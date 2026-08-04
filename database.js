const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'db.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Utilisateurs
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password_hash TEXT,
    name TEXT,
    role TEXT
  )`);

  // Cours
  db.run(`CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    title TEXT,
    teacher TEXT,
    teacherEmail TEXT,
    schedule TEXT,
    public TEXT,
    zoomLink TEXT
  )`);

  // Étudiants (avec colonnes paiement)
  db.run(`CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    courseId TEXT,
    payment_status TEXT DEFAULT 'unpaid',
    amount_paid REAL DEFAULT 0
  )`);

  // Présences
  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    studentId TEXT,
    courseId TEXT,
    date TEXT,
    status TEXT
  )`);

  // Créneaux
  db.run(`CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    courseId TEXT,
    date TEXT,
    time TEXT
  )`);

  // Apprenants (planning)
  db.run(`CREATE TABLE IF NOT EXISTS learners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    courseId TEXT,
    name TEXT
  )`);

  // Migration (sécurité) – ajoute les colonnes si elles existent déjà
  db.run(`ALTER TABLE students ADD COLUMN payment_status TEXT DEFAULT 'unpaid'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.warn('Migration payment_status :', err.message);
    }
  });
  db.run(`ALTER TABLE students ADD COLUMN amount_paid REAL DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.warn('Migration amount_paid :', err.message);
    }
  });
});

module.exports = db;