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

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'timsirinSecretKey';

app.use(cors());
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

// ============================================================
//  INITIALISATION AUTOMATIQUE (si vide)
// ============================================================
db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
  if (err) {
    console.error('❌ Erreur vérification users:', err.message);
    return;
  }
  if (row.count === 0) {
    console.log('🔄 Base vide, initialisation...');
    exec('node initDB.js', (error, stdout, stderr) => {
      if (error) console.error('❌ Erreur init:', error);
      else console.log(stdout);
    });
  } else {
    console.log(`✅ Base OK (${row.count} utilisateurs)`);
  }
});

// ============================================================
//  MIDDLEWARE AUTH
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

// ============================================================
//  ROUTES D'ADMINISTRATION
// ============================================================

// --- Récupérer tous les étudiants ---
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

// --- Mettre à jour un étudiant (payment_status, amount_paid) ---
app.put('/api/students/:id', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });
  const { id } = req.params;
  const { payment_status, amount_paid } = req.body;
  console.log('📝 Mise à jour étudiant:', id, { payment_status, amount_paid });

  if (payment_status === undefined && amount_paid === undefined) {
    return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });
  }

  // Construire la requête dynamiquement
  let fields = [];
  let values = [];
  if (payment_status !== undefined) {
    fields.push('payment_status = ?');
    values.push(payment_status);
  }
  if (amount_paid !== undefined) {
    fields.push('amount_paid = ?');
    values.push(parseFloat(amount_paid));
  }
  values.push(id);

  const sql = `UPDATE students SET ${fields.join(', ')} WHERE id = ?`;
  db.run(sql, values, function(err) {
    if (err) {
      console.error('❌ Erreur UPDATE:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

// --- Supprimer plusieurs étudiants ---
app.delete('/api/students', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Aucun ID fourni' });
  }
  const placeholders = ids.map(() => '?').join(',');
  db.run(`DELETE FROM students WHERE id IN (${placeholders})`, ids, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

// --- Statistiques financières ---
app.get('/api/stats/financial', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });
  db.get(`SELECT 
    SUM(amount_paid) as total_encaisse, 
    SUM(CASE WHEN amount_paid > 120 THEN amount_paid - 120 ELSE 0 END) as total_dons 
    FROM students`, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ total_encaisse: row.total_encaisse || 0, total_dons: row.total_dons || 0 });
  });
});

// ============================================================
//  AUTRES ROUTES (courses, attendance, planning...)
//  (identique à la version précédente – ne pas oublier de les inclure)
// ============================================================

// ... (ajoutez ici toutes les routes existantes pour courses, attendance, planning, etc.)

// ============================================================
//  DÉMARRAGE
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Serveur Timsirin démarré sur http://localhost:${PORT}`);
});