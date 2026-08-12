// Seeds one demo user with two budgeting profiles - "Personal" and
// "Household" - each with ~9 months of clearly fictional transaction
// history, so the dashboard, charts, and multi-profile switching all have
// something meaningful to show immediately.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'DemoPass123!';

function catId(name) {
  return db.prepare('SELECT id FROM categories WHERE name = ? AND user_id IS NULL').get(name).id;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function monthsAgo(n, day = 1) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCDate(day);
  return d;
}

const run = db.transaction(() => {
  db.prepare('DELETE FROM users WHERE email = ?').run(DEMO_EMAIL);

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 12);
  const { lastInsertRowid: userId } = db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run('Demo User', DEMO_EMAIL, passwordHash);

  const { lastInsertRowid: personalProfileId } = db
    .prepare('INSERT INTO profiles (user_id, name) VALUES (?, ?)')
    .run(userId, 'Personal');
  const { lastInsertRowid: householdProfileId } = db
    .prepare('INSERT INTO profiles (user_id, name) VALUES (?, ?)')
    .run(userId, 'Household');

  const insertTxn = db.prepare(
    `INSERT INTO transactions (user_id, profile_id, category_id, amount_cents, type, description, occurred_on, is_recurring, recurring_interval)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // Shared household costs - rent, utilities, groceries, car - live in the
  // Household profile, as if split or tracked jointly.
  const householdTemplates = [
    { cat: 'Rent/Mortgage', desc: 'Monthly rent', amount: 1650, day: 1, recurring: true },
    { cat: 'Utilities', desc: 'Electric & water', amount: 95, day: 4 },
    { cat: 'Groceries', desc: 'Weekly grocery run', amount: 78, day: 6 },
    { cat: 'Groceries', desc: 'Weekly grocery run', amount: 64, day: 13 },
    { cat: 'Groceries', desc: 'Weekly grocery run', amount: 91, day: 20 },
    { cat: 'Groceries', desc: 'Weekly grocery run', amount: 55, day: 27 },
    { cat: 'Transportation', desc: 'Car insurance', amount: 120, day: 9, recurring: true },
    { cat: 'Utilities', desc: 'Internet bill', amount: 60, day: 15, recurring: true },
  ];

  // Personal spending - subscriptions, entertainment, individual purchases -
  // plus the demo user's own income, live in the Personal profile.
  const personalTemplates = [
    { cat: 'Transportation', desc: 'Gas fill-up', amount: 42, day: 5 },
    { cat: 'Transportation', desc: 'Transit pass', amount: 65, day: 1, recurring: true },
    { cat: 'Subscription', desc: 'Netflix', amount: 15.49, day: 8, recurring: true },
    { cat: 'Subscription', desc: 'Spotify', amount: 11.99, day: 10, recurring: true },
    { cat: 'Subscription', desc: 'Cloud storage', amount: 2.99, day: 14, recurring: true },
    { cat: 'Entertainment', desc: 'Movie night', amount: 32, day: 16 },
    { cat: 'Food', desc: 'Dinner out', amount: 48, day: 18 },
    { cat: 'Food', desc: 'Coffee shop', amount: 6.5, day: 22 },
    { cat: 'Shopping', desc: 'Clothing', amount: 89, day: 19 },
    { cat: 'Healthcare', desc: 'Pharmacy', amount: 24, day: 11 },
  ];

  function seedTemplates(profileId, templates, m) {
    for (const t of templates) {
      // Small random variance so months don't look identical
      const variance = 1 + (Math.random() * 0.16 - 0.08);
      const amountCents = Math.round(t.amount * 100 * variance);
      insertTxn.run(
        userId,
        profileId,
        catId(t.cat),
        amountCents,
        'expense',
        t.desc,
        isoDate(monthsAgo(m, t.day)),
        t.recurring ? 1 : 0,
        t.recurring ? 'monthly' : null
      );
    }
  }

  const MONTHS = 9;
  for (let m = MONTHS - 1; m >= 0; m--) {
    // Salary, in the Personal profile
    insertTxn.run(
      userId, personalProfileId, catId('Salary/Income'), 3500 * 100, 'income',
      'Monthly salary', isoDate(monthsAgo(m, 1)), 1, 'monthly'
    );
    // Occasional freelance income, roughly every other month
    if (m % 2 === 0) {
      insertTxn.run(
        userId, personalProfileId, catId('Salary/Income'), 42000, 'income',
        'Freelance project', isoDate(monthsAgo(m, 15)), 0, null
      );
    }

    seedTemplates(householdProfileId, householdTemplates, m);
    seedTemplates(personalProfileId, personalTemplates, m);
  }

  // Subscriptions and bills (API still supports these; no longer surfaced
  // in the UI, kept user-scoped rather than split across profiles).
  const subs = [
    { name: 'Netflix', amount: 15.49, cat: 'Subscription' },
    { name: 'Spotify', amount: 11.99, cat: 'Subscription' },
    { name: 'Cloud storage', amount: 2.99, cat: 'Subscription' },
    { name: 'Gym membership', amount: 39.0, cat: 'Healthcare' },
  ];
  const insertSub = db.prepare(
    `INSERT INTO subscriptions (user_id, category_id, name, amount_cents, billing_cycle, next_billing_on, is_active)
     VALUES (?, ?, ?, ?, 'monthly', ?, 1)`
  );
  subs.forEach((s, i) => {
    const next = new Date();
    next.setUTCDate(next.getUTCDate() + ((i + 1) * 3));
    insertSub.run(userId, catId(s.cat), s.name, Math.round(s.amount * 100), isoDate(next));
  });

  const bills = [
    { name: 'Electric bill', amount: 95, cat: 'Utilities', daysOut: 5, paid: false },
    { name: 'Car insurance', amount: 120, cat: 'Transportation', daysOut: 20, paid: false },
    { name: 'Water bill', amount: 38, cat: 'Utilities', daysOut: -10, paid: true },
  ];
  const insertBill = db.prepare(
    `INSERT INTO bills (user_id, category_id, name, amount_cents, due_on, is_paid, is_recurring)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );
  bills.forEach((b) => {
    const due = new Date();
    due.setUTCDate(due.getUTCDate() + b.daysOut);
    insertBill.run(userId, catId(b.cat), b.name, Math.round(b.amount * 100), isoDate(due), b.paid ? 1 : 0);
  });

  console.log('Seed complete.');
  console.log(`Demo login -> email: ${DEMO_EMAIL}  password: ${DEMO_PASSWORD}`);
  console.log('Two profiles created: "Personal" and "Household" - switch between them in the sidebar.');
});

run();
