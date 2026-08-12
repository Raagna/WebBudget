const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'finance.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Predefined categories, seeded once. These are global (user_id NULL) so
// every user sees the same baseline list alongside any custom categories.
const DEFAULT_CATEGORIES = [
  ['Subscription', 'expense', 'repeat'],
  ['Bill', 'expense', 'file-text'],
  ['Food', 'expense', 'utensils'],
  ['Groceries', 'expense', 'shopping-cart'],
  ['Transportation', 'expense', 'car'],
  ['Entertainment', 'expense', 'film'],
  ['Rent/Mortgage', 'expense', 'home'],
  ['Utilities', 'expense', 'zap'],
  ['Shopping', 'expense', 'bag'],
  ['Healthcare', 'expense', 'heart'],
  ['Salary/Income', 'income', 'briefcase'],
  ['Other', 'both', 'circle'],
];

const insertCategory = db.prepare(
  `INSERT OR IGNORE INTO categories (user_id, name, type, icon, is_default)
   VALUES (NULL, ?, ?, ?, 1)`
);
const seedCategories = db.transaction(() => {
  for (const [name, type, icon] of DEFAULT_CATEGORIES) {
    insertCategory.run(name, type, icon);
  }
});
seedCategories();

module.exports = db;
