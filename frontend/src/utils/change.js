import { formatMoney } from './format.js';

// "€120 more than this point last month" - compared with the same stretch
// of days last month (the API's lastMonthToDate / lastMonthSpent), so the
// comparison is fair mid-month. Plain words, no arrows or colour: more
// spending isn't automatically bad, and the user ruled out a busy screen.
export function changeVsLastMonth(current, lastMonth, currency) {
  if (lastMonth == null) return null;
  if (!current && !lastMonth) return null;
  const diff = Math.round((current - lastMonth) * 100) / 100;
  if (diff === 0) return 'the same as this point last month';
  const amount = formatMoney(Math.abs(diff), { currency });
  return `${amount} ${diff > 0 ? 'more' : 'less'} than this point last month`;
}
