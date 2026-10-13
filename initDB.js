require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./database');

// ============================================================
//  COMPTES UTILISATEURS INITIAUX
//  Les mots de passe ne sont PLUS stockés dans le code (dépôt public).
//  Ils sont lus depuis la variable INIT_PASSWORDS (JSON {"email":"motdepasse"})
//  ou, à défaut, générés aléatoirement et affichés une seule fois dans les logs.
// ============================================================
const USERS = [
  { email: 'tahar.boukhenoufa@gmail.com', name: 'Tahar Boukhenoufa', role: 'admin' },
  { email: 'inscription.aptamazight@gmail.com', name: 'Inscription APT', role: 'admin' },
  { email: 'contact@alliancepourtamazight.fr', name: 'Contact Alliance', role: 'admin' },
  { email: 'touati.ramdane@yahoo.fr', name: 'Ramdane Touati', role: 'teacher' },
  { email: 'amazisyfax@gmail.com', name: 'Said Adel', role: 'teacher' }
];

// ============================================================
//  COURS
// ============================================================
const COURSES = [
  { id: 'c1', title: 'Taqbaylit', teacher: 'Said Adel', teacherEmail: 'amazisyfax@gmail.com', schedule: 'Samedi 14h00 - 16h00' },
  { id: 'c2', title: 'Tacawit', teacher: 'À définir', teacherEmail: '', schedule: 'Lundi 18h00 - 20h00' },
  { id: 'c3', title: 'Tumẓabt', teacher: 'À définir', teacherEmail: '', schedule: 'Mardi 19h00 - 21h00' },
  { id: 'c4', title: 'Tamahaq-Tamacaq', teacher: 'À définir', teacherEmail: '', schedule: 'Mercredi 17h00 - 19h00' },
  { id: 'c5', title: 'Tamazight n Arif', teacher: 'À définir', teacherEmail: '', schedule: 'Jeudi 18h30 - 20h30' },
  { id: 'c6', title: 'Tamazight n watlas', teacher: 'À définir', teacherEmail: '', schedule: 'Vendredi 16h00 - 18h00' },
  { id: 'c7', title: 'Tacelhit', teacher: 'À définir', teacherEmail: '', schedule: 'Samedi 10h00 - 12h00' },
  { id: 'c8', title: 'Tamazight n Ighermawen', teacher: 'À définir', teacherEmail: '', schedule: 'Dimanche 14h00 - 16h00' },
  { id: 'c9', title: 'Taqbaylit n Chenoua', teacher: 'À définir', teacherEmail: '', schedule: 'Lundi 19h30 - 21h30' },
  { id: 'c10', title: 'Français', teacher: 'À définir', teacherEmail: '', schedule: 'Mardi 17h00 - 19h00' },
  { id: 'c11', title: 'Préparation de l\'examen civique', teacher: 'À définir', teacherEmail: '', schedule: 'Mercredi 19h00 - 21h00' },
  { id: 'c12', title: 'Amazigh Compréhension', teacher: 'Ramdane Touati', teacherEmail: 'touati.ramdane@yahoo.fr', schedule: 'Jeudi 17h00 - 19h00' }
];

// ============================================================
//  SCHÉMA (non destructif)
// ============================================================
async function ensureSchema() {
  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    teacher TEXT,
    teacherEmail TEXT,
    schedule TEXT,
    public TEXT,
    zoomLink TEXT
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    courseId TEXT,
    payment_status TEXT DEFAULT 'unpaid',
    amount_paid REAL DEFAULT 0
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    studentId TEXT,
    courseId TEXT,
    date TEXT,
    status TEXT
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS slots (
    id SERIAL PRIMARY KEY,
    courseId TEXT,
    date TEXT,
    time TEXT
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS learners (
    id SERIAL PRIMARY KEY,
    courseId TEXT,
    name TEXT
  )`);
}

function initialPassword(email) {
  try {
    const map = JSON.parse(process.env.INIT_PASSWORDS || '{}');
    if (map[email]) return { password: map[email], generated: false };
  } catch (e) {
    console.warn('⚠️ INIT_PASSWORDS n\'est pas un JSON valide, mots de passe générés.');
  }
  return { password: crypto.randomBytes(9).toString('base64url'), generated: true };
}

// Insère les comptes et cours initiaux uniquement s'ils n'existent pas.
async function seed() {
  for (const u of USERS) {
    const exists = await db.get('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [u.email]);
    if (exists) continue;
    const { password, generated } = initialPassword(u.email);
    const hash = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      [u.email, hash, u.name, u.role]);
    console.log(`👤 Compte créé : ${u.email} (${u.role})` +
      (generated ? ` — mot de passe provisoire : ${password}` : ''));
  }
  for (const c of COURSES) {
    await db.query(
      `INSERT INTO courses (id, title, teacher, teacherEmail, schedule, public, zoomLink)
       VALUES ($1, $2, $3, $4, $5, 'adultes', '') ON CONFLICT (id) DO NOTHING`,
      [c.id, c.title, c.teacher, c.teacherEmail, c.schedule]
    );
  }
}

async function resetAll() {
  for (const t of ['attendance', 'students', 'slots', 'learners', 'courses', 'users']) {
    await db.query(`DROP TABLE IF EXISTS ${t}`);
  }
}

module.exports = { ensureSchema, seed };

// Exécution en ligne de commande : `npm run init-db` (ajouter `-- --reset` pour TOUT effacer)
if (require.main === module) {
  (async () => {
    if (process.argv.includes('--reset')) {
      console.log('⚠️ --reset : suppression de toutes les tables...');
      await resetAll();
    }
    await ensureSchema();
    await seed();
    console.log('✅ Base PostgreSQL initialisée.');
  })()
    .then(() => db.close())
    .catch(err => {
      console.error('❌ Erreur lors de l\'initialisation:', err);
      process.exit(1);
    });
}
