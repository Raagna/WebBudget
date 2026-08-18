const express = require('express');
const bcrypt = require('bcryptjs');
const { query, queryOne, run, withTransaction } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth, signToken } = require('../middleware/auth');
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

// Deleting an account requires the current password, same as any other
// destructive account action - a stolen/left-open session alone isn't
// enough. Deleting a user cascades to everything they own directly
// (profiles, custom categories, transactions, subscriptions, bills - see
// the ON DELETE CASCADE foreign keys in the migrations), which is exactly
// right for profiles only they use. But a profile they OWN that has other
// *active* members is a shared household - cascading it away would delete
// that household and its transaction history out from under everyone
// else in it without any warning or consent from them. So this blocks
// deletion if the user is the sole owner of any profile with other active
// members, and tells them exactly which profile(s) to deal with first
// (remove the other members, or hand the household off some other way -
// there's no ownership-transfer feature yet, tracked in the README).
router.delete(
  '/account',
  requireAuth,
  validateBody({ password: (v) => typeof v === 'string' && v.length > 0 }),
  asyncHandler(async (req, res) => {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ error: 'Account not found' });

    const valid = bcrypt.compareSync(req.body.password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const blockedProfiles = await query(
      `SELECT p.name,
              (SELECT COUNT(*)::int FROM profile_members m WHERE m.profile_id = p.id AND m.status = 'active') AS member_count
       FROM profiles p
       JOIN profile_members pm ON pm.profile_id = p.id AND pm.user_id = ? AND pm.role = 'owner' AND pm.status = 'active'
       WHERE (SELECT COUNT(*)::int FROM profile_members m WHERE m.profile_id = p.id AND m.status = 'active') > 1`,
      [req.userId]
    );
    if (blockedProfiles.length > 0) {
      const names = blockedProfiles.map((p) => `"${p.name}" (${p.member_count} members)`).join(', ');
      return res.status(400).json({
        error: `You own shared profiles with other active members: ${names}. Remove the other members (or have them leave) before deleting your account.`,
      });
    }

    await run('DELETE FROM users WHERE id = ?', [req.userId]);
    res.status(204).end();
  })
);

module.exports = router;
