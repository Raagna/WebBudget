const { Pool, types } = require('pg');
const fs = require('fs');
const path = require('path');

// By default node-postgres parses DATE columns into JS Date objects,
// which introduces timezone-shift risk (a date can silently become the
// previous/next day depending on server timezone). This app stores and
// compares dates as plain 'YYYY-MM-DD' strings everywhere, so keep them
// as strings straight out of the driver instead. OID 1082 = date.
types.setTypeParser(1082, (val) => val);

// DATABASE_URL is the standard Postgres connection string
// (postgresql://user:password@host:port/dbname). Falls back to a local
// dev default so `npm start` works out of the box against a local
// Postgres without extra setup - set DATABASE_URL for anything real.
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/finance_dev';

// Hosted Postgres providers (Render, Neon, Supabase, etc.) require SSL and
// often use a self-signed chain from Node's perspective - PGSSL=true (or a
// connection string containing sslmode=require) enables that without
// forcing SSL on a plain local Postgres.
const useSSL = process.env.PGSSL === 'true' || /sslmode=require/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // Errors on idle clients in the pool (e.g. a dropped connection) would
  // otherwise crash the process - log and let the pool recover.
  console.error('[db] unexpected pool error', err);
});

// Route files are written with SQLite-style `?` placeholders for
// readability; this converts them to Postgres's positional $1, $2, ...
// before the query reaches pg. Safe here because none of this app's SQL
// contains a literal '?' character inside a string value.
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// query(): SELECT returning many rows (like better-sqlite3's .all())
async function query(sql, params = []) {
  const result = await pool.query(toPg(sql), params);
  return result.rows;
}

// queryOne(): SELECT returning a single row or undefined (like .get())
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0];
}

// run(): INSERT/UPDATE/DELETE (like .run()). Use `RETURNING id` in the SQL
// and read result.rows[0].id when the caller needs the new row's id -
// Postgres has no equivalent of lastInsertRowid.
async function run(sql, params = []) {
  const result = await pool.query(toPg(sql), params);
  return { rowCount: result.rowCount, rows: result.rows };
}

// withTransaction(): runs fn with a `tx` query function bound to a single
// client inside BEGIN/COMMIT/ROLLBACK. tx has the same query/queryOne/run
// shape as the module-level helpers above.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = {
      query: async (sql, params = []) => (await client.query(toPg(sql), params)).rows,
      queryOne: async (sql, params = []) => (await client.query(toPg(sql), params)).rows[0],
      run: async (sql, params = []) => {
        const r = await client.query(toPg(sql), params);
        return { rowCount: r.rowCount, rows: r.rows };
      },
    };
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Migrations ----------
// Every schema change lives as its own numbered .sql file in
// db/migrations/, tracked in schema_migrations so it only ever runs once
// against a given database - deploying new code against a database that
// already has real user data upgrades it in place instead of requiring a
// wipe. See db/migrations/ and the README's "Migrations & upgrading"
// section for the rules on adding a new one.
async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[db] applied migration ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = { pool, query, queryOne, run, withTransaction, runMigrations };
