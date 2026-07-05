const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'tarot.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS consultantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    fecha_nacimiento TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lecturas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    consultante_id INTEGER NOT NULL REFERENCES consultantes(id),
    pregunta TEXT NOT NULL,
    tirada_json TEXT NOT NULL,
    interpretacion TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
