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
| Routing | React Router v6 | Standard client-side routing + protected routes |
| Backend | Node.js + Express | Simple, well-understood, easy to extend |
| Database | SQLite via `better-sqlite3` | Zero-config persistent DB, synchronous API keeps route handlers simple, trivially swappable for Postgres later (see Future Improvements) |
| Auth | JWT + bcrypt | Stateless auth, industry-standard password hashing (12 salt rounds) |
| Validation | Hand-written allow-list validators | No hidden magic — every field is explicitly checked before touching SQL |

**Assumption made:** SQLite was chosen over Postgres/MySQL to keep the
project runnable with zero external services. The schema and query patterns
(parameterized queries, explicit foreign keys) translate directly to
Postgres if you outgrow a single-file database — see Future Improvements.

## Architecture

```
┌─────────────┐      HTTPS/JSON       ┌──────────────┐      SQL       ┌──────────┐
│   Frontend   │ ───────────────────▶ │   Backend    │ ─────────────▶ │  SQLite  │
│  React/Vite  │ ◀─────────────────── │ Express API  │ ◀───────────── │   file   │
└─────────────┘   Bearer JWT token    └──────────────┘                └──────────┘
                                              │
                                       middleware/auth.js
                                       (verifies JWT, sets
                                        req.userId on every
                                        protected request)
```

Layers are kept separate on purpose:
- **`middleware/auth.js`** only knows how to verify identity — it has no idea
  what a transaction or bill is.
- **`routes/*.js`** each own one resource and never trust a `user_id` from
  the client — they always use `req.userId` from the verified token.
- **`db/`** owns schema + connection setup; route files never open their own
  connections or run raw migrations inline.

## Database schema

```
users            id, name, email (unique), password_hash, created_at
categories       id, user_id (NULL = global default), name, type, icon, is_default
transactions     id, user_id, category_id, amount_cents, type, description,
                 occurred_on, is_recurring, recurring_interval
subscriptions    id, user_id, category_id, name, amount_cents, billing_cycle,
                 next_billing_on, is_active
bills            id, user_id, category_id, name, amount_cents, due_on,
                 is_paid, is_recurring
```

Full DDL: `backend/db/schema.sql`. Notes:
- Amounts are stored as **integer cents**, never floats, to avoid rounding
  errors when summing totals.
- Every financial table has `user_id NOT NULL REFERENCES users(id)`.
- Categories are global (`user_id IS NULL`) for the 12 predefined ones, or
  scoped to a user for custom ones — queried as a `UNION`-style `WHERE
  user_id IS NULL OR user_id = ?`.

## API endpoints

All routes under `/api` except `/api/auth/*` require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account, returns JWT |
| POST | `/api/auth/login` | Returns JWT |
| GET | `/api/categories` | Default + user's custom categories |
| POST | `/api/categories` | Create a custom category |
| DELETE | `/api/categories/:id` | Delete own custom category |
| GET | `/api/transactions` | List with `type`, `categoryId`, `from`, `to`, `minAmount`, `maxAmount`, `sort`, `dir`, `limit`, `offset` |
| POST | `/api/transactions` | Create |
| PUT | `/api/transactions/:id` | Update (only if owned) |
| DELETE | `/api/transactions/:id` | Delete (only if owned) |
| GET/POST/PUT/DELETE | `/api/subscriptions[/:id]` | Same pattern |
| GET/POST/PUT/DELETE | `/api/bills[/:id]` | Same pattern |
| GET | `/api/dashboard/summary?month=YYYY-MM` | Totals, spending by category, recent transactions, upcoming bills, active subscriptions |
| GET | `/api/dashboard/trends?months=N` | Income vs. expenses per month, for charts |

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
- **Parameterized queries** throughout — `better-sqlite3`'s `?` placeholders
  are used everywhere; the one place a column name is interpolated
  (`ORDER BY`) is checked against a hardcoded allow-list first.
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
  api/client.js          axios instance, attaches JWT, redirects to /login on 401
  context/AuthContext.jsx login/register/logout state, persisted to localStorage
  components/
    Layout.jsx            sidebar + page shell
    StatCard.jsx           dashboard summary tile
    TransactionForm.jsx    shared add/edit form
  pages/
    Login.jsx / Register.jsx
    Dashboard.jsx           summaries + charts
    Transactions.jsx        filterable/sortable ledger (reused for Income/Expenses)
    Subscriptions.jsx
    Bills.jsx
    Reports.jsx             longer-range trend charts
    Settings.jsx            custom categories
  utils/format.js          money/date formatting helpers
  styles.css                design tokens + all component styles
```

## Dashboard & financial features

- **Summary tiles**: monthly income, expenses, remaining, largest category,
  upcoming bills, active subscriptions.
- **Charts**: income vs. expenses line chart (Dashboard, last 9 months),
  category pie chart (current month), category bar chart, and a
  longer-range Reports page with an area chart and net-by-month bar chart.
- **Filtering/sorting**: transactions can be filtered by category and date
  range, and sorted by date, amount, or description, ascending or
  descending.
- **Recurring tracking**: transactions, subscriptions, and bills all support
  a recurring flag; subscriptions can be paused/resumed, bills can be marked
  paid/unpaid.

## Database seed data

`backend/seed.js` creates one demo account
(`demo@example.com` / `DemoPass123!`) with ~9 months of clearly fictional
transaction history (salary, groceries, rent, subscriptions, occasional
freelance income with random variance so months aren't identical), 6 sample
subscriptions, and 5 bills (some paid, some upcoming) — enough for every
chart and filter to show real data immediately.

## Project file structure

```
finance-app/
  backend/
    db/               schema.sql, index.js (connection + default category seed)
    middleware/       auth.js, validate.js
    routes/           auth.js, categories.js, transactions.js, subscriptions.js, bills.js, dashboard.js
    server.js
    seed.js
    package.json
    .env
  frontend/
    src/              (see Frontend structure above)
    index.html
    vite.config.js
    package.json
    .env
```

## Setup & installation

Requires Node.js 18+.

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env   # or use the provided .env — set your own JWT_SECRET for real use
npm run seed            # creates demo@example.com / DemoPass123! with sample data
npm start                # http://localhost:4000

# 2. Frontend (separate terminal)
cd frontend
npm install
npm run dev               # http://localhost:5173
```

Open `http://localhost:5173` and sign in with the demo account, or register
a new one.

## Testing instructions

Manual flows to verify (all confirmed working during development):

1. **Register** a new account → lands on Dashboard with zero data.
2. **Add a transaction** (income and expense) → appears in Dashboard recent
   list and Transactions page; totals update.
3. **Edit / delete** a transaction → list and totals update immediately.
4. **Filter transactions** by category and date range; **sort** by amount
   ascending/descending.
5. **Add a subscription**, pause it, confirm the Dashboard's "Active
   Subscriptions" count and total update.
6. **Add a bill**, mark it paid, confirm "Upcoming Bills" count drops.
7. **Data isolation**: register a second account in a private/incognito
   window, confirm it starts empty and cannot see or modify the first
   account's data (try hitting `PUT /api/transactions/:id` for another
   user's transaction ID — should 404).
8. **Auth**: log out, confirm protected pages redirect to `/login`; try a
   wrong password, confirm a generic error with no hint about account
   existence.

For automated backend testing, `curl` or a tool like Postman can exercise
the endpoints in the API table above — every route returns JSON and
standard HTTP status codes (`400` invalid input, `401` unauthenticated,
`404` not found/not owned, `409` conflict).

## Future improvements

- Swap SQLite for Postgres for concurrent multi-instance deployments (the
  parameterized-query style ports directly).
- Add refresh tokens / shorter-lived access tokens instead of a single 7-day JWT.
- Auto-generate transactions from active subscriptions/recurring bills on
  their due dates (currently they're tracked but not auto-posted).
- CSV import/export.
- Budgets per category with over-budget alerts.
- Multi-currency support (currently USD-only, cents-based).
- Automated test suite (Jest/Supertest for the API, Playwright for the UI) —
  this build was verified manually and via `curl` smoke tests, but doesn't
  ship with a test runner.
