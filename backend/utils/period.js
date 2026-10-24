const { isValidDate } = require('../middleware/validate');

// "Today" in the USER's timezone, which the server can't know: the
// browser sends it as ?today=YYYY-MM-DD. Without it, the server's UTC
// date is used, which is already tomorrow for North America in the
// evening - so a page could show next month, or count a transaction
// dated tomorrow as already spent.
function userToday(req) {
  return isValidDate(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
}

function monthBounds(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  const start = `${yyyyMm}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of month
  return { start, end };
}

// The month being looked at (?month=YYYY-MM, default: the month of the
// user's today) and the part of it that has already happened:
// start..end, where end is today for the current month.
function monthPeriod(req) {
  const today = userToday(req);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month) ? req.query.month : today.slice(0, 7);
  const { start, end: monthEnd } = monthBounds(month);
  const end = monthEnd < today ? monthEnd : today;
  return { today, month, start, monthEnd, end };
}

// Days from `today` to the end of its month, counting today: on the 30th
// of a 31-day month this is 2.
function daysLeftInMonth(today) {
  const { end } = monthBounds(today.slice(0, 7));
  return Math.round((Date.parse(end) - Date.parse(today)) / 86_400_000) + 1;
}

// The same stretch of the previous month: if today is Oct 17, that's
// Sep 1..Sep 17. Comparing month-to-date with ALL of last month would
// always make the current month look thrifty, so changes are measured
// against this window. A short previous month is clamped (Mar 31 → Feb 28).
function sameStretchLastMonth(today) {
  const [y, m, d] = today.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const { start, end: prevEnd } = monthBounds(prev);
  const lastDay = Number(prevEnd.slice(8));
  const end = `${prev}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
  return { start, end };
}

// Calendar months from today's month through a target date's, counting
// both: on Oct 19 a Dec 31 target has 3 (October, November, December),
// since a monthly transfer can still go in this month.
function monthsLeft(today, targetDate) {
  const [y, m] = today.split('-').map(Number);
  const [ty, tm] = targetDate.split('-').map(Number);
  return (ty - y) * 12 + (tm - m) + 1;
}

module.exports = { userToday, monthBounds, monthPeriod, daysLeftInMonth, sameStretchLastMonth, monthsLeft };
