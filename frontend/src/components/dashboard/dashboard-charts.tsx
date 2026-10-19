'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { categoryLabels, formatAxisMoney, formatCurrency } from '@/features/finance/format';
import type { FinanceCategory, FinanceDashboard } from '@/features/finance/types';

const categoryColors: Record<FinanceCategory, string> = {
  SALES: '#478561',
  SERVICES: '#78a989',
  TAXES: '#ce8b50',
  RENT: '#8295a2',
  PAYROLL: '#ba6b5a',
  UTILITIES: '#b9a063',
  MARKETING: '#8a78a8',
  TRANSPORT: '#5d97a0',
  SUPPLIERS: '#718b73',
  OTHER: '#a0a49a'
};

function EmptyChart({ children }: { children: string }) {
  return <div className="dashboard-chart-empty"><span className="dashboard-chart-empty__line" aria-hidden="true" />{children}</div>;
}

export function CashFlowChart({ report }: { report: FinanceDashboard }) {
  const hasRows = report.summary.transactionCount > 0;
  return (
    <section className="dashboard-panel dashboard-panel--cashflow" aria-labelledby="cashflow-title">
      <div className="dashboard-panel__heading">
        <div>
          <p className="dashboard-panel__kicker">MOVIMENTO</p>
          <h2 id="cashflow-title">Entradas e saídas</h2>
        </div>
        <span className="dashboard-panel__period">Últimos {report.period.months} meses</span>
      </div>
      {hasRows ? (
        <>
          <div className="dashboard-chart dashboard-chart--cashflow" role="img" aria-label="Gráfico mensal de entradas, saídas e saldo">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={report.monthly} margin={{ top: 12, right: 8, left: 8, bottom: 2 }}>
                <CartesianGrid stroke="#e8ebe5" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#768179', fontSize: 11 }} tickMargin={10} />
                <YAxis width={65} tickLine={false} axisLine={false} tick={{ fill: '#768179', fontSize: 10 }} tickFormatter={formatAxisMoney} />
                <Tooltip
                  cursor={{ fill: 'rgba(22, 61, 46, 0.045)' }}
                  labelFormatter={(label) => `Mês: ${String(label)}`}
                  formatter={(value, name) => [formatCurrency(Number(value ?? 0)), name === 'income' ? 'Entradas' : name === 'expense' ? 'Saídas' : 'Saldo']}
                  contentStyle={{ border: '1px solid #dfe4dc', borderRadius: 9, background: '#fffefa', fontSize: 12 }}
                />
                <Bar dataKey="income" name="income" fill="#397553" radius={[4, 4, 0, 0]} maxBarSize={27} />
                <Bar dataKey="expense" name="expense" fill="#c58a51" radius={[4, 4, 0, 0]} maxBarSize={27} />
                <Line dataKey="net" name="net" type="monotone" stroke="#213f31" strokeWidth={2} dot={{ r: 3, fill: '#213f31' }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="dashboard-chart-legend" aria-label="Legenda do gráfico">
            <span><i className="legend-swatch legend-swatch--income" />Entradas</span>
            <span><i className="legend-swatch legend-swatch--expense" />Saídas</span>
            <span><i className="legend-swatch legend-swatch--net" />Saldo</span>
          </div>
        </>
      ) : (
        <EmptyChart>Os valores aparecerão aqui depois do primeiro lançamento.</EmptyChart>
      )}
    </section>
  );
}

export function ExpenseCategoryChart({ report }: { report: FinanceDashboard }) {
  const hasExpenses = report.expensesByCategory.length > 0;
  return (
    <section className="dashboard-panel dashboard-panel--categories" aria-labelledby="categories-title">
      <div className="dashboard-panel__heading">
        <div>
          <p className="dashboard-panel__kicker">COMPOSIÇÃO</p>
          <h2 id="categories-title">Despesas por categoria</h2>
        </div>
      </div>
      {hasExpenses ? (
        <>
          <div className="dashboard-chart dashboard-chart--donut" role="img" aria-label="Gráfico da proporção das despesas por categoria">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={report.expensesByCategory} dataKey="amount" nameKey="category" cx="50%" cy="50%" innerRadius={60} outerRadius={91} paddingAngle={2} stroke="#fffefa" strokeWidth={2}>
                  {report.expensesByCategory.map((row) => <Cell key={row.category} fill={categoryColors[row.category]} />)}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [formatCurrency(Number(value ?? 0)), categoryLabels[String(name) as FinanceCategory] ?? String(name)]}
                  contentStyle={{ border: '1px solid #dfe4dc', borderRadius: 9, background: '#fffefa', fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="dashboard-donut-center" aria-hidden="true">
              <span>Total</span>
              <strong>{formatCurrency(report.summary.expense)}</strong>
            </div>
          </div>
          <ul className="dashboard-category-list">
            {report.expensesByCategory.map((row) => (
              <li key={row.category}>
                <span className="dashboard-category-list__name"><i style={{ backgroundColor: categoryColors[row.category] }} />{categoryLabels[row.category]}</span>
                <span className="dashboard-category-list__amount">{formatCurrency(row.amount)}</span>
                <span className="dashboard-category-list__share">{row.sharePercent.toLocaleString('pt-BR')}%</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyChart>Nenhuma despesa registrada neste período.</EmptyChart>
      )}
    </section>
  );
}
