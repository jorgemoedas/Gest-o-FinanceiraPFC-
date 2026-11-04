'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Ban, Check, ChevronLeft, ChevronRight, Filter, LoaderCircle, Pencil, RotateCcw, X } from 'lucide-react';
import { categoryLabels, formatCurrency, formatDate, transactionStatusLabels } from '@/features/finance/format';
import { cancelFinanceTransaction, getFinanceTransactions, refundFinanceTransaction, updateFinanceTransaction } from '@/features/finance/finance-client';
import { transactionListQuerySchema } from '@/features/finance/validation';
import type { FinanceCategory, FinanceEntryType, FinanceTransaction, FinanceTransactionList, FinanceTransactionListQuery, FinanceTransactionStatus } from '@/features/finance/types';
import type { TransactionUpdateInput } from '@/features/finance/validation';
import { BulkTransactionEditor } from './bulk-transaction-editor';
import { TransactionEditor } from './transaction-editor';
import { TransactionAttachments } from './transaction-attachments';

type FilterDraft = {
  search: string;
  type: '' | FinanceEntryType;
  category: '' | FinanceCategory;
  status: '' | FinanceTransactionStatus;
  from: string;
  to: string;
};
type TransactionAction = 'cancel' | 'void' | 'refund';

const emptyDraft: FilterDraft = { search: '', type: '', category: '', status: '', from: '', to: '' };
const baseQuery: FinanceTransactionListQuery = { page: 1, limit: 20 };
const incomeCategories: FinanceCategory[] = ['SALES', 'SERVICES', 'OTHER'];
const expenseCategories: FinanceCategory[] = ['TAXES', 'RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'TRANSPORT', 'SUPPLIERS', 'OTHER'];
const allCategories: FinanceCategory[] = [...incomeCategories, ...expenseCategories.filter((category) => !incomeCategories.includes(category))];

export function TransactionHistory({
  refreshKey,
  canEdit,
  onMutatedAction
}: {
  refreshKey: number;
  canEdit: boolean;
  onMutatedAction: () => void;
}) {
  const [draft, setDraft] = useState<FilterDraft>(emptyDraft);
  const [query, setQuery] = useState<FinanceTransactionListQuery>(baseQuery);
  const [result, setResult] = useState<FinanceTransactionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterError, setFilterError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [mutationNotice, setMutationNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingAction, setConfirmingAction] = useState<{ id: string; action: TransactionAction } | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setResult(null);
    setSelectedIds([]);
    setBulkEditorOpen(false);
    void getFinanceTransactions(query)
      .then((response) => {
        if (active) setResult(response);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o histórico.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [query, refreshKey]);

  useEffect(() => {
    function closeTransientPanel(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (bulkEditorOpen) {
        event.preventDefault();
        setBulkEditorOpen(false);
        setSelectedIds([]);
        return;
      }
      if (confirmingAction) {
        event.preventDefault();
        setConfirmingAction(null);
        return;
      }
      if (editingId) {
        event.preventDefault();
        setEditingId(null);
      }
    }

    window.addEventListener('keydown', closeTransientPanel);
    return () => window.removeEventListener('keydown', closeTransientPanel);
  }, [bulkEditorOpen, confirmingAction, editingId]);

  const visibleCategories = draft.type === 'INCOME'
    ? incomeCategories
    : draft.type === 'EXPENSE'
      ? expenseCategories
      : allCategories;

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = transactionListQuerySchema.safeParse({
      ...baseQuery,
      ...(draft.search.trim() ? { search: draft.search } : {}),
      ...(draft.type ? { type: draft.type } : {}),
      ...(draft.category ? { category: draft.category } : {}),
      ...(draft.status ? { status: draft.status } : {}),
      ...(draft.from ? { from: draft.from } : {}),
      ...(draft.to ? { to: draft.to } : {})
    });
    if (!parsed.success) {
      setFilterError(parsed.error.issues[0]?.message ?? 'Confira os filtros informados.');
      return;
    }
    setFilterError('');
    setMutationError('');
    setMutationNotice('');
    setEditingId(null);
    setConfirmingAction(null);
    setSelectedIds([]);
    setBulkEditorOpen(false);
    setQuery(parsed.data);
  }

  function resetFilters() {
    setDraft(emptyDraft);
    setFilterError('');
    setMutationError('');
    setMutationNotice('');
    setEditingId(null);
    setConfirmingAction(null);
    setSelectedIds([]);
    setBulkEditorOpen(false);
    setQuery(baseQuery);
  }

  function changePage(page: number) {
    setQuery((current) => ({ ...current, page }));
    setEditingId(null);
    setConfirmingAction(null);
    setSelectedIds([]);
    setBulkEditorOpen(false);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function saveEdit(id: string, input: TransactionUpdateInput) {
    setMutatingId(id);
    setMutationError('');
    setMutationNotice('');
    try {
      await updateFinanceTransaction(id, input);
      setEditingId(null);
      setMutationNotice('Alterações salvas e registradas no histórico de auditoria.');
      onMutatedAction();
    } catch (reason: unknown) {
      throw reason;
    } finally {
      setMutatingId(null);
    }
  }

  async function confirmTransactionAction(item: FinanceTransaction, action: TransactionAction) {
    setMutatingId(item.id);
    setMutationError('');
    setMutationNotice('');
    try {
      if (action === 'refund') {
        await refundFinanceTransaction(item.id);
        setMutationNotice('Devolução/reembolso integral registrado como movimentação real; o lançamento original continua no histórico e nos totais.');
      } else {
        const result = await cancelFinanceTransaction(item.id);
        setMutationNotice(result.adjustmentKind === 'VOID'
          ? 'Lançamento anulado por erro. Original e contrapartida permanecem no histórico, mas não compõem os indicadores.'
          : 'Lançamento pendente cancelado e registrado no histórico de auditoria.');
      }
      setConfirmingAction(null);
      onMutatedAction();
    } catch (reason: unknown) {
      setMutationError(reason instanceof Error ? reason.message : 'Não foi possível cancelar o lançamento.');
    } finally {
      setMutatingId(null);
    }
  }

  const totalPages = result?.totalPages ?? 0;
  const currentPage = result?.page ?? query.page;
  const firstShown = result && result.total > 0 ? (result.page - 1) * result.limit + 1 : 0;
  const lastShown = result ? Math.min(result.page * result.limit, result.total) : 0;
  const eligibleItems = result?.items.filter((item) => canEdit && !item.hasAdjustment && (item.status === 'PAID' || item.status === 'PENDING' || item.status === 'OVERDUE')) ?? [];
  const selectedItems = eligibleItems.filter((item) => selectedIds.includes(item.id));

  return (
    <section className="dashboard-panel transaction-history" aria-labelledby="transaction-history-title">
      <div className="dashboard-panel__heading">
        <div>
          <p className="dashboard-panel__kicker">MOVIMENTAÇÕES</p>
          <h2 id="transaction-history-title">Histórico financeiro</h2>
        </div>
        {result ? <span className="dashboard-panel__period">{result.total.toLocaleString('pt-BR')} registros</span> : null}
      </div>

      <form className="transaction-history__filters" onSubmit={applyFilters}>
        <label className="dashboard-field transaction-history__search">
          <span>Buscar descrição</span>
          <input value={draft.search} onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))} maxLength={160} placeholder="Ex.: aluguel, venda" autoComplete="off" />
        </label>
        <label className="dashboard-field">
          <span>Tipo</span>
          <select value={draft.type} onChange={(event) => {
            const type = event.target.value as FilterDraft['type'];
            setDraft((current) => {
              const allowed = type === 'INCOME' ? incomeCategories : type === 'EXPENSE' ? expenseCategories : allCategories;
              const category = current.category && !allowed.includes(current.category) ? '' : current.category;
              return { ...current, type, category };
            });
          }}>
            <option value="">Todos</option>
            <option value="INCOME">Receitas</option>
            <option value="EXPENSE">Despesas</option>
          </select>
        </label>
        <label className="dashboard-field">
          <span>Categoria</span>
          <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as FilterDraft['category'] }))}>
            <option value="">Todas</option>
            {visibleCategories.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}
          </select>
        </label>
        <label className="dashboard-field">
          <span>Situação</span>
          <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as FilterDraft['status'] }))}>
            <option value="">Todas</option>
            <option value="PAID">Pago</option>
            <option value="PENDING">Pendente</option>
            <option value="OVERDUE">Em atraso</option>
            <option value="CANCELLED">Cancelado</option>
            <option value="REVERSED">Anulado</option>
            <option value="REFUNDED">Devolução/reembolso</option>
          </select>
        </label>
        <label className="dashboard-field">
          <span>De</span>
          <input type="date" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} />
        </label>
        <label className="dashboard-field">
          <span>Até</span>
          <input type="date" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} />
        </label>
        <div className="transaction-history__actions">
          <button className="dashboard-submit transaction-history__apply" type="submit" disabled={loading}>
            {loading ? <LoaderCircle className="spinner" size={16} /> : <Filter size={16} aria-hidden="true" />}
            Filtrar
          </button>
          <button className="transaction-history__reset" type="button" onClick={resetFilters} disabled={loading} aria-label="Limpar filtros">
            <RotateCcw size={15} aria-hidden="true" />
          </button>
        </div>
      </form>

      {eligibleItems.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <input
              type="checkbox"
              checked={selectedItems.length === eligibleItems.length && eligibleItems.length > 0}
              onChange={(event) => setSelectedIds(event.target.checked ? eligibleItems.map((item) => item.id) : [])}
              aria-label="Selecionar todos os lançamentos elegíveis desta página"
            />
            Selecionar elegíveis desta página
          </label>
          {selectedItems.length > 0 ? (
            <button type="button" className="dashboard-submit" onClick={() => setBulkEditorOpen(true)} aria-expanded={bulkEditorOpen} aria-controls="bulk-transaction-editor">
              Editar selecionados ({selectedItems.length})
            </button>
          ) : null}
        </div>
      ) : null}
      {bulkEditorOpen && selectedItems.length > 0 ? (
        <BulkTransactionEditor
          transactions={selectedItems}
          onCloseAction={() => setBulkEditorOpen(false)}
          onSuccessAction={() => {
            setBulkEditorOpen(false);
            setSelectedIds([]);
            onMutatedAction();
          }}
        />
      ) : null}

      {filterError ? <p className="notice notice--error transaction-history__error" role="alert">{filterError}</p> : null}
      {error ? <p className="notice notice--error transaction-history__error" role="alert">{error}</p> : null}
      {mutationError ? <p className="notice notice--error transaction-history__error" role="alert">{mutationError}</p> : null}
      {mutationNotice ? <p className="dashboard-notice" role="status">{mutationNotice}</p> : null}

      {loading ? (
        <div className="transaction-history__status" role="status"><LoaderCircle className="spinner" size={18} /> Carregando movimentações…</div>
      ) : result && result.items.length > 0 ? (
        <>
          <ul className="transaction-history__list" aria-live="polite">
            {result.items.map((item) => {
              const editable = canEdit && !item.hasAdjustment && (item.status === 'PAID' || item.status === 'PENDING' || item.status === 'OVERDUE');
              const pending = item.status === 'PENDING' || item.status === 'OVERDUE';
              const action = confirmingAction?.id === item.id ? confirmingAction.action : null;
              return (
                <li className="transaction-history__row" key={item.id}>
                  {editable ? (
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelected(item.id)}
                      aria-label={`Selecionar ${item.description} para edição em lote`}
                    />
                  ) : <span aria-hidden="true" />}
                  <div className="transaction-history__details">
                    <strong>{item.description}</strong>
                    <small>
                      {categoryLabels[item.category]}{item.subcategory ? ` · ${item.subcategory}` : ''} <span aria-hidden="true">·</span> {formatDate(item.occurredAt)}{item.counterparty ? ` · ${item.counterparty.name}` : ''}
                    </small>
                    {item.dueAt ? <small>Vencimento: {formatDate(item.dueAt)}</small> : null}
                  </div>
                  <div className="transaction-history__badges">
                    <span className={`transaction-history__type transaction-history__type--${item.type.toLowerCase()}`}>
                      {item.type === 'INCOME' ? 'Receita' : 'Despesa'}
                    </span>
                    <span className={`transaction-history__status-badge transaction-history__status-badge--${item.status.toLowerCase()}`}>
                      {transactionStatusLabels[item.status]}
                    </span>
                  </div>
                  <strong className={`transaction-history__amount transaction-history__amount--${item.type.toLowerCase()}`}>
                    {item.type === 'INCOME' ? '+' : '−'}{formatCurrency(item.amount)}
                  </strong>
                  {editable ? (
                    <div className="transaction-history__row-actions">
                      <button type="button" onClick={() => { setEditingId(item.id); setConfirmingAction(null); setMutationError(''); setMutationNotice(''); }} disabled={mutatingId === item.id} aria-label={`Editar ${item.description}`} title="Editar lançamento">
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                      {pending ? (
                        <button type="button" onClick={() => { setConfirmingAction({ id: item.id, action: 'cancel' }); setEditingId(null); setMutationError(''); setMutationNotice(''); }} disabled={mutatingId === item.id} aria-label={`Cancelar pendência ${item.description}`} title="Cancelar pendência">
                          <Ban size={15} aria-hidden="true" />
                        </button>
                      ) : (
                        <>
                          <button type="button" onClick={() => { setConfirmingAction({ id: item.id, action: 'void' }); setEditingId(null); setMutationError(''); setMutationNotice(''); }} disabled={mutatingId === item.id} aria-label={`Anular por erro ${item.description}`} title="Anular lançamento incorreto">
                            <Ban size={15} aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => { setConfirmingAction({ id: item.id, action: 'refund' }); setEditingId(null); setMutationError(''); setMutationNotice(''); }} disabled={mutatingId === item.id} aria-label={`Registrar devolução/reembolso ${item.description}`} title="Registrar devolução/reembolso real">
                            <RotateCcw size={15} aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  ) : <span className="transaction-history__row-actions-placeholder" aria-hidden="true" />}
                  {editingId === item.id ? (
                    <>
                      <TransactionEditor
                        transaction={item}
                        onSaveAction={(input) => saveEdit(item.id, input)}
                        onCancelAction={() => setEditingId(null)}
                      />
                      <TransactionAttachments transactionId={item.id} />
                    </>
                  ) : null}
                  {action ? (
                    <div className="transaction-history__confirm" role="group" aria-label="Confirmar ação financeira">
                      <span>{action === 'void'
                        ? 'Anulação por erro: o registro original e a contrapartida ficam no histórico, mas ambos são excluídos dos indicadores. Não use esta opção para registrar devolução de dinheiro.'
                        : action === 'refund'
                          ? `Devolução/reembolso integral de ${formatCurrency(item.amount)} será registrado como ${item.type === 'INCOME' ? 'saída' : 'entrada'} real, com data de hoje e categoria Outros. O original permanece pago e os dois fluxos entram nos indicadores.`
                          : 'A pendência será cancelada, sem criar movimentação de caixa, e permanecerá no histórico de auditoria.'}</span>
                      <button type="button" onClick={() => void confirmTransactionAction(item, action)} disabled={mutatingId === item.id}>
                        {mutatingId === item.id ? <LoaderCircle className="spinner" size={15} /> : <Check size={15} aria-hidden="true" />}
                        {action === 'void' ? 'Confirmar anulação' : action === 'refund' ? 'Registrar devolução' : 'Confirmar cancelamento'}
                      </button>
                      <button type="button" onClick={() => setConfirmingAction(null)} disabled={mutatingId === item.id} aria-label="Manter lançamento">
                        <X size={15} aria-hidden="true" /> Manter
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="transaction-history__pagination">
            <span>Exibindo {firstShown}–{lastShown} de {result.total.toLocaleString('pt-BR')}</span>
            <div className="transaction-history__pagination-controls">
              <button type="button" onClick={() => changePage(currentPage - 1)} disabled={loading || currentPage <= 1} aria-label="Página anterior">
                <ChevronLeft size={16} aria-hidden="true" /> Anterior
              </button>
              <span>Página {currentPage} de {Math.max(totalPages, 1)}</span>
              <button type="button" onClick={() => changePage(currentPage + 1)} disabled={loading || currentPage >= totalPages} aria-label="Próxima página">
                Próxima <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="transaction-history__empty" role="status">
          {error ? 'Não foi possível mostrar as movimentações.' : 'Nenhuma movimentação encontrada para estes filtros.'}
        </p>
      )}
    </section>
  );
}
