import type { ReactNode } from 'react';

export function MetricCard({
  label,
  value,
  caption,
  tone,
  icon
}: {
  label: string;
  value: string;
  caption: string;
  tone: 'income' | 'expense' | 'neutral';
  icon: ReactNode;
}) {
  return (
    <article className={`dashboard-metric dashboard-metric--${tone}`}>
      <div className="dashboard-metric__top">
        <span className="dashboard-metric__label">{label}</span>
        <span className="dashboard-metric__icon" aria-hidden="true">{icon}</span>
      </div>
      <strong className="dashboard-metric__value">{value}</strong>
      <span className="dashboard-metric__caption">{caption}</span>
    </article>
  );
}
