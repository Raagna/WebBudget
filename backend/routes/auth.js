const express = require('express');
const bcrypt = require('bcryptjs');
const { queryOne, withTransaction } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth, signToken } = require('../middleware/auth');
const { isNonEmptyString, isValidEmail, validateBody } = require('../middleware/validate');

const router = express.Router();
const SALT_ROUNDS = 12;

// Compared against when a login names an email with no account, so that
// path costs the same bcrypt work as a wrong password. It has to be a
// real, well-formed hash at the same cost: bcryptjs returns false
// instantly for a malformed one, which made unknown emails answer
// ~250ms faster and revealed which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', SALT_ROUNDS);

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
    const hashToCheck = user ? user.password_hash : DUMMY_HASH;
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
// enough.
//
// What gets deleted is decided by who else uses each profile, never by
// who originally created it:
// - A profile nobody else is an active member of is deleted along with
//   its transactions (including one the user created and later left).
// - A shared profile survives, with every transaction in it - including
//   the ones this user entered (migration 005 turned the creator/author
//   columns into ON DELETE SET NULL history).
// - Deletion is refused while the user is the ONLY owner of a shared
//   profile, since it would be left with members but nobody able to
//   manage it. They promote someone to owner first (or remove the others).
// Their custom categories, bills and subscriptions are personal and go
// with the account.
router.delete(
  '/account',
  requireAuth,
  validateBody({ password: (v) => typeof v === 'string' && v.length > 0 }),
  asyncHandler(async (req, res) => {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ error: 'Account not found' });

    const valid = bcrypt.compareSync(req.body.password, user.password_hash);
    if (!valid) {
      // 403, not 401: the session is fine, only the confirmation password
      // is wrong. The frontend treats any 401 as "session expired" and
      // logs the user out, which is the wrong response to a typo here.
      return res.status(403).json({ error: 'Incorrect password' });
    }

    const result = await withTransaction(async (tx) => {
      const blockedProfiles = await tx.query(
        `SELECT p.name,
                (SELECT COUNT(*)::int FROM profile_members m WHERE m.profile_id = p.id AND m.status = 'active') AS member_count
         FROM profiles p
         JOIN profile_members pm ON pm.profile_id = p.id AND pm.user_id = ? AND pm.role = 'owner' AND pm.status = 'active'
         WHERE EXISTS (SELECT 1 FROM profile_members m
                       WHERE m.profile_id = p.id AND m.user_id <> pm.user_id AND m.status = 'active')
           AND NOT EXISTS (SELECT 1 FROM profile_members m
                           WHERE m.profile_id = p.id AND m.user_id <> pm.user_id
                             AND m.status = 'active' AND m.role = 'owner')`,
        [req.userId]
      );
      if (blockedProfiles.length > 0) {
        const names = blockedProfiles.map((p) => `"${p.name}" (${p.member_count} members)`).join(', ');
        return {
          error: `You are the only owner of shared profiles: ${names}. Promote another member to owner (or remove the other members) before deleting your account.`,
        };
      }

      // Profiles this user created or belongs to that nobody else is an
      // active member of. Shared ones are left alone.
      await tx.run(
        `DELETE FROM profiles p
         WHERE (p.user_id = ? OR EXISTS (SELECT 1 FROM profile_members pm
                                         WHERE pm.profile_id = p.id AND pm.user_id = ? AND pm.status = 'active'))
           AND NOT EXISTS (SELECT 1 FROM profile_members m
                           WHERE m.profile_id = p.id AND m.user_id <> ? AND m.status = 'active')`,
        [req.userId, req.userId, req.userId]
      );
      await tx.run('DELETE FROM users WHERE id = ?', [req.userId]);
      return { error: null };
    });

    if (result.error) return res.status(400).json({ error: result.error });
    res.status(204).end();
  })
);

module.exports = router;
