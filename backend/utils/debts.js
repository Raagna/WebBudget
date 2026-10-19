// The arithmetic behind a household's "who owes what" tab. Plain
// functions on integer cents, so every split adds back up exactly.

// $100 between three people is 33.34 + 33.33 + 33.33: the leftover cents
// go one each to the first people listed, so the shares always sum to
// the total and nobody is off by more than a cent.
function splitEqually(totalCents, userIds) {
  const n = userIds.length;
  const base = Math.floor(totalCents / n);
  let extra = totalCents - base * n;
  return userIds.map((userId) => {
    const amountCents = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    return { userId, amountCents };
  });
}

// entries: [{ paidBy, amountCents, shares: [{ userId, amountCents }] }]
// -> Map userId -> net cents. Positive: others owe them. Negative: they
// owe. A payment is an entry too: the payer paid, the receiver's share is
// the whole amount, which moves both of them toward zero.
// A person who deleted their account has userId null; their part still
// counts, under null, so everyone else's balance stays right.
function netBalances(entries) {
  const net = new Map();
  const add = (id, cents) => net.set(id, (net.get(id) || 0) + cents);
  for (const e of entries) {
    add(e.paidBy, e.amountCents);
    for (const s of e.shares) add(s.userId, -s.amountCents);
  }
  return net;
}

// The fewest payments that clear every balance: the person owed most is
// paid by the person who owes most, then repeat. (Fewest isn't always
// optimal in theory, but for a household it's what people expect, and
// it never has anyone pay someone who also owes them.)
function settleUp(net) {
  const owed = [];
  const owes = [];
  for (const [userId, cents] of net) {
    if (cents > 0) owed.push({ userId, cents });
    else if (cents < 0) owes.push({ userId, cents: -cents });
  }
  const biggestFirst = (a, b) => b.cents - a.cents || String(a.userId).localeCompare(String(b.userId));
  owed.sort(biggestFirst);
  owes.sort(biggestFirst);
  const payments = [];
  let i = 0;
  let j = 0;
  while (i < owes.length && j < owed.length) {
    const amountCents = Math.min(owes[i].cents, owed[j].cents);
    payments.push({ from: owes[i].userId, to: owed[j].userId, amountCents });
    owes[i].cents -= amountCents;
    owed[j].cents -= amountCents;
    if (owes[i].cents === 0) i++;
    if (owed[j].cents === 0) j++;
  }
  return payments;
}

module.exports = { splitEqually, netBalances, settleUp };
