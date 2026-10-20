// Writes an import or a sync (holdingsImport.js / snaptrade.js) into a
// profile's holdings, and runs the SnapTrade sync on a schedule.

const { query, queryOne, withTransaction } = require('../db');
const { getQuotes, getRates } = require('./quotes');
const { replaceAccounts, withCostsIn } = require('./holdingsImport');
const snaptrade = require('./snaptrade');

// parsed = { asOf, accounts, skipped } from either source. Book costs are
// converted into the profile's currency, each account's rows replaced in one
// transaction, and every symbol priced once so the response can say which
// ones Yahoo doesn't know (they're kept - shares are still worth tracking -
// but show "No price").
async function applyHoldings({ profileId, userId, source, parsed }) {
  const profile = await queryOne(`SELECT currency FROM profiles WHERE id = ?`, [profileId]);
  const target = profile?.currency || 'USD';
  const currencies = parsed.accounts.flatMap((a) => a.positions.map((p) => p.bookCostCurrency)).filter(Boolean);
  const accounts = withCostsIn(parsed.accounts, await getRates(currencies, target));

  const { inserted, removed } = await withTransaction(async (tx) => {
    const out = await replaceAccounts(tx, { profileId, source, accounts, userId });
    await tx.run(
      `INSERT INTO holding_syncs (profile_id, source, synced_at, as_of, synced_by)
       VALUES (?, ?, NOW(), ?, ?)
       ON CONFLICT (profile_id, source) DO UPDATE
         SET synced_at = NOW(), as_of = EXCLUDED.as_of, synced_by = EXCLUDED.synced_by`,
      [profileId, source, parsed.asOf || null, userId]
    );
    return out;
  });

  const symbols = [...new Set(accounts.flatMap((a) => a.positions.map((p) => p.symbol)))];
  const quotes = await getQuotes(symbols);
  return {
    imported: inserted,
    removed,
    accounts: accounts.map((a) => ({ label: a.label, holdings: a.positions.length })),
    skipped: parsed.skipped,
    unpriced: symbols.filter((s) => !quotes.has(s)),
    asOf: parsed.asOf || null,
  };
}

async function syncSnapTrade({ profileId, userId }) {
  const parsed = await snaptrade.fetchAccounts();
  const result = await applyHoldings({ profileId, userId, source: 'snaptrade', parsed });
  return { ...result, broken: parsed.broken };
}

// Daily sync, so holdings stay current without pressing anything. Re-syncs
// any profile last synced over 20 hours ago, as the login that last synced
// it - and only while that login is still SNAPTRADE_OWNER_EMAIL and still a
// member of the profile. Checked hourly; a host that sleeps (Render's free
// plan) simply catches up when it next wakes, or on the next "Sync now".
async function syncDueProfiles() {
  const due = await query(
    `SELECT hs.profile_id, hs.synced_by, u.email
       FROM holding_syncs hs
       JOIN users u ON u.id = hs.synced_by
       JOIN profile_members pm ON pm.profile_id = hs.profile_id AND pm.user_id = hs.synced_by AND pm.status = 'active'
      WHERE hs.source = 'snaptrade' AND hs.synced_at < NOW() - INTERVAL '20 hours'`
  );
  for (const row of due) {
    if (!snaptrade.availability(row.email).available) continue;
    try {
      const r = await syncSnapTrade({ profileId: row.profile_id, userId: row.synced_by });
      console.log(`[snaptrade] synced profile ${row.profile_id}: ${r.imported} holdings`);
    } catch (err) {
      console.error(`[snaptrade] scheduled sync of profile ${row.profile_id} failed:`, err.message);
    }
  }
}

function startScheduledSync() {
  if (!snaptrade.availability(process.env.SNAPTRADE_OWNER_EMAIL).available) return null;
  const run = () => syncDueProfiles().catch((err) => console.error('[snaptrade] scheduled sync failed:', err.message));
  setTimeout(run, 60 * 1000).unref();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { applyHoldings, syncSnapTrade, syncDueProfiles, startScheduledSync };
