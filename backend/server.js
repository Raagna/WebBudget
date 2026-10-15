require('dotenv').config();
const { runMigrations } = require('./db');
const app = require('./app');

const PORT = process.env.PORT || 4000;

// Run pending migrations before accepting any traffic, so `npm start`
// alone is always safe to run against a database that's behind - matches
// what `npm run migrate` does standalone, just inline on boot.
runMigrations()
  .then(() => {
    app.listen(PORT, () => console.log(`Finance API listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('[db] failed to run migrations, refusing to start:', err);
    process.exit(1);
  });
