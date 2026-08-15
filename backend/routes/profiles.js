const express = require('express');
const { query, queryOne, run } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { isNonEmptyString, validateBody } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const profiles = await query(
    `SELECT p.id, p.name, p.created_at,
            (SELECT COUNT(*)::int FROM transactions t WHERE t.profile_id = p.id) AS transaction_count
     FROM profiles p
     WHERE p.user_id = ?
     ORDER BY p.created_at ASC`,
    [req.userId]
  );
  res.json({ profiles });
}));

router.post(
  '/',
  validateBody({ name: (v) => isNonEmptyString(v, 60) }),
  asyncHandler(async (req, res) => {
    const inserted = await queryOne(
      'INSERT INTO profiles (user_id, name) VALUES (?, ?) RETURNING id',
      [req.userId, req.body.name.trim()]
    );
    res.status(201).json({ id: inserted.id, name: req.body.name.trim() });
  })
);

router.put(
  '/:id',
  validateBody({ name: (v) => isNonEmptyString(v, 60) }),
  asyncHandler(async (req, res) => {
    const result = await run(
      'UPDATE profiles SET name = ? WHERE id = ? AND user_id = ?',
      [req.body.name.trim(), req.params.id, req.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Profile not found' });
    res.json({ id: Number(req.params.id), name: req.body.name.trim() });
  })
);

// Deleting a profile cascades to its transactions (ON DELETE CASCADE), so
// this is destructive - the frontend confirms with the user first. A user
// must always keep at least one profile so there's somewhere for new
// transactions to go.
router.delete('/:id', asyncHandler(async (req, res) => {
  const countRow = await queryOne('SELECT COUNT(*)::int AS n FROM profiles WHERE user_id = ?', [req.userId]);
  if (countRow.n <= 1) {
    return res.status(400).json({ error: 'You must keep at least one profile' });
  }
  const result = await run('DELETE FROM profiles WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Profile not found' });
  res.status(204).end();
}));

module.exports = router;
