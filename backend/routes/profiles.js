const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isNonEmptyString, validateBody } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const profiles = db
    .prepare(
      `SELECT p.id, p.name, p.created_at,
              (SELECT COUNT(*) FROM transactions t WHERE t.profile_id = p.id) AS transaction_count
       FROM profiles p
       WHERE p.user_id = ?
       ORDER BY p.created_at ASC`
    )
    .all(req.userId);
  res.json({ profiles });
});

router.post(
  '/',
  validateBody({ name: (v) => isNonEmptyString(v, 60) }),
  (req, res) => {
    const info = db
      .prepare('INSERT INTO profiles (user_id, name) VALUES (?, ?)')
      .run(req.userId, req.body.name.trim());
    res.status(201).json({ id: info.lastInsertRowid, name: req.body.name.trim() });
  }
);

router.put(
  '/:id',
  validateBody({ name: (v) => isNonEmptyString(v, 60) }),
  (req, res) => {
    const result = db
      .prepare('UPDATE profiles SET name = ? WHERE id = ? AND user_id = ?')
      .run(req.body.name.trim(), req.params.id, req.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Profile not found' });
    res.json({ id: Number(req.params.id), name: req.body.name.trim() });
  }
);

// Deleting a profile cascades to its transactions (ON DELETE CASCADE), so
// this is destructive - the frontend confirms with the user first. A user
// must always keep at least one profile so there's somewhere for new
// transactions to go.
router.delete('/:id', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?').get(req.userId).n;
  if (count <= 1) {
    return res.status(400).json({ error: 'You must keep at least one profile' });
  }
  const result = db.prepare('DELETE FROM profiles WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Profile not found' });
  res.status(204).end();
});

module.exports = router;
