const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { isValidDate, isPositiveAmount, validateBody } = require('../middleware/validate');

// Receipt and bill scanning runs on a LOCAL vision model served by Ollama, so receipt
// images never leave the machine the API runs on. The model only proposes a
// draft - nothing is written to the database here. The frontend pre-fills
// the transaction form with the draft and the user saves it through the
// normal POST /api/transactions, so every existing validation still applies.
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5vl:7b';
const SCAN_TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MS) || 120_000;

// The frontend downscales photos before upload, so a real receipt is well
// under 1 MB. 8 MB of base64 leaves headroom for a phone that skips that.
const MAX_IMAGE_CHARS = 8_000_000;
const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

const router = express.Router();
router.use(requireAuth);

// Each scan ties up the GPU for a few seconds, so cap it well below the
// general API rate - plenty for a person photographing their receipts.
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many scans, please try again later' },
}));

// Structured-output schema Ollama constrains the model's reply to, so the
// response is always parseable JSON with exactly these fields.
const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['receipt', 'bill', 'other'] },
    total: { type: ['number', 'null'] },
    currentCharges: { type: ['number', 'null'] },
    amountDue: { type: ['number', 'null'] },
    date: { type: ['string', 'null'] },
    dueDate: { type: ['string', 'null'] },
    merchant: { type: ['string', 'null'] },
    category: { type: ['string', 'null'] },
  },
  required: ['kind', 'total', 'currentCharges', 'amountDue', 'date', 'dueDate', 'merchant', 'category'],
};

// Receipts and bills (electricity, water, phone, internet...) look alike to
// a model but put the important numbers in different places: a bill lists
// a previous balance, payments received, this period's charges and an
// amount due, plus a statement date AND a due date. Asking the model to
// CHOOSE "this period's charges" proved unreliable - it reached for the
// big bold "amount due" even when that included an overdue balance. So it
// copies both labelled numbers and the route picks (see pickAmount).
function buildPrompt(categoryNames) {
  return [
    'You are reading a photo or scan of a purchase receipt, or of a bill/statement (e.g. electricity, gas, water, phone, internet, insurance).',
    'Extract (numbers as plain values like 42.17, null if not shown):',
    '- kind: "receipt" for a purchase already paid, "bill" for a statement asking for payment, "other" if neither.',
    '- total: for a receipt, the final amount paid including tax and tip. null for bills.',
    '- currentCharges: for a bill, the line labelled "Total Current Charges", "New Charges", "Current Charges" or similar - the charges for this billing period only. null for receipts.',
    '- amountDue: for a bill, the line labelled "Total Amount Due", "Amount Due", "Balance Due" or similar. null for receipts.',
    '- date: for a receipt, the purchase date; for a bill, the statement/bill date (not the due date). YYYY-MM-DD, null if not shown.',
    '- dueDate: for a bill, the payment due date as YYYY-MM-DD; null for receipts or if not shown.',
    '- merchant: the store, utility or company name, short (e.g. "Costco", "Hydro Ottawa"). null if not shown.',
    `- category: the single best match from this list, copied exactly: ${categoryNames.map((n) => `"${n}"`).join(', ')}. null if none fit.`,
    'If the image is neither a receipt nor a bill, return null for every field.',
  ].join('\n');
}

async function askModel(imageBase64, categoryNames) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: RECEIPT_SCHEMA,
        // Default 4096-token context on purpose: a 1600px image is ~2500
        // tokens, which fits with the prompt. A bigger context pushes part
        // of a 7B model off an 8 GB GPU and makes scans many times slower,
        // so the frontend caps images at 1600px instead.
        options: { temperature: 0 },
        messages: [{ role: 'user', content: buildPrompt(categoryNames), images: [imageBase64] }],
      }),
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
  } catch (err) {
    // Connection refused (Ollama not running / unreachable) or timed out.
    console.error('[scan] model request failed:', err.message);
    return null;
  }
  if (!res.ok) {
    console.error('[scan] model returned', res.status, await res.text().catch(() => ''));
    return null;
  }
  const body = await res.json();
  try {
    return JSON.parse(body.message?.content ?? '');
  } catch {
    console.error('[scan] model reply was not JSON:', body.message?.content);
    return null;
  }
}

// A bill's spending for the month is its current charges; the amount due
// can also include an unpaid balance from a previous bill, which was
// already recorded last month. Fall back to the amount due only when the
// bill doesn't break out current charges (many simple bills don't).
// Some models put a bill's figure in `total` anyway, so that's the last
// resort.
function pickAmount(kind, extracted) {
  const candidates = kind === 'bill'
    ? [extracted.currentCharges, extracted.amountDue, extracted.total]
    : [extracted.total, extracted.amountDue];
  for (const c of candidates) {
    const n = Number(c);
    if (c !== null && c !== undefined && isPositiveAmount(n)) return n;
  }
  return NaN;
}

router.post(
  '/receipt',
  express.json({ limit: '10mb' }),
  validateBody({ image: (v) => typeof v === 'string' && v.length > 0 && v.length < MAX_IMAGE_CHARS }),
  asyncHandler(async (req, res) => {
    const match = DATA_URL_RE.exec(req.body.image);
    if (!match) {
      return res.status(400).json({ error: 'Upload a JPEG, PNG or WebP image' });
    }

    // Same visibility rule as everywhere else: shared defaults plus this
    // user's own categories. Receipts are purchases, so only categories
    // usable for expenses are offered to the model.
    const categories = await query(
      `SELECT id, name FROM categories
       WHERE (user_id IS NULL OR user_id = ?) AND type IN ('expense', 'both')`,
      [req.userId]
    );

    const extracted = await askModel(match[2], categories.map((c) => c.name));
    if (!extracted) {
      return res.status(503).json({ error: 'Receipt scanning is unavailable right now. Enter the transaction manually.' });
    }

    // Everything the model says is treated as untrusted input: each field
    // is re-checked and dropped (null) rather than passed through if it
    // doesn't fit, so the form only ever gets pre-filled with sane values.
    const kind = extracted.kind === 'bill' ? 'bill' : 'receipt';
    const total = pickAmount(kind, extracted);
    const merchant = typeof extracted.merchant === 'string' ? extracted.merchant.trim().slice(0, 255) : '';
    const categoryName = typeof extracted.category === 'string' ? extracted.category.trim().toLowerCase() : '';
    const category = categories.find((c) => c.name.toLowerCase() === categoryName);

    res.json({
      kind,
      type: 'expense',
      amount: isPositiveAmount(total) ? Math.round(total * 100) / 100 : null,
      date: isValidDate(extracted.date) ? extracted.date : null,
      // Only meaningful for bills. Returned separately (the transaction form
      // has no due-date field) so a future Bills page can use it directly.
      dueDate: kind === 'bill' && isValidDate(extracted.dueDate) ? extracted.dueDate : null,
      // What actually has to be paid, which can be more than `amount` when
      // a previous balance is carried over - shown to the user as a hint.
      amountDue: kind === 'bill' && isPositiveAmount(Number(extracted.amountDue)) && extracted.amountDue !== null
        ? Math.round(Number(extracted.amountDue) * 100) / 100
        : null,
      description: merchant || null,
      categoryId: category ? category.id : null,
    });
  })
);

module.exports = router;
