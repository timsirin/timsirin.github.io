require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./database');
const { ensureSchema, seed } = require('./initDB');

const app = express();
const PORT = process.env.PORT || 3000;

// Les secrets doivent venir des variables d'environnement (le dépôt est public).
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET non défini. Ajoutez-le dans les variables d\'environnement (Render).');
  process.exit(1);
}
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;

// ============================================================
//  MIDDLEWARE
// ============================================================
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined));
app.use(express.json());
// Fichiers importés gardés en mémoire (pas de dossier uploads/ à nettoyer)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// ============================================================
//  INITIALISATION (non destructive)
// ============================================================
const ready = (async () => {
  try {
    await ensureSchema();
    const row = await db.get('SELECT COUNT(*)::int AS count FROM users');
    if (row.count === 0) {
      console.log('🔄 Aucun utilisateur, création des comptes initiaux...');
      await seed();
    } else {
      console.log(`✅ Base OK (${row.count} utilisateurs)`);
    }
  } catch (err) {
    console.error('❌ Erreur initialisation base:', err.message);
  }
})();

// ============================================================
//  AUTHENTIFICATION / AUTORISATIONS
// ============================================================
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'administrateur' });
  next();
}

const isAdmin = (user) => user.role === 'admin';

// Un enseignant n'a accès qu'aux cours dont il est l'enseignant.
async function canAccessCourse(user, courseId) {
  if (isAdmin(user)) return true;
  if (!courseId) return false;
  const c = await db.get('SELECT id FROM courses WHERE id = $1 AND LOWER(teacherEmail) = LOWER($2)', [courseId, user.email]);
  return !!c;
}

async function denyIfNoAccess(req, res, courseId) {
  if (await canAccessCourse(req.user, courseId)) return false;
  res.status(403).json({ error: 'Accès refusé à ce cours' });
  return true;
}

const todayISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function serverError(res, err) {
  console.error('❌', err);
  res.status(500).json({ error: 'Erreur serveur' });
}

// ============================================================
//  ROUTES PUBLIQUES
// ============================================================
app.get('/api/health', async (req, res) => {
  try {
    await ready;
    await db.get('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  try {
    await ready;
    const user = await db.get('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) { serverError(res, err); }
});

// ============================================================
//  COURS
// ============================================================
app.get('/api/courses', authenticate, async (req, res) => {
  try {
    const rows = isAdmin(req.user)
      ? await db.all('SELECT * FROM courses ORDER BY id')
      : await db.all('SELECT * FROM courses WHERE LOWER(teacherEmail) = LOWER($1) ORDER BY id', [req.user.email]);
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.post('/api/courses', authenticate, requireAdmin, async (req, res) => {
  const { id, title, teacher, teacherEmail, schedule, zoomLink } = req.body;
  const pub = req.body.public;
  if (!id || !title || !teacher || !teacherEmail) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  try {
    await db.run(
      `INSERT INTO courses (id, title, teacher, teacherEmail, schedule, public, zoomLink)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, title, teacher, teacherEmail, schedule || '', pub || 'adultes', zoomLink || '']
    );
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.put('/api/courses/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { field, value } = req.body;
  const teacherFields = ['teacher', 'public', 'zoomLink', 'schedule'];
  const adminFields = [...teacherFields, 'teacherEmail', 'title'];
  const allowed = isAdmin(req.user) ? adminFields : teacherFields;
  if (!allowed.includes(field)) return res.status(400).json({ error: 'Champ invalide' });
  if (field === 'public' && !['adultes', 'enfants'].includes(value)) {
    return res.status(400).json({ error: 'Valeur invalide' });
  }

  try {
    if (await denyIfNoAccess(req, res, id)) return;
    await db.run(`UPDATE courses SET ${field} = $1 WHERE id = $2`, [value ?? '', id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// Supprime le cours ET toutes ses données liées
app.delete('/api/courses/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    for (const t of ['attendance', 'students', 'slots', 'learners']) {
      await db.run(`DELETE FROM ${t} WHERE courseId = $1`, [id]);
    }
    await db.run('DELETE FROM courses WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// ============================================================
//  ÉTUDIANTS
// ============================================================
app.get('/api/students', authenticate, async (req, res) => {
  try {
    const { courseId } = req.query;
    if (courseId) {
      if (await denyIfNoAccess(req, res, courseId)) return;
      return res.json(await db.all('SELECT * FROM students WHERE courseId = $1 ORDER BY name', [courseId]));
    }
    const rows = isAdmin(req.user)
      ? await db.all('SELECT * FROM students ORDER BY name')
      : await db.all(
        'SELECT * FROM students WHERE courseId IN (SELECT id FROM courses WHERE LOWER(teacherEmail) = LOWER($1)) ORDER BY name',
        [req.user.email]);
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.post('/api/students', authenticate, requireAdmin, async (req, res) => {
  const { id, name, email, courseId } = req.body;
  if (!id || !name || !courseId) return res.status(400).json({ error: 'Champs requis' });
  try {
    await db.run(
      `INSERT INTO students (id, name, email, courseId, payment_status, amount_paid)
       VALUES ($1, $2, $3, $4, 'unpaid', 0)`,
      [id, name, email || '', courseId]
    );
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.put('/api/students/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { payment_status, amount_paid } = req.body;
  const fields = [];
  const values = [];

  if (payment_status !== undefined) {
    if (!['unpaid', 'partial', 'paid'].includes(payment_status)) {
      return res.status(400).json({ error: 'Statut de paiement invalide' });
    }
    values.push(payment_status);
    fields.push(`payment_status = $${values.length}`);
  }
  if (amount_paid !== undefined) {
    const amount = parseFloat(amount_paid);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Montant invalide' });
    values.push(amount);
    fields.push(`amount_paid = $${values.length}`);
  }
  if (fields.length === 0) return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });

  try {
    values.push(id);
    await db.run(`UPDATE students SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.delete('/api/students', authenticate, requireAdmin, async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Aucun ID fourni' });
  try {
    await db.run('DELETE FROM attendance WHERE studentId = ANY($1)', [ids]);
    const result = await db.run('DELETE FROM students WHERE id = ANY($1)', [ids]);
    res.json({ success: true, deleted: result.rowCount });
  } catch (err) { serverError(res, err); }
});

app.delete('/api/students/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM attendance WHERE studentId = $1', [id]);
    await db.run('DELETE FROM students WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// Import CSV / TXT : un nom par ligne (1re colonne si CSV). Ligne d'en-tête ignorée.
app.post('/api/students/import', authenticate, requireAdmin, upload.single('file'), async (req, res) => {
  const { courseId } = req.body;
  if (!courseId) return res.status(400).json({ error: 'courseId requis' });
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier uploadé' });

  const content = req.file.buffer.toString('utf8').replace(/^﻿/, '');
  const HEADERS = ['nom', 'name', 'nom complet', 'nom & prénom', 'nom et prénom', 'apprenant'];
  const rows = content.split(/\r?\n/)
    .map(line => line.split(/[;,\t]/))
    .map(cols => ({
      name: (cols[0] || '').replace(/^"|"$/g, '').trim(),
      email: (cols[1] || '').replace(/^"|"$/g, '').trim()
    }))
    .filter(r => r.name && !HEADERS.includes(r.name.toLowerCase()));

  if (rows.length === 0) return res.status(400).json({ error: 'Aucun nom trouvé dans le fichier' });

  try {
    const course = await db.get('SELECT id FROM courses WHERE id = $1', [courseId]);
    if (!course) return res.status(404).json({ error: 'Cours introuvable' });

    let inserted = 0;
    for (const r of rows) {
      const id = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const email = /@/.test(r.email) ? r.email : '';
      await db.run(
        `INSERT INTO students (id, name, email, courseId, payment_status, amount_paid)
         VALUES ($1, $2, $3, $4, 'unpaid', 0)`,
        [id, r.name, email, courseId]
      );
      inserted++;
    }
    res.json({ success: true, imported: inserted, total: rows.length });
  } catch (err) { serverError(res, err); }
});

// ============================================================
//  STATISTIQUES
// ============================================================
app.get('/api/stats/financial', authenticate, requireAdmin, async (req, res) => {
  try {
    const row = await db.get(`
      SELECT
        COALESCE(SUM(amount_paid), 0)::float AS total_encaisse,
        COALESCE(SUM(CASE WHEN amount_paid > 120 THEN amount_paid - 120 ELSE 0 END), 0)::float AS total_dons
      FROM students
    `);
    res.json(row);
  } catch (err) { serverError(res, err); }
});

// ============================================================
//  PRÉSENCES
// ============================================================
app.post('/api/attendance', authenticate, async (req, res) => {
  const { studentId, courseId, status } = req.body;
  if (!studentId || !courseId) return res.status(400).json({ error: 'studentId et courseId requis' });
  if (!['present', 'retard', 'absent'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  const date = isISODate(req.body.date) ? req.body.date : todayISO();

  try {
    if (await denyIfNoAccess(req, res, courseId)) return;
    // Un seul enregistrement par apprenant / cours / jour : on remplace l'ancien.
    await db.run('DELETE FROM attendance WHERE studentId = $1 AND courseId = $2 AND date = $3',
      [studentId, courseId, date]);
    const id = `att_${date}_${courseId}_${studentId}`;
    await db.run(
      'INSERT INTO attendance (id, studentId, courseId, date, status) VALUES ($1, $2, $3, $4, $5)',
      [id, studentId, courseId, date, status]
    );
    res.json({ success: true, date });
  } catch (err) { serverError(res, err); }
});

app.get('/api/attendance', authenticate, async (req, res) => {
  try {
    const { courseId, month } = req.query;
    const conditions = [];
    const params = [];

    if (courseId) {
      params.push(courseId);
      conditions.push(`courseId = $${params.length}`);
    }
    if (month) {
      params.push(month + '%');
      conditions.push(`date LIKE $${params.length}`);
    }
    if (!isAdmin(req.user)) {
      params.push(req.user.email);
      conditions.push(`courseId IN (SELECT id FROM courses WHERE LOWER(teacherEmail) = LOWER($${params.length}))`);
    }

    let sql = 'SELECT * FROM attendance';
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY date, id';
    res.json(await db.all(sql, params));
  } catch (err) { serverError(res, err); }
});

// ============================================================
//  PLANNING (créneaux + liste d'apprenants)
// ============================================================
app.get('/api/planning', authenticate, async (req, res) => {
  try {
    const courses = isAdmin(req.user)
      ? await db.all('SELECT * FROM courses ORDER BY id')
      : await db.all('SELECT * FROM courses WHERE LOWER(teacherEmail) = LOWER($1) ORDER BY id', [req.user.email]);
    const ids = courses.map(c => c.id);
    const slots = await db.all('SELECT * FROM slots WHERE courseId = ANY($1) ORDER BY date, time, id', [ids]);
    const learners = await db.all('SELECT * FROM learners WHERE courseId = ANY($1) ORDER BY id', [ids]);

    res.json(courses.map(course => ({
      ...course,
      slots: slots.filter(s => s.courseId === course.id).map(s => ({ id: s.id, date: s.date, time: s.time })),
      learners: learners.filter(l => l.courseId === course.id).map(l => ({ id: l.id, name: l.name }))
    })));
  } catch (err) { serverError(res, err); }
});

app.get('/api/slots', authenticate, async (req, res) => {
  const { courseId } = req.query;
  try {
    if (await denyIfNoAccess(req, res, courseId)) return;
    res.json(await db.all('SELECT * FROM slots WHERE courseId = $1 ORDER BY date, time, id', [courseId]));
  } catch (err) { serverError(res, err); }
});

app.post('/api/slots', authenticate, async (req, res) => {
  const { courseId, date, time } = req.body;
  if (!courseId || !isISODate(date)) return res.status(400).json({ error: 'courseId et date (AAAA-MM-JJ) requis' });
  try {
    if (await denyIfNoAccess(req, res, courseId)) return;
    const row = await db.get(
      'INSERT INTO slots (courseId, date, time) VALUES ($1, $2, $3) RETURNING id',
      [courseId, date, time || '']
    );
    res.json({ success: true, id: row.id });
  } catch (err) { serverError(res, err); }
});

app.put('/api/slots/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { field, value } = req.body;
  if (!['date', 'time'].includes(field)) return res.status(400).json({ error: 'Champ invalide' });
  if (field === 'date' && !isISODate(value)) return res.status(400).json({ error: 'Date invalide' });
  try {
    const row = await db.get('SELECT courseId FROM slots WHERE id = $1', [id]);
    if (!row) return res.status(404).json({ error: 'Créneau introuvable' });
    if (await denyIfNoAccess(req, res, row.courseId)) return;
    await db.run(`UPDATE slots SET ${field} = $1 WHERE id = $2`, [value || '', id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.delete('/api/slots/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const row = await db.get('SELECT courseId FROM slots WHERE id = $1', [id]);
    if (!row) return res.status(404).json({ error: 'Créneau introuvable' });
    if (await denyIfNoAccess(req, res, row.courseId)) return;
    await db.run('DELETE FROM slots WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.get('/api/learners', authenticate, async (req, res) => {
  const { courseId } = req.query;
  try {
    if (await denyIfNoAccess(req, res, courseId)) return;
    res.json(await db.all('SELECT * FROM learners WHERE courseId = $1 ORDER BY id', [courseId]));
  } catch (err) { serverError(res, err); }
});

app.post('/api/learners', authenticate, async (req, res) => {
  const { courseId } = req.body;
  // Accepte un nom unique (name) ou une liste (names)
  const names = (Array.isArray(req.body.names) ? req.body.names : [req.body.name])
    .map(n => String(n || '').trim()).filter(Boolean);
  if (!courseId || names.length === 0) return res.status(400).json({ error: 'courseId et name requis' });
  try {
    if (await denyIfNoAccess(req, res, courseId)) return;
    for (const name of names) {
      await db.run('INSERT INTO learners (courseId, name) VALUES ($1, $2)', [courseId, name]);
    }
    res.json({ success: true, added: names.length });
  } catch (err) { serverError(res, err); }
});

app.delete('/api/learners/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const row = await db.get('SELECT courseId FROM learners WHERE id = $1', [id]);
    if (!row) return res.status(404).json({ error: 'Apprenant introuvable' });
    if (await denyIfNoAccess(req, res, row.courseId)) return;
    await db.run('DELETE FROM learners WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// Vide les créneaux et/ou la liste d'apprenants d'un cours
app.delete('/api/planning/:courseId', authenticate, async (req, res) => {
  const { courseId } = req.params;
  const what = req.query.what || 'all'; // 'slots' | 'learners' | 'all'
  try {
    if (await denyIfNoAccess(req, res, courseId)) return;
    if (what === 'slots' || what === 'all') await db.run('DELETE FROM slots WHERE courseId = $1', [courseId]);
    if (what === 'learners' || what === 'all') await db.run('DELETE FROM learners WHERE courseId = $1', [courseId]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// ============================================================
//  COMPTES UTILISATEURS (onglet Gestion, admin uniquement)
// ============================================================
const ROLES = ['teacher', 'admin'];
const MIN_PASSWORD = 8;
const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// Liste des comptes avec les cours attribués (jamais le hash du mot de passe)
app.get('/api/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const users = await db.all('SELECT id, email, name, role FROM users ORDER BY role, name');
    const courses = await db.all('SELECT id, title, teacherEmail FROM courses ORDER BY id');
    res.json(users.map(u => ({
      ...u,
      courses: courses
        .filter(c => (c.teacherEmail || '').toLowerCase() === u.email.toLowerCase())
        .map(c => ({ id: c.id, title: c.title }))
    })));
  } catch (err) { serverError(res, err); }
});

// Attribue les cours cochés à l'utilisateur (remplace l'enseignant précédent de ces cours)
async function assignCourses(email, name, courseIds) {
  if (!Array.isArray(courseIds)) return;
  for (const courseId of courseIds) {
    await db.run('UPDATE courses SET teacher = $1, teacherEmail = $2 WHERE id = $3', [name, email, courseId]);
  }
}

app.post('/api/users', authenticate, requireAdmin, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role || 'teacher';
  const { courseIds } = req.body;

  if (!name) return res.status(400).json({ error: 'Le nom est requis' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Email invalide' });
  if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Mot de passe : ${MIN_PASSWORD} caractères minimum` });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide' });

  try {
    const existing = await db.get('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    const hash = await bcrypt.hash(password, 10);
    const row = await db.get(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [email, hash, name, role]);
    await assignCourses(email, name, courseIds);
    res.json({ success: true, id: row.id });
  } catch (err) { serverError(res, err); }
});

// Modifier nom, rôle et cours attribués
app.put('/api/users/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const user = await db.get('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) return res.status(404).json({ error: 'Compte introuvable' });

    const name = req.body.name !== undefined ? String(req.body.name).trim() : user.name;
    const role = req.body.role !== undefined ? req.body.role : user.role;
    if (!name) return res.status(400).json({ error: 'Le nom est requis' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
    if (id === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'Vous ne pouvez pas retirer votre propre rôle administrateur' });
    }

    await db.run('UPDATE users SET name = $1, role = $2 WHERE id = $3', [name, role, id]);
    // Le nom affiché dans les cours suit le nom du compte
    await db.run('UPDATE courses SET teacher = $1 WHERE LOWER(teacherEmail) = LOWER($2)', [name, user.email]);

    if (Array.isArray(req.body.courseIds)) {
      // Cours décochés : plus d'enseignant
      await db.run(
        `UPDATE courses SET teacher = 'À définir', teacherEmail = ''
         WHERE LOWER(teacherEmail) = LOWER($1) AND NOT (id = ANY($2))`,
        [user.email, req.body.courseIds]);
      await assignCourses(user.email, name, req.body.courseIds);
    }
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// Réinitialiser le mot de passe d'un compte
app.put('/api/users/:id/password', authenticate, requireAdmin, async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Mot de passe : ${MIN_PASSWORD} caractères minimum` });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, parseInt(req.params.id, 10)]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Compte introuvable' });
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// Supprimer un compte : ses cours repassent « À définir »
app.delete('/api/users/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
  try {
    const user = await db.get('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) return res.status(404).json({ error: 'Compte introuvable' });
    if (user.role === 'admin') {
      const admins = await db.get("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'");
      if (admins.n <= 1) return res.status(400).json({ error: 'Impossible de supprimer le dernier administrateur' });
    }
    await db.run(`UPDATE courses SET teacher = 'À définir', teacherEmail = '' WHERE LOWER(teacherEmail) = LOWER($1)`, [user.email]);
    await db.run('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// ============================================================
//  ADMINISTRATION (ajout d'enseignants / admins)
//  Désactivé si ADMIN_TOKEN n'est pas défini. Token passé dans l'en-tête
//  « X-Admin-Token » (ou ?token= pour compatibilité).
// ============================================================
function checkAdminToken(req, res, next) {
  const token = req.get('X-Admin-Token') || req.query.token;
  if (!ADMIN_TOKEN) return res.status(404).json({ error: 'Route désactivée' });
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'Token invalide' });
  next();
}

app.post('/admin/add-teacher', checkAdminToken, async (req, res) => {
  const { email, password, name, courseId } = req.body;
  if (!email || !password || !name || !courseId) {
    return res.status(400).json({ error: 'Tous les champs sont requis : email, password, name, courseId' });
  }
  try {
    const course = await db.get('SELECT * FROM courses WHERE id = $1', [courseId]);
    if (!course) return res.status(404).json({ error: 'Cours introuvable' });
    const existing = await db.get('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const hash = await bcrypt.hash(password, 10);
    await db.run('INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      [email, hash, name, 'teacher']);
    await db.run('UPDATE courses SET teacher = $1, teacherEmail = $2 WHERE id = $3', [name, email, courseId]);
    res.json({ success: true, message: `Enseignant ${name} ajouté et associé au cours ${course.title}` });
  } catch (err) { serverError(res, err); }
});

app.post('/admin/add-admin', checkAdminToken, async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Tous les champs sont requis : email, password, name' });
  }
  try {
    const existing = await db.get('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    const hash = await bcrypt.hash(password, 10);
    await db.run('INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      [email, hash, name, 'admin']);
    res.json({ success: true, message: `Administrateur ${name} ajouté avec succès !` });
  } catch (err) { serverError(res, err); }
});

// Changer son propre mot de passe
app.post('/api/auth/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'Nouveau mot de passe : 8 caractères minimum' });
  }
  try {
    const user = await db.get('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// ============================================================
//  DÉMARRAGE
// ============================================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Serveur Timsirin démarré sur http://localhost:${PORT}`);
  });
}

module.exports = app;
