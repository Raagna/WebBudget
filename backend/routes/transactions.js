const express = require('express');
const { query, queryOne, run, withTransaction } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { parseCsv, generateCsv, unneutralize } = require('../utils/csv');
const { detectFormat, parseBankRows, assignImportHashes, merchantKey, guessCategory } = require('../utils/bankImport');
const { modelCategorize } = require('../utils/modelCategorize');
const { findRecurringSeries, seriesKey } = require('../utils/recurring');
const {
  isNonEmptyString,
  isValidDate,
  isPositiveAmount,
  isIdArray,
  toCents,
  fromCents,
  validateBody,
} = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

const SORTABLE_COLUMNS = new Set(['occurred_on', 'amount_cents', 'description', 'type']);

function serialize(row) {
  return {
    id: row.id,
    amount: fromCents(row.amount_cents),
    type: row.type,
    description: row.description,
    date: row.occurred_on instanceof Date ? row.occurred_on.toISOString().slice(0, 10) : row.occurred_on,
    isRecurring: !!row.is_recurring,
    recurringInterval: row.recurring_interval,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryIcon: row.category_icon,
    profileId: row.profile_id,
    // Who entered it - shown in shared households. null once that member
    // has deleted their account (the transaction itself stays; see
    // migration 005).
    addedBy: row.user_id ? { id: row.user_id, name: row.added_by_name } : null,
  };
}

// Every route below operates within a single profile. This helper confirms
// the authenticated user has an active membership on the requested profile
// before any query touches it - either as the original owner or as an
// invited-and-accepted member - so a user can never read or write a
// profile they're not part of by guessing an id. Returns null (and has
// already sent a response) if the check fails.
async function requireOwnedProfile(req, res, profileIdRaw) {
  const profileId = Number(profileIdRaw);
  if (!Number.isInteger(profileId) || profileId <= 0) {
    res.status(400).json({ error: 'A valid profileId is required' });
    return null;
  }
  const member = await queryOne(
    `SELECT 1 FROM profile_members WHERE profile_id = ? AND user_id = ? AND status = 'active'`,
    [profileId, req.userId]
  );
  if (!member) {
    res.status(404).json({ error: 'Profile not found' });
    return null;
  }
  return profileId;
}

// Given a transaction id, confirms the requester is an active member of
// the PROFILE that transaction belongs to - not just that they personally
// created it. This is what makes shared households actually collaborative:
// either partner can fix or remove a transaction the other one entered.
async function requireTransactionAccess(req, res, transactionId) {
  const row = await queryOne(
    `SELECT t.id, t.profile_id FROM transactions t
     JOIN profile_members pm ON pm.profile_id = t.profile_id AND pm.user_id = ? AND pm.status = 'active'
     WHERE t.id = ?`,
    [req.userId, transactionId]
  );
  if (!row) {
    res.status(404).json({ error: 'Transaction not found' });
    return null;
  }
  return row;
}

// Shared by GET / and GET /export so the two never drift out of sync on
// what "matching the current filters" means.
function buildFilterClauses(req, profileId) {
  const { type, categoryId, from, to, minAmount, maxAmount, addedBy } = req.query;
  const clauses = ['t.profile_id = ?'];
  const params = [profileId];

  if (type === 'income' || type === 'expense') {
    clauses.push('t.type = ?');
    params.push(type);
  }
  if (categoryId && Number.isInteger(Number(categoryId))) {
    clauses.push('t.category_id = ?');
    params.push(Number(categoryId));
  }
  if (addedBy && Number.isInteger(Number(addedBy))) {
    clauses.push('t.user_id = ?');
    params.push(Number(addedBy));
  }
  if (isValidDate(from)) {
    clauses.push('t.occurred_on >= ?');
    params.push(from);
  }
  if (isValidDate(to)) {
    clauses.push('t.occurred_on <= ?');
    params.push(to);
  }
  if (minAmount && !Number.isNaN(Number(minAmount))) {
    clauses.push('t.amount_cents >= ?');
    params.push(toCents(Number(minAmount)));
  }
  if (maxAmount && !Number.isNaN(Number(maxAmount))) {
    clauses.push('t.amount_cents <= ?');
    params.push(toCents(Number(maxAmount)));
  }
  // Free-text search: the description or the category name contains it,
  // or - when it reads as an amount ("42.17", "$42") - the amount is
  // exactly that. % and _ are escaped so they're searched for literally.
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const asAmount = Number(q.replace(/[$,\s]/g, ''));
    const amountClause = q.replace(/[$,\s]/g, '') !== '' && Number.isFinite(asAmount) && asAmount > 0 ? ' OR t.amount_cents = ?' : '';
    clauses.push(`(t.description ILIKE ? OR EXISTS (SELECT 1 FROM categories cq WHERE cq.id = t.category_id AND cq.name ILIKE ?)${amountClause})`);
    params.push(like, like);
    if (amountClause) params.push(toCents(asAmount));
  }
  return { clauses, params };
}

// GET /api/transactions?profileId=&q=&type=&categoryId=&addedBy=&from=&to=&minAmount=&maxAmount=&sort=&dir=&limit=&offset=
router.get('/', asyncHandler(async (req, res) => {
  const profileId = await requireOwnedProfile(req, res, req.query.profileId);
  if (profileId === null) return;

  const sort = SORTABLE_COLUMNS.has(req.query.sort) ? req.query.sort : 'occurred_on';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  // Filtered by profile only, NOT by who entered each transaction - every
  // active member of a shared profile sees the whole shared ledger, not
  // just the rows they personally added.
  const { clauses, params } = buildFilterClauses(req, profileId);

  // sort/dir are validated against an allow-list above, never interpolated
  // from raw user input, so this stays injection-safe despite the template
  // literal.
  const sql = `
    SELECT t.*, c.name AS category_name, c.icon AS category_icon, u.name AS added_by_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY t.${sort} ${dir}, t.id ${dir}
    LIMIT ? OFFSET ?
  `;
  const rows = await query(sql, [...params, limit, offset]);
  const totalRow = await queryOne(
    `SELECT COUNT(*)::int AS n FROM transactions t WHERE ${clauses.join(' AND ')}`,
    params
  );

  res.json({ transactions: rows.map(serialize), total: totalRow.n, limit, offset });
}));

const CSV_COLUMNS = ['date', 'type', 'description', 'category', 'amount', 'recurring', 'recurring_interval'];

// GET /api/transactions/export?profileId=&(same filters as the list above)
// Exports EVERY matching transaction (no limit/offset - a full download,
// not a page of one), as a CSV file download.
router.get('/export', asyncHandler(async (req, res) => {
  const profileId = await requireOwnedProfile(req, res, req.query.profileId);
  if (profileId === null) return;

  const { clauses, params } = buildFilterClauses(req, profileId);
  const rows = await query(
    `SELECT t.*, c.name AS category_name
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY t.occurred_on ASC`,
    params
  );

  const csvRows = [CSV_COLUMNS];
  for (const row of rows) {
    csvRows.push([
      row.occurred_on instanceof Date ? row.occurred_on.toISOString().slice(0, 10) : row.occurred_on,
      row.type,
      row.description,
      row.category_name || '',
      fromCents(row.amount_cents),
      row.is_recurring ? 'true' : 'false',
      row.recurring_interval || '',
    ]);
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(generateCsv(csvRows));
}));

// POST /api/transactions/import  { profileId, csv: "<raw csv text>" }
// The frontend reads the chosen file client-side and sends its contents
// as a JSON string field rather than a multipart upload - avoids adding a
// file-upload middleware dependency for what's fundamentally just text,
// and everything here is re-validated server-side regardless of what the
// client already checked, same as every other endpoint in this app.
router.post(
  '/import',
  express.json({ limit: '5mb' }),
  validateBody({ csv: (v) => typeof v === 'string' && v.length > 0 && v.length < 5_000_000 }),
  asyncHandler(async (req, res) => {
    const profileId = await requireOwnedProfile(req, res, req.body.profileId);
    if (profileId === null) return;

    // Spreadsheet apps on Windows often save with a byte-order mark, which
    // would otherwise stick to the first header (or TD's first date).
    const rows = parseCsv(req.body.csv.replace(/^﻿/, ''));
    if (rows.length === 0) {
      return res.status(400).json({ error: 'The file is empty' });
    }

    const detected = detectFormat(rows);
    if (!detected) {
      return res.status(400).json({
        error: 'Unrecognized file format. Expected either this app\'s export (a header row with at least: date, type, amount) '
          + 'or a TD bank download (date, description, withdrawal, deposit, balance). '
          + `First row: ${rows[0].join(', ')}`,
      });
    }

    // Category names are matched case-insensitively against everything
    // this user can currently see (their own custom categories plus the
    // shared defaults) - same visibility rule as everywhere else in the
    // app. A name that doesn't match anything isn't a hard error; the row
    // still imports, just uncategorized, and gets reported as a warning
    // rather than skipped outright.
    const visibleCategories = await query(
      `SELECT id, name FROM categories WHERE user_id IS NULL OR user_id = ?`,
      [req.userId]
    );
    const categoryByName = new Map(visibleCategories.map((c) => [c.name.toLowerCase(), c.id]));

    let records;
    let errors;
    const warnings = [];

    if (detected.format === 'td') {
      ({ records, errors } = parseBankRows(rows, detected));
    } else {
      ({ records, errors } = parseAppRows(rows, detected.header, categoryByName, warnings));
    }

    // Duplicates: anything this profile has already imported (an
    // overlapping bank download, or the same file twice) is skipped and
    // reported rather than inserted again.
    assignImportHashes(profileId, records);
    const existing = records.length === 0 ? [] : await query(
      `SELECT id, import_hash, category_id FROM transactions WHERE profile_id = ? AND import_hash = ANY(?)`,
      [profileId, records.map((r) => r.importHash)]
    );
    const existingByHash = new Map(existing.map((r) => [r.import_hash, r]));
    const duplicates = records.filter((r) => existingByHash.has(r.importHash)).map((r) => r.rowNum);
    const toInsert = records.filter((r) => !existingByHash.has(r.importHash));

    // A bank row imported before categorization could place it is still
    // uncategorized. Importing the same file again fills those in - the
    // rows themselves stay skipped as duplicates.
    const toFill = records
      .filter((r) => r.autoCategorize && existingByHash.get(r.importHash)?.category_id === null)
      .map((r) => ({ ...r, existingId: existingByHash.get(r.importHash).id }));

    await autoCategorize(req.userId, profileId, [...toInsert, ...toFill]);
    const autoCategorized = toInsert.filter((r) => r.categorizedBy).length;
    const lookedUp = toInsert.filter((r) => r.categorizedBy === 'model').length;
    const filled = toFill.filter((r) => r.categoryId);
    const recurringUpdates = await detectRecurring(profileId, toInsert);

    // Insert all new rows in ONE database transaction. If any insert
    // fails, none are kept, so a failed import never leaves half a file
    // behind that a retry would then duplicate. ON CONFLICT covers the
    // same file being imported twice at once: the second copy's rows are
    // counted as duplicates instead of failing the whole import. The
    // updates to earlier rows ride in the same transaction.
    const { inserted, recurringExisting } = await withTransaction(async (tx) => {
      let n = 0;
      for (const r of toInsert) {
        const result = await tx.run(
          `INSERT INTO transactions
             (user_id, profile_id, category_id, amount_cents, type, description, occurred_on, is_recurring, recurring_interval, import_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (profile_id, import_hash) WHERE import_hash IS NOT NULL DO NOTHING`,
          [req.userId, profileId, r.categoryId, r.amountCents, r.type, r.description, r.date, r.recurring, r.interval, r.importHash]
        );
        n += result.rowCount;
      }
      for (const r of filled) {
        await tx.run(
          `UPDATE transactions SET category_id = ?, updated_at = NOW() WHERE id = ? AND category_id IS NULL`,
          [r.categoryId, r.existingId]
        );
      }
      let flagged = 0;
      for (const [interval, ids] of recurringUpdates) {
        const result = await tx.run(
          `UPDATE transactions SET is_recurring = TRUE, recurring_interval = ?, updated_at = NOW()
           WHERE id = ANY(?) AND is_recurring = FALSE`,
          [interval, ids]
        );
        flagged += result.rowCount;
      }
      return { inserted: n, recurringExisting: flagged };
    });

    res.json({
      format: detected.format,
      imported: inserted,
      duplicates: duplicates.length + (toInsert.length - inserted),
      duplicateRows: duplicates,
      autoCategorized,
      lookedUp,
      categorizedExisting: filled.length,
      recurring: toInsert.filter((r) => r.autoCategorize && r.recurring).length,
      recurringExisting,
      errors,
      warnings,
      totalRows: rows.length - (detected.format === 'td' && !detected.hasHeader ? 0 : 1),
    });
  })
);

// Gives bank rows (they never carry a category) one, in order of trust:
//   1. how this profile categorized the same merchant before
//   2. built-in merchant keywords, then bank codes (e-transfer, NSF...)
//   3. the local model, for merchants nothing above recognizes
// App-format files say their category explicitly, so a blank there stays
// blank. Sets categoryId and categorizedBy ('rules' | 'model') on each
// record it places.
async function autoCategorize(userId, profileId, records) {
  const pending = records.filter((r) => r.autoCategorize && !r.categoryId);
  if (pending.length === 0) return;

  const usable = await query(
    `SELECT c.id, c.name, c.type FROM categories c
     WHERE (c.user_id IS NULL OR c.user_id = ?)
       AND NOT EXISTS (SELECT 1 FROM hidden_categories h WHERE h.user_id = ? AND h.category_id = c.id)`,
    [userId, userId]
  );
  const usableIds = new Set(usable.map((c) => c.id));
  const past = await query(
    `SELECT description, type, category_id FROM transactions
     WHERE profile_id = ? AND category_id IS NOT NULL
     ORDER BY occurred_on DESC, id DESC
     LIMIT 5000`,
    [profileId]
  );
  const history = new Map();
  for (const t of past) {
    // A shared profile can hold another member's custom categories,
    // which this user can't see or pick - don't hand those out.
    if (!usableIds.has(t.category_id)) continue;
    const key = `${t.type}|${merchantKey(t.description)}`;
    if (!history.has(key)) history.set(key, t.category_id); // newest first
  }
  const byName = new Map(usable.map((c) => [c.name.toLowerCase(), c.id]));

  const unplaced = new Map(); // `${type}|${merchantKey}` -> lookup item
  for (const r of pending) {
    r.categoryId = guessCategory(r, { history, byName });
    if (r.categoryId) { r.categorizedBy = 'rules'; continue; }
    const key = merchantKey(r.description);
    if (key && !unplaced.has(`${r.type}|${key}`)) {
      unplaced.set(`${r.type}|${key}`, { key: `${r.type}|${key}`, description: r.description, type: r.type });
    }
  }

  // One request per batch of distinct merchants, not per row: ten visits
  // to the same unknown shop are one question.
  const fromModel = await modelCategorize([...unplaced.values()], usable);
  for (const r of pending) {
    if (r.categoryId) continue;
    const id = fromModel.get(`${r.type}|${merchantKey(r.description)}`);
    if (id) { r.categoryId = id; r.categorizedBy = 'model'; }
  }
}

// Flags new bank rows that belong to a weekly, monthly or yearly series
// (see utils/recurring.js), looking back - and ahead - 400 days through
// this profile's transactions so a once-a-month charge is caught one file
// at a time. Rows the file or user already marked recurring are left
// alone. Earlier rows in a newly found series get flagged too, so the
// whole series reads the same in the list; returns those as
// [[interval, ids]] for the caller's transaction.
async function detectRecurring(profileId, toInsert) {
  const bankRows = toInsert.filter((r) => r.autoCategorize);
  if (bankRows.length === 0) return [];
  const dates = bankRows.map((r) => r.date).sort();
  const stored = await query(
    `SELECT id, type, description, amount_cents, occurred_on, is_recurring FROM transactions
     WHERE profile_id = ? AND occurred_on BETWEEN ?::date - 400 AND ?::date + 400
     ORDER BY occurred_on DESC
     LIMIT 20000`,
    [profileId, dates[0], dates[dates.length - 1]]
  );
  const storedRows = stored.map((t) => ({
    id: t.id, type: t.type, description: t.description, date: t.occurred_on, amountCents: t.amount_cents, isRecurring: t.is_recurring,
  }));
  const series = findRecurringSeries([...storedRows, ...bankRows]);
  const keyOf = (r) => `${r.type}|${seriesKey(r.description)}`;

  const touched = new Set();
  for (const r of bankRows) {
    const interval = series.get(keyOf(r));
    if (!interval) continue;
    touched.add(keyOf(r));
    if (!r.recurring) { r.recurring = true; r.interval = interval; }
  }
  const updates = new Map(); // interval -> ids
  for (const t of storedRows) {
    if (t.isRecurring || !touched.has(keyOf(t))) continue;
    const interval = series.get(keyOf(t));
    if (!updates.has(interval)) updates.set(interval, []);
    updates.get(interval).push(t.id);
  }
  return [...updates];
}

// Validates rows in this app's own export format (see CSV_COLUMNS) into
// the shared record shape. Rows with problems are skipped and reported.
function parseAppRows(rows, header, categoryByName, warnings) {
  const colIndex = {};
  for (const col of CSV_COLUMNS) colIndex[col] = header.indexOf(col);

  const records = [];
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i];
    if (raw.length === 1 && raw[0].trim() === '') continue; // blank line
    const rowNum = i + 1; // 1-based, matches what a spreadsheet would show

    const date = (raw[colIndex.date] || '').trim();
    const type = (raw[colIndex.type] || '').trim().toLowerCase();
    // unneutralize: strip the apostrophe our own export adds in front of
    // text that looks like a spreadsheet formula (see utils/csv.js).
    const description = colIndex.description >= 0 ? unneutralize((raw[colIndex.description] || '').trim()) : '';
    const categoryName = colIndex.category >= 0 ? unneutralize((raw[colIndex.category] || '').trim()) : '';
    const amountStr = (raw[colIndex.amount] || '').trim();
    const recurringStr = colIndex.recurring >= 0 ? (raw[colIndex.recurring] || '').trim().toLowerCase() : '';
    const intervalStr = colIndex.recurring_interval >= 0 ? (raw[colIndex.recurring_interval] || '').trim().toLowerCase() : '';

    if (!isValidDate(date)) { errors.push({ row: rowNum, reason: `Invalid date "${date}" (expected YYYY-MM-DD)` }); continue; }
    if (type !== 'income' && type !== 'expense') { errors.push({ row: rowNum, reason: `Invalid type "${type}" (expected income or expense)` }); continue; }
    const amount = Number(amountStr);
    if (!isPositiveAmount(amount)) { errors.push({ row: rowNum, reason: `Invalid amount "${amountStr}"` }); continue; }

    let categoryId = null;
    if (categoryName) {
      categoryId = categoryByName.get(categoryName.toLowerCase()) || null;
      if (categoryId === null) {
        warnings.push({ row: rowNum, reason: `Category "${categoryName}" not found - imported as Uncategorized` });
      }
    }

    const recurring = recurringStr === 'true' || recurringStr === 'yes' || recurringStr === '1';
    const interval = recurring && ['weekly', 'monthly', 'yearly'].includes(intervalStr) ? intervalStr : null;

    records.push({
      rowNum,
      date,
      type,
      description: description.slice(0, 255),
      amountCents: toCents(amount),
      categoryId,
      recurring,
      interval,
      autoCategorize: false,
    });
  }
  return { records, errors };
}

router.post(
  '/',
  validateBody({
    amount: isPositiveAmount,
    type: (v) => v === 'income' || v === 'expense',
    description: (v) => v === undefined || isNonEmptyString(v, 255),
    date: isValidDate,
  }),
  asyncHandler(async (req, res) => {
    const profileId = await requireOwnedProfile(req, res, req.body.profileId);
    if (profileId === null) return;

    const { amount, type, description = '', date, categoryId, isRecurring, recurringInterval } = req.body;

    if (categoryId !== undefined && categoryId !== null) {
      const cat = await queryOne(
        'SELECT id FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)',
        [categoryId, req.userId]
      );
      if (!cat) return res.status(400).json({ error: 'Invalid category' });
    }

    const recurring = !!isRecurring;
    const interval = recurring && ['weekly', 'monthly', 'yearly'].includes(recurringInterval)
      ? recurringInterval
      : null;

    // user_id still records who actually entered it (shown nowhere in the
    // UI today, but useful history) - authorization for everything else
    // flows through profile_id + profile_members, not this column.
    const inserted = await queryOne(
      `INSERT INTO transactions
         (user_id, profile_id, category_id, amount_cents, type, description, occurred_on, is_recurring, recurring_interval)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [req.userId, profileId, categoryId || null, toCents(amount), type, description.trim(), date, recurring, interval]
    );

    const row = await queryOne(
      `SELECT t.*, c.name AS category_name, c.icon AS category_icon, u.name AS added_by_name
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN users u ON u.id = t.user_id
       WHERE t.id = ?`,
      [inserted.id]
    );
    res.status(201).json(serialize(row));
  })
);

router.put(
  '/:id',
  validateBody({
    amount: isPositiveAmount,
    type: (v) => v === 'income' || v === 'expense',
    description: (v) => v === undefined || isNonEmptyString(v, 255),
    date: isValidDate,
  }),
  asyncHandler(async (req, res) => {
    const { amount, type, description = '', date, categoryId, isRecurring, recurringInterval } = req.body;

    const access = await requireTransactionAccess(req, res, req.params.id);
    if (access === null) return;

    if (categoryId !== undefined && categoryId !== null) {
      const cat = await queryOne(
        'SELECT id FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)',
        [categoryId, req.userId]
      );
      if (!cat) return res.status(400).json({ error: 'Invalid category' });
    }

    const recurring = !!isRecurring;
    const interval = recurring && ['weekly', 'monthly', 'yearly'].includes(recurringInterval)
      ? recurringInterval
      : null;

    await run(
      `UPDATE transactions
       SET amount_cents = ?, type = ?, description = ?, occurred_on = ?,
           category_id = ?, is_recurring = ?, recurring_interval = ?, updated_at = NOW()
       WHERE id = ?`,
      [toCents(amount), type, description.trim(), date, categoryId || null, recurring, interval, req.params.id]
    );

    const row = await queryOne(
      `SELECT t.*, c.name AS category_name, c.icon AS category_icon, u.name AS added_by_name
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN users u ON u.id = t.user_id
       WHERE t.id = ?`,
      [req.params.id]
    );
    res.json(serialize(row));
  })
);

router.delete('/:id', asyncHandler(async (req, res) => {
  const access = await requireTransactionAccess(req, res, req.params.id);
  if (access === null) return;

  await run('DELETE FROM transactions WHERE id = ?', [req.params.id]);
  res.status(204).end();
}));

// ---------- Bulk operations (multi-select in the UI) ----------
// Both endpoints join through profile_members rather than filtering by
// user_id, so any active member of a shared profile can bulk-act on the
// whole shared ledger - but only on rows in profiles they actually belong
// to. A crafted request naming a transaction id from a profile the caller
// isn't a member of simply skips that row; the response's affected count
// reveals if some ids were skipped for that reason.

router.post(
  '/bulk-delete',
  validateBody({ ids: isIdArray }),
  asyncHandler(async (req, res) => {
    const { ids } = req.body;
    const placeholders = ids.map(() => '?').join(',');
    const result = await run(
      `DELETE FROM transactions t
       USING profile_members pm
       WHERE pm.profile_id = t.profile_id AND pm.user_id = ? AND pm.status = 'active'
         AND t.id IN (${placeholders})`,
      [req.userId, ...ids]
    );
    res.json({ deleted: result.rowCount });
  })
);

router.patch(
  '/bulk-update',
  validateBody({ ids: isIdArray }),
  asyncHandler(async (req, res) => {
    const { ids, categoryId, isRecurring } = req.body;

    if (categoryId === undefined && isRecurring === undefined) {
      return res.status(400).json({ error: 'Provide categoryId and/or isRecurring to update' });
    }
    if (categoryId !== undefined && categoryId !== null) {
      const cat = await queryOne(
        'SELECT id FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)',
        [categoryId, req.userId]
      );
      if (!cat) return res.status(400).json({ error: 'Invalid category' });
    }

    const fields = [];
    const params = [];
    if (categoryId !== undefined) { fields.push('category_id = ?'); params.push(categoryId || null); }
    if (isRecurring !== undefined) {
      fields.push('is_recurring = ?');
      params.push(!!isRecurring);
      if (!isRecurring) { fields.push('recurring_interval = NULL'); }
    }
    fields.push('updated_at = NOW()');

    const placeholders = ids.map(() => '?').join(',');
    const result = await run(
      `UPDATE transactions t SET ${fields.join(', ')}
       FROM profile_members pm
       WHERE pm.profile_id = t.profile_id AND pm.user_id = ? AND pm.status = 'active'
         AND t.id IN (${placeholders})`,
      [...params, req.userId, ...ids]
    );
    res.json({ updated: result.rowCount });
  })
);

module.exports = router;
