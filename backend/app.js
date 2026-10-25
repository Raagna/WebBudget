const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const categoryRoutes = require('./routes/categories');
const profileRoutes = require('./routes/profiles');
const transactionRoutes = require('./routes/transactions');
const subscriptionRoutes = require('./routes/subscriptions');
const billRoutes = require('./routes/bills');
const dashboardRoutes = require('./routes/dashboard');
const budgetRoutes = require('./routes/budgets');
const scanRoutes = require('./routes/scan');
const investmentRoutes = require('./routes/investments');
const newsRoutes = require('./routes/news');
const redditRoutes = require('./routes/reddit');
const debtRoutes = require('./routes/debts');
const payoffRoutes = require('./routes/payoff');
const goalRoutes = require('./routes/goals');
const netWorthRoutes = require('./routes/networth');

const app = express();

app.disable('x-powered-by'); // don't advertise the stack in response headers

// Behind a hosting proxy (Render, a homelab reverse proxy), every request
// arrives from the proxy's IP, so without this the rate limiters below
// treat ALL users as one client: 20 failed logins from anyone locks
// everyone out. The value is the number of proxies in front of the app.
// Off by default (0) when not on Render, because trusting
// X-Forwarded-For with no proxy in front lets a client pick its own IP
// and dodge the limits. Set TRUST_PROXY to override either way.
const trustProxy = process.env.TRUST_PROXY ?? (process.env.RENDER ? '1' : '0');
app.set('trust proxy', Number(trustProxy) || false);
// Comma-separated, so two frontends can share one API (e.g. GitHub Pages and a
// self-hosted copy while you move over): CORS_ORIGIN=https://a.example,https://b.example
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins }));

// Mounted BEFORE the global JSON parser: receipt photos are far bigger than
// its 100kb limit, and that parser would reject them with a 413 before the
// route's own larger parser ever ran.
app.use('/api/scan', scanRoutes);

// The CSV import routes parse their own bodies with bigger limits; the
// global 100kb parser must skip them or it rejects larger files before
// those run.
const jsonParser = express.json({ limit: '100kb' });
const OWN_BODY_PARSER = new Set(['/api/transactions/import', '/api/investments/import']);
app.use((req, res, next) =>
  OWN_BODY_PARSER.has(req.path) ? next() : jsonParser(req, res, next)
);

// Basic brute-force protection on auth endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});
app.use('/api/auth', authLimiter, authRoutes);

app.use('/api/categories', categoryRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/investments', investmentRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/reddit', redditRoutes);
app.use('/api/debts', debtRoutes);
app.use('/api/payoff', payoffRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/networth', netWorthRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Central error handler: never leak stack traces or internals to clients.
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'File too large' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
