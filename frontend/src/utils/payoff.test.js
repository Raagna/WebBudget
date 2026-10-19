import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthName, monthShort, duration, addMonths, chartRows } from './payoff.js';

test('months read as dates', () => {
  assert.equal(monthName('2029-03'), 'March 2029');
  assert.equal(monthShort('2027-01'), 'Jan 2027');
  assert.equal(addMonths('2026-10', 3), '2027-01');
  assert.equal(addMonths('2026-12', 0), '2026-12');
});

test('spans of time read in years and months', () => {
  assert.equal(duration(1), '1 month');
  assert.equal(duration(11), '11 months');
  assert.equal(duration(12), '1 year');
  assert.equal(duration(29), '2 years 5 months');
  assert.equal(duration(137), '11 years 5 months');
});

test('chart rows keep a finished plan at zero and stop one that never finishes', () => {
  const rows = chartRows('2026-10', {
    avalanche: { paidOff: true, balances: [300, 100, 0] },
    minimum: { paidOff: false, balances: [300, 290, 280, 270] },
  });
  assert.deepEqual(rows, [
    { month: '2026-10', avalanche: 300, minimum: 300 },
    { month: '2026-11', avalanche: 100, minimum: 290 },
    { month: '2026-12', avalanche: 0, minimum: 280 },
    { month: '2027-01', avalanche: 0, minimum: 270 },
  ]);
  const never = chartRows('2026-10', { a: { paidOff: true, balances: [5, 0] }, b: { paidOff: false, balances: [5] } });
  assert.equal(never[1].b, undefined);
});
