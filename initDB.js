const db = require('./database');
const bcrypt = require('bcryptjs');

const USERS = [
  { email: 'tahar.boukhenoufa@gmail.com', password: 'Admin01A', name: 'Tahar Boukhenoufa', role: 'admin' },
  { email: 'inscription.aptamazight@gmail.com', password: 'Admin02B', name: 'Inscription APT', role: 'admin' },
  { email: 'contact@alliancepourtamazight.fr', password: 'Admin03AB', name: 'Contact Alliance', role: 'admin' },
  { email: 'touati.ramdane@yahoo.fr', password: 'Aselmad01', name: 'Ramdane Touati', role: 'teacher' },
  { email: 'amazisyfax@gmail.com', password: 'Aselmad02', name: 'Said Adel', role: 'teacher' }
];

const COURSES = [
  { id: 'c1', title: 'Taqbaylit', teacher: 'Said Adel', teacherEmail: 'amazisyfax@gmail.com', schedule: 'Samedi 14h00 - 16h00', public: 'adultes', zoomLink: '' },
  { id: 'c2', title: 'Tacawit', teacher: 'À définir', teacherEmail: '', schedule: 'Lundi 18h00 - 20h00', public: 'adultes', zoomLink: '' },
  { id: 'c3', title: 'Tumẓabt', teacher: 'À définir', teacherEmail: '', schedule: 'Mardi 19h00 - 21h00', public: 'adultes', zoomLink: '' },
  { id: 'c4', title: 'Tamahaq-Tamacaq', teacher: 'À définir', teacherEmail: '', schedule: 'Mercredi 17h00 - 19h00', public: 'adultes', zoomLink: '' },
  { id: 'c5', title: 'Tamazight n Arif', teacher: 'À définir', teacherEmail: '', schedule: 'Jeudi 18h30 - 20h30', public: 'adultes', zoomLink: '' },
  { id: 'c6', title: 'Tamazight n watlas', teacher: 'À définir', teacherEmail: '', schedule: 'Vendredi 16h00 - 18h00', public: 'adultes', zoomLink: '' },
  { id: 'c7', title: 'Tacelhit', teacher: 'À définir', teacherEmail: '', schedule: 'Samedi 10h00 - 12h00', public: 'adultes', zoomLink: '' },
  { id: 'c8', title: 'Tamazight n Ighermawen', teacher: 'À définir', teacherEmail: '', schedule: 'Dimanche 14h00 - 16h00', public: 'adultes', zoomLink: '' },
  { id: 'c9', title: 'Taqbaylit n Chenoua', teacher: 'À définir', teacherEmail: '', schedule: 'Lundi 19h30 - 21h30', public: 'adultes', zoomLink: '' },
  { id: 'c10', title: 'Français', teacher: 'À définir', teacherEmail: '', schedule: 'Mardi 17h00 - 19h00', public: 'adultes', zoomLink: '' },
  { id: 'c11', title: 'Préparation de l\'examen civique', teacher: 'À définir', teacherEmail: '', schedule: 'Mercredi 19h00 - 21h00', public: 'adultes', zoomLink: '' },
  { id: 'c12', title: 'Amazigh Compréhension', teacher: 'Ramdane Touati', teacherEmail: 'touati.ramdane@yahoo.fr', schedule: 'Jeudi 17h00 - 19h00', public: 'adultes', zoomLink: '' }
];

const STUDENTS = [
  { id: 's1', name: 'Amine Belkacem', email: 'amine.b@gmail.com', courseId: 'c1', payment_status: 'paid', amount_paid: 120 },
  { id: 's2', name: 'Lydia Ould', email: 'lydia.o@hotmail.fr', courseId: 'c1', payment_status: 'partial', amount_paid: 60 },
  { id: 's3', name: 'Sofiane Ferhat', email: 'sofiane.f@yahoo.fr', courseId: 'c1', payment_status: 'unpaid', amount_paid: 0 },
  { id: 's4', name: 'Nadia Meziani', email: 'nadia.m@gmail.com', courseId: 'c12', payment_status: 'paid', amount_paid: 150 },
  { id: 's5', name: 'Kahina Azem', email: 'kahina.a@gmail.com', courseId: 'c2', payment_status: 'paid', amount_paid: 120 },
  { id: 's6', name: 'Idir Sadi', email: 'idir.s@gmail.com', courseId: 'c5', payment_status: 'unpaid', amount_paid: 0 }
];

const ATTENDANCE = [
  { id: 'att1', studentId: 's1', courseId: 'c1', date: '2026-08-04', status: 'present' },
  { id: 'att2', studentId: 's2', courseId: 'c1', date: '2026-08-04', status: 'present' },
  { id: 'att3', studentId: 's3', courseId: 'c1', date: '2026-08-04', status: 'absent' },
  { id: 'att4', studentId: 's4', courseId: 'c12', date: '2026-08-04', status: 'present' }
];

async function initDB() {
  // Supprimer les tables (ordre inverse des dépendances)
  await db.query('DROP TABLE IF EXISTS attendance');
  await db.query('DROP TABLE IF EXISTS students');
  await db.query('DROP TABLE IF EXISTS courses');
  await db.query('DROP TABLE IF EXISTS users');
  await db.query('DROP TABLE IF EXISTS slots');
  await db.query('DROP TABLE IF EXISTS learners');

  // Créer les tables
  await db.query(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE courses (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      teacher TEXT,
      teacherEmail TEXT,
      schedule TEXT,
      public TEXT,
      zoomLink TEXT
    )
  `);

  await db.query(`
    CREATE TABLE students (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      courseId TEXT,
      payment_status TEXT DEFAULT 'unpaid',
      amount_paid REAL DEFAULT 0
    )
  `);

  await db.query(`
    CREATE TABLE attendance (
      id TEXT PRIMARY KEY,
      studentId TEXT,
      courseId TEXT,
      date TEXT,
      status TEXT
    )
  `);

  await db.query(`
    CREATE TABLE slots (
      id SERIAL PRIMARY KEY,
      courseId TEXT,
      date TEXT,
      time TEXT
    )
  `);

  await db.query(`
    CREATE TABLE learners (
      id SERIAL PRIMARY KEY,
      courseId TEXT,
      name TEXT
    )
  `);

  // Insérer les utilisateurs
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    await db.query('INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      [u.email, hash, u.name, u.role]);
  }

  // Insérer les cours
  for (const c of COURSES) {
    await db.query(
      'INSERT INTO courses (id, title, teacher, teacherEmail, schedule, public, zoomLink) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [c.id, c.title, c.teacher, c.teacherEmail, c.schedule, c.public, c.zoomLink]
    );
  }

  // Insérer les étudiants
  for (const s of STUDENTS) {
    await db.query(
      'INSERT INTO students (id, name, email, courseId, payment_status, amount_paid) VALUES ($1, $2, $3, $4, $5, $6)',
      [s.id, s.name, s.email, s.courseId, s.payment_status, s.amount_paid]
    );
  }

  // Insérer les présences
  for (const a of ATTENDANCE) {
    await db.query(
      'INSERT INTO attendance (id, studentId, courseId, date, status) VALUES ($1, $2, $3, $4, $5)',
      [a.id, a.studentId, a.courseId, a.date, a.status]
    );
  }

  console.log('✅ Base PostgreSQL initialisée avec succès !');
  console.log('👑 Admins:', USERS.filter(u => u.role === 'admin').map(u => u.email).join(', '));
  console.log('📚 Cours:', COURSES.length);
}

initDB()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Erreur:', err);
    process.exit(1);
  });