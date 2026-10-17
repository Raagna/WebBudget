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

module.exports = { userToday, monthBounds, monthPeriod, daysLeftInMonth };
