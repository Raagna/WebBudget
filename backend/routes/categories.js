const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isNonEmptyString, validateBody } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

// Categories visible to a user = global defaults (user_id IS NULL) UNION
// that user's own custom categories. Never exposes other users' custom ones.
router.get('/', (req, res) => {
  const categories = db
    .prepare(
      `SELECT id, name, type, icon, is_default FROM categories
       WHERE user_id IS NULL OR user_id = ?
       ORDER BY is_default DESC, name ASC`
    )
    .all(req.userId);
  res.json({ categories });
});

router.post(
  '/',
  validateBody({
    name: (v) => isNonEmptyString(v, 50),
    type: (v) => ['income', 'expense', 'both'].includes(v),
  }),
  (req, res) => {
    const { name, type, icon } = req.body;
    try {
      const info = db
        .prepare(
          `INSERT INTO categories (user_id, name, type, icon, is_default)
           VALUES (?, ?, ?, ?, 0)`
        )
        .run(req.userId, name.trim(), type, isNonEmptyString(icon, 30) ? icon : 'tag');
      res.status(201).json({ id: info.lastInsertRowid, name: name.trim(), type });
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Category already exists' });
      }
      throw err;
    }
  }
);

// Only a user's own custom categories can be deleted; defaults are protected.
router.delete('/:id', (req, res) => {
  const result = db
    .prepare('DELETE FROM categories WHERE id = ? AND user_id = ? AND is_default = 0')
    .run(req.params.id, req.userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Category not found' });
  }
  res.status(204).end();
});

module.exports = router;
