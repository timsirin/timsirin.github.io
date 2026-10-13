const { Pool } = require('pg');

// SSL requis par Neon / Render, mais désactivable en local (DATABASE_SSL=false)
const useSSL = process.env.DATABASE_SSL !== 'false';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false
});

// PostgreSQL met en minuscules les noms de colonnes non quotés
// (teacherEmail -> teacheremail). On rétablit le camelCase attendu par le frontend.
const KEY_MAP = {
  teacheremail: 'teacherEmail',
  courseid: 'courseId',
  zoomlink: 'zoomLink',
  studentid: 'studentId'
};

function mapRow(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[KEY_MAP[k] || k] = v;
  return out;
}

const query = (text, params) =>
  pool.query(text, params).then(res => {
    res.rows = res.rows.map(mapRow);
    return res;
  });

const db = {
  query,
  get: (text, params) => query(text, params).then(res => res.rows[0]),
  all: (text, params) => query(text, params).then(res => res.rows),
  run: (text, params) => query(text, params),
  close: () => pool.end()
};

module.exports = db;
