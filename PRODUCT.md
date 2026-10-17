# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **The owner and their household.** A Canadian (TD Canada Trust customer) who tracks their own money, shares a "Household" budget with a partner, and wants to know at a glance whether the month is on track. They check quickly on a phone (scanning a receipt, "can I afford this?") and sit at a desktop for imports, budgets and reviews; both matter equally.
- **Beginners and careful budgeters alike.** The product must answer "am I OK this month?" for someone new to budgeting, while giving a serious user the detail they want (categories, budgets, bills, reports, exports).
- **Portfolio viewers.** The app is also a showcase of the owner's work, so its first impression is part of its job; it is a real tool first, not a mockup.

## Product Purpose

A self-hosted personal and household finance tracker. People record spending and income (by hand, from a TD CSV download, or by photographing a receipt or bill), set monthly budgets per category, track bills, and see one trustworthy number for what is safe to spend. Success: the owner and partner keep it up to date with little effort and trust what it tells them.

## Positioning

- Receipts and bills (photos and PDFs) are read by a vision model running on the owner's own machine, so financial documents never leave the household.
- A conservative "Safe to spend" figure (income received − spent − bills still due − scheduled expenses), not an optimistic balance.
- Built for a shared household: shared budgets, bills and ledger, with every transaction showing who added it.
- Self-hosted (currently GitHub Pages + Render, moving to a homelab).

## Operating Context

- Phone: open over home Wi-Fi or the deployed site, add or scan a transaction, check Safe to spend and budgets.
- Desktop: download `accountactivity.csv` from TD EasyWeb and import it (duplicates skipped, auto-categorized), set and adjust budgets, review reports, manage household members.
- Monthly rhythm: budgets reset each month; bills recur; the dashboard always looks at the current month up to the user's own today.

## Capabilities and Constraints

- Pages: Dashboard (income, expenses, Safe to spend with breakdown, budgets, charts, recent transactions), Transactions (filters, bulk actions, CSV import/export, scan, "Added by" in households), Budgets, Bills (scan a bill, mark paid → expense), Reports (3–24 month trends), Profiles (budgets/households, invites, roles), Settings (categories, account deletion), Login/Register.
- Profiles have a currency; amounts must always be shown in the active profile's currency.
- Stack: React 18 + Vite + Recharts + React Router (HashRouter), Express + Postgres API, Ollama (`qwen2.5vl:7b`) for scanning. Plain CSS in `frontend/src/styles.css`; no CSS framework.
- Must work at phone widths down to 320px; ledger tables become two-line rows at ≤720px.
- No bank API: TD has none and Canadian open banking isn't live (see the owner's vault note). Plaid is a possible later addition.
- **Undecided:** the product's name. "Ledger" is a placeholder until the owner picks one.

## Brand Commitments

- Voice: plain, calm and reassuring; say what the number means ("Safe to spend", "Check it before saving", "Income you're still expecting isn't counted until it arrives"). No jargon, no hype.
- Name: undecided (placeholder "Ledger").

## Evidence on Hand

- Working app with seeded demo data (`backend/seed.js`: demo@example.com and a partner in a shared Household).
- No real users, testimonials, metrics or press. Do not invent any.

## Product Principles

1. One honest number first: the answer to "am I OK this month?" is visible before any detail.
2. Conservative over flattering: never count money that hasn't arrived.
3. Effortless capture: scanning and importing should beat typing.
4. Shared by default: a household sees the same truth and knows who did what.
5. Private by design: financial documents stay on the owner's hardware.

## Accessibility & Inclusion

- WCAG 2.1 AA as the target: text contrast, labelled form controls, keyboard use, and never colour alone for income/expense or over-budget states.
