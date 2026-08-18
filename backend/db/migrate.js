// Standalone entry point for running pending migrations without booting
// the full HTTP server - useful as a Render "pre-deploy"/start-command
// step so migrations apply before new server code starts serving traffic.
require('dotenv').config();
const { runMigrations, pool } = require('./index');

runMigrations()
  .then(() => {
    console.log('[db] migrations up to date');
    return pool.end();
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[db] migration failed:', err);
    process.exit(1);
  });
