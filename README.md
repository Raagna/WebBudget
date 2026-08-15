# Ledger — Personal Finance Tracker

A full-stack personal finance app: track income, expenses, subscriptions, and
bills, with a dashboard of summaries and charts. Built with a real persistent
database and per-user data isolation — not a demo that stores data in
frontend state.

This is a **personal tracker**, not a banking app: all data is manually
entered, and the seeded sample data is clearly fictional.

## Technology stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 18 + Vite | Fast dev loop, small footprint, no framework lock-in |
| Charts | Recharts | Declarative, composable, good defaults for line/bar/pie |
| Routing | React Router v6 (`HashRouter`) | Hash-based routing works on static hosts like GitHub Pages with no server-side rewrite rules needed |
| Backend | Node.js + Express | Simple, well-understood, easy to extend |
| Database | Postgres via `pg` (node-postgres) | Real concurrent-write support, works with free managed hosts (Neon, Supabase, Render), no persistent-disk juggling on the API host since data lives in the managed database |
| Auth | JWT + bcrypt | Stateless auth, industry-standard password hashing (12 salt rounds) |
| Validation | Hand-written allow-list validators | No hidden magic — every field is explicitly checked before touching SQL |

**This project previously used SQLite** (`better-sqlite3`) and has since
been converted to Postgres so the frontend can be hosted separately on
GitHub Pages while the backend talks to a managed database. The
conversion touched every route file: SQLite's synchronous
`db.prepare(sql).get/all/run()` API became async `query`/`queryOne`/`run`
helpers over a connection pool, `?` placeholders are auto-converted to
Postgres's `$1, $2, ...` by a small helper in `db/index.js` (so the SQL in
route files barely changed), and a few SQLite-specific SQL functions
(`strftime`, `date('now', ...)`) became their Postgres equivalents
(`TO_CHAR`, `CURRENT_DATE - INTERVAL`). See `db/index.js` for the
compatibility layer.

## Architecture

```
┌─────────────┐      HTTPS/JSON       ┌──────────────┐      SQL       ┌──────────────┐
│   Frontend   │ ───────────────────▶ │   Backend    │ ─────────────▶ │   Postgres   │
│ React/Vite   │ ◀─────────────────── │ Express API  │ ◀───────────── │ (managed DB) │
│ GitHub Pages │   Bearer JWT token   │  e.g. Render │                │ e.g. Neon    │
└─────────────┘                       └──────────────┘                └──────────────┘
                                              │
                                       middleware/auth.js
                                       (verifies JWT, sets
                                        req.userId on every
                                        protected request)
```

The frontend and backend are deployed to **separate hosts** — GitHub Pages
only serves static files, it has no server runtime, so it cannot run the
Express API or talk to Postgres directly. See Deployment below.

Layers are kept separate on purpose:
- **`middleware/auth.js`** only knows how to verify identity — it has no idea
  what a transaction or bill is.
- **`routes/*.js`** each own one resource and never trust a `user_id` from
  the client — they always use `req.userId` from the verified token.
- **`db/index.js`** owns the connection pool, the SQLite-placeholder-style-to-Postgres
  translation, and migrations; route files never open their own connections.

## Database schema

```
users              id, name, email (unique), password_hash, created_at
profiles           id, user_id, name, created_at
categories         id, user_id (NULL = global default), name, type, icon, is_default
hidden_categories  user_id, category_id  (per-user hide of a default category)
transactions       id, user_id, profile_id, category_id, amount_cents, type,
                   description, occurred_on, is_recurring, recurring_interval
subscriptions      id, user_id, category_id, name, amount_cents, billing_cycle,
                   next_billing_on, is_active   (API only, not in the UI)
bills              id, user_id, category_id, name, amount_cents, due_on,
                   is_paid, is_recurring         (API only, not in the UI)
```

Full DDL: `backend/db/migrations/001_initial.sql` (the baseline schema —
see "Migrations & upgrading" below for how later changes are structured).
Notes:
- Amounts are stored as **integer cents**, never floats, to avoid rounding
  errors when summing totals.
- Every financial table has `user_id NOT NULL REFERENCES users(id)`.
- **Profiles** are separate budgeting contexts (e.g. "Personal" and
  "Household") owned by one user. Every transaction belongs to exactly one
  profile; switching the active profile in the sidebar switches the entire
  dashboard, transaction list, and reports to that profile's data.
  Categories are *not* profile-scoped — a user manages one category list
  shared across all of their profiles.
- Categories are global (`user_id IS NULL`) for the 12 predefined ones, or
  scoped to a user for custom ones — queried as a `UNION`-style `WHERE
  user_id IS NULL OR user_id = ?`.
- **Known bug, fixed:** the original schema relied on `UNIQUE(user_id, name)`
  to stop duplicate default categories. SQL (both SQLite and Postgres) treats
  every `NULL` as distinct from every other `NULL`, so that constraint never
  actually caught duplicates among the global (`user_id IS NULL`) rows —
  each server restart silently re-inserted all 12 defaults. Fixed with a
  **partial unique index**: `CREATE UNIQUE INDEX ... ON categories(name)
  WHERE user_id IS NULL`. This fix is baked into `001_initial.sql`, so it
  applies to every database from the start — no manual cleanup needed. It
  was re-verified against Postgres specifically (restarted the server
  multiple times, category count stayed at exactly 12).
- A user can remove a default category from their own view via
  `hidden_categories` without deleting the shared row (which would remove
  it for every other account on the instance) — Settings offers a
  "Restore" action for anything hidden this way.
- Money amounts (`amount_cents`) are `INTEGER`; date columns
  (`occurred_on`, `due_on`, `next_billing_on`) are `DATE`; boolean flags
  are real `BOOLEAN` (Postgres, unlike SQLite, has a native boolean type —
  the app no longer stores them as 0/1 integers). `db/index.js` overrides
  node-postgres's default `DATE` parser to return plain `'YYYY-MM-DD'`
  strings instead of JS `Date` objects, avoiding a class of timezone-shift
  bugs where a date silently becomes the previous/next day depending on
  server timezone.

## API endpoints

All routes under `/api` except `/api/auth/*` require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account, returns JWT |
| POST | `/api/auth/login` | Returns JWT |
| GET | `/api/categories` | Default + user's custom categories, minus anything hidden |
| POST | `/api/categories` | Create a custom category |
| DELETE | `/api/categories/:id` | Delete own custom category, or hide a default one for this user |
| GET | `/api/categories/hidden` | List default categories this user has hidden |
| POST | `/api/categories/:id/restore` | Un-hide a previously hidden default category |
| GET | `/api/profiles` | List this user's budgeting profiles |
| POST | `/api/profiles` | Create a profile `{ name }` |
| PUT | `/api/profiles/:id` | Rename a profile |
| DELETE | `/api/profiles/:id` | Delete a profile and its transactions (blocked if it's the user's last one) |
| GET | `/api/transactions?profileId=` | List, scoped to a profile, with `type`, `categoryId`, `from`, `to`, `minAmount`, `maxAmount`, `sort`, `dir`, `limit`, `offset` |
| POST | `/api/transactions` | Create — body includes `profileId` |
| PUT | `/api/transactions/:id` | Update (only if owned) |
| DELETE | `/api/transactions/:id` | Delete (only if owned) |
| POST | `/api/transactions/bulk-delete` | Delete many at once: `{ ids: [...] }` — multi-select in the UI |
| PATCH | `/api/transactions/bulk-update` | Bulk-edit category and/or recurring flag: `{ ids: [...], categoryId?, isRecurring? }` |
| GET/POST/PUT/DELETE | `/api/subscriptions[/:id]` | Available in the API; not currently linked from the UI |
| GET/POST/PUT/DELETE | `/api/bills[/:id]` | Available in the API; not currently linked from the UI |
| GET | `/api/dashboard/summary?profileId=&month=YYYY-MM` | Totals, spending by category, recent transactions — scoped to one profile |
| GET | `/api/dashboard/trends?profileId=&months=N` | Income vs. expenses per month, for charts — scoped to one profile |

## Authentication & security

- Passwords hashed with **bcrypt**, 12 salt rounds — never stored or logged
  in plaintext.
- **JWT** (7-day expiry) signed with a secret from `.env` — the server
  refuses to boot if `JWT_SECRET` is unset.
- **User-data isolation**: every query touching `transactions`, `bills`, or
  `subscriptions` filters by `user_id = req.userId`, taken only from the
  verified token — this was tested by creating two accounts and confirming
  one user gets `404`, not another user's data, when guessing an ID.
- **Input validation**: hand-written allow-list validators
  (`middleware/validate.js`) reject malformed amounts, dates, emails, and
  strings before they reach SQL.
- **Parameterized queries** throughout — route files write `?`
  placeholders for readability, and `db/index.js` converts them to
  Postgres's `$1, $2, ...` before the query ever reaches `pg`; the one
  place a column name is interpolated (`ORDER BY`) is checked against a
  hardcoded allow-list first.
- **Rate limiting** on `/api/auth/*` (20 requests / 15 min) to slow down
  credential stuffing.
- **Generic error messages** on login/registration so responses don't reveal
  whether an email is registered.
- **No sensitive data in responses**: `password_hash` is never selected into
  API responses; the global error handler returns a generic 500 instead of
  stack traces.

## Frontend structure

```
frontend/src/
  api/client.js            axios instance, attaches JWT, redirects to /login on 401
  context/
    AuthContext.jsx        login/register/logout state, persisted to localStorage
    ProfileContext.jsx     list of profiles + active profile, persisted to localStorage
  components/
    Layout.jsx              sidebar + page shell + profile switcher
    StatCard.jsx             dashboard summary tile
    TransactionForm.jsx      shared add/edit form
  pages/
    Login.jsx / Register.jsx
    Dashboard.jsx            summaries + charts (scoped to active profile)
    Transactions.jsx         filterable/sortable ledger with multi-select bulk actions
    Reports.jsx              longer-range trend charts
    Profiles.jsx             create/rename/delete budgeting profiles
    Settings.jsx             category management (add/remove/hide/restore)
  utils/format.js            money/date formatting helpers
  styles.css                  design tokens + all component styles
```

**Note:** `Subscriptions.jsx` and `Bills.jsx` pages were removed along with
their sidebar links to keep navigation focused on transactions. The
underlying `/api/subscriptions` and `/api/bills` endpoints are still there
if you want to bring the UI back later.

## Dashboard & financial features

- **Multi-household budgeting**: create separate **profiles** (e.g.
  "Personal" and "Household") from the Profiles tab. Each profile has its
  own transactions, dashboard, and reports — switching profiles in the
  sidebar switches the entire financial picture. A user always keeps at
  least one profile; deleting a profile deletes its transactions with a
  confirmation first.
- **Summary tiles**: monthly income, expenses, remaining, and largest
  category for the active profile.
- **Charts**: income vs. expenses line chart (Dashboard, last 9 months),
  category pie chart (current month), category bar chart, and a
  longer-range Reports page with an area chart and net-by-month bar chart.
- **Filtering/sorting**: transactions can be filtered by **type**
  (income/expense — a filter now, not a separate page), category, and date
  range, and sorted by date, amount, description, or type, ascending or
  descending.
- **Multi-select bulk actions**: check multiple transactions in the ledger
  to bulk-delete them or bulk-reassign their category in one action.
- **Recurring tracking**: transactions support a recurring flag with an
  interval (weekly/monthly/yearly).
- **Category management**: add custom categories, remove your own, or hide
  a built-in default from your view (reversible — see Settings).

## Database seed data

`backend/seed.js` creates one demo account
(`demo@example.com` / `DemoPass123!`) with **two profiles** — "Personal"
and "Household" — and ~9 months of clearly fictional transaction history
split realistically between them (rent, shared utilities, and groceries in
Household; subscriptions, entertainment, and the user's own salary in
Personal, with random variance so months aren't identical). It also seeds a
few sample subscriptions and bills directly in the database for
completeness, even though those aren't currently linked from the UI.

## Project file structure

```
finance-app/
  .github/workflows/
    deploy-pages.yml  builds frontend/ and publishes it to GitHub Pages on push to main
  backend/
    db/                migrations/001_initial.sql, migrate.js, index.js (pool + migration runner)
    middleware/        auth.js, validate.js, asyncHandler.js
    routes/            auth.js, categories.js, profiles.js, transactions.js, subscriptions.js, bills.js, dashboard.js
    server.js
    seed.js
    package.json
    .env
  frontend/
    src/               (see Frontend structure above)
    index.html
    vite.config.js
    package.json
    .env
```

## Setup & installation

Requires Node.js 18+ and a Postgres database (a local install, or a free
managed one — see Deployment below for permanent-free options).

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env    # set DATABASE_URL to your Postgres connection string, and a real JWT_SECRET
npm run migrate            # creates/upgrades the schema
npm run seed                 # optional: adds demo@example.com / DemoPass123! with sample data
npm start                     # http://localhost:4000

# 2. Frontend (separate terminal)
cd frontend
npm install
npm run dev               # http://localhost:5173
```

Open `http://localhost:5173` and sign in with the demo account, or register
a new one.

(`npm start` also runs pending migrations automatically on boot, before it
starts accepting requests — `npm run migrate` is there so you can run that
as a separate step in a deploy pipeline if you'd rather apply migrations
before a new server version starts serving traffic, rather than relying on
the inline check.)

**No Postgres installed locally?** `DATABASE_URL` in `.env.example`
defaults to `postgresql://postgres:postgres@localhost:5432/finance_dev` —
either install Postgres locally and `createdb finance_dev`, or skip local
Postgres entirely and point `DATABASE_URL` straight at a free Neon or
Supabase database (see Deployment) even for local development.

## Migrations & upgrading

Schema changes live as individual, numbered SQL files in
`backend/db/migrations/`, tracked in a `schema_migrations` table so each
file only ever runs once against a given database. This means **updating
to a new version of this app never requires deleting your database** — you
pull the new code, run `npm run migrate` (or just restart the server), and
any new migration files apply on top of your existing data.

Rules for adding a future schema change:
1. Create `backend/db/migrations/00N_short_description.sql` where `N` is
   the next number.
2. Never edit an already-shipped migration file. A database that already
   applied it won't re-run it, so an edit only affects fresh installs and
   silently diverges from everyone else's database. Write a new migration
   instead — `ALTER TABLE ... ADD COLUMN`, a new `INSERT` for a new default
   category, a data backfill, etc.
3. Wrap anything destructive with care: each migration runs inside a
   transaction automatically. Postgres's `ALTER TABLE` is more capable than
   SQLite's (it supports `DROP COLUMN`, `ALTER COLUMN ... TYPE`, etc.
   directly), but changing a column's type on a large table can still lock
   it for the duration — for anything risky, the safe pattern is still add
   a new column, backfill it, then drop the old one in a later migration.

This was tested by seeding real data, adding a new migration file that
inserts an additional default category, and confirming the upgrade applies
the new category while leaving every existing transaction and login
untouched — done twice, once against SQLite during the original migration
system design and again against Postgres after the database conversion.

## Testing instructions

Manual flows to verify (all confirmed working during development):

1. **Register** a new account → lands on Dashboard with a "Personal"
   profile auto-created and zero data.
2. **Add a transaction** (income and expense) → appears in Dashboard recent
   list and Transactions page; totals update.
3. **Edit / delete** a transaction → list and totals update immediately.
4. **Filter transactions** by type, category, and date range; **sort** by
   amount, date, description, or type, ascending/descending.
5. **Multi-select**: check several transactions, bulk-delete them, and
   separately bulk-reassign a category — confirm the count in the toolbar
   matches what changed.
6. **Profiles**: create a second profile (e.g. "Household"), add a
   transaction while it's active, switch back to "Personal" and confirm
   that transaction is *not* visible there. Try deleting your only
   remaining profile — should be blocked with a clear message.
7. **Categories**: add a custom category; hide a default category from
   Settings and confirm it disappears from the add-transaction dropdown;
   restore it and confirm it reappears.
8. **Category duplication regression check**: restart the backend server
   two or three times in a row, then reload Settings — the category count
   should stay at 12 (+ any custom ones), never grow.
9. **Data isolation**: register a second account in a private/incognito
   window, confirm it starts empty and cannot see or modify the first
   account's data or profiles (try hitting `PUT /api/transactions/:id` or
   `GET /api/transactions?profileId=` for another user's ID — should 404).
10. **Auth**: log out, confirm protected pages redirect to `/login`; try a
    wrong password, confirm a generic error with no hint about account
    existence.
11. **If deployed to GitHub Pages**: navigate to a page like Transactions,
    then hard-refresh the browser — should reload the same page correctly
    (confirms hash-based routing is working) rather than showing a GitHub
    Pages 404.

For automated backend testing, `curl` or a tool like Postman can exercise
the endpoints in the API table above — every route returns JSON and
standard HTTP status codes (`400` invalid input, `401` unauthenticated,
`404` not found/not owned, `409` conflict).

## Deployment (free tier)

Three pieces now, deployed independently: **GitHub Pages** serves the
static frontend, a **Postgres provider** hosts the database, and a
**Node host** runs the Express API in between. Because the database is
external, the API host doesn't need persistent disk the way the SQLite
version did — the container can be fully ephemeral and the data survives
regardless.

**Recommended free combination: Neon (Postgres) + Render (backend) +
GitHub Pages (frontend).**

1. **Push this repo to GitHub** if you haven't already (`git init`,
   commit, create a repo on github.com, `git remote add origin ...`,
   `git push -u origin main`).

2. **Create a free Postgres database.** [Neon](https://neon.tech) and
   [Supabase](https://supabase.com) both have permanent free tiers (unlike
   Render's Postgres, which is free for 90 days and then deleted). Either
   one works the same way here — create a project, and copy the connection
   string it gives you. It'll look like:
   ```
   postgresql://user:password@ep-something.region.aws.neon.tech/dbname?sslmode=require
   ```
   That `sslmode=require` matters — `db/index.js` detects it automatically
   and enables SSL, which these providers require.

3. **Generate a real JWT secret** — don't reuse the placeholder in
   `.env.example`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   Keep it somewhere safe; it goes into Render's environment variables
   next, never into the repo.

4. **Deploy the backend on Render** (free web service):
   - New Web Service → connect your GitHub repo → root directory `backend`
   - Build command: `npm install`
   - **Start command: `npm run migrate && npm start`** — this is the part
     that matters for upgrade compatibility. Every deploy runs pending
     migrations against your Neon/Supabase database before the server
     starts accepting traffic, so pushing a future update never requires
     manually touching the database.
   - Environment variables: `DATABASE_URL` (from step 2), `JWT_SECRET`
     (from step 3), `CORS_ORIGIN` (your GitHub Pages URL — add this after
     step 6, once you know it).
   - No persistent disk needed this time — the database lives in Neon/Supabase,
     not on this container.
   - Optional one-time step: open Render's shell for the service and run
     `npm run seed` if you want the demo account and sample data live.
     Skip this for a real deployment with only real user accounts.

5. **Set up GitHub Pages**: repo Settings → Pages → Source: "GitHub
   Actions" (not "Deploy from a branch" — the included workflow handles
   the build itself). Then repo Settings → Secrets and variables → Actions
   → Variables → New repository variable: `VITE_API_URL` set to your
   Render backend URL plus `/api`, e.g.
   `https://your-backend.onrender.com/api`.

6. **Deploy the frontend**: the included `.github/workflows/deploy-pages.yml`
   runs automatically on every push to `main` — build it, upload it,
   publish it. Push a commit (or trigger it manually from the Actions tab)
   and watch it run. Your site ends up at
   `https://<your-username>.github.io/<repo-name>/`.

7. **Close the loop on CORS**: go back to Render's environment variables
   and set `CORS_ORIGIN` to your GitHub Pages URL from step 6, then
   redeploy the backend so it accepts requests from the deployed frontend
   instead of just `localhost`.

8. **Verify**: open the Pages URL, register an account (or sign in with
   the demo account if you seeded it), add a transaction, confirm it
   appears on the dashboard.

**What "upgrade compatibility" gets you going forward:** when you make a
future change locally — add a table, add a column, add a new migration
file — you just `git push`. Render rebuilds and runs `npm run migrate` as
part of the start command, GitHub Actions rebuilds the frontend, and your
existing users' data in Neon/Supabase carries forward untouched. No manual
database surgery, no coordinating a maintenance window.

**Trade-offs of the free tier, worth knowing going in:**
- Render's free web services **spin down after ~15 minutes of
  inactivity** and take a few seconds to wake back up on the next request
  — fine for a personal project, noticeable if you show it to someone cold.
- Neon's free tier also has its own auto-suspend behavior (a few seconds
  of "cold" latency on the first query after idle) and a storage cap that's
  generous for personal use but worth checking against your plans.
- GitHub Pages is a **public** URL by default on a public repo — anyone
  with the link can reach the login page (they still need real
  credentials to see any data, but if that visibility bothers you, GitHub
  Pages on a private repo requires GitHub Enterprise; a plain custom
  domain behind Vercel/Netlify with access controls is the alternative).
- `HashRouter` means URLs look like
  `your-site.github.io/repo/#/transactions` instead of a clean path — a
  reasonable trade for not needing server-side rewrite rules, but worth
  knowing if clean URLs matter to you (achievable with a `404.html`
  redirect trick instead, at the cost of more moving parts).
- Alternatives: Fly.io's free allowance also works for the backend;
  Supabase can replace Neon for Postgres and additionally offers its own
  auth/storage if you ever want to lean on it instead of this app's own
  JWT auth; Vercel/Netlify remain fine alternatives to GitHub Pages for
  the frontend if you'd rather avoid the hash-routing trade-off (just
  swap `HashRouter` back to `BrowserRouter` in `App.jsx` — those hosts
  support the server-side rewrites that need).

## Future improvements

- Add refresh tokens / shorter-lived access tokens instead of a single 7-day JWT.
- **Connection pooling at scale**: the `pg.Pool` default settings are fine
  for a personal project; a busier deployment would want to tune pool size
  against whatever connection limit your Postgres provider's free tier
  imposes (Neon and Supabase both cap free-tier connection counts).
- **Shared household profiles**: profiles currently belong to a single
  user. A real multi-person household would need a `profile_members` join
  table so more than one login can see and edit the same profile.
- Auto-generate transactions from active subscriptions/recurring bills on
  their due dates (currently they're tracked but not auto-posted).
- CSV import/export.
- Budgets per category with over-budget alerts, including per-profile budgets.
- Multi-currency support (currently USD-only, cents-based).
- Automated test suite (Jest/Supertest for the API, Playwright for the UI) —
  this build was verified manually and via `curl` smoke tests, but doesn't
  ship with a test runner.
