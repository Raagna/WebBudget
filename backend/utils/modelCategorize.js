// Last-resort categorization for imported bank rows: asks the LOCAL model
// served by Ollama (the same one that reads receipts) which category a
// merchant belongs to. It runs only on rows that history, the merchant
// keywords and the bank-code rules couldn't place - names like
// "UNTOUCHABLES SP" or "GIGSKY INC" that no fixed list will ever cover.
//
// Descriptions never leave the machine the API runs on. Nothing here is
// required: if Ollama isn't running (the hosted API on Render has none),
// the call fails fast and those rows simply import uncategorized, as they
// did before.
//
// Settings are read on every call, not at load, so tests can point it at
// a fake server or switch it off:
//   OLLAMA_URL, OLLAMA_MODEL   shared with receipt scanning
//   IMPORT_MODEL_LOOKUP=off    never ask the model
//   IMPORT_MODEL_TIMEOUT_MS    per batch (default 60s)

const BATCH_SIZE = 40;
const MAX_LOOKUPS = 200; // distinct descriptions per import
const UNKNOWN = 'Unknown';

function settings() {
  return {
    enabled: (process.env.IMPORT_MODEL_LOOKUP || '').toLowerCase() !== 'off',
    url: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    model: process.env.OLLAMA_MODEL || 'qwen2.5vl:7b',
    timeoutMs: Number(process.env.IMPORT_MODEL_TIMEOUT_MS) || 60_000,
  };
}

// What each default category is for. Without these a 7B model filed an
// eSIM provider under Bank Fees and a pharmacy under Groceries.
const HINTS = {
  subscription: 'streaming, software, apps and memberships billed on a schedule',
  bill: 'insurance, loan and other bill payments',
  food: 'restaurants, cafés, fast food, takeout, bars',
  groceries: 'supermarkets and grocery stores',
  transportation: 'transit, taxis and rideshare, fuel, parking, car costs',
  entertainment: 'movies, events, games, hobbies, sports',
  'rent/mortgage': 'rent and mortgage payments',
  utilities: 'electricity, gas, water, phone and mobile plans, mobile data, internet',
  shopping: 'retail stores, online shopping, clothing, electronics, household goods',
  healthcare: 'pharmacies, dental, clinics, health services',
  'salary/income': 'pay from an employer',
  investments: 'brokerages, mutual funds, retirement and savings plans',
  other: 'anything that fits no other category',
};

// Transfers and bank fees are bank codes the rules already catch; a
// merchant the rules missed is neither, so the model isn't offered them.
const NOT_FOR_MODEL = new Set(['transfers', 'bank fees']);

function buildPrompt(items, categories) {
  const list = categories.map((c) => {
    const kind = c.type === 'both' ? 'income or spending' : c.type === 'income' ? 'income' : 'spending';
    const hint = HINTS[c.name.toLowerCase()];
    return `- "${c.name}" (${kind})${hint ? `: ${hint}` : ''}`;
  });
  return [
    'You are sorting lines from a Canadian bank statement into budget categories.',
    'Each line is a raw bank description: merchant names are often cut short, upper-case, and may end in a store number or a card marker like _V or _M.',
    'Categories:',
    ...list,
    '',
    'For each line, set "recognized" to true only if you know what this specific business is or sells. Then give the single category that fits what it sells, choosing only a category allowed for that line\'s kind (income or spending).',
    `If you do not recognize the business, set "recognized" to false and answer "${UNKNOWN}" - a wrong guess is worse than none.`,
    '',
    'Lines:',
    ...items.map((it, i) => `${i + 1}. [${it.type === 'income' ? 'income' : 'spending'}] ${it.description}`),
  ].join('\n');
}

async function askBatch(items, categories, cfg) {
  const names = [...categories.map((c) => c.name), UNKNOWN];
  const schema = {
    type: 'object',
    properties: {
      answers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            line: { type: 'integer' },
            recognized: { type: 'boolean' },
            category: { type: 'string', enum: names },
          },
          required: ['line', 'recognized', 'category'],
        },
      },
    },
    required: ['answers'],
  };
  const res = await fetch(`${cfg.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      format: schema,
      options: { temperature: 0 },
      messages: [{ role: 'user', content: buildPrompt(items, categories) }],
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!res.ok) throw new Error(`model returned ${res.status}`);
  const body = await res.json();
  return JSON.parse(body.message?.content ?? '').answers || [];
}

// items:      [{ key, description, type }] - one per distinct merchant
// categories: [{ id, name, type }] the user can pick (hidden ones removed)
// Returns Map key -> categoryId for the lines the model could place.
// Every answer is checked: it must name a real category of the right
// kind, or it's dropped - the schema alone doesn't stop the model
// putting a paycheque under Groceries.
async function modelCategorize(items, categories) {
  const cfg = settings();
  const found = new Map();
  if (!cfg.enabled || items.length === 0 || categories.length === 0) return found;

  const offered = categories.filter((c) => !NOT_FOR_MODEL.has(c.name.toLowerCase()));
  const byName = new Map(offered.map((c) => [c.name, c]));
  const todo = items.slice(0, MAX_LOOKUPS);
  for (let start = 0; start < todo.length; start += BATCH_SIZE) {
    const batch = todo.slice(start, start + BATCH_SIZE);
    let answers;
    try {
      answers = await askBatch(batch, offered, cfg);
    } catch (err) {
      // Not running, timed out or a garbled reply: keep what earlier
      // batches found and stop, rather than waiting out every batch.
      console.error('[import] model lookup skipped:', err.message);
      break;
    }
    for (const a of answers) {
      const item = batch[Number(a?.line) - 1];
      const cat = byName.get(a?.category);
      if (!item || !cat || a.recognized !== true) continue;
      if (cat.type !== 'both' && cat.type !== item.type) continue;
      found.set(item.key, cat.id);
    }
  }
  return found;
}

module.exports = { modelCategorize };
