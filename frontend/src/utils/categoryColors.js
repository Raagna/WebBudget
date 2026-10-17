// Each spending category is a "denomination": it owns one colour, taken
// from the family of Canada's polymer notes, and keeps it everywhere it
// appears (dots, budget strips, chart series). Every colour is dark enough
// for white text on it (WCAG AA). Red is deliberately NOT in this set: it
// is reserved for over-budget and negative states, so a red category could
// never be mistaken for a warning.
export const NOTE_COLORS = {
  green: '#1F6E46',  // $20
  blue: '#1F5FA8',   // $5
  purple: '#5E3F99', // $10
  brown: '#7A4E2D',  // $100
  teal: '#0E6E72',
  ochre: '#7D5A0F',
  plum: '#86306A',
  slate: '#3D5168',
};

const BY_NAME = {
  groceries: NOTE_COLORS.green,
  'rent/mortgage': NOTE_COLORS.brown,
  transportation: NOTE_COLORS.blue,
  entertainment: NOTE_COLORS.purple,
  utilities: NOTE_COLORS.teal,
  bill: NOTE_COLORS.slate,
  shopping: NOTE_COLORS.ochre,
  food: NOTE_COLORS.plum,
  subscription: '#4B4FA3', // indigo, between the $5 and $10 notes
  healthcare: '#0F6A55',   // deep green-teal
  'salary/income': NOTE_COLORS.green,
  other: '#5B6470',
  uncategorized: '#5B6470',
};

const ROTATION = Object.values(NOTE_COLORS);

// Default categories get a fixed colour; custom ones get a stable colour
// from their name, so the same category is the same colour on every page
// and for every member of a household.
export function categoryColor(name) {
  const key = (name || 'Uncategorized').trim().toLowerCase();
  if (BY_NAME[key]) return BY_NAME[key];
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return ROTATION[hash % ROTATION.length];
}
