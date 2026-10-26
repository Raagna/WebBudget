# API reference

[← README](../README.md) · [Architecture](architecture.md) · [Deployment](deployment.md)

- **Format:** JSON in and out, under `/api`.
- **Auth:** every route except register, login, forgot-password, reset-password and `/api/health` needs `Authorization: Bearer <token>`.
- **Money and dates:** amounts are decimal numbers (`12.5`); the database keeps cents. Dates are `YYYY-MM-DD`.
- **`?today=`:** routes that depend on the date take `?today=YYYY-MM-DD` from the browser, so "this month" follows the user's timezone.
- **Profiles:** most data belongs to a **profile** (a budget). Pass `profileId`, and you must be an active member of that profile.

| Status | Means |
|---|---|
| `400` | Invalid input, with a readable `error` |
| `401` | Not signed in, or the session was signed out |
| `403` | Signed in, but not allowed (for example, not an owner) |
| `404` | Doesn't exist, **or isn't yours**: other people's data is never confirmed to exist |
| `409` | Conflict (a duplicate name, an existing follow) |
| `429` | Rate limited |

## Account

| | | |
|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password }` → `{ token, user }`. Creates a "Personal" budget |
| POST | `/api/auth/login` | `{ email, password }` → `{ token, user }` |
| POST | `/api/auth/password` | `{ currentPassword, newPassword }`. Signs out other sessions and returns a new token for this one |
| POST | `/api/auth/logout-all` | Signs out everywhere, this session included |
| POST | `/api/auth/forgot-password` | `{ email }`. Always `202`; emails a one-hour reset link if the account exists |
| POST | `/api/auth/reset-password` | `{ token, password }`. Sets the password and signs out every session |
| DELETE | `/api/auth/account` | `{ password }`. Deletes the account; households keep what you added |

## Budgets (profiles) and households

| | | |
|---|---|---|
| GET | `/api/profiles` | Your budgets, with your role and each budget's currency |
| POST | `/api/profiles` | `{ name, currency? }`. You become its owner |
| PUT | `/api/profiles/:id` | `{ name?, currency? }` (owners) |
| DELETE | `/api/profiles/:id` | Deletes a budget and its data (owners; not your last one) |
| GET | `/api/profiles/invites` | Invites waiting for you |
| POST | `/api/profiles/invites/:profileId/accept`, `/decline` | Answer an invite |
| GET | `/api/profiles/:id/members` | Members who have accepted |
| POST | `/api/profiles/:id/members` | `{ email }`. Invite someone (owners). Same answer whether or not the email has an account |
| DELETE | `/api/profiles/:id/members/:userId` | Remove someone (owners) or leave. Never the last owner |
| POST | `/api/profiles/:id/members/:userId/promote`, `/demote` | Make someone an owner, or a member again |

## Categories

| | | |
|---|---|---|
| GET | `/api/categories` | Built-in and your own, minus ones you've hidden |
| POST | `/api/categories` | `{ name, type }`, where type is `expense`, `income` or `both` |
| DELETE | `/api/categories/:id` | Deletes your own category, or hides a built-in one just for you |
| GET | `/api/categories/hidden` | Built-ins you've hidden |
| POST | `/api/categories/:id/restore` | Un-hides one |

## Transactions

| | | |
|---|---|---|
| GET | `/api/transactions?profileId=` | Optional: `q` (description, category, or an exact amount), `type`, `categoryId`, `addedBy`, `from`, `to`, `minAmount`, `maxAmount`, `sort`, `dir`, `limit` (≤500), `offset`. Returns `{ transactions, total }` |
| GET | `/api/transactions/export?profileId=` | CSV of everything matching the same filters |
| POST | `/api/transactions/import` | `{ profileId, csv }`. This app's export or a TD download. Skips rows already imported, auto-categorizes and flags recurring rows, and reports any rows it skipped |
| POST | `/api/transactions` | `{ profileId, amount, type, date, description?, categoryId?, isRecurring?, recurringInterval? }` |
| PUT / DELETE | `/api/transactions/:id` | Any member of the budget |
| POST | `/api/transactions/bulk-delete` | `{ ids }` |
| PATCH | `/api/transactions/bulk-update` | `{ ids, categoryId?, isRecurring? }` |
| POST | `/api/scan/receipt` | `{ image }` (a JPEG/PNG/WebP data URL). The local model reads it and returns a draft `{ kind, type, amount, date, dueDate, amountDue, description, categoryId }`; nothing is saved. Rate-limited |

## Bills and budgets

| | | |
|---|---|---|
| GET | `/api/bills?profileId=` | Soonest due first |
| POST / PUT / DELETE | `/api/bills[/:id]` | `{ profileId, name, amount, dueOn, categoryId?, isRecurring? }` |
| POST | `/api/bills/:id/pay` | Marks a bill paid. `{ expense: { amount, date, … } }` also records the transaction, in the same step |
| GET | `/api/budgets?profileId=&today=` | Each budget with spent, left and percent, the same point last month, and spending outside any budget |
| PUT | `/api/budgets` | `{ profileId, categoryId, amount }`. Sets or changes a monthly limit |
| DELETE | `/api/budgets/:id` | |
| GET/POST/PUT/DELETE | `/api/subscriptions[/:id]` | API only, not shown in the app |

## Dashboard

| | | |
|---|---|---|
| GET | `/api/dashboard/summary?profileId=&today=` | The month's totals, Safe to spend (with its parts and per-day figure), spending by category, recent transactions, and the same point last month |
| GET | `/api/dashboard/trends?profileId=&months=` | Income and spending per month |
| GET / PUT | `/api/dashboard/layout` | Your widget layout. `{ layout }` saves it, and `null` resets it |
| GET / POST | `/api/dashboard/layout/presets` | Your saved layouts, or `{ name, layout }` to save one |
| PUT / DELETE | `/api/dashboard/layout/presets/:id` | Rename or overwrite (`{ name?, layout? }`), or delete |

## Planning

| | | |
|---|---|---|
| GET | `/api/goals?profileId=&today=` | Goals with saved, remaining, percent, and the monthly amount needed to hit the date |
| POST / PUT / DELETE | `/api/goals[/:id]` | `{ profileId, name, target, targetDate?, startingAmount? }` |
| GET / POST | `/api/goals/:id/contributions` | History, or `{ amount, date, note? }` (a negative amount takes money out) |
| DELETE | `/api/goals/:id/contributions/:contributionId` | |
| GET | `/api/payoff?profileId=&today=` | Your debts, plus avalanche, snowball and minimums-only plans (payoff date, interest, order) |
| POST / PUT / DELETE | `/api/payoff/debts[/:id]` | `{ profileId, name, balance, rate, minPayment }` |
| PUT | `/api/payoff/settings` | `{ profileId, extra?, strategy? }` |

## Wealth

| | | |
|---|---|---|
| GET | `/api/networth?profileId=&today=` | Accounts with their latest balances, live investment value, totals, change since last month, and 12 months of history |
| POST | `/api/networth/accounts` | `{ profileId, name, kind, balance, asOf? }`. Kinds: `chequing`, `savings`, `cash`, `property`, `other_asset`, `credit_card`, `loan`, `mortgage`, `other_debt` |
| PUT / DELETE | `/api/networth/accounts/:id` | Rename or change kind, or delete |
| POST | `/api/networth/accounts/:id/balances` | `{ balance, asOf? }`. A second update on the same day replaces the first |
| GET | `/api/investments?profileId=` | Holdings at live prices in the budget's currency, plus totals |
| POST / PUT / DELETE | `/api/investments[/:id]` | `{ profileId, symbol, shares, account?, bookCost? }`. Symbols as Yahoo writes them (`XEQT.TO`, `AAPL`) |
| POST | `/api/investments/import` | `{ profileId, csv }`. Wealthsimple's Holdings report |
| POST | `/api/investments/snaptrade/sync` | `{ profileId }`. Pulls positions from SnapTrade (only for `SNAPTRADE_OWNER_EMAIL`) |

## Household tab

| | | |
|---|---|---|
| GET | `/api/debts?profileId=` | Everyone's balance, the fewest payments to settle up, and the history |
| POST | `/api/debts` | A shared cost: `{ profileId, description, amount, date, paidBy, split: 'equal', between }` or `split: 'custom', shares: [{ userId, amount }]` |
| POST | `/api/debts/payments` | A payback: `{ profileId, from, to, amount, date, note? }` |
| DELETE | `/api/debts/:id` | By whoever added it, or an owner |

## Extras

| | | |
|---|---|---|
| GET | `/api/news` | Recent headlines, taking turns between sources. Cached for 30 minutes |
| GET | `/api/reddit` | Threads you follow, plus popular threads from your subreddits ranked by upvotes and recency. `mode` is `api` or `rss` |
| POST | `/api/reddit/follows` | `{ subreddit }` or `{ thread }` (a link or post id) |
| DELETE | `/api/reddit/follows/:id` | |
| GET | `/api/health` | `{ ok: true }` |
