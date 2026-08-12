export default function StatCard({ label, value, hint, tone }) {
  const toneClass = tone ? ` ${tone}` : '';
  return (
    <div className="card stat-card">
      <div className="label">{label}</div>
      <div className={`value${toneClass}`}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
