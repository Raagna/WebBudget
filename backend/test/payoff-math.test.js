// The payoff plan's arithmetic (utils/payoff.js). No database needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_MONTHS, monthlyInterest, avalancheOrder, snowballOrder, minimumTooLow, simulate, comparePlans, addMonths,
} = require('../utils/payoff');

const debt = (id, balance, ratePercent, min) => ({
  id, name: id, balanceCents: Math.round(balance * 100), rateBps: Math.round(ratePercent * 100), minPaymentCents: Math.round(min * 100),
});
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

// Every plan that finishes must have paid exactly what was owed plus the
// interest, cleared every debt once, and ended on zero.
function assertConsistent(plan, debts) {
  assert.equal(plan.timeline.length, plan.months + 1);
  assert.equal(plan.timeline[0], sum(debts.map((d) => d.balanceCents)));
  assert.equal(plan.timeline.at(-1), 0);
  assert.equal(plan.totalPaidCents, sum(debts.map((d) => d.balanceCents)) + plan.totalInterestCents);
  assert.deepEqual(plan.order.map((o) => o.id).sort(), debts.map((d) => d.id).sort());
  assert.ok(plan.order.every((o, i) => i === 0 || o.month >= plan.order[i - 1].month), 'cleared in month order');
  assert.equal(plan.order.at(-1).month, plan.months);
  assert.deepEqual(plan.unpaid, []);
}

test('a month of interest is a twelfth of the annual rate, rounded to the cent', () => {
  assert.equal(monthlyInterest(100000, 1200), 1000); // $1,000 at 12% -> $10.00
  assert.equal(monthlyInterest(123456, 1999), 2057); // 2056.62... -> 2057
  assert.equal(monthlyInterest(50, 1999), 1); // 0.83 of a cent rounds up
  assert.equal(monthlyInterest(10, 1999), 0);
  assert.equal(monthlyInterest(500000, 0), 0);
});

test('one debt on its minimum, worked through month by month', () => {
  // $1,000 at 12%, $100 a month. Month 1: 1000 + 10.00 - 100 = 910.
  // Month 2: 910 + 9.10 - 100 = 819.10. ... Month 11 pays the last 58.98.
  const d = [debt('loan', 1000, 12, 100)];
  const plan = simulate(d, { strategy: 'minimum' });
  assert.deepEqual(plan.timeline, [100000, 91000, 81910, 72729, 63456, 54091, 44632, 35078, 25429, 15683, 5840, 0]);
  assert.equal(plan.months, 11);
  assert.equal(plan.totalInterestCents, 5898);
  assert.equal(plan.paidOff, true);
  assertConsistent(plan, d);
});

test('with no interest, extra money just shortens the plan', () => {
  const d = [debt('promo', 1000, 0, 100)];
  const { avalanche, minimum } = comparePlans(d, 5000); // $50 extra
  assert.equal(minimum.months, 10);
  assert.equal(avalanche.months, 7); // 6 x $150, then the last $100
  assert.equal(avalanche.totalInterestCents, 0);
  assert.deepEqual(avalanche.timeline, [100000, 85000, 70000, 55000, 40000, 25000, 10000, 0]);
});

test('avalanche goes after the highest rate, snowball the smallest balance', () => {
  const card = debt('card', 5000, 22, 100);
  const car = debt('car', 1000, 5, 50);
  const d = [card, car];
  assert.deepEqual(avalancheOrder(d).map((x) => x.id), ['card', 'car']);
  assert.deepEqual(snowballOrder(d).map((x) => x.id), ['car', 'card']);

  const { avalanche, snowball, minimum } = comparePlans(d, 20000); // $200 extra
  assertConsistent(avalanche, d);
  assertConsistent(snowball, d);
  assertConsistent(minimum, d);

  // Snowball clears the small car loan in month 5 for a quick win;
  // avalanche throws everything at the 22% card first.
  assert.deepEqual(snowball.order, [{ id: 'car', month: 5 }, { id: 'card', month: 21 }]);
  assert.equal(avalanche.order[0].id, 'card');
  assert.equal(avalanche.months, 21);
  assert.equal(avalanche.totalInterestCents, 106792);
  assert.equal(snowball.totalInterestCents, 121864);
  assert.ok(avalanche.totalInterestCents < snowball.totalInterestCents, 'avalanche pays less interest');

  // Minimums only takes over eleven years.
  assert.equal(minimum.months, 137);
  assert.equal(minimum.totalInterestCents, 872465);
});

test('ties: the same rate goes smaller balance first, the same balance higher rate first', () => {
  const d = [debt('a', 900, 10, 20), debt('b', 300, 10, 20), debt('c', 300, 15, 20)];
  assert.deepEqual(avalancheOrder(d).map((x) => x.id), ['c', 'b', 'a']);
  assert.deepEqual(snowballOrder(d).map((x) => x.id), ['c', 'b', 'a']);
});

test('money left over after clearing a debt spills onto the next one that same month', () => {
  // Month 1 budget: $10 + $10 minimums + $200 extra = $220.
  // Small debt: $10 minimum, then $90 of the extra clears it.
  // Big debt: its $10 minimum plus the remaining $110.
  const d = [debt('small', 100, 0, 10), debt('big', 1000, 0, 10)];
  const plan = simulate(d, { strategy: 'snowball', extraCents: 20000 });
  assert.deepEqual(plan.order[0], { id: 'small', month: 1 });
  assert.equal(plan.timeline[1], 88000);
  // From month 2 the whole $220 goes to the big debt: 880 = 4 x 220.
  assert.equal(plan.months, 5);
  assertConsistent(plan, d);
});

test('a cleared debt’s minimum rolls on, so even no extra beats minimums only', () => {
  const d = [debt('visa', 3000, 19.99, 90), debt('loc', 8000, 9.5, 120), debt('osap', 12000, 6.2, 150)];
  const { avalanche, snowball, minimum } = comparePlans(d, 0);
  for (const plan of [avalanche, snowball, minimum]) assertConsistent(plan, d);
  assert.ok(avalanche.months < minimum.months);
  assert.ok(avalanche.totalInterestCents < minimum.totalInterestCents);
  assert.ok(snowball.totalInterestCents < minimum.totalInterestCents);
  assert.ok(avalanche.totalInterestCents <= snowball.totalInterestCents);
});

test('a minimum that never beats the interest is caught, and the rest of the plan still runs', () => {
  // $10,000 at 24% is $200 of interest a month; $150 never makes a dent.
  const stuck = debt('card', 10000, 24, 150);
  const fine = debt('loan', 2000, 6, 100);
  assert.equal(minimumTooLow(stuck), true);
  assert.equal(minimumTooLow(fine), false);
  // Exactly the interest is still never paid off: the balance just sits there.
  assert.equal(minimumTooLow(debt('flat', 10000, 24, 200)), true);
  assert.equal(minimumTooLow(debt('pause', 500, 0, 0)), true);
  assert.equal(minimumTooLow(debt('free', 500, 0, 25)), false);

  const { minimum, avalanche, minimumTooLow: low } = comparePlans([stuck, fine], 30000);
  assert.deepEqual(low, [{ id: 'card', interestCents: 20000 }]);
  assert.equal(minimum.paidOff, false);
  assert.equal(minimum.months, null);
  assert.deepEqual(minimum.unpaid, ['card']);
  // It stops once the loan is cleared, rather than running for 50 years.
  assert.deepEqual(minimum.order.map((o) => o.id), ['loan']);
  assert.equal(minimum.timeline.length, minimum.order[0].month + 1);
  assert.ok(minimum.timeline.at(-1) > 1000000, 'the card has grown');

  // With $300 extra on top, the avalanche clears both.
  assertConsistent(avalanche, [stuck, fine]);
});

test('a budget that can never keep up stops instead of running forever', () => {
  // $250 of interest a month against $100 a month: it only grows.
  const d = [debt('x', 10000, 30, 100)];
  const { avalanche, minimum } = comparePlans(d, 0);
  assert.equal(avalanche.paidOff, false);
  assert.equal(avalanche.months, null);
  assert.ok(avalanche.timeline.length <= MAX_MONTHS + 1);
  assert.ok(avalanche.timeline.every((c) => Number.isSafeInteger(c)));
  assert.equal(minimum.timeline.length, 1, 'known never to clear, so nothing to simulate');

  // A minimum that only just beats the interest still has a 50-year ceiling.
  const slow = simulate([debt('y', 10000, 12, 100.01)], { strategy: 'minimum' });
  assert.equal(slow.paidOff, false);
  assert.equal(slow.timeline.length, MAX_MONTHS + 1);
});

test('a minimum bigger than what is owed only pays what is owed', () => {
  const d = [debt('tiny', 30, 12, 100), debt('other', 500, 12, 25)];
  const { minimum, avalanche } = comparePlans(d, 0);
  assertConsistent(minimum, d);
  assert.deepEqual(minimum.order[0], { id: 'tiny', month: 1 });
  assert.equal(minimum.totalPaidCents, 3000 + 500 * 100 + minimum.totalInterestCents);
  // Avalanche hands tiny's unused $69.70 to the other debt in month 1.
  assert.equal(avalanche.timeline[1], 50000 + 500 - 2500 - (10000 - 3030));
  assertConsistent(avalanche, d);
});

test('many random plans all add up exactly', () => {
  let seed = 42;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 200; i++) {
    const d = Array.from({ length: 1 + rand(5) }, (_, j) => {
      const balanceCents = 1000 + rand(3000000);
      const rateBps = rand(3000);
      // Always more than the first month's interest, so every plan finishes.
      const minPaymentCents = monthlyInterest(balanceCents, rateBps) + 500 + rand(20000);
      return { id: `d${j}`, name: `d${j}`, balanceCents, rateBps, minPaymentCents };
    });
    const plans = comparePlans(d, rand(50000));
    for (const k of ['avalanche', 'snowball', 'minimum']) {
      if (plans[k].paidOff) assertConsistent(plans[k], d);
      else assert.equal(plans[k].timeline.length, MAX_MONTHS + 1, 'only the 50-year ceiling stops a plan here');
    }
    assert.equal(plans.minimumTooLow.length, 0);
    assert.ok(!plans.minimum.paidOff || (plans.avalanche.paidOff && plans.avalanche.months <= plans.minimum.months));
  }
});

test('months count forward across year ends', () => {
  assert.equal(addMonths('2026-10', 0), '2026-10');
  assert.equal(addMonths('2026-10', 3), '2027-01');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', 24), '2028-01');
  assert.equal(addMonths('2026-10', 29), '2029-03');
});
