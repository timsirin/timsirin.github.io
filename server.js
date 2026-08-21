require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const { backupDatabase, restoreDatabase } = require('./backup');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'timsirinSecretKey';

// ============================================================
//  MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

// ============================================================
//  RESTAURATION DE LA BASE AU DÉMARRAGE (GitHub backup)
// ============================================================
(async () => {
  await restoreDatabase();
})();

// ============================================================
//  INITIALISATION AUTOMATIQUE (si la base est vide)
// ============================================================
(async () => {
  try {
    const row = await db.get('SELECT COUNT(*) as count FROM users');
    if (row.count === 0) {
      console.log('🔄 Base vide, initialisation...');
      exec('node initDB.js', (error, stdout, stderr) => {
        if (error) {
          console.error('❌ Erreur init:', error);
          console.error('stderr:', stderr);
          return;
        }
        console.log('✅ Base initialisée avec succès !');
        console.log(stdout);
        setImmediate(() => backupDatabase());
      });
    } else {
      console.log(`✅ Base OK (${row.count} utilisateurs)`);
    }
  } catch (err) {
    console.error('❌ Erreur vérification users:', err.message);
  }
})();

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
//  ROUTES PUBLIQUES
// ============================================================

// --- Login ---
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  try {
    const user = await db.get('SELECT * FROM users WHERE email = $1', [email]);
    if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Identifiants incorrects' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error('❌ Erreur login:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  ROUTES PROTÉGÉES (exemples)
// ============================================================

// --- Récupérer les cours ---
app.get('/api/courses', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let sql = 'SELECT * FROM courses';
    const params = [];
    if (!isAdmin) {
      sql += ' WHERE teacherEmail = $1';
      params.push(req.user.email);
    }
    const rows = await db.all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Récupérer les étudiants ---
app.get('/api/students', authenticate, async (req, res) => {
  try {
    const { courseId } = req.query;
    const isAdmin = req.user.role === 'admin';
    let sql = 'SELECT * FROM students';
    const params = [];
    if (courseId) {
      sql += ' WHERE courseId = $1';
      params.push(courseId);
    } else if (!isAdmin) {
      sql += ' WHERE courseId IN (SELECT id FROM courses WHERE teacherEmail = $1)';
      params.push(req.user.email);
    }
    const rows = await db.all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Mettre à jour un étudiant ---
app.put('/api/students/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });
  const { id } = req.params;
  const { payment_status, amount_paid } = req.body;
  console.log('📝 Mise à jour étudiant:', id, { payment_status, amount_paid });

  try {
    let fields = [];
    let values = [];
    let paramIndex = 1;

    if (payment_status !== undefined) {
      fields.push(`payment_status = $${paramIndex}`);
      values.push(payment_status);
      paramIndex++;
    }
    if (amount_paid !== undefined) {
      fields.push(`amount_paid = $${paramIndex}`);
      values.push(parseFloat(amount_paid));
      paramIndex++;
    }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });
    }

    values.push(id);
    const sql = `UPDATE students SET ${fields.join(', ')} WHERE id = $${paramIndex}`;

    await db.run(sql, values);
    res.json({ success: true });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error('❌ Erreur UPDATE:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Supprimer plusieurs étudiants ---
app.delete('/api/students', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Aucun ID fourni' });
  }

  try {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const result = await db.run(`DELETE FROM students WHERE id IN (${placeholders})`, ids);
    res.json({ success: true, deleted: result.rowCount });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Statistiques financières ---
app.get('/api/stats/financial', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });

  try {
    const row = await db.get(`
      SELECT 
        SUM(amount_paid) as total_encaisse, 
        SUM(CASE WHEN amount_paid > 120 THEN amount_paid - 120 ELSE 0 END) as total_dons 
      FROM students
    `);
    res.json({
      total_encaisse: row.total_encaisse || 0,
      total_dons: row.total_dons || 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Marquer une présence ---
app.post('/api/attendance', authenticate, async (req, res) => {
  const { studentId, courseId, status } = req.body;
  const date = new Date().toISOString().slice(0, 10);

  try {
    const id = 'att_' + Date.now() + '_' + studentId;
    await db.run(
      `INSERT INTO attendance (id, studentId, courseId, date, status) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET status = $5`,
      [id, studentId, courseId, date, status]
    );
    res.json({ success: true, date });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Récupérer les présences ---
app.get('/api/attendance', authenticate, async (req, res) => {
  try {
    const { courseId, month } = req.query;
    let sql = 'SELECT * FROM attendance';
    const params = [];
    const conditions = [];
    let paramIndex = 1;

    if (courseId) {
      conditions.push(`courseId = $${paramIndex}`);
      params.push(courseId);
      paramIndex++;
    }
    if (month) {
      conditions.push(`date LIKE $${paramIndex}`);
      params.push(month + '%');
      paramIndex++;
    }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');

    if (req.user.role !== 'admin') {
      sql += (conditions.length ? ' AND' : ' WHERE') +
        ` courseId IN (SELECT id FROM courses WHERE teacherEmail = $${paramIndex})`;
      params.push(req.user.email);
    }

    const rows = await db.all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Planning complet ---
app.get('/api/planning', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let sql = 'SELECT * FROM courses';
    const params = [];

    if (!isAdmin) {
      sql += ' WHERE teacherEmail = $1';
      params.push(req.user.email);
    }

    const courses = await db.all(sql, params);
    const result = [];

    for (const course of courses) {
      const slots = await db.all('SELECT * FROM slots WHERE courseId = $1', [course.id]);
      const learners = await db.all('SELECT * FROM learners WHERE courseId = $1', [course.id]);

      result.push({
        ...course,
        slots: slots.map(s => ({ date: s.date, time: s.time, id: s.id })),
        learners: learners.map(l => l.name)
      });
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Mettre à jour un champ d'un cours ---
app.put('/api/courses/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { field, value } = req.body;
  const allowed = ['teacher', 'public', 'zoomLink', 'schedule', 'teacherEmail'];
  if (!allowed.includes(field)) return res.status(400).json({ error: 'Champ invalide' });

  try {
    await db.run(`UPDATE courses SET ${field} = $1 WHERE id = $2`, [value, id]);
    res.json({ success: true });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Ajouter un slot ---
app.post('/api/slots', authenticate, async (req, res) => {
  const { courseId, date, time } = req.body;
  if (!courseId || !date) return res.status(400).json({ error: 'courseId et date requis' });

  try {
    const result = await db.run(
      'INSERT INTO slots (courseId, date, time) VALUES ($1, $2, $3)',
      [courseId, date, time || '']
    );
    res.json({ success: true, id: result.rows?.[0]?.id || Date.now() });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Supprimer un slot ---
app.delete('/api/slots/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    const row = await db.get('SELECT courseId FROM slots WHERE id = $1', [id]);
    if (!row) return res.status(404).json({ error: 'Slot introuvable' });

    await db.run('DELETE FROM slots WHERE id = $1', [id]);
    res.json({ success: true });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Mettre à jour un slot ---
app.put('/api/slots/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { field, value } = req.body;
  if (!['date', 'time'].includes(field)) return res.status(400).json({ error: 'Champ invalide' });

  try {
    const row = await db.get('SELECT courseId FROM slots WHERE id = $1', [id]);
    if (!row) return res.status(404).json({ error: 'Slot introuvable' });

    await db.run(`UPDATE slots SET ${field} = $1 WHERE id = $2`, [value, id]);
    res.json({ success: true });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Ajouter un learner ---
app.post('/api/learners', authenticate, async (req, res) => {
  const { courseId, name } = req.body;
  if (!courseId || !name) return res.status(400).json({ error: 'courseId et name requis' });

  try {
    const result = await db.run(
      'INSERT INTO learners (courseId, name) VALUES ($1, $2)',
      [courseId, name]
    );
    res.json({ success: true, id: result.rows?.[0]?.id || Date.now() });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Supprimer un learner ---
app.delete('/api/learners/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    const row = await db.get('SELECT courseId FROM learners WHERE id = $1', [id]);
    if (!row) return res.status(404).json({ error: 'Apprenant introuvable' });

    await db.run('DELETE FROM learners WHERE id = $1', [id]);
    res.json({ success: true });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Récupérer les learners avec filtres ---
app.get('/api/learners', authenticate, async (req, res) => {
  try {
    const { courseId, name } = req.query;
    let sql = 'SELECT * FROM learners';
    const params = [];
    const conditions = [];
    let paramIndex = 1;

    if (courseId) {
      conditions.push(`courseId = $${paramIndex}`);
      params.push(courseId);
      paramIndex++;
    }
    if (name) {
      conditions.push(`name = $${paramIndex}`);
      params.push(name);
      paramIndex++;
    }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    const rows = await db.all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- (Admin) Ajouter un cours ---
app.post('/api/courses', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });

  const { id, title, teacher, teacherEmail, schedule, public, zoomLink } = req.body;
  if (!id || !title || !teacher || !teacherEmail) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }

  try {
    await db.run(
      `INSERT INTO courses (id, title, teacher, teacherEmail, schedule, public, zoomLink) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, title, teacher, teacherEmail, schedule || '', public || 'adultes', zoomLink || '']
    );
    res.json({ success: true });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- (Admin) Supprimer un cours ---
app.delete('/api/courses/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });

  const { id } = req.params;

  try {
    await db.run('DELETE FROM courses WHERE id = $1', [id]);
    res.json({ success: true });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- (Admin) Ajouter un étudiant ---
app.post('/api/students', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });

  const { id, name, email, courseId } = req.body;
  if (!id || !name || !email || !courseId) return res.status(400).json({ error: 'Champs requis' });

  try {
    await db.run(
      `INSERT INTO students (id, name, email, courseId, payment_status, amount_paid) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, name, email, courseId, 'unpaid', 0]
    );
    res.json({ success: true });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- (Admin) Supprimer un étudiant (unique) ---
app.delete('/api/students/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });

  const { id } = req.params;

  try {
    await db.run('DELETE FROM students WHERE id = $1', [id]);
    res.json({ success: true });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- (Admin) Importer des apprenants depuis un CSV ---
app.post('/api/students/import', authenticate, upload.single('file'), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });

  const { courseId } = req.body;
  if (!courseId) return res.status(400).json({ error: 'courseId requis' });
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier uploadé' });

  const content = fs.readFileSync(req.file.path, 'utf8');
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
  const names = lines.map(line => line.split(/[;,]\s*/)[0].trim()).filter(n => n !== '');

  if (names.length === 0) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Aucun nom trouvé dans le fichier' });
  }

  let inserted = 0;

  try {
    for (const name of names) {
      const id = 's_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      await db.run(
        `INSERT INTO students (id, name, email, courseId, payment_status, amount_paid) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, name, '', courseId, 'unpaid', 0]
      );
      inserted++;
    }

    fs.unlinkSync(req.file.path);
    res.json({ success: true, imported: inserted, total: names.length });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error(err);
    fs.unlinkSync(req.file.path);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  ROUTES D'ADMINISTRATION (ajout d'enseignants / admins)
// ============================================================
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '2976AllianceTmazight2026';

app.post('/admin/add-teacher', async (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'Token invalide' });

  const { email, password, name, courseId } = req.body;
  if (!email || !password || !name || !courseId) {
    return res.status(400).json({ error: 'Tous les champs sont requis : email, password, name, courseId' });
  }

  try {
    const course = await db.get('SELECT * FROM courses WHERE id = $1', [courseId]);
    if (!course) return res.status(404).json({ error: 'Cours introuvable' });

    const existing = await db.get('SELECT * FROM users WHERE email = $1', [email]);
    if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const hash = await bcrypt.hash(password, 10);
    await db.run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      [email, hash, name, 'teacher']
    );
    await db.run(
      'UPDATE courses SET teacher = $1, teacherEmail = $2 WHERE id = $3',
      [name, email, courseId]
    );

    res.json({ success: true, message: `Enseignant ${name} ajouté et associé au cours ${course.title}` });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error('❌ Erreur ajout enseignant:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/add-admin', async (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'Token invalide' });

  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Tous les champs sont requis : email, password, name' });
  }

  try {
    const existing = await db.get('SELECT * FROM users WHERE email = $1', [email]);
    if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const hash = await bcrypt.hash(password, 10);
    await db.run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      [email, hash, name, 'admin']
    );

    res.json({ success: true, message: `Administrateur ${name} ajouté avec succès !` });
    setImmediate(() => backupDatabase());
  } catch (err) {
    console.error('❌ Erreur ajout administrateur:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  ROUTE DE TEST DE LA BASE DE DONNÉES (à supprimer après)
// ============================================================
app.get('/test-db', async (req, res) => {
  try {
    const result = await db.get('SELECT NOW()');
    res.json({ success: true, time: result.now });
  } catch (err) {
    console.error('❌ Erreur test DB:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  DÉMARRAGE
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Serveur Timsirin démarré sur http://localhost:${PORT}`);
});