'use client';

import type { ReactNode } from 'react';
import type { FinanceDashboardComparison } from '@/features/finance/finance-dashboard-comparison';
import { formatCurrency } from '@/features/finance/format';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

type ComparisonMetric = {
  label: string;
  current: number;
  previous: number;
  change: FinanceDashboardComparison['changes']['income'];
};

type CurrentSummary = {
  income: number;
  expense: number;
  net: number;
};

function formatPeriodDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(value))
    .replace('.', '');
}

function signedCurrency(value: number): string {
  if (value === 0) return formatCurrency(0);
  return `${value > 0 ? '+' : '−'}${formatCurrency(Math.abs(value))}`;
}

function signedPercent(value: number | null): string {
  if (value === null) return 'sem base anterior';
  if (value === 0) return '0%';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

function ChangeIcon({ value }: { value: number }): ReactNode {
  if (value > 0) return <ArrowUpRight size={15} aria-hidden="true" />;
  if (value < 0) return <ArrowDownRight size={15} aria-hidden="true" />;
  return <Minus size={14} aria-hidden="true" />;
}

function ComparisonRow({ label, current, previous, change }: ComparisonMetric) {
  return (
    <div className="dashboard-comparison-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 1.2fr) repeat(3, minmax(88px, 1fr))', gap: 10, alignItems: 'center', padding: '12px 0', borderTop: '1px solid #e7ebe5' }}>
      <strong style={{ color: '#394b3f', fontSize: 12 }}>{label}</strong>
      <span style={{ color: '#59685d', fontSize: 11 }}><small style={{ display: 'block', color: '#89938b', fontSize: 9 }}>Atual</small>{formatCurrency(current)}</span>
      <span style={{ color: '#59685d', fontSize: 11 }}><small style={{ display: 'block', color: '#89938b', fontSize: 9 }}>Anterior</small>{formatCurrency(previous)}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: change.amount > 0 ? '#397553' : change.amount < 0 ? '#a76042' : '#89938b', fontSize: 11, fontWeight: 650 }} title={change.percent === null ? 'Não há percentual quando o valor anterior é zero.' : undefined}>
        <ChangeIcon value={change.amount} />
        <span><small style={{ display: 'block', color: '#89938b', fontSize: 9, fontWeight: 500 }}>Variação</small>{signedCurrency(change.amount)} <em style={{ fontStyle: 'normal', fontWeight: 500 }}>({signedPercent(change.percent)})</em></span>
      </span>
    </div>
  );
}

export function FinanceComparison({ comparison, summary }: { comparison: FinanceDashboardComparison; summary: CurrentSummary }) {
  const { previousPeriod, previousSummary, changes } = comparison;
  const metrics: ComparisonMetric[] = [
    { label: 'Entradas pagas', current: summary.income, previous: previousSummary.income, change: changes.income },
    { label: 'Saídas pagas', current: summary.expense, previous: previousSummary.expense, change: changes.expense },
    { label: 'Saldo do período', current: summary.net, previous: previousSummary.net, change: changes.net }
  ];

  return (
    <section className="dashboard-panel dashboard-panel--comparison" aria-labelledby="comparison-title" style={{ marginBottom: 16 }}>
      <div className="dashboard-panel__heading">
        <div>
          <p className="dashboard-panel__kicker">COMPARATIVO</p>
          <h2 id="comparison-title">Período equivalente anterior</h2>
        </div>
        <span className="dashboard-panel__period">{formatPeriodDate(previousPeriod.from)} — {formatPeriodDate(new Date(new Date(previousPeriod.to).getTime() - 1).toISOString())}</span>
      </div>
      <p style={{ margin: '0 0 10px', color: '#78857b', fontSize: 11, lineHeight: 1.5 }}>
        Compare o período atual com a mesma quantidade de meses-calendário imediatamente anterior. O período atual inclui o mês em curso, que pode estar incompleto; não é uma comparação de iguais quantidades de dias decorridos.
      </p>
      <div style={{ overflowX: 'auto' }}>
        {metrics.map((metric) => <ComparisonRow key={metric.label} {...metric} />)}
      </div>
      <p style={{ margin: '12px 0 0', color: '#9aa39b', fontSize: 10, lineHeight: 1.5 }}>
        Percentuais usam o valor absoluto do período anterior quando a base é negativa; bases zeradas ficam sem percentual.
      </p>
    </section>
  );
}
