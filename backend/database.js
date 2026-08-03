const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'db.sqlite'));

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

  // Étudiants (apprenants)
  db.run(`CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    courseId TEXT
  )`);

  // Présences
  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    studentId TEXT,
    courseId TEXT,
    date TEXT,
    status TEXT
  )`);

  // Créneaux (planning)
  db.run(`CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    courseId TEXT,
    date TEXT,
    time TEXT
  )`);

  // Apprenants (pour le planning)
  db.run(`CREATE TABLE IF NOT EXISTS learners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    courseId TEXT,
    name TEXT
  )`);
});

module.exports = db;