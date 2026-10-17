---
name: Ledger (placeholder name)
description: A shared household budget where every spending category is a banknote denomination and one note-like panel carries the number that matters.
colors:
  ground: "#f4f6f2"
  surface: "#ffffff"
  surface-2: "#eef2ec"
  ink: "#17211d"
  ink-soft: "#4f5b55"
  line: "#d7ded7"
  line-strong: "#b9c4bc"
  rail: "#173a2f"
  rail-raised: "#1f4a3c"
  rail-ink: "#eaf3ee"
  rail-ink-soft: "#b7cdc2"
  rail-hi: "#a6e3c3"
  accent: "#1f6e46"
  accent-strong: "#175636"
  accent-soft: "#e2efe6"
  positive: "#15693f"
  negative: "#b42318"
  negative-soft: "#fdecea"
  negative-note: "#7a1f17"
  warn: "#8a5a00"
  warn-soft: "#fbf1dc"
  badge-overdue: "#f2b8b0"
  badge-overdue-ink: "#5c0f08"
  chart-grid: "#e3e8e3"
  note-green: "#1f6e46"
  note-blue: "#1f5fa8"
  note-purple: "#5e3f99"
  note-brown: "#7a4e2d"
  note-teal: "#0e6e72"
  note-ochre: "#7d5a0f"
  note-plum: "#86306a"
  note-slate: "#3d5168"
  note-indigo: "#4b4fa3"
  note-green-teal: "#0f6a55"
  note-neutral: "#5b6470"
typography:
  display:
    fontFamily: "'Figtree Variable', 'Figtree', system-ui, sans-serif"
    fontSize: "clamp(36px, 16cqi, 88px)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.035em"
    fontFeature: "tnum"
  headline:
    fontFamily: "'Figtree Variable', 'Figtree', system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  figure:
    fontFamily: "'Figtree Variable', 'Figtree', system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  title:
    fontFamily: "'Figtree Variable', 'Figtree', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 800
  body:
    fontFamily: "'Figtree Variable', 'Figtree', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  table:
    fontFamily: "'Figtree Variable', 'Figtree', system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    fontFeature: "tnum"
  label:
    fontFamily: "'Figtree Variable', 'Figtree', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
rounded:
  sm: "8px"
  md: "12px"
  lg: "18px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "18px"
  xl: "26px"
  page: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "10px 18px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "10px 18px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.accent-soft}"
  button-destructive:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    padding: "10px 18px"
    height: "40px"
  button-destructive-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
  button-sm:
    padding: "6px 13px"
    height: "32px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
    height: "42px"
  nav-link:
    textColor: "{colors.rail-ink-soft}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  nav-link-hover:
    backgroundColor: "{colors.rail-raised}"
    textColor: "{colors.rail-ink}"
  nav-link-active:
    backgroundColor: "{colors.rail-hi}"
    textColor: "{colors.rail}"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "3px 10px 3px 8px"
  chip-recurring:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "20px 22px"
  note-panel:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.display}"
    rounded: "{rounded.lg}"
    padding: "26px 28px 22px"
  note-panel-negative:
    backgroundColor: "{colors.negative-note}"
  category-strip:
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "13px 16px 12px"
  budget-bar-track:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.pill}"
    height: "10px"
---

# Design System: Ledger (placeholder name)

## Overview

**Creative North Star: "Polymer Notes"**

Every spending category is a denomination. The app borrows the colour logic of Canada's polymer banknotes: each category owns one deep note colour and keeps it everywhere it appears (chip dot, budget bar, dashboard strip, chart series), so a household learns "purple is entertainment" the way they know a purple note is a ten. The shell is a deep note-green rail on a light mineral ground, and exactly one surface, the note panel, is dressed as a banknote: fine engraved line work, a translucent clear window that is a real readout, and the headline figure set large enough to answer "am I OK this month?" before anything else.

The rest of the world is quiet and working: white cards with a soft lift, hairline ledger rules, Figtree everywhere with tabular figures so money lines up in columns. Density is moderate; the dashboard carries a 7/5 split of note and strips, then cards. Red has one job, over-budget and negative, and the system protects that meaning by refusing red anywhere else, including destructive buttons and category colours.

The world rejects the category default of a grey dashboard with one brand accent and a row of identical white KPI tiles. Totals are written as a sentence-like summary line; the safe-to-spend number shows its own working as a written equation.

**Key Characteristics:**
- One note-colour per category, carried across every representation.
- One note panel per screen, with guilloche line work and a functional window; nothing else is engraved.
- Red means over-budget or negative, never decoration or action.
- Figtree variable throughout, tabular figures on every amount, U+2212 for minus.
- Pill-shaped buttons and chips, softly rounded cards (12px), a larger 18px radius for the note.
- One authored motion: the note settles in on load; reduced motion removes it.

## Colors

A deep-green mineral palette for the shell and actions, a family of eight-plus dark banknote hues for categories, and a single reserved red.

### Primary
- **Note Green** (accent): the action colour (primary buttons, links, focus rings, caret, `accent-color`) and the resting colour of the note panel. Its gradient partner **Deep Note Green** (accent-strong) is the primary hover and the lower stop of the note's gradient. **Pale Note Green** (accent-soft) tints the bulk-action toolbar, the secondary-button hover and the bills "mark paid" row.

### Secondary
- **Rail Green** (rail): the app shell's sidebar, the phone top bar and its dropdown, and the full-bleed background of the sign-in screen. **Raised Rail** (rail-raised) for rail hover, the profile switcher, the menu toggle and sign-out. **Rail Ink** and **Rail Ink Soft** for rail text; **Mint Window** (rail-hi) marks the active nav item and rail focus rings.

### Tertiary: the denomination palette
Every category colour is dark enough for white text at WCAG AA; assignment lives in one place (`utils/categoryColors.js`).
- **Note Green** (note-green): Groceries, Salary/Income ($20 note).
- **Note Blue** (note-blue): Transportation ($5 note).
- **Note Purple** (note-purple): Entertainment ($10 note).
- **Note Brown** (note-brown): Rent/Mortgage ($100 note).
- **Note Teal** (note-teal): Utilities.
- **Note Ochre** (note-ochre): Shopping.
- **Note Plum** (note-plum): Food.
- **Note Slate** (note-slate): Bill, the dashboard "Bills due" strip, and the Spending series in trend charts.
- **Note Indigo** (note-indigo): Subscription.
- **Deep Green-Teal** (note-green-teal): Healthcare.
- **Neutral Grey** (note-neutral): Other and Uncategorized; also the default chip dot.
- Custom categories hash their name into the eight core note colours, so a category is the same colour on every page and for every household member.

### Neutral
- **Mineral Ground** (ground): page background behind everything.
- **White** (surface): cards, inputs, secondary buttons, the auth card.
- **Mist** (surface-2): chip fill, budget-bar track, chart cursor, destructive-button hover.
- **Ink** (ink) for text; **Soft Ink** (ink-soft) for secondary text, labels, dates, axis ticks and the select chevron.
- **Hairline** (line) for ledger rules and card borders; **Strong Hairline** (line-strong) for input borders, secondary-button borders and the chart zero line.
- **Chart Grid** (chart-grid): horizontal gridlines only.

### Status
- **Reserved Red** (negative) with **Red Wash** (negative-soft): over-budget amounts and bars, negative months in the net chart, overdue due-dates, error banners. **Oxblood Note** (negative-note) is the note panel's colour when safe-to-spend goes negative.
- **Positive Green** (positive): income amounts and positive totals.
- **Ochre Warning** (warn) with **Warm Wash** (warn-soft): budgets at 80 to 100 percent, pace warnings, the recurring chip.
- **Overdue Badge** (badge-overdue on badge-overdue-ink): the count of overdue bills on the rail's nav item and menu toggle.

### Named Rules
**The Reserved Red Rule.** Red means over-budget or negative, and nothing else. No red category, no red button, no red decoration. Delete and Remove stay neutral.

**The One Denomination Rule.** A category's colour comes only from `categoryColor(name)` and is the same in every chip dot, bar, strip and chart series. Never pick a category colour locally.

**The Never-Colour-Alone Rule.** Every red or green state also carries words or a sign: "over", "left", "+", "−".

## Typography

**Display Font:** Figtree Variable (self-hosted via @fontsource-variable, falling back to Figtree, system-ui, sans-serif)
**Body Font:** the same Figtree Variable
**Label/Mono Font:** none distinct; display and mono tokens both alias the body family.

**Character:** One friendly geometric sans at many weights. Hierarchy comes from weight (400 to 800) and size, never from a second family or uppercase tracking.

### Hierarchy
- **Display** (800, clamp(36px, 16cqi, 88px), line-height 1, -0.035em): the note panel's headline figure only. Sized in container units against the note's head so it fills the panel and never wraps mid-number (`white-space: nowrap`).
- **Headline** (700, 32px, 1.1, -0.01em; 26px at ≤720px): page titles; 26px on the auth card.
- **Figure** (800, 26px, -0.02em, tabular): bold numbers in the summary line. Related figure sizes: 30px in the note window, 21px on category strips, 17px to 19px in the written equation.
- **Title** (800, 17px): card titles, with an optional 13px/700 link at the right.
- **Body** (400, 15px, 1.5): running text and captions, captions capped near 52ch.
- **Table** (14.5px, tabular): ledger rows; headers 12.5px/700 in soft ink, sentence case.
- **Label** (700, 13px, soft ink, sentence case): form labels, fact terms, sub-lines.

### Named Rules
**The Tabular Money Rule.** Every amount uses `font-variant-numeric: tabular-nums` so money lines up in columns.

**The Weight Not Case Rule.** Emphasis comes from weight and size. No uppercase tracked labels.

## Layout

Desktop is a fixed 236px rail plus a main column (padding 32px 40px 72px, max 1240px). The dashboard top row is a 7fr/5fr grid: note panel on the left, a stack of category strips on the right, stretched to the note's height. Below that sits a 1.4fr/1fr card grid. Both grids collapse to one column (at 1000px and 900px). Cards space at 14px to 18px gaps; sections separate by 26px.

At ≤720px the rail becomes a sticky top bar with a menu toggle. Navigation opens as a panel under the bar over a dimmed backdrop. Main padding drops to 18px 16px. Forms go single column. On Transactions the primary action goes first at full width, and the filters fold behind a toggle. Ledger tables marked `stack` become two-line rows: description and amount on line one; date, category, status and actions on line two. The header stays for screen readers. Everything holds at 320px.

Spacing rhythm is 6, 8, 14, 18, 26 and 40px, with internal card padding of 20px 22px (16px on phones).

## Elevation & Depth

A light, hybrid system: white cards sit on the mineral ground with a hairline border and a soft two-layer shadow, and only the note panel and auth card rise further. Depth is otherwise tonal: rail vs. ground, the note window's translucent white over the note's colour.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 2px rgba(23, 33, 29, 0.05), 0 6px 16px -10px rgba(23, 33, 29, 0.18)`): every card, and category strips on hover.
- **Pop** (`box-shadow: 0 2px 4px rgba(23, 33, 29, 0.08), 0 18px 40px -18px rgba(23, 33, 29, 0.35)`): the note panel and the auth card.
- **Window inset** (`box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35)`): the note window's top edge.
- **Phone menu** (`box-shadow: 0 16px 30px rgba(10, 25, 20, 0.35)`): the dropped navigation panel.

### Named Rules
**The One Note Rule.** Guilloche line work (repeating radial gradients) and the clear window belong to the note panel alone. Cards stay plain. The brand mark is the one small echo: a tiny note with a window.

## Shapes

Soft and banknote-like. Cards and strips use the medium radius, and the note and auth card use the large radius. Inputs, nav items and rail controls use the small radius. Buttons, chips, badges, progress tracks and the over-budget pill are full pills. Budget names carry a 10px rounded-square swatch, and chips carry an 8px round dot. Borders are 1px hairlines. The empty strip uses a 1.5px dashed border as the only dashed form besides the demo hint divider.

## Components

### Buttons
Calm, pill-shaped, confident without shouting.
- **Shape:** full pill (999px), min-height 40px, 14px/700 text.
- **Primary:** Note Green on white text; hover deepens to Deep Note Green. One primary per header ("Add or scan a transaction").
- **Secondary:** white with a strong hairline border; hover borders in Note Green over Pale Note Green.
- **Destructive (Delete / Remove / Delete my account):** deliberately neutral. Transparent fill, hairline border, soft-ink text; hover goes to Mist with ink text. Never red.
- **Small:** 32px high, 6px 13px padding, 13px text, used for row actions.
- **Active / Focus:** press nudges 1px down. Focus is a 2px Note Green outline offset 2px (Mint Window on the rail). Disabled sits at 55% opacity.

### Chips
- **Category chip:** Mist pill, 13px/600 ink text, led by an 8px dot in the category's denomination colour.
- **Recurring chip:** Warm Wash fill with Ochre Warning text.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** White on Mineral Ground.
- **Shadow Strategy:** Card shadow (see Elevation).
- **Border:** 1px Hairline.
- **Internal Padding:** 20px 22px; 16px on phones, where a card scrolls its content horizontally instead of overflowing.

### Inputs / Fields
- **Style:** white, 1px Strong Hairline, 8px radius, 10px 12px padding, min-height 42px, label above in 13px/700 soft ink.
- **Select:** native appearance removed and replaced by a themed 12×8 chevron in soft ink (rail-ink-soft on the rail's profile switcher), 34px right padding.
- **Focus:** 2px Note Green outline flush with a Note Green border.
- **Error:** a Red Wash banner with red 14px/600 text above the form.

### Navigation
The rail: a 236px Rail Green column holding the brand (21px/800 with the note brand-mark), the profile switcher, the nav list and the user chip with sign-out. Nav links are 15px/600 in Rail Ink Soft. Hover puts Raised Rail behind Rail Ink, and the active item is Mint Window with dark green text. Overdue bills show as a pink pill badge. On phones the rail becomes a top bar with a three-bar toggle that animates into an X.

### Note Panel (signature)
The single banknote on the dashboard.
- Note Green with a 135° gradient to Deep Note Green, two repeating radial gradients of fine white rings, 18px radius, Pop shadow. It turns Oxblood Note when safe-to-spend is negative.
- Grid areas: head (18px/700 label plus the Display figure), caption (15px body plus a bold change line), window, sum.
- **Window:** 176px, translucent white (16%) with a 45% white border and inset top highlight. It shows "per day" and "days left" as 30px/800 figures split by a rule. On phones it lays out side by side with a vertical rule.
- **Written equation:** a hairline-topped row of terms: income so far, − spent, − bills due, − scheduled, = safe to spend. Each operator travels with the amount after it so wraps never strand an operator. Values are 17px/800 and the result 19px.

### Category Strip
Beside the note: a full-colour block in the category's denomination colour (via `--cat`), white text, 12px radius. It shows the name (15px/700), the amount left (21px/800), a sub-line "spent of limit · change", and a 5px white track. When over, the amount becomes a white pill with red text. Hover lifts 1px with the Card shadow. A slate "Bills due" strip closes the stack.

### Budget Bar
List row: a 10px rounded swatch in the category colour, then the name and "left" or "over" amount. The amount sits in ink, turns Ochre Warning from 80%, and turns red past 100%. Below is a 10px Mist track filled in the category colour (red only when over), and then a 13px sub-line with spent of budget, percent and change.

### Ledger Table
Full-width, hairline-ruled rows (12px 10px padding), with a subtle hover tint. Amounts are right-aligned 700 tabular. Income is Positive Green with "+", and spending is ink with "−". At ≤720px, stacked tables use the two-line row mode described in Layout.

### Summary Line
Totals appear as one wrapped line instead of tiles. Each term is a 26px/800 figure followed by plain words ("left in budgets", "spent outside any budget", "came in", "kept per month on average"), with an optional 13px change line beneath. An over total turns its figure red.

### Charts
Recharts on horizontal gridlines only, with 12px soft-ink axis ticks, a 10px-radius tooltip and a Mist cursor. Category bars use their denomination colours. Income is Note Green and Spending is Note Slate. Net months are green when kept and red when overspent, against a Strong Hairline zero line. Axis values are compact currency with U+2212 minus and round ticks that always include zero.

### Motion
One authored moment: on load the note panel settles (0.7s, translateY 10px and scale 0.985 to rest), and its figure rises (0.9s, 0.1s delay). Both use `cubic-bezier(0.16, 1, 0.3, 1)` and run only under `prefers-reduced-motion: no-preference`. Everything else is a 0.1s to 0.2s state transition on the same ease.

### Voice in the interface
Comparisons read "€X more/less than this point last month" (same stretch of days, so it is fair mid-month), in plain words with no arrows or colour. Negatives use the true minus sign (U+2212). Sort options are plain language ("Newest first", "Largest amount", "Income first"). Numbers come first and the words say what they are.

## Do's and Don'ts

### Do:
- **Do** take every category colour from `categoryColor(name)` and use it identically for dots, bars, strips and chart series.
- **Do** keep red (#b42318) for over-budget, overdue and negative values only, always paired with a word or sign.
- **Do** set every amount in tabular figures and format negatives with U+2212.
- **Do** write totals as a summary line (figure, then plain words) and show a change "than this point last month" where data exists.
- **Do** size the note's headline figure in container units (clamp(36px, 16cqi, 88px)) with no wrapping.
- **Do** give money tables the two-line row mode at ≤720px and keep them usable at 320px.
- **Do** gate the note entrance behind `prefers-reduced-motion: no-preference`.

### Don't:
- **Don't** build rows of identical KPI tiles; use the summary line.
- **Don't** add kicker or eyebrow labels above headings, or uppercase tracked labels.
- **Don't** put guilloche line work or a window on any surface except the note panel (and the brand mark's echo).
- **Don't** make destructive buttons red; Delete and Remove use the neutral style.
- **Don't** add red, or any near-red, to the category palette.
- **Don't** add a second typeface or load fonts from a third-party CDN; Figtree is self-hosted.
- **Don't** hard-code the product name; it lives in `APP_NAME` (brand.js) and the `<title>` until the owner chooses one.
