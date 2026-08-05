const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Requis par Neon.tech et Render
  }
});

const db = {
  query: (text, params) => pool.query(text, params),
  get: (text, params) => pool.query(text, params).then(res => res.rows[0]),
  all: (text, params) => pool.query(text, params).then(res => res.rows),
  run: (text, params) => pool.query(text, params).then(res => res),
  serialize: (callback) => callback(),
  close: () => pool.end()
};

module.exports = db;