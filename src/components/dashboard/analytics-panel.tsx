'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, LoaderCircle, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { getFinanceAnalytics, type AnalyticsReport, type AnalyticsQuery } from '@/features/finance/analytics';
import { formatCurrency } from '@/features/finance/format';

function signedPercent(value: number | null): string {
  if (value === null) return 'sem base percentual';
  return `${value > 0 ? '+' : ''}${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function TrendIcon({ direction }: { direction: AnalyticsReport['trend']['income']['direction'] }) {
  if (direction === 'UP') return <TrendingUp size={15} aria-hidden="true" />;
  if (direction === 'DOWN') return <TrendingDown size={15} aria-hidden="true" />;
  return <Minus size={14} aria-hidden="true" />;
}

function formatMonth(value: string): string {
  const [year, month] = value.split('-');
  return `${month}/${year}`;
}

export function AnalyticsPanel({ months = 6, projectionMonths = 3 }: AnalyticsQuery) {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getFinanceAnalytics({ months, projectionMonths })
      .then((value) => { if (active) setReport(value); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a análise financeira.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [months, projectionMonths]);

  const empty = report !== null && report.monthly.every((item) => item.transactionCount === 0);
  return (
    <section className="dashboard-panel dashboard-panel--analytics" aria-labelledby="analytics-title">
      <div className="dashboard-panel__heading">
        <div>
          <p className="dashboard-panel__kicker">ANÁLISE FINANCEIRA</p>
          <h2 id="analytics-title">Tendências e projeções</h2>
        </div>
        <span className="dashboard-panel__period">{months} meses fechados</span>
      </div>
      {loading ? <p className="dashboard-panel__loading" role="status"><LoaderCircle className="spinner" size={16} /> Carregando análise…</p> : null}
      {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
      {!loading && !error && empty ? <p className="insights-empty" role="status">Não há lançamentos pagos no período para calcular tendências ou projeções.</p> : null}
      {!loading && !error && report && !empty ? (
        <>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            {([['income', 'Receita'], ['expense', 'Despesa'], ['net', 'Saldo líquido']] as const).map(([key, label]) => {
              const trend = report.trend[key];
              return <div key={key} className="dashboard-panel__metric" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}><span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#69746d', fontSize: 11 }}><TrendIcon direction={trend.direction} /> {label} · {trend.direction}</span><strong style={{ display: 'block', marginTop: 5, fontSize: 12 }}>{signedPercent(trend.changePercent)}</strong><p style={{ margin: '7px 0 0', color: '#69746d', fontSize: 11, lineHeight: 1.5 }}>{trend.explanation}</p></div>;
            })}
          </div>
          <div style={{ marginTop: 16 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>Sazonalidade</h3>
            <p style={{ margin: '0 0 8px', color: '#69746d', fontSize: 11 }}>{report.seasonality.explanation}</p>
            {report.seasonality.index ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(50px, 1fr))', gap: 6 }}>{report.seasonality.index.map((item) => <span key={item.month} style={{ padding: 7, borderRadius: 6, background: '#f0f4ef', fontSize: 10, textAlign: 'center' }}>M{item.month}: {item.factor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×</span>)}</div> : null}
          </div>
          <div style={{ marginTop: 16, overflowX: 'auto' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>Projeção · não é previsão garantida</h3>
            <div style={{ display: 'grid', gap: 5, minWidth: 360 }}>
              {report.projection.map((item) => <div key={item.monthKey} style={{ display: 'grid', gridTemplateColumns: '1fr repeat(3, minmax(80px, 1fr))', gap: 8, padding: '7px 0', borderTop: '1px solid var(--line)', fontSize: 11 }}><strong>{formatMonth(item.monthKey)}</strong><span>Receita<br />{formatCurrency(item.income)}</span><span>Despesa<br />{formatCurrency(item.expense)}</span><span>Saldo<br />{formatCurrency(item.net)}</span></div>)}
            </div>
            <ul style={{ margin: '9px 0 0', paddingLeft: 18, color: '#69746d', fontSize: 10, lineHeight: 1.5 }}>{report.projectionAssumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
          </div>
          <div style={{ marginTop: 16 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>Alertas ({report.alerts.length})</h3>
            {report.alerts.length ? <div style={{ display: 'grid', gap: 7 }}>{report.alerts.map((alert) => <article key={`${alert.code}-${alert.source.reference}`} className={alert.severity === 'CRITICAL' ? 'notice notice--error' : 'dashboard-panel__alert'} style={{ padding: 9, borderRadius: 7, border: '1px solid var(--line)' }}><strong style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}><AlertTriangle size={14} aria-hidden="true" /> {alert.title}</strong><p style={{ margin: '5px 0', fontSize: 11, lineHeight: 1.45 }}>{alert.explanation}</p><small style={{ color: '#69746d' }}>Origem: {alert.source.metric} · valor {alert.source.value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} · {alert.source.reference}</small></article>)}</div> : <p style={{ margin: 0, color: '#69746d', fontSize: 11 }}>Nenhum alerta para os critérios deste relatório.</p>}
          </div>
        </>
      ) : null}
    </section>
  );
}
