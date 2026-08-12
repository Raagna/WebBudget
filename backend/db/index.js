const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'finance.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- Migrations ----------
// Every schema change - new tables, new columns, new default data - lives
// as its own numbered .sql file in db/migrations/. This runs once per
// migration, ever, tracked in schema_migrations, so deploying new code
// against a database that already has real user data in it upgrades that
// database in place instead of requiring it to be wiped.
//
// To add a change later: create db/migrations/00N_description.sql (N =
// next number). Never edit an already-shipped migration file - if a
// database out there already applied it, editing it after the fact won't
// retroactively change what that database has. Write a new migration that
// makes the further change instead (e.g. ALTER TABLE ... ADD COLUMN, or a
// new INSERT OR IGNORE for a new default category).

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

function runMigrations() {
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(db.prepare('SELECT filename FROM schema_migrations').all().map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run(file);
    });
    applyMigration();
    console.log(`[db] applied migration ${file}`);
  }
}

runMigrations();

module.exports = db;
