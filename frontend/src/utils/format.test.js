// Run with `npm test` (Node's built-in test runner; no extra dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localToday, currentYearMonth } from './format.js';

// Node applies a TZ change immediately, so these behave like a browser in
// that timezone.
function inTimezone(tz, fn) {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try { fn(); } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
}

test('localToday is the date where the user is, not the UTC date', () => {
  // 9pm on Oct 14 in Toronto = 01:00 on Oct 15 UTC. toISOString() said the
  // 15th, so new transactions defaulted to tomorrow every evening.
  const evening = new Date('2026-10-15T01:00:00Z');
  inTimezone('America/Toronto', () => {
    assert.equal(localToday(evening), '2026-10-14');
  });
  inTimezone('Asia/Tokyo', () => {
    assert.equal(localToday(evening), '2026-10-15');
  });
});

test('localToday pads single-digit months and days', () => {
  inTimezone('UTC', () => {
    assert.equal(localToday(new Date('2026-03-05T12:00:00Z')), '2026-03-05');
  });
});

test('currentYearMonth follows the local date across a month boundary', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-01T02:30:00Z') });
  inTimezone('America/Vancouver', () => {
    assert.equal(currentYearMonth(), '2026-10'); // still Oct 31 at 7:30pm in Vancouver
  });
});
