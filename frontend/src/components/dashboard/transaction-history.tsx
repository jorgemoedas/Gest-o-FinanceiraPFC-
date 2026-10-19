'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Filter, LoaderCircle, RotateCcw } from 'lucide-react';
import { categoryLabels, formatCurrency, formatDate } from '@/features/finance/format';
import { getFinanceTransactions } from '@/features/finance/finance-client';
import { transactionListQuerySchema } from '@/features/finance/validation';
import type { FinanceCategory, FinanceEntryType, FinanceTransactionList, FinanceTransactionListQuery } from '@/features/finance/types';

type FilterDraft = {
  search: string;
  type: '' | FinanceEntryType;
  category: '' | FinanceCategory;
  from: string;
  to: string;
};

const emptyDraft: FilterDraft = { search: '', type: '', category: '', from: '', to: '' };
const baseQuery: FinanceTransactionListQuery = { page: 1, limit: 20 };
const incomeCategories: FinanceCategory[] = ['SALES', 'SERVICES', 'OTHER'];
const expenseCategories: FinanceCategory[] = ['TAXES', 'RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'TRANSPORT', 'SUPPLIERS', 'OTHER'];
const allCategories: FinanceCategory[] = [...incomeCategories, ...expenseCategories.filter((category) => !incomeCategories.includes(category))];

export function TransactionHistory({ refreshKey }: { refreshKey: number }) {
  const [draft, setDraft] = useState<FilterDraft>(emptyDraft);
  const [query, setQuery] = useState<FinanceTransactionListQuery>(baseQuery);
  const [result, setResult] = useState<FinanceTransactionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterError, setFilterError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setResult(null);
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
      ...(draft.from ? { from: draft.from } : {}),
      ...(draft.to ? { to: draft.to } : {})
    });
    if (!parsed.success) {
      setFilterError(parsed.error.issues[0]?.message ?? 'Confira os filtros informados.');
      return;
    }
    setFilterError('');
    setQuery(parsed.data);
  }

  function resetFilters() {
    setDraft(emptyDraft);
    setFilterError('');
    setQuery(baseQuery);
  }

  function changePage(page: number) {
    setQuery((current) => ({ ...current, page }));
  }

  const totalPages = result?.totalPages ?? 0;
  const currentPage = result?.page ?? query.page;
  const firstShown = result && result.total > 0 ? (result.page - 1) * result.limit + 1 : 0;
  const lastShown = result ? Math.min(result.page * result.limit, result.total) : 0;

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

      {filterError ? <p className="notice notice--error transaction-history__error" role="alert">{filterError}</p> : null}
      {error ? <p className="notice notice--error transaction-history__error" role="alert">{error}</p> : null}

      {loading ? (
        <div className="transaction-history__status" role="status"><LoaderCircle className="spinner" size={18} /> Carregando movimentações…</div>
      ) : result && result.items.length > 0 ? (
        <>
          <ul className="transaction-history__list" aria-live="polite">
            {result.items.map((item) => (
              <li className="transaction-history__row" key={item.id}>
                <div className="transaction-history__details">
                  <strong>{item.description}</strong>
                  <small>{categoryLabels[item.category]} <span aria-hidden="true">·</span> {formatDate(item.occurredAt)}</small>
                </div>
                <span className={`transaction-history__type transaction-history__type--${item.type.toLowerCase()}`}>
                  {item.type === 'INCOME' ? 'Receita' : 'Despesa'}
                </span>
                <strong className={`transaction-history__amount transaction-history__amount--${item.type.toLowerCase()}`}>
                  {item.type === 'INCOME' ? '+' : '−'}{formatCurrency(item.amount)}
                </strong>
              </li>
            ))}
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
