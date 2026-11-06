'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, X } from 'lucide-react';
import { bulkUpdateFinanceTransactions, bulkUpdateTransactionsRequestSchema, type BulkUpdateTransactionsRequest } from '@/features/finance/bulk';
import { categoryLabels } from '@/features/finance/format';
import type { FinanceCategory, FinanceTransaction } from '@/features/finance/types';

const categories: FinanceCategory[] = ['SALES', 'SERVICES', 'TAXES', 'RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'TRANSPORT', 'SUPPLIERS', 'OTHER'];
const incomeCategories: FinanceCategory[] = ['SALES', 'SERVICES', 'OTHER'];
const expenseCategories: FinanceCategory[] = ['TAXES', 'RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'TRANSPORT', 'SUPPLIERS', 'OTHER'];

type BulkChanges = BulkUpdateTransactionsRequest['changes'];

export function BulkTransactionEditor({
  transactions,
  onCloseAction,
  onSuccessAction
}: {
  transactions: FinanceTransaction[];
  onCloseAction: () => void;
  onSuccessAction: () => void;
}) {
  const [category, setCategory] = useState<FinanceCategory | ''>('');
  const [subcategory, setSubcategory] = useState('');
  const [status, setStatus] = useState<'' | 'PAID' | 'PENDING'>('');
  const [dueAt, setDueAt] = useState('');
  const [clearSubcategory, setClearSubcategory] = useState(false);
  const [clearDueAt, setClearDueAt] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || loading) return;
      event.preventDefault();
      if (confirming) setConfirming(false);
      else onCloseAction();
    }

    window.addEventListener('keydown', closeWithEscape);
    return () => window.removeEventListener('keydown', closeWithEscape);
  }, [confirming, loading, onCloseAction]);

  const changes: BulkChanges = {
    ...(category ? { category } : {}),
    ...(clearSubcategory ? { subcategory: null } : subcategory.trim() ? { subcategory: subcategory.trim() } : {}),
    ...(status ? { status } : {}),
    ...(clearDueAt ? { dueAt: null } : dueAt ? { dueAt: `${dueAt}T00:00:00.000Z` } : {})
  };
  const availableCategories = categories.filter((item) => transactions.every((transaction) => (transaction.type === 'INCOME' ? incomeCategories : expenseCategories).includes(item)));
  const includesPaid = transactions.some((transaction) => transaction.status === 'PAID');

  function requestConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const parsed = bulkUpdateTransactionsRequestSchema.safeParse({
      items: transactions.map(({ id, version }) => ({ id, version })),
      changes
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Escolha ao menos um campo para alterar.');
      return;
    }
    setConfirming(true);
  }

  async function confirm() {
    setLoading(true);
    setError('');
    try {
      await bulkUpdateFinanceTransactions({
        items: transactions.map(({ id, version }) => ({ id, version })),
        changes
      });
      onSuccessAction();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível aplicar as alterações.');
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div id="bulk-transaction-editor" className="transaction-history__confirm" role="region" aria-labelledby="bulk-transaction-title">
      <div style={{ width: '100%' }}>
        <strong id="bulk-transaction-title">Editar {transactions.length} lançamentos selecionados</strong>
        <p>Somente categoria, subcategoria, situação e vencimento serão alterados. Registros cancelados, anulados ou ajustados não são elegíveis.</p>
      </div>
      {!confirming ? (
        <form onSubmit={requestConfirmation} style={{ display: 'grid', width: '100%', gap: 8 }}>
          <label className="dashboard-field"><span>Categoria (opcional)</span><select value={category} onChange={(event) => setCategory(event.target.value as FinanceCategory | '')}><option value="">Não alterar</option>{availableCategories.map((item) => <option key={item} value={item}>{categoryLabels[item]}</option>)}</select></label>
          <label className="dashboard-field"><span>Subcategoria (opcional)</span><input value={subcategory} onChange={(event) => setSubcategory(event.target.value)} disabled={clearSubcategory} maxLength={80} placeholder="Não alterar" /><span><input type="checkbox" checked={clearSubcategory} onChange={(event) => setClearSubcategory(event.target.checked)} /> Limpar subcategoria</span></label>
          <label className="dashboard-field"><span>Situação (opcional)</span><select value={status} onChange={(event) => setStatus(event.target.value as '' | 'PAID' | 'PENDING')}><option value="">Não alterar</option><option value="PAID">Pago</option><option value="PENDING" disabled={includesPaid}>Pendente{includesPaid ? ' (pago não pode voltar)' : ''}</option></select></label>
          <label className="dashboard-field"><span>Vencimento (opcional)</span><input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} disabled={clearDueAt} /><span><input type="checkbox" checked={clearDueAt} onChange={(event) => setClearDueAt(event.target.checked)} /> Limpar vencimento</span></label>
          {error ? <span className="notice notice--error" role="alert">{error}</span> : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCloseAction} disabled={loading}><X size={15} aria-hidden="true" /> Cancelar</button>
            <button type="submit" disabled={loading}><Check size={15} aria-hidden="true" /> Revisar alterações</button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'grid', width: '100%', gap: 8 }}>
          <p>Confirme a aplicação destas alterações em <strong>{transactions.length} lançamentos</strong>. A operação é atômica e exige a versão atual de cada item.</p>
          <ul>
            {category ? <li>Categoria: {categoryLabels[category]}</li> : null}
            {clearSubcategory ? <li>Limpar subcategoria</li> : subcategory.trim() ? <li>Subcategoria: {subcategory.trim()}</li> : null}
            {status ? <li>Situação: {status === 'PAID' ? 'Pago' : 'Pendente'}</li> : null}
            {clearDueAt ? <li>Limpar vencimento</li> : dueAt ? <li>Vencimento: {dueAt}</li> : null}
          </ul>
          {error ? <span className="notice notice--error" role="alert">{error}</span> : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setConfirming(false)} disabled={loading}>Voltar</button>
            <button type="button" onClick={() => void confirm()} disabled={loading}>{loading ? <LoaderCircle className="spinner" size={15} /> : <Check size={15} aria-hidden="true" />} {loading ? 'Aplicando…' : 'Confirmar edição em lote'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
