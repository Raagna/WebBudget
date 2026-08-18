const express = require('express');
const { query, queryOne, run, withTransaction } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { isNonEmptyString, isValidEmail, isValidCurrency, validateBody } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

// A profile is now shared through profile_members rather than a single
// owner column. Membership has two axes: role ('owner' can rename/delete
// the profile, manage members, and promote/demote other owners; 'member'
// can use it day-to-day) and status ('pending' = invited but not
// accepted, 'active' = can actually see the profile's data). A profile
// can have MORE THAN ONE active owner - that's an application-layer rule
// enforced here, not a database constraint (profile_members.role allows
// 'owner' on any number of rows for the same profile). Every route below
// checks profile_members, not profiles.user_id directly - profiles.user_id
// still exists as a record of who originally created it, but it's no
// longer what authorization reads.

async function getMembership(profileId, userId) {
  return queryOne(
    'SELECT role, status FROM profile_members WHERE profile_id = ? AND user_id = ?',
    [profileId, userId]
  );
}

async function countActiveOwners(profileId) {
  const row = await queryOne(
    `SELECT COUNT(*)::int AS n FROM profile_members WHERE profile_id = ? AND role = 'owner' AND status = 'active'`,
    [profileId]
  );
  return row.n;
}

// Profiles this user can currently see and use (accepted invites only).
router.get('/', asyncHandler(async (req, res) => {
  const profiles = await query(
    `SELECT p.id, p.name, p.currency, p.created_at, pm.role,
            (SELECT COUNT(*)::int FROM transactions t WHERE t.profile_id = p.id) AS transaction_count,
            (SELECT COUNT(*)::int FROM profile_members m WHERE m.profile_id = p.id AND m.status = 'active') AS member_count
     FROM profile_members pm
     JOIN profiles p ON p.id = pm.profile_id
     WHERE pm.user_id = ? AND pm.status = 'active'
     ORDER BY p.created_at ASC`,
    [req.userId]
  );
  res.json({ profiles });
}));

// Invites sent to this user that haven't been accepted or declined yet.
router.get('/invites', asyncHandler(async (req, res) => {
  const invites = await query(
    `SELECT p.id AS profile_id, p.name AS profile_name, u.name AS invited_by_name
     FROM profile_members pm
     JOIN profiles p ON p.id = pm.profile_id
     LEFT JOIN users u ON u.id = pm.invited_by
     WHERE pm.user_id = ? AND pm.status = 'pending'
     ORDER BY pm.created_at DESC`,
    [req.userId]
  );
  res.json({ invites });
}));

router.post('/invites/:profileId/accept', asyncHandler(async (req, res) => {
  const result = await run(
    `UPDATE profile_members SET status = 'active'
     WHERE profile_id = ? AND user_id = ? AND status = 'pending'`,
    [req.params.profileId, req.userId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Invite not found' });
  res.status(204).end();
}));

router.post('/invites/:profileId/decline', asyncHandler(async (req, res) => {
  const result = await run(
    `DELETE FROM profile_members WHERE profile_id = ? AND user_id = ? AND status = 'pending'`,
    [req.params.profileId, req.userId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Invite not found' });
  res.status(204).end();
}));

router.post(
  '/',
  validateBody({
    name: (v) => isNonEmptyString(v, 60),
    currency: (v) => v === undefined || isValidCurrency(v),
  }),
  asyncHandler(async (req, res) => {
    const name = req.body.name.trim();
    const currency = (req.body.currency || 'USD').toUpperCase();
    const profile = await withTransaction(async (tx) => {
      const inserted = await tx.queryOne(
        'INSERT INTO profiles (user_id, name, currency) VALUES (?, ?, ?) RETURNING id',
        [req.userId, name, currency]
      );
      await tx.run(
        `INSERT INTO profile_members (profile_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')`,
        [inserted.id, req.userId]
      );
      return inserted;
    });
    res.status(201).json({ id: profile.id, name, currency });
  })
);

router.put(
  '/:id',
  validateBody({
    name: (v) => v === undefined || isNonEmptyString(v, 60),
    currency: (v) => v === undefined || isValidCurrency(v),
  }),
  asyncHandler(async (req, res) => {
    const membership = await getMembership(req.params.id, req.userId);
    if (!membership || membership.status !== 'active') {
      return res.status(404).json({ error: 'Profile not found' });
    }
    if (membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only a profile owner can edit it' });
    }
    if (req.body.name === undefined && req.body.currency === undefined) {
      return res.status(400).json({ error: 'Provide name and/or currency to update' });
    }

    const fields = [];
    const params = [];
    if (req.body.name !== undefined) { fields.push('name = ?'); params.push(req.body.name.trim()); }
    if (req.body.currency !== undefined) { fields.push('currency = ?'); params.push(req.body.currency.toUpperCase()); }

    await run(`UPDATE profiles SET ${fields.join(', ')} WHERE id = ?`, [...params, req.params.id]);
    const updated = await queryOne('SELECT id, name, currency FROM profiles WHERE id = ?', [req.params.id]);
    res.json(updated);
  })
);

// Deleting a profile cascades to its transactions and memberships
// (ON DELETE CASCADE), so this is destructive - the frontend confirms
// first. Any owner can delete it (not just whoever created it). A user
// must always keep at least one active profile membership of their own.
router.delete('/:id', asyncHandler(async (req, res) => {
  const membership = await getMembership(req.params.id, req.userId);
  if (!membership || membership.status !== 'active') {
    return res.status(404).json({ error: 'Profile not found' });
  }
  if (membership.role !== 'owner') {
    return res.status(403).json({ error: 'Only a profile owner can delete it' });
  }
  const countRow = await queryOne(
    `SELECT COUNT(*)::int AS n FROM profile_members WHERE user_id = ? AND status = 'active'`,
    [req.userId]
  );
  if (countRow.n <= 1) {
    return res.status(400).json({ error: 'You must keep at least one profile' });
  }
  await run('DELETE FROM profiles WHERE id = ?', [req.params.id]);
  res.status(204).end();
}));

// ---------- Members ----------

router.get('/:id/members', asyncHandler(async (req, res) => {
  const membership = await getMembership(req.params.id, req.userId);
  if (!membership || membership.status !== 'active') {
    return res.status(404).json({ error: 'Profile not found' });
  }
  const members = await query(
    `SELECT u.id AS user_id, u.name, u.email, pm.role, pm.status
     FROM profile_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.profile_id = ?
     ORDER BY pm.role = 'owner' DESC, pm.created_at ASC`,
    [req.params.id]
  );
  res.json({ members });
}));

router.post(
  '/:id/members',
  validateBody({ email: isValidEmail }),
  asyncHandler(async (req, res) => {
    const membership = await getMembership(req.params.id, req.userId);
    if (!membership || membership.status !== 'active') {
      return res.status(404).json({ error: 'Profile not found' });
    }
    if (membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only a profile owner can invite members' });
    }

    const email = req.body.email.trim().toLowerCase();
    const target = await queryOne('SELECT id FROM users WHERE email = ?', [email]);

    // Same "don't confirm whether an account exists" principle as
    // login/register: always respond the same way whether or not a
    // matching account was found, and silently no-op if it wasn't.
    if (target) {
      const existing = await getMembership(req.params.id, target.id);
      if (!existing) {
        await run(
          `INSERT INTO profile_members (profile_id, user_id, role, status, invited_by)
           VALUES (?, ?, 'member', 'pending', ?)`,
          [req.params.id, target.id, req.userId]
        );
      }
      // If existing (already a member or already invited), do nothing -
      // still returns the same generic response below either way.
    }

    res.status(202).json({ message: 'If an account exists with that email, they have been invited.' });
  })
);

// Any owner can remove any other member (owner or plain member) - safe by
// construction, since the acting owner always remains active afterward,
// so the profile never ends up with zero owners that way. Anyone can
// remove themselves (leave) UNLESS they're the profile's only remaining
// active owner - promote a co-owner first, or delete the profile instead.
router.delete('/:id/members/:userId', asyncHandler(async (req, res) => {
  const targetUserId = Number(req.params.userId);
  const membership = await getMembership(req.params.id, req.userId);
  if (!membership || membership.status !== 'active') {
    return res.status(404).json({ error: 'Profile not found' });
  }

  const isSelf = targetUserId === req.userId;
  if (!isSelf && membership.role !== 'owner') {
    return res.status(403).json({ error: 'Only a profile owner can remove other members' });
  }
  if (isSelf && membership.role === 'owner') {
    const ownerCount = await countActiveOwners(req.params.id);
    if (ownerCount <= 1) {
      return res.status(400).json({
        error: 'You are the only owner — promote another member to owner first, or delete the profile instead',
      });
    }
  }

  const result = await run(
    'DELETE FROM profile_members WHERE profile_id = ? AND user_id = ?',
    [req.params.id, targetUserId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Member not found' });
  res.status(204).end();
}));

// Promote an active member to co-owner. Owner-only. Any number of owners
// is allowed - there's no cap.
router.post('/:id/members/:userId/promote', asyncHandler(async (req, res) => {
  const membership = await getMembership(req.params.id, req.userId);
  if (!membership || membership.status !== 'active') {
    return res.status(404).json({ error: 'Profile not found' });
  }
  if (membership.role !== 'owner') {
    return res.status(403).json({ error: 'Only a profile owner can promote members' });
  }
  const target = await getMembership(req.params.id, req.params.userId);
  if (!target || target.status !== 'active') {
    return res.status(404).json({ error: 'Member not found' });
  }
  if (target.role === 'owner') {
    return res.status(400).json({ error: 'Already an owner' });
  }
  await run(
    `UPDATE profile_members SET role = 'owner' WHERE profile_id = ? AND user_id = ?`,
    [req.params.id, req.params.userId]
  );
  res.status(204).end();
}));

// Demote a co-owner back to a regular member. Owner-only, including
// demoting yourself - but blocked if the target is the profile's last
// remaining active owner, same "never leave a profile with zero owners"
// rule as the leave/remove endpoint above.
router.post('/:id/members/:userId/demote', asyncHandler(async (req, res) => {
  const membership = await getMembership(req.params.id, req.userId);
  if (!membership || membership.status !== 'active') {
    return res.status(404).json({ error: 'Profile not found' });
  }
  if (membership.role !== 'owner') {
    return res.status(403).json({ error: 'Only a profile owner can demote another owner' });
  }
  const target = await getMembership(req.params.id, req.params.userId);
  if (!target || target.status !== 'active' || target.role !== 'owner') {
    return res.status(400).json({ error: 'That member is not currently an owner' });
  }
  const ownerCount = await countActiveOwners(req.params.id);
  if (ownerCount <= 1) {
    return res.status(400).json({ error: 'Cannot demote the only remaining owner' });
  }
  await run(
    `UPDATE profile_members SET role = 'member' WHERE profile_id = ? AND user_id = ?`,
    [req.params.id, req.params.userId]
  );
  res.status(204).end();
}));

module.exports = router;
