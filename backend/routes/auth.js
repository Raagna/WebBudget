const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { queryOne, run, withTransaction } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth, signToken } = require('../middleware/auth');
const { isNonEmptyString, isValidEmail, isValidPassword, validateBody } = require('../middleware/validate');
const mailer = require('../utils/mailer');

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
    password: isValidPassword,
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

    const token = signToken(user.id, 0);
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

    const token = signToken(user.id, user.token_version);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  })
);

// ---------- Sessions and passwords ----------

// Lenient on purpose: a password set before the 72-byte cap (up to 128
// characters) must still be accepted when the user confirms it.
const isPasswordAttempt = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128;

// Changing the password signs out every other session (it bumps
// token_version, see middleware/auth.js) - if the password was changed
// because someone else knew it, their session must not survive. This
// device gets a fresh token so the user isn't bounced to the login page.
router.post(
  '/password',
  requireAuth,
  validateBody({ currentPassword: isPasswordAttempt, newPassword: isValidPassword }),
  asyncHandler(async (req, res) => {
    const user = await queryOne('SELECT id, password_hash FROM users WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ error: 'Account not found' });

    if (!bcrypt.compareSync(req.body.currentPassword, user.password_hash)) {
      // 403, not 401, for the same reason as DELETE /account below.
      return res.status(403).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = bcrypt.hashSync(req.body.newPassword, SALT_ROUNDS);
    const updated = await withTransaction(async (tx) => {
      // An outstanding reset link was asked for under the old password;
      // it shouldn't be able to undo this change an hour later.
      await tx.run('DELETE FROM password_resets WHERE user_id = ?', [user.id]);
      return tx.queryOne(
        'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ? RETURNING token_version',
        [passwordHash, user.id]
      );
    });
    res.json({ token: signToken(user.id, updated.token_version) });
  })
);

// "Sign out everywhere": every token issued so far stops working,
// including the one making this request.
router.post('/logout-all', requireAuth, asyncHandler(async (req, res) => {
  await run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [req.userId]);
  res.status(204).end();
}));

const RESET_MESSAGE = 'If an account exists for that email, we sent a link to reset its password.';

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issuePasswordReset(email) {
  const user = await queryOne('SELECT id, email FROM users WHERE email = ?', [email]);
  if (!user) return;

  // 32 random bytes: unguessable, so a plain SHA-256 is enough to store
  // it (bcrypt's slowness only matters for low-entropy human passwords),
  // and it can be looked up by its hash directly.
  const token = crypto.randomBytes(32).toString('base64url');
  await withTransaction(async (tx) => {
    // Only the newest link works; asking again cancels earlier ones.
    await tx.run('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', [user.id]);
    await tx.run(
      `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL '1 hour')`,
      [user.id, hashResetToken(token)]
    );
  });
  await mailer.sendPasswordReset(user.email, token);
}

// Answers BEFORE looking the email up, then does the work. Same rule as
// login/register: the response must not reveal whether an account exists,
// and that includes its timing - creating a token and sending an email
// takes far longer than finding nothing, so awaiting it would tell.
router.post(
  '/forgot-password',
  validateBody({ email: isValidEmail }),
  (req, res) => {
    res.status(202).json({ message: RESET_MESSAGE });
    issuePasswordReset(req.body.email.trim().toLowerCase()).catch((err) => {
      console.error('[auth] could not issue a password reset', err);
    });
  }
);

// Spends the token and sets the new password in one transaction. The
// conditional UPDATE is what makes a link single use: two requests racing
// with the same token can't both match "used_at IS NULL". Setting a new
// password this way also signs out every existing session.
router.post(
  '/reset-password',
  validateBody({ token: (v) => isNonEmptyString(v, 200), password: isValidPassword }),
  asyncHandler(async (req, res) => {
    const passwordHash = bcrypt.hashSync(req.body.password, SALT_ROUNDS);
    const ok = await withTransaction(async (tx) => {
      const reset = await tx.queryOne(
        `UPDATE password_resets SET used_at = NOW()
         WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
         RETURNING id, user_id`,
        [hashResetToken(req.body.token)]
      );
      if (!reset) return false;
      await tx.run(
        'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
        [passwordHash, reset.user_id]
      );
      await tx.run('DELETE FROM password_resets WHERE user_id = ? AND id <> ?', [reset.user_id, reset.id]);
      return true;
    });
    if (!ok) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Ask for a new one.' });
    }
    res.status(204).end();
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
  validateBody({ password: isPasswordAttempt }),
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
