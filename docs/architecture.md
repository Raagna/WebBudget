# Architecture and data model

[← README](../README.md) · [API reference](api.md) · [Deployment](deployment.md)

## The pieces

```
 Browser / installed app            API (Node + Express)               PostgreSQL
┌──────────────────────┐  JSON   ┌───────────────────────────┐  SQL  ┌──────────────┐
│ React + Vite         │ ──────▶ │ routes/  one per area     │ ────▶ │ migrations/  │
│ static files         │ ◀────── │ utils/   the logic        │ ◀──── │ 001 ... 019  │
│ (Pages, or any host) │  Bearer │ middleware/ auth, checks  │       └──────────────┘
└──────────────────────┘   JWT   └──────────┬────────────────┘
                                            │ optional, all cached, all degrade gracefully
              ┌─────────────────┬───────────┼──────────────┬─────────────────┐
              ▼                 ▼           ▼              ▼                 ▼
        Ollama (local)    Yahoo Finance   RSS feeds    Reddit (RSS/API)   SnapTrade
        scan + categorize    prices        news                           Wealthsimple
```

- **Frontend:** a folder of static files. Hash routing (`#/transactions`) means any static host works, with no rewrite rules.
- **API:** a plain Node process. Each route file owns one area, and the logic lives in `utils/`, where tests can reach it without HTTP.
- **Database:** ordinary Postgres. `npm start` applies any migrations not yet run before it serves a request.
- **Outside services:** every one is optional, cached, and fails gracefully. When Ollama is off, you type the transaction in. When Yahoo is down, the last price shows, marked stale. A feed that fails is left out and the others still show.

### Conventions

- **Money is integer cents** (`amount_cents BIGINT`), never floats, so totals add up exactly. The API takes and returns decimal amounts; `toCents` and `fromCents` convert.
- **Dates are `DATE` columns returned as `'YYYY-MM-DD'` strings** (a pg type parser in `db/index.js`), never JS `Date`s, so nothing shifts a day by timezone.
- **"Today" comes from the browser** (`?today=YYYY-MM-DD`, see `utils/period.js`). The server's UTC date is already tomorrow in the evening across the Americas.
- **SQL uses `?` placeholders.** `db/index.js` turns them into `$1, $2…`. Every query is parameterized; the one interpolated column (`ORDER BY`) comes from an allow-list.
- **Nothing derived is stored when it can be summed:** goal progress, household balances, budget spending and net worth are all computed from their entries each time, so they can't drift.

## Data model

### Accounts and households

| Table | Holds |
|---|---|
| `users` | name, email, bcrypt hash, `token_version` (raising it signs out every session), `dashboard_layout` (JSONB) |
| `password_resets` | SHA-256 of a one-hour, single-use reset token. The token itself is never stored |
| `profiles` | a budget: name, currency, creator |
| `profile_members` | who can use a budget. `role` is owner or member; `status` is pending or active. **This, not `profiles.user_id`, grants access** |
| `dashboard_presets` | named dashboard layouts, per user |

A **profile** (shown in the app as a "budget") is a separate ledger, such as "Personal" or "Household". Every money table hangs off a profile, and every route checks for an *active* `profile_members` row for the caller. A pending invite grants nothing. A budget can have several owners, and the last owner can't leave or be demoted.

### Money in and out

| Table | Holds |
|---|---|
| `categories`, `hidden_categories` | built-in defaults (`user_id IS NULL`) and each user's own; a user can hide a default just for themselves |
| `transactions` | amount, type, date, description, category, recurring flag and interval, `import_hash` (stops duplicate imports), `user_id` (who added it) |
| `bills` | name, amount, due date, paid, recurring |
| `budgets` | a monthly limit per category per profile |
| `subscriptions` | API only, not shown in the app |

### Planning and wealth

| Table | Holds |
|---|---|
| `savings_goals`, `goal_contributions` | target and date; contributions in (and out). Saved = their sum |
| `payoff_debts`, `payoff_settings` | your own loans and cards (balance, rate in basis points, minimum payment), the extra monthly amount, and the chosen strategy |
| `accounts`, `account_balances` | things owned or owed, with a dated balance history |
| `holdings` | symbol, shares, account, book cost, source (manual, Wealthsimple CSV or SnapTrade) |
| `quotes` | last known price per symbol, shared by every profile, refreshed every 15 minutes |
| `investment_snapshots` | the portfolio's value once a day, for net worth history |
| `holding_syncs` | when each import or sync last ran |

### Household tab and extras

| Table | Holds |
|---|---|
| `debts`, `debt_shares` | shared costs and paybacks between household members. Each person's balance = what they paid − their shares |
| `reddit_follows` | subreddits and threads a user follows |

People in shared data (`transactions.user_id`, `debts.paid_by` and the like) are `ON DELETE SET NULL`, so a member deleting their account never removes anything a household still uses. They show as "Former member".

## Security

- **Passwords:** bcrypt, from 8 characters up to 72 *bytes* (bcrypt ignores anything longer, so longer passwords are rejected rather than quietly cut). Changing or resetting a password raises `token_version`, which signs out every session.
- **Sessions:** 7-day JWTs. `middleware/auth.js` checks the token's version against the user on every request, so "sign out everywhere" and deleted accounts take effect at once.
- **No account enumeration:**
  - Login, register, forgot-password and household invites answer the same way whether or not an email exists.
  - Login and forgot-password also take the same time either way.
  - A household's member list only shows people who accepted.
- **Isolation:** another budget's data returns `404`, never someone else's rows. The API tests check this area by area.
- **Limits:** sign-in is rate-limited (20 per 15 minutes per IP, using `TRUST_PROXY` to see real IPs). Request bodies are capped, and imports and scans have their own larger limits.
- **Responses:** CSV export neutralizes cells that start with `=`, `+`, `-` or `@`. Links from feeds are kept only if they are `http(s)`. Errors never include stack traces.

## Writing a migration

1. Add `backend/db/migrations/NNN_short_name.sql`, using the next free number. Files run in name order and are recorded by full filename, so two branches that both pick the same number won't collide.
2. **Never edit a migration that has shipped.** Databases that already ran it won't run it again. Write a new one instead (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`, a backfill, and so on).
3. Each file runs inside a transaction. For risky type changes on big tables, add a new column, backfill it, then drop the old one in a later migration.

## Tests

- **Isolation:** `backend/test/helpers.js` gives each test file its own Postgres schema, migrates it, starts the app on a random port, and drops the schema at the end. Tests run in parallel and never touch real data.
- **Load order:** a test must not `require` anything that loads `db/` before `start()` has pointed it at that schema. Pure logic lives in `utils/` so tests can import it safely.
- **Outside services** are faked with small local HTTP servers, pointed at through the same environment variables the app uses (`QUOTES_URL`, `NEWS_FEEDS`, `REDDIT_*_URL`, `SNAPTRADE_URL`, `OLLAMA_URL`).
