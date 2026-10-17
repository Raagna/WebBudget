---
version: 1
slug: "frontend-src"
primary_target: "frontend/src"
related_targets: []
---

# App shell and working screens

Scope: the whole authenticated app (Dashboard, Transactions, Budgets, Bills, Reports, Profiles, Settings) plus Login/Register. Visitor mode: Operate.

Audience and job: the owner and household partner checking "am I OK this month?" on a phone and doing imports, budgets and reviews on a desktop; beginners and careful budgeters alike; portfolio viewers see it too.

Constraints: user rejected playful/cartoony, corporate/bank-like, dark/techy, and busy. Layout may change freely. Must hold at 320px; ledger tables become two-line rows at ≤720px. Amounts always in the profile's currency. Product name undecided ("Ledger" placeholder, one constant).

## Direction contract

THESIS: Each spending category is a denomination. The app uses the colour logic of Canada's polymer notes: every category owns one note colour everywhere it appears (dot, bar, chart series, budget strip), and one note-like panel carries the headline number. It refuses the category default of a grey dashboard with one brand accent and identical white KPI tiles.

OWN-WORLD: Light mineral-white ground (#F7F8F5), a deep note-green rail (#1F3B33) as the shell, ink #1C2321. Category colours from the note family: blue, purple, green, brown, plus teal, ochre, plum and slate, all dark enough for white text. Red (#B42318) is reserved for over-budget and negative states only. Figtree throughout with tabular figures; 14–12px radii; fine guilloche line work and a translucent "window" appear only on the hero panel.

STORY: The visitor sees immediately how much is safe to spend and how fast, then which categories are close to their limit (by colour), then the detail. They trust it because the sum is shown, and they act (add or scan, adjust a budget) from the same screen.

FIRST VIEWPORT: Desktop: 240px green rail (brand, profile switcher, nav, user). Main: "October · Household" heading with days left, then a 7/12 Safe-to-spend note panel (label, 96px figure, per-day line) with its window showing per-day and days left, beside a 5/12 stack of category budget strips in their note colours, each "spent of limit" and "left/over". Below: category spending chart and recent transactions with category dots. Primary action "Add / Scan" sits top-right of the main header. Phone: the rail becomes a top bar, and the note panel leads full width.

FORM: Polymer Banknotes, IMPECCABLE'S PICK (my #1 of 7; the roll assigned #6, the Shelf-Tag Flyer). seed:65f6eb928decbd10. Signature move: the note panel with its functional clear window, plus the denomination colour system carried consistently across dots, strips and chart series. Raises kept from the round: every figure shows its change where data exists; size is rank; no boxed chrome beyond what organises; one cell grid.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Product name.
