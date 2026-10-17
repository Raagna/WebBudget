import { formatMoney } from '../utils/format.js';
import { categoryColor } from '../utils/categoryColors.js';
import { changeVsLastMonth } from '../utils/change.js';

// ok under 80% of the budget, warn from 80%, over past 100%.
function budgetTone(percent) {
  if (percent > 100) return 'over';
  if (percent >= 80) return 'warn';
  return 'ok';
}

export default function BudgetBar({ budget, currency, compact = false }) {
  const tone = budgetTone(budget.percent);
  const change = changeVsLastMonth(budget.spent, budget.lastMonthSpent, currency);
  const label = budget.remaining >= 0
    ? `${formatMoney(budget.remaining, { currency })} left`
    : `${formatMoney(-budget.remaining, { currency })} over`;
  return (
    // The bar fills in the category's own note colour; only "over" turns red.
    <div className={`budget-bar${compact ? ' compact' : ''}`} style={{ '--cat': categoryColor(budget.categoryName) }}>
      <div className="budget-bar-head">
        <span className="budget-name">{budget.categoryName}</span>
        <span className={`budget-left ${tone}`}>{label}</span>
      </div>
      <div className="progress" role="progressbar" aria-label={`${budget.categoryName} budget used`}
           aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(budget.percent, 100)}>
        <span className={tone} style={{ width: `${Math.min(budget.percent, 100)}%` }} />
      </div>
      <div className="budget-sub">
        {formatMoney(budget.spent, { currency })} of {formatMoney(budget.amount, { currency })} · {budget.percent}%
        {change && ` · ${change}`}
      </div>
    </div>
  );
}
