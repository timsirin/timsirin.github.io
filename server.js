require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'timsirinSuperSecretKey';

// Middleware
app.use(cors());
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

// ============================================================
//  AUTHENTIFICATION
// ============================================================
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token manquant' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token invalide' });
  }
}

// ============================================================
//  ROUTES
// ============================================================

// --- Login ---
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Identifiants incorrects' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });
});

// --- Récupérer les cours accessibles ---
app.get('/api/courses', authenticate, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  let sql = 'SELECT * FROM courses';
  const params = [];
  if (!isAdmin) {
    sql += ' WHERE teacherEmail = ?';
    params.push(req.user.email);
  }
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// --- Récupérer les étudiants ---
app.get('/api/students', authenticate, (req, res) => {
  const { courseId } = req.query;
  const isAdmin = req.user.role === 'admin';
  let sql = 'SELECT * FROM students';
  const params = [];
  if (courseId) {
    sql += ' WHERE courseId = ?';
    params.push(courseId);
  } else if (!isAdmin) {
    sql += ' WHERE courseId IN (SELECT id FROM courses WHERE teacherEmail = ?)';
    params.push(req.user.email);
  }
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// --- Marquer une présence ---
app.post('/api/attendance', authenticate, (req, res) => {
  const { studentId, courseId, status } = req.body;
  const date = new Date().toISOString().slice(0, 10);

  function upsert() {
    const id = 'att_' + Date.now() + '_' + studentId;
    db.run(
      `INSERT OR REPLACE INTO attendance (id, studentId, courseId, date, status)
       VALUES (?, ?, ?, ?, ?)`,
      [id, studentId, courseId, date, status],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, date });
      }
    );
  }

  if (req.user.role === 'admin') {
    upsert();
  } else {
    db.get('SELECT * FROM courses WHERE id = ? AND teacherEmail = ?', [courseId, req.user.email], (err, course) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!course) return res.status(403).json({ error: 'Accès non autorisé' });
      upsert();
    });
  }
});

// --- Récupérer les présences ---
app.get('/api/attendance', authenticate, (req, res) => {
  const { courseId, month } = req.query;
  let sql = 'SELECT * FROM attendance';
  const params = [];
  const conditions = [];
  if (courseId) { conditions.push('courseId = ?'); params.push(courseId); }
  if (month) { conditions.push('date LIKE ?'); params.push(month + '%'); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  if (req.user.role !== 'admin') {
    sql += (conditions.length ? ' AND' : ' WHERE') + ' courseId IN (SELECT id FROM courses WHERE teacherEmail = ?)';
    params.push(req.user.email);
  }
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// --- Planning complet ---
app.get('/api/planning', authenticate, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  let sql = 'SELECT * FROM courses';
  const params = [];
  if (!isAdmin) { sql += ' WHERE teacherEmail = ?'; params.push(req.user.email); }
  db.all(sql, params, (err, courses) => {
    if (err) return res.status(500).json({ error: err.message });
    const result = [];
    let remaining = courses.length;
    if (remaining === 0) return res.json([]);
    courses.forEach(course => {
      db.all('SELECT * FROM slots WHERE courseId = ?', [course.id], (errSlots, slots) => {
        db.all('SELECT * FROM learners WHERE courseId = ?', [course.id], (errLearners, learners) => {
          if (errSlots || errLearners) return res.status(500).json({ error: errSlots?.message || errLearners?.message });
          result.push({
            ...course,
            slots: slots.map(s => ({ date: s.date, time: s.time })),
            learners: learners.map(l => l.name)
          });
          remaining--;
          if (remaining === 0) res.json(result);
        });
      });
    });
  });
});

// --- Mettre à jour un champ d'un cours ---
app.put('/api/courses/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const { field, value } = req.body;
  const allowed = ['teacher', 'public', 'zoomLink', 'schedule', 'teacherEmail'];
  if (!allowed.includes(field)) return res.status(400).json({ error: 'Champ invalide' });

  function update() {
    db.run(`UPDATE courses SET ${field} = ? WHERE id = ?`, [value, id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  }

  if (req.user.role === 'admin') {
    update();
  } else {
    db.get('SELECT * FROM courses WHERE id = ? AND teacherEmail = ?', [id, req.user.email], (err, course) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!course) return res.status(403).json({ error: 'Non autorisé' });
      update();
    });
  }
});

// --- Ajouter un slot ---
app.post('/api/slots', authenticate, (req, res) => {
  const { courseId, date, time } = req.body;
  if (!courseId || !date) return res.status(400).json({ error: 'courseId et date requis' });

  function insert() {
    db.run('INSERT INTO slots (courseId, date, time) VALUES (?, ?, ?)', [courseId, date, time || ''], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    });
  }

  if (req.user.role === 'admin') {
    insert();
  } else {
    db.get('SELECT * FROM courses WHERE id = ? AND teacherEmail = ?', [courseId, req.user.email], (err, course) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!course) return res.status(403).json({ error: 'Non autorisé' });
      insert();
    });
  }
});

// --- Supprimer un slot ---
app.delete('/api/slots/:id', authenticate, (req, res) => {
  const { id } = req.params;
  db.get('SELECT courseId FROM slots WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Slot introuvable' });

    function del() {
      db.run('DELETE FROM slots WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    }

    if (req.user.role === 'admin') {
      del();
    } else {
      db.get('SELECT * FROM courses WHERE id = ? AND teacherEmail = ?', [row.courseId, req.user.email], (err2, course) => {
        if (err2) return res.status(500).json({ error: err2.message });
        if (!course) return res.status(403).json({ error: 'Non autorisé' });
        del();
      });
    }
  });
});

// --- Ajouter un apprenant (learner) ---
app.post('/api/learners', authenticate, (req, res) => {
  const { courseId, name } = req.body;
  if (!courseId || !name) return res.status(400).json({ error: 'courseId et name requis' });

  function insert() {
    db.run('INSERT INTO learners (courseId, name) VALUES (?, ?)', [courseId, name], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    });
  }

  if (req.user.role === 'admin') {
    insert();
  } else {
    db.get('SELECT * FROM courses WHERE id = ? AND teacherEmail = ?', [courseId, req.user.email], (err, course) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!course) return res.status(403).json({ error: 'Non autorisé' });
      insert();
    });
  }
});

// --- Supprimer un apprenant (learner) ---
app.delete('/api/learners/:id', authenticate, (req, res) => {
  const { id } = req.params;
  db.get('SELECT courseId FROM learners WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Apprenant introuvable' });

    function del() {
      db.run('DELETE FROM learners WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    }

    if (req.user.role === 'admin') {
      del();
    } else {
      db.get('SELECT * FROM courses WHERE id = ? AND teacherEmail = ?', [row.courseId, req.user.email], (err2, course) => {
        if (err2) return res.status(500).json({ error: err2.message });
        if (!course) return res.status(403).json({ error: 'Non autorisé' });
        del();
      });
    }
  });
});

// --- (Admin) Ajouter un cours ---
app.post('/api/courses', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });
  const { id, title, teacher, teacherEmail, schedule, public, zoomLink } = req.body;
  if (!id || !title || !teacher || !teacherEmail) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  db.run(
    'INSERT INTO courses (id, title, teacher, teacherEmail, schedule, public, zoomLink) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, title, teacher, teacherEmail, schedule || '', public || 'adultes', zoomLink || ''],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

// --- (Admin) Supprimer un cours ---
app.delete('/api/courses/:id', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });
  const { id } = req.params;
  db.run('DELETE FROM courses WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// --- (Admin) Ajouter un étudiant ---
app.post('/api/students', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });
  const { id, name, email, courseId } = req.body;
  if (!id || !name || !email || !courseId) return res.status(400).json({ error: 'Champs requis' });
  db.run('INSERT INTO students (id, name, email, courseId) VALUES (?, ?, ?, ?)',
    [id, name, email, courseId],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

// --- (Admin) Supprimer un étudiant ---
app.delete('/api/students/:id', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });
  const { id } = req.params;
  db.run('DELETE FROM students WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// --- (Admin) Importer des apprenants depuis un fichier CSV ---
app.post('/api/students/import', authenticate, upload.single('file'), (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });
  const { courseId } = req.body;
  if (!courseId) return res.status(400).json({ error: 'courseId requis' });
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier uploadé' });

  const fs = require('fs');
  const content = fs.readFileSync(req.file.path, 'utf8');
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
  const names = lines.map(line => line.split(/[;,]\s*/)[0].trim()).filter(n => n !== '');

  if (names.length === 0) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Aucun nom trouvé dans le fichier' });
  }

  let inserted = 0;
  let remaining = names.length;

  names.forEach(name => {
    const id = 's_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    db.run('INSERT INTO students (id, name, email, courseId) VALUES (?, ?, ?, ?)',
      [id, name, '', courseId],
      function(err) {
        if (!err) inserted++;
        remaining--;
        if (remaining === 0) {
          fs.unlinkSync(req.file.path);
          res.json({ success: true, imported: inserted, total: names.length });
        }
      }
    );
  });
});
// ============================================================
//  ROUTE D'INITIALISATION DE LA BASE DE DONNÉES (une seule fois)
// ============================================================
const { exec } = require('child_process');
const path = require('path');

// Route protégée par un token simple (pour éviter les accès non autorisés)
const INIT_TOKEN = 'monTokenSecret123'; // Changez-le par un mot de passe fort

app.get('/init-db', (req, res) => {
  const token = req.query.token;
  if (token !== INIT_TOKEN) {
    return res.status(403).json({ error: 'Token invalide' });
  }

  // Exécuter le script initDB.js
  const scriptPath = path.join(__dirname, 'initDB.js');
  exec(`node ${scriptPath}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Erreur : ${error}`);
      return res.status(500).json({ error: 'Échec de l\'initialisation', details: stderr });
    }
    console.log(stdout);
    res.json({ message: 'Base de données initialisée avec succès !', output: stdout });
  });
});
// Route de debug (à supprimer après)
app.get('/debug-users', (req, res) => {
  db.all('SELECT email, password_hash FROM users', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows.map(r => ({
      email: r.email,
      hash_length: r.password_hash ? r.password_hash.length : 0,
      hash_start: r.password_hash ? r.password_hash.substring(0, 20) : null
    })));
  });
});
// --- Démarrer ---
app.listen(PORT, () => {
  console.log(`🚀 Serveur Timsirin démarré sur http://localhost:${PORT}`);
});