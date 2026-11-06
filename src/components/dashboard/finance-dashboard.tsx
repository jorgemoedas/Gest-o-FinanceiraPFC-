'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, LoaderCircle, LogOut, RefreshCw, Wallet } from 'lucide-react';
import { BrandMark } from '@/components/auth/auth-shell';
import { getCurrentUser, logout } from '@/features/auth/auth-client';
import type { CurrentUser } from '@/features/auth/types';
import { createFinanceTransaction, getFinanceDashboard } from '@/features/finance/finance-client';
import { formatCurrency, formatDate, transactionStatusLabels } from '@/features/finance/format';
import type { FinanceDashboard } from '@/features/finance/types';
import type { TransactionInput } from '@/features/finance/validation';
import { CashFlowChart, ExpenseCategoryChart } from './dashboard-charts';
import { BusinessRegistryPanel } from './business-registry-panel';
import { InsightsPanel } from './insights-panel';
import { MetricCard } from './metric-card';
import { TransactionForm } from './transaction-form';
import { TransactionHistory } from './transaction-history';
import { TaxEstimatorPanel } from './tax-estimator-panel';
import { FinanceComparison } from './finance-comparison';
import { AnalyticsPanel } from './analytics-panel';
import { FiscalCalendarPanel } from './fiscal-calendar-panel';
import { PrivacyPanel } from './privacy-panel';
import { RecurrencePanel } from './recurrence-panel';
import { useRouter } from 'next/navigation';

const periods = [3, 6, 12] as const;

function isExpiredSession(reason: unknown): boolean {
  return reason instanceof Error && reason.message.toLowerCase().includes('sessão expirou');
}

export function FinanceDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [report, setReport] = useState<FinanceDashboard | null>(null);
  const [months, setMonths] = useState<3 | 6 | 12>(6);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setReport(null);

    void (async () => {
      try {
        const current = await getCurrentUser();
        if (!active) return;
        setUser(current);
        const data = await getFinanceDashboard(months);
        if (active) setReport(data);
      } catch (reason: unknown) {
        if (isExpiredSession(reason)) {
          router.replace('/login');
          return;
        }
        if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o Dashboard.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [months, refreshKey, router]);

  const refreshFinanceData = useCallback(() => setRefreshKey((value) => value + 1), []);

  const handleTransaction = useCallback(async (input: TransactionInput) => {
    await createFinanceTransaction(input);
    setNotice('Lançamento salvo. As métricas serão atualizadas com os dados registrados.');
    refreshFinanceData();
  }, [refreshFinanceData]);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  const comparison = report?.comparison;

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-brand"><BrandMark compact /><span className="dashboard-brand__divider" /><span className="dashboard-brand__section">GESTÃO FINANCEIRA</span></div>
        <div className="dashboard-header__right">
          {user ? <span className="dashboard-user" title={user.email}>{user.email}</span> : null}
          <button className="dashboard-logout" type="button" onClick={handleLogout} disabled={signingOut}>
            {signingOut ? <LoaderCircle className="spinner" size={16} /> : <LogOut size={16} />} Sair
          </button>
        </div>
      </header>

      <div className="dashboard-content">
        <section className="dashboard-hero">
          <div>
            <p className="dashboard-eyebrow">VISÃO DO NEGÓCIO</p>
            <h1>Seu financeiro, em perspectiva.</h1>
            <p className="dashboard-lead">Acompanhe o que entrou, o que saiu e os lançamentos registrados pela sua empresa.</p>
            {user ? <p className="dashboard-company">Empresa <span>{user.companyId}</span> · perfil {user.role}</p> : null}
          </div>
          <div className="dashboard-controls">
            <label htmlFor="dashboard-period">Período</label>
            <select id="dashboard-period" value={months} onChange={(event) => setMonths(Number(event.target.value) as 3 | 6 | 12)} disabled={loading}>
              {periods.map((period) => <option key={period} value={period}>Últimos {period} meses</option>)}
            </select>
            <button className="dashboard-refresh" type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} aria-label="Atualizar dados">
              {loading ? <LoaderCircle className="spinner" size={17} /> : <RefreshCw size={16} />}
            </button>
          </div>
        </section>

        {notice ? <p className="dashboard-notice" role="status">{notice}</p> : null}
        {error ? <div className="notice notice--error dashboard-error" role="alert">{error}</div> : null}
        {loading ? <div className="dashboard-loading" role="status"><LoaderCircle className="spinner" size={19} /> Buscando os dados financeiros da empresa…</div> : null}

        {!loading && report ? (
          <>
            <section className="dashboard-summary" aria-label="Resumo financeiro do período">
              <MetricCard label="Entradas pagas" value={formatCurrency(report.summary.income)} caption="Receitas compensadas no período" tone="income" icon={<ArrowUpRight size={18} />} />
              <MetricCard label="Saídas pagas" value={formatCurrency(report.summary.expense)} caption="Despesas compensadas no período" tone="expense" icon={<ArrowDownRight size={18} />} />
              <MetricCard label="Saldo do período" value={formatCurrency(report.summary.net)} caption={`${report.summary.transactionCount} lançamentos pagos`} tone="neutral" icon={<Wallet size={18} />} />
            </section>

            {comparison ? <FinanceComparison comparison={comparison} summary={report.summary} /> : null}

            <section className="dashboard-open-items" aria-label="Contas a receber e a pagar em aberto">
              <MetricCard
                label="A receber"
                value={formatCurrency(report.openBalances.receivables.amount)}
                caption={`${report.openBalances.receivables.count} em aberto · ${report.openBalances.overdueReceivables.count} em atraso (${formatCurrency(report.openBalances.overdueReceivables.amount)})`}
                tone="income"
                icon={<ArrowUpRight size={18} />}
              />
              <MetricCard
                label="A pagar"
                value={formatCurrency(report.openBalances.payables.amount)}
                caption={`${report.openBalances.payables.count} em aberto · ${report.openBalances.overduePayables.count} em atraso (${formatCurrency(report.openBalances.overduePayables.amount)})`}
                tone="expense"
                icon={<ArrowDownRight size={18} />}
              />
            </section>

            <section className="dashboard-charts" aria-label="Gráficos financeiros">
              <CashFlowChart report={report} />
              <ExpenseCategoryChart report={report} />
            </section>

            <section className="dashboard-lower">
              <section className="dashboard-panel dashboard-panel--recent" aria-labelledby="recent-title">
                <div className="dashboard-panel__heading">
                  <div><p className="dashboard-panel__kicker">REGISTROS</p><h2 id="recent-title">Movimentações recentes</h2></div>
                  <span className="dashboard-panel__period">{report.summary.transactionCount} no período</span>
                </div>
                {report.recentTransactions.length ? (
                  <ul className="recent-list">
                    {report.recentTransactions.map((entry) => (
                      <li className="recent-row" key={entry.id}>
                        <span className={`recent-row__mark recent-row__mark--${entry.type.toLowerCase()}`} aria-hidden="true">{entry.type === 'INCOME' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}</span>
                        <span className="recent-row__details"><strong>{entry.description}</strong><small>{formatDate(entry.occurredAt)} · {transactionStatusLabels[entry.status]}{entry.counterparty ? ` · ${entry.counterparty.name}` : ''}</small></span>
                        <strong className={`recent-row__amount recent-row__amount--${entry.type.toLowerCase()}`}>{entry.type === 'INCOME' ? '+' : '−'}{formatCurrency(entry.amount)}</strong>
                      </li>
                    ))}
                  </ul>
                ) : <p className="dashboard-empty-copy">Ainda não há movimentações no período selecionado.</p>}
              </section>

              <InsightsPanel months={months} transactionCount={report.summary.transactionCount} />
            </section>

            <TransactionHistory refreshKey={refreshKey} canEdit={user?.role !== 'READ_ONLY'} onMutatedAction={refreshFinanceData} />

            <BusinessRegistryPanel canManageProfile={user?.role === 'OWNER' || user?.role === 'ADMIN'} />

            <TaxEstimatorPanel />

            <AnalyticsPanel months={months} projectionMonths={3} />

            <RecurrencePanel onChangedAction={refreshFinanceData} />

            <FiscalCalendarPanel />

            <PrivacyPanel />

            {user?.role === 'READ_ONLY' ? (
              <p className="dashboard-readonly">Seu perfil permite consultar os dados, mas não registrar lançamentos.</p>
            ) : (
              <TransactionForm onSubmitAction={handleTransaction} />
            )}
          </>
        ) : null}

        {!loading && !report && !error ? <p className="dashboard-empty-copy">Não foi possível carregar os dados financeiros.</p> : null}
        <footer className="dashboard-footer">As métricas vêm dos lançamentos persistidos. A consulta de CNPJ é pública; o perfil empresarial só é atualizado após confirmação explícita.</footer>
      </div>
    </main>
  );
}
