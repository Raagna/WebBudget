const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isNonEmptyString, validateBody } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

// Categories visible to a user = global defaults (user_id IS NULL) UNION
// that user's own custom categories, MINUS anything that user has hidden.
// Never exposes other users' custom categories.
router.get('/', (req, res) => {
  const categories = db
    .prepare(
      `SELECT c.id, c.name, c.type, c.icon, c.is_default
       FROM categories c
       WHERE (c.user_id IS NULL OR c.user_id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM hidden_categories h WHERE h.user_id = ? AND h.category_id = c.id
         )
       ORDER BY c.is_default DESC, c.name ASC`
    )
    .all(req.userId, req.userId);
  res.json({ categories });
});

// Default categories a user has hidden, so Settings can offer to restore them.
router.get('/hidden', (req, res) => {
  const hidden = db
    .prepare(
      `SELECT c.id, c.name, c.type, c.icon
       FROM hidden_categories h
       JOIN categories c ON c.id = h.category_id
       WHERE h.user_id = ?
       ORDER BY c.name ASC`
    )
    .all(req.userId);
  res.json({ hidden });
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

// Removing a category behaves differently depending on who owns it:
//  - a user's own custom category is actually deleted (transactions that
//    used it fall back to Uncategorized via ON DELETE SET NULL)
//  - a shared default category is only hidden for this user, since
//    deleting the row outright would remove it for every other account on
//    this instance too
router.delete('/:id', (req, res) => {
  const category = db.prepare('SELECT id, user_id FROM categories WHERE id = ?').get(req.params.id);
  if (!category || (category.user_id !== null && category.user_id !== req.userId)) {
    return res.status(404).json({ error: 'Category not found' });
  }

  if (category.user_id === req.userId) {
    db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  } else {
    db.prepare('INSERT OR IGNORE INTO hidden_categories (user_id, category_id) VALUES (?, ?)').run(
      req.userId,
      req.params.id
    );
  }
  res.status(204).end();
});

router.post('/:id/restore', (req, res) => {
  const result = db
    .prepare('DELETE FROM hidden_categories WHERE user_id = ? AND category_id = ?')
    .run(req.userId, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Category was not hidden' });
  res.status(204).end();
});

module.exports = router;
