// Seeds one demo user with two budgeting profiles - "Personal" and
// "Household" - each with ~9 months of clearly fictional transaction
// history, so the dashboard, charts, and multi-profile switching all have
// something meaningful to show immediately. Also seeds a second demo
// account that's an active member (not owner) of the Household profile,
// so shared-household access is demonstrable without first setting up an
// invite yourself.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { withTransaction } = require('./db');

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'DemoPass123!';
const PARTNER_EMAIL = 'partner@example.com';
const PARTNER_PASSWORD = 'DemoPass123!';

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

async function run() {
  await withTransaction(async (tx) => {
    await tx.run('DELETE FROM users WHERE email = ?', [DEMO_EMAIL]);
    await tx.run('DELETE FROM users WHERE email = ?', [PARTNER_EMAIL]);

    const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 12);
    const user = await tx.queryOne(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?) RETURNING id',
      ['Demo User', DEMO_EMAIL, passwordHash]
    );
    const userId = user.id;

    const personalProfile = await tx.queryOne(
      'INSERT INTO profiles (user_id, name) VALUES (?, ?) RETURNING id',
      [userId, 'Personal']
    );
    const householdProfile = await tx.queryOne(
      'INSERT INTO profiles (user_id, name) VALUES (?, ?) RETURNING id',
      [userId, 'Household']
    );
    const personalProfileId = personalProfile.id;
    const householdProfileId = householdProfile.id;

    // profile_members is what actually grants access to a profile - see
    // routes/profiles.js. Without these rows the demo account would have
    // profiles that exist but that GET /api/profiles never returns.
    await tx.run(
      `INSERT INTO profile_members (profile_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')`,
      [personalProfileId, userId]
    );
    await tx.run(
      `INSERT INTO profile_members (profile_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')`,
      [householdProfileId, userId]
    );

    // Second demo account, added as an active (not pending) member of the
    // Household profile - demonstrates shared access immediately without
    // requiring a manual invite/accept round trip first.
    const partnerHash = bcrypt.hashSync(PARTNER_PASSWORD, 12);
    const partner = await tx.queryOne(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?) RETURNING id',
      ['Demo Partner', PARTNER_EMAIL, partnerHash]
    );
    // The partner also needs their own profile to land on (every account
    // always has at least one it owns outright).
    const partnerPersonalProfile = await tx.queryOne(
      'INSERT INTO profiles (user_id, name) VALUES (?, ?) RETURNING id',
      [partner.id, 'Personal']
    );
    await tx.run(
      `INSERT INTO profile_members (profile_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')`,
      [partnerPersonalProfile.id, partner.id]
    );
    await tx.run(
      `INSERT INTO profile_members (profile_id, user_id, role, status, invited_by)
       VALUES (?, ?, 'member', 'active', ?)`,
      [householdProfileId, partner.id, userId]
    );

    async function catId(name) {
      const row = await tx.queryOne('SELECT id FROM categories WHERE name = ? AND user_id IS NULL', [name]);
      return row.id;
    }

    async function insertTxn(profileId, categoryId, amountCents, type, desc, date, recurring, interval) {
      await tx.run(
        `INSERT INTO transactions (user_id, profile_id, category_id, amount_cents, type, description, occurred_on, is_recurring, recurring_interval)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, profileId, categoryId, amountCents, type, desc, date, recurring, interval]
      );
    }

    // Shared household costs - rent, utilities, groceries, car - live in
    // the Household profile, as if split or tracked jointly.
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

    // Personal spending - subscriptions, entertainment, individual
    // purchases - plus the demo user's own income, live in Personal.
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

    async function seedTemplates(profileId, templates, m) {
      for (const t of templates) {
        // Small random variance so months don't look identical
        const variance = 1 + (Math.random() * 0.16 - 0.08);
        const amountCents = Math.round(t.amount * 100 * variance);
        await insertTxn(
          profileId,
          await catId(t.cat),
          amountCents,
          'expense',
          t.desc,
          isoDate(monthsAgo(m, t.day)),
          t.recurring || false,
          t.recurring ? 'monthly' : null
        );
      }
    }

    const MONTHS = 9;
    const salaryCatId = await catId('Salary/Income');
    for (let m = MONTHS - 1; m >= 0; m--) {
      // Salary, in the Personal profile
      await insertTxn(
        personalProfileId, salaryCatId, 3500 * 100, 'income',
        'Monthly salary', isoDate(monthsAgo(m, 1)), true, 'monthly'
      );
      // Occasional freelance income, roughly every other month
      if (m % 2 === 0) {
        await insertTxn(
          personalProfileId, salaryCatId, 42000, 'income',
          'Freelance project', isoDate(monthsAgo(m, 15)), false, null
        );
      }

      await seedTemplates(householdProfileId, householdTemplates, m);
      await seedTemplates(personalProfileId, personalTemplates, m);
    }

    // Subscriptions and bills (API still supports these; no longer
    // surfaced in the UI, kept user-scoped rather than split across profiles).
    const subs = [
      { name: 'Netflix', amount: 15.49, cat: 'Subscription' },
      { name: 'Spotify', amount: 11.99, cat: 'Subscription' },
      { name: 'Cloud storage', amount: 2.99, cat: 'Subscription' },
      { name: 'Gym membership', amount: 39.0, cat: 'Healthcare' },
    ];
    let i = 0;
    for (const s of subs) {
      const next = new Date();
      next.setUTCDate(next.getUTCDate() + ((i + 1) * 3));
      await tx.run(
        `INSERT INTO subscriptions (user_id, category_id, name, amount_cents, billing_cycle, next_billing_on, is_active)
         VALUES (?, ?, ?, ?, 'monthly', ?, TRUE)`,
        [userId, await catId(s.cat), s.name, Math.round(s.amount * 100), isoDate(next)]
      );
      i++;
    }

    const bills = [
      { name: 'Electric bill', amount: 95, cat: 'Utilities', daysOut: 5, paid: false },
      { name: 'Car insurance', amount: 120, cat: 'Transportation', daysOut: 20, paid: false },
      { name: 'Water bill', amount: 38, cat: 'Utilities', daysOut: -10, paid: true },
    ];
    for (const b of bills) {
      const due = new Date();
      due.setUTCDate(due.getUTCDate() + b.daysOut);
      await tx.run(
        `INSERT INTO bills (user_id, category_id, name, amount_cents, due_on, is_paid, is_recurring)
         VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
        [userId, await catId(b.cat), b.name, Math.round(b.amount * 100), isoDate(due), b.paid]
      );
    }
  });

  console.log('Seed complete.');
  console.log(`Demo login -> email: ${DEMO_EMAIL}  password: ${DEMO_PASSWORD}`);
  console.log(`Partner login (shared "Household" access) -> email: ${PARTNER_EMAIL}  password: ${PARTNER_PASSWORD}`);
  console.log('Two profiles created: "Personal" and "Household" - switch between them in the sidebar.');
  console.log('The partner account is already an active member of "Household" - log in as either to see shared data.');
  process.exit(0);
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
