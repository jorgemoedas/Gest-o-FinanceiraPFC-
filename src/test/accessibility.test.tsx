/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';
import { RegisterForm } from '@/components/auth/register-form';
import { TransactionForm } from '@/components/dashboard/transaction-form';
import { TransactionEditor } from '@/components/dashboard/transaction-editor';
import { TransactionHistory } from '@/components/dashboard/transaction-history';
import { BulkTransactionEditor } from '@/components/dashboard/bulk-transaction-editor';
import { CounterpartySelector } from '@/components/dashboard/counterparty-selector';
import { FinanceDashboard } from '@/components/dashboard/finance-dashboard';
import { RecurrencePanel } from '@/components/dashboard/recurrence-panel';
import { TransactionAttachments } from '@/components/dashboard/transaction-attachments';
import { AnalyticsPanel } from '@/components/dashboard/analytics-panel';
import { FiscalCalendarPanel } from '@/components/dashboard/fiscal-calendar-panel';
import { PrivacyPanel } from '@/components/dashboard/privacy-panel';
import type { FinanceTransaction } from '@/features/finance/types';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => <a {...props}>{children}</a>
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() })
}));

vi.mock('@/features/auth/auth-client', () => ({
  login: vi.fn().mockResolvedValue(undefined),
  register: vi.fn().mockResolvedValue(undefined),
  getCurrentUser: vi.fn().mockResolvedValue({
    id: '11111111-1111-4111-8111-111111111111',
    email: 'gestao@empresa.com.br',
    companyId: '22222222-2222-4222-8222-222222222222',
    role: 'OWNER'
  }),
  logout: vi.fn().mockResolvedValue(undefined)
}));

const fixtures = vi.hoisted(() => {
  const counterparty = {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Cliente Exemplo',
    role: 'CUSTOMER' as const,
    cnpj: null,
    legalName: null,
    tradeName: null,
    source: null,
    consultedAt: null
  };
  const transaction = {
    id: '44444444-4444-4444-8444-444444444444',
    version: 1,
    type: 'INCOME' as const,
    category: 'SALES' as const,
    subcategory: null,
    counterpartyId: counterparty.id,
    counterparty,
    description: 'Venda de produtos',
    amount: 1250,
    occurredAt: '2026-10-10T12:00:00.000Z',
    dueAt: null,
    hasAdjustment: false,
    status: 'PAID' as const
  };
  return { counterparty, transaction };
});

const transaction = fixtures.transaction as FinanceTransaction;

vi.mock('@/features/finance/finance-client', () => ({
  getFinanceCounterparties: vi.fn().mockResolvedValue({ page: 1, limit: 100, total: 1, totalPages: 1, items: [fixtures.counterparty] }),
  createFinanceCounterparty: vi.fn().mockResolvedValue(fixtures.counterparty),
  createFinanceTransaction: vi.fn().mockResolvedValue(fixtures.transaction),
  getFinanceDashboard: vi.fn().mockResolvedValue({
    currency: 'BRL',
    period: { months: 6, from: '2026-05-01T00:00:00.000Z', to: '2026-10-31T23:59:59.999Z' },
    comparison: null,
    summary: { income: 1250, expense: 300, net: 950, transactionCount: 1 },
    openBalances: {
      receivables: { amount: 0, count: 0 },
      payables: { amount: 0, count: 0 },
      overdueReceivables: { amount: 0, count: 0 },
      overduePayables: { amount: 0, count: 0 }
    },
    monthly: [
      { month: '2026-09', label: 'set/2026', income: 0, expense: 0, net: 0 },
      { month: '2026-10', label: 'out/2026', income: 1250, expense: 300, net: 950 }
    ],
    expensesByCategory: [{ category: 'RENT', amount: 300, sharePercent: 100 }],
    recentTransactions: [fixtures.transaction]
  }),
  getFinanceTransactions: vi.fn().mockResolvedValue({ page: 1, limit: 20, total: 1, totalPages: 1, items: [fixtures.transaction] }),
  updateFinanceTransaction: vi.fn().mockResolvedValue(fixtures.transaction),
  cancelFinanceTransaction: vi.fn().mockResolvedValue({ cancelled: true, adjustmentKind: null, reversalId: null }),
  refundFinanceTransaction: vi.fn().mockResolvedValue({ refunded: true, adjustmentId: '55555555-5555-4555-8555-555555555555' }),
  generateFinanceInsights: vi.fn().mockResolvedValue({ generated: false, model: null, insights: '' })
}));

vi.mock('@/features/business-registry/business-registry-client', () => ({
  lookupBusinessRegistry: vi.fn().mockResolvedValue({
    cnpj: '12345678000195',
    legalName: 'Empresa Exemplo LTDA',
    tradeName: 'Empresa Exemplo',
    status: 'ATIVA'
  }),
  normalizeCnpjInput: (value: string) => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}));

vi.mock('@/features/finance/recurrence', () => ({
  listFinanceRecurrences: vi.fn().mockResolvedValue({ items: [] }),
  createFinanceRecurrence: vi.fn().mockResolvedValue({}),
  runDueFinanceRecurrences: vi.fn().mockResolvedValue({ generated: 0, skipped: 0 }),
  setFinanceRecurrenceActive: vi.fn().mockResolvedValue({})
}));

vi.mock('@/features/finance/attachments', () => ({
  allowedAttachmentContentTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/csv', 'text/plain'],
  MAX_ATTACHMENT_BYTES: 5 * 1024 * 1024,
  listTransactionAttachments: vi.fn().mockResolvedValue([]),
  uploadTransactionAttachment: vi.fn(),
  deleteTransactionAttachment: vi.fn()
}));

vi.mock('@/features/finance/analytics', () => ({
  getFinanceAnalytics: vi.fn().mockResolvedValue({
    currency: 'BRL',
    period: { from: '2026-05-01T00:00:00.000Z', to: '2026-10-31T23:59:59.999Z', months: 6 },
    monthly: [{ monthKey: '2026-10', income: 1250, expense: 300, net: 950, transactionCount: 1 }],
    trend: {
      income: { direction: 'UP', slopePerMonth: 10, changePercent: 12, explanation: 'Receita em crescimento.' },
      expense: { direction: 'FLAT', slopePerMonth: 0, changePercent: 0, explanation: 'Despesa estável.' },
      net: { direction: 'UP', slopePerMonth: 10, changePercent: 8, explanation: 'Saldo positivo.' }
    },
    seasonality: { index: null, monthsObserved: 1, explanation: 'Base histórica curta.' },
    projection: [{ monthKey: '2026-11', income: 1000, expense: 250, net: 750 }],
    projectionAssumptions: ['A projeção usa a média recente.'],
    alerts: []
  })
}));

vi.mock('@/features/fiscal/calendar', () => ({
  getFiscalCalendar: vi.fn().mockResolvedValue({ items: [], summary: { pending: 0, overdue: 0, dueSoon: 0, done: 0 } }),
  createFiscalObligation: vi.fn(),
  updateFiscalObligationStatus: vi.fn(),
  generateDefaultFiscalCalendar: vi.fn().mockResolvedValue({ created: 0, skipped: 0 })
}));
vi.mock('@/features/fiscal/export', () => ({ downloadFiscalCsv: vi.fn(), downloadFiscalPdf: vi.fn() }));
vi.mock('@/features/privacy/privacy-client', () => ({
  exportPrivacyData: vi.fn().mockResolvedValue({ account: {}, transactions: [] }),
  erasePrivacyData: vi.fn().mockResolvedValue({ retained: [] })
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function audit(container: HTMLElement) {
  const result = await axe(container);
  const blockingViolations = result.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
  expect({ ...result, violations: blockingViolations }).toHaveNoViolations();
  return result.violations;
}

describe('RNF06 — auditoria automatizada de acessibilidade', () => {
  it('audita o shell, login e cadastro', async () => {
    const shell = render(<AuthShell variant="login"><LoginForm /></AuthShell>);
    await audit(shell.container);
    shell.unmount();

    const register = render(<AuthShell variant="register"><RegisterForm documentVersions={{ termsVersion: '2026.1', privacyVersion: '2026.1' }} /></AuthShell>);
    await audit(register.container);
  });

  it('audita o formulário de lançamento e o editor de lançamento', async () => {
    const form = render(<TransactionForm onSubmitAction={vi.fn().mockResolvedValue(undefined)} />);
    await waitFor(() => expect(screen.getByLabelText('Cliente (opcional)')).toBeInTheDocument());
    await audit(form.container);
    form.unmount();

    const editor = render(<TransactionEditor transaction={transaction} onSaveAction={vi.fn().mockResolvedValue(undefined)} onCancelAction={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Descrição')).toHaveValue('Venda de produtos'));
    await audit(editor.container);
  });

  it('audita Dashboard, histórico, edição em lote e anulação/reembolso', async () => {
    const dashboard = render(<FinanceDashboard />);
    await screen.findByText('Histórico financeiro');
    await audit(dashboard.container);
    dashboard.unmount();

    const history = render(<TransactionHistory refreshKey={0} canEdit onMutatedAction={vi.fn()} />);
    const checkbox = await screen.findByRole('checkbox', { name: 'Selecionar Venda de produtos para edição em lote' });
    await audit(history.container);
    await userEvent.setup().click(checkbox);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Editar selecionados (1)' }));
    expect(screen.getByRole('region', { name: 'Editar 1 lançamentos selecionados' })).toBeInTheDocument();
    await audit(history.container);
    await userEvent.setup().keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Editar 1 lançamentos selecionados' })).not.toBeInTheDocument();
  });

  it('audita seletor de clientes e fornecedores e fecha o painel por Escape', async () => {
    const user = userEvent.setup();
    const view = render(<CounterpartySelector entryType="INCOME" value={null} onChangeAction={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('option', { name: /Cliente Exemplo/ })).toBeInTheDocument());
    await audit(view.container);
    await user.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
    expect(screen.getByRole('region', { name: 'Novo cadastro de cliente ou fornecedor' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Novo cadastro de cliente ou fornecedor' })).not.toBeInTheDocument();
  });

  it('audita recorrência, anexos, analítico, calendário fiscal e privacidade', async () => {
    const recurrence = render(<RecurrencePanel />);
    await screen.findByText('Nenhuma regra de recorrência cadastrada.');
    await audit(recurrence.container);
    recurrence.unmount();

    const attachments = render(<TransactionAttachments transactionId={transaction.id} />);
    await screen.findByText('Nenhum anexo neste lançamento.');
    await audit(attachments.container);
    attachments.unmount();

    const analytics = render(<AnalyticsPanel months={6} projectionMonths={3} />);
    await screen.findByText('Tendências e projeções');
    await waitFor(() => expect(screen.queryByText('Carregando análise…')).not.toBeInTheDocument());
    await audit(analytics.container);
    analytics.unmount();

    const calendar = render(<FiscalCalendarPanel />);
    await screen.findByText('Nenhuma obrigação encontrada no período.');
    await audit(calendar.container);
    calendar.unmount();

    const privacy = render(<PrivacyPanel />);
    await audit(privacy.container);
  });

  it('fecha o editor em lote por Escape sem criar armadilha de foco', async () => {
    const user = userEvent.setup();
    const view = render(<BulkTransactionEditor transactions={[transaction]} onCloseAction={vi.fn()} onSuccessAction={vi.fn()} />);
    await audit(view.container);
    await user.selectOptions(screen.getByLabelText('Categoria (opcional)'), 'SALES');
    await user.click(screen.getByRole('button', { name: 'Revisar alterações' }));
    expect(screen.getByText(/Confirme a aplicação/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Revisar alterações' })).toBeInTheDocument();
    expect(document.activeElement).not.toBe(view.container);
  });

  it('mantém a ordem de foco previsível nos controles principais', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    const email = screen.getByRole('textbox', { name: 'E-mail' });
    const password = screen.getByLabelText('Senha');
    const submit = screen.getByRole('button', { name: 'Entrar na conta' });
    email.focus();
    expect(document.activeElement).toBe(email);
    await user.tab();
    expect(document.activeElement).toBe(password);
    await user.tab();
    expect(document.activeElement).toHaveAttribute('aria-label', 'Mostrar senha');
    await user.tab();
    expect(document.activeElement).toBe(submit);
  });
});
