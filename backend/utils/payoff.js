// The arithmetic behind the debt payoff plan: month by month, what
// happens to a set of loans and credit cards under three ways of paying
// them. Plain functions on integer cents, so nothing drifts.
//
// A debt: { id, name, balanceCents, rateBps, minPaymentCents }
//   rateBps is the annual interest rate in basis points (19.99% = 1999).
//
// Each month, in this order:
//   1. Interest: every debt still owing grows by a twelfth of its annual
//      rate (monthly compounding), rounded to the cent.
//   2. Minimums: every debt gets its minimum payment (or what's left on
//      it, if that's less).
//   3. Extra: the rest of the monthly budget goes to one debt at a time,
//      in the plan's order, spilling into the next once one is cleared.
//
// Avalanche and Snowball both spend the same budget every month: all the
// starting minimums plus the extra. When a debt is cleared its minimum
// isn't spent elsewhere, it rolls on to the next debt in line. "Minimums
// only" pays each debt its own minimum and nothing more, and stops paying
// a debt once it's cleared.

const MAX_MONTHS = 600; // 50 years; past this a plan is "not in your lifetime"

function monthlyInterest(balanceCents, rateBps) {
  // bps / 10000 is the annual rate; / 12 for the month.
  return Math.round((balanceCents * rateBps) / 120000);
}

// Highest rate first; on a tie, the smaller balance (it clears sooner).
function avalancheOrder(debts) {
  return [...debts].sort((a, b) => b.rateBps - a.rateBps || a.balanceCents - b.balanceCents);
}

// Smallest balance first; on a tie, the higher rate.
function snowballOrder(debts) {
  return [...debts].sort((a, b) => a.balanceCents - b.balanceCents || b.rateBps - a.rateBps);
}

// A minimum that doesn't beat the first month's interest never pays the
// debt off on its own: the balance can't fall, so next month's interest
// is no smaller, and so on forever. If it does beat it, the balance
// falls, interest falls with it, and the minimum keeps winning.
function minimumTooLow(debt) {
  return debt.minPaymentCents <= monthlyInterest(debt.balanceCents, debt.rateBps);
}

// strategy: 'avalanche' | 'snowball' | 'minimum'
// -> {
//   strategy,
//   paidOff:   every debt cleared,
//   months:    payments until the last one is cleared (null if never),
//   totalInterestCents, totalPaidCents: over the months simulated,
//   order:     [{ id, month }] in the order debts were cleared (month 1 = first payment),
//   unpaid:    ids still owing when the simulation stopped,
//   timeline:  total owed after each month, timeline[0] being today,
// }
function simulate(debts, { strategy, extraCents = 0 }) {
  const rolling = strategy !== 'minimum';
  const priority = strategy === 'snowball' ? snowballOrder(debts) : avalancheOrder(debts);
  const owed = new Map(debts.map((d) => [d.id, d.balanceCents]));
  const budget = rolling ? debts.reduce((s, d) => s + d.minPaymentCents, 0) + extraCents : 0;
  const startTotal = debts.reduce((s, d) => s + d.balanceCents, 0);

  // On minimums alone, a debt whose minimum can't beat its interest is
  // known never to clear; the plan runs until everything else has, so the
  // chart and totals stop at a sensible point instead of running 50 years.
  const stuck = new Set(rolling ? [] : debts.filter(minimumTooLow).map((d) => d.id));

  const order = [];
  const timeline = [startTotal];
  let totalInterestCents = 0;
  let totalPaidCents = 0;
  let month = 0;

  const pay = (id, cents) => {
    const amount = Math.min(cents, owed.get(id));
    if (amount <= 0) return 0;
    owed.set(id, owed.get(id) - amount);
    totalPaidCents += amount;
    if (owed.get(id) === 0) order.push({ id, month });
    return amount;
  };
  const open = () => debts.filter((d) => owed.get(d.id) > 0);
  const total = () => debts.reduce((s, d) => s + owed.get(d.id), 0);

  while (open().some((d) => !stuck.has(d.id)) && month < MAX_MONTHS) {
    month++;
    for (const d of open()) {
      const interest = monthlyInterest(owed.get(d.id), d.rateBps);
      owed.set(d.id, owed.get(d.id) + interest);
      totalInterestCents += interest;
    }
    let left = budget;
    for (const d of open()) {
      const paid = pay(d.id, d.minPaymentCents);
      left -= paid;
    }
    if (rolling) {
      for (const d of priority) {
        if (left <= 0) break;
        left -= pay(d.id, left);
      }
    }
    timeline.push(total());
    // A budget that can't keep up with the interest only digs deeper; no
    // need to watch it for 50 years (and the numbers would stop fitting).
    if (total() > startTotal * 10) break;
  }

  const unpaid = open().map((d) => d.id);
  return {
    strategy,
    paidOff: unpaid.length === 0,
    months: unpaid.length === 0 ? month : null,
    totalInterestCents,
    totalPaidCents,
    order,
    unpaid,
    timeline,
  };
}

// All three plans side by side, plus the debts whose minimum alone would
// never pay them off.
function comparePlans(debts, extraCents = 0) {
  return {
    avalanche: simulate(debts, { strategy: 'avalanche', extraCents }),
    snowball: simulate(debts, { strategy: 'snowball', extraCents }),
    minimum: simulate(debts, { strategy: 'minimum' }),
    minimumTooLow: debts.filter(minimumTooLow).map((d) => ({
      id: d.id,
      interestCents: monthlyInterest(d.balanceCents, d.rateBps),
    })),
  };
}

// '2026-10' plus 3 months -> '2027-01'.
function addMonths(yyyyMm, n) {
  const [y, m] = yyyyMm.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

module.exports = {
  MAX_MONTHS,
  monthlyInterest,
  avalancheOrder,
  snowballOrder,
  minimumTooLow,
  simulate,
  comparePlans,
  addMonths,
};
