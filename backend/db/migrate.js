// Standalone entry point for running pending migrations without booting
// the full HTTP server - useful as a Render/Railway "pre-deploy" or
// "release" command so migrations apply before new server code starts
// serving traffic.
require('dotenv').config();
require('./index'); // requiring db/index.js runs migrations as a side effect
console.log('[db] migrations up to date');
