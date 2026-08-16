const express = require('express');
const bcrypt = require('bcryptjs');
const { queryOne, withTransaction } = require('../db');
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
    // gaps in the UI. profile_members is what actually grants access (see
    // routes/profiles.js) - creating the profile alone isn't enough.
    const user = await withTransaction(async (tx) => {
      const inserted = await tx.queryOne(
        'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?) RETURNING id',
        [name.trim(), normalizedEmail, passwordHash]
      );
      const profile = await tx.queryOne(
        'INSERT INTO profiles (user_id, name) VALUES (?, ?) RETURNING id',
        [inserted.id, 'Personal']
      );
      await tx.run(
        `INSERT INTO profile_members (profile_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')`,
        [profile.id, inserted.id]
      );
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

    // Defensive backfill: an account with no active profile membership
    // (created before profiles/households existed, or restored from an
    // old backup) would otherwise be stuck with nowhere to log a
    // transaction. Give it a fresh "Personal" profile it owns outright.
    const membershipCount = await queryOne(
      `SELECT COUNT(*)::int AS n FROM profile_members WHERE user_id = ? AND status = 'active'`,
      [user.id]
    );
    if (membershipCount.n === 0) {
      await withTransaction(async (tx) => {
        const profile = await tx.queryOne(
          'INSERT INTO profiles (user_id, name) VALUES (?, ?) RETURNING id',
          [user.id, 'Personal']
        );
        await tx.run(
          `INSERT INTO profile_members (profile_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')`,
          [profile.id, user.id]
        );
      });
    }

    const token = signToken(user.id);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  })
);

module.exports = router;
