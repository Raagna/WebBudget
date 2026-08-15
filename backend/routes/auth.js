const express = require('express');
const bcrypt = require('bcryptjs');
const { queryOne, run, withTransaction } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { signToken } = require('../middleware/auth');
const { isNonEmptyString, isValidEmail, validateBody } = require('../middleware/validate');

const router = express.Router();
const SALT_ROUNDS = 12;

router.post(
  '/register',
  validateBody({
    name: (v) => isNonEmptyString(v, 100),
    email: isValidEmail,
    password: (v) => typeof v === 'string' && v.length >= 8 && v.length <= 128,
  }),
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing) {
      // Same generic message as login failures - do not reveal whether an
      // account exists.
      return res.status(409).json({ error: 'Could not create account' });
    }

    const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);

    // Create the user and their first profile together so they always
    // land on a working "Personal" budget with nowhere-to-put-a-transaction
    // gaps in the UI.
    const user = await withTransaction(async (tx) => {
      const inserted = await tx.queryOne(
        'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?) RETURNING id',
        [name.trim(), normalizedEmail, passwordHash]
      );
      await tx.run('INSERT INTO profiles (user_id, name) VALUES (?, ?)', [inserted.id, 'Personal']);
      return inserted;
    });

    const token = signToken(user.id);
    res.status(201).json({
      token,
      user: { id: user.id, name: name.trim(), email: normalizedEmail },
    });
  })
);

router.post(
  '/login',
  validateBody({
    email: isValidEmail,
    password: (v) => typeof v === 'string' && v.length > 0 && v.length <= 128,
  }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    const user = await queryOne('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    // Always run bcrypt.compare, even on a missing user, against a dummy
    // hash so response timing doesn't leak whether the email is registered.
    const hashToCheck = user ? user.password_hash : '$2a$12$invalidsaltinvalidsaltinvalidsalu';
    const valid = bcrypt.compareSync(password, hashToCheck);

    if (!user || !valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Defensive backfill: an account created before profiles existed
    // (or restored from an old backup) might have none. Give it one
    // rather than leaving the user stuck with nowhere to log a transaction.
    const profileCount = await queryOne('SELECT COUNT(*)::int AS n FROM profiles WHERE user_id = ?', [user.id]);
    if (profileCount.n === 0) {
      await run('INSERT INTO profiles (user_id, name) VALUES (?, ?)', [user.id, 'Personal']);
    }

    const token = signToken(user.id);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  })
);

module.exports = router;
