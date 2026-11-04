'use client';

import { useState, type FormEvent } from 'react';
import { LoaderCircle, Save, X } from 'lucide-react';
import { categoryLabels } from '@/features/finance/format';
import type { FinanceCategory, FinanceTransaction } from '@/features/finance/types';
import { transactionUpdateSchema, type TransactionUpdateInput } from '@/features/finance/validation';
import { CounterpartySelector } from './counterparty-selector';

const incomeCategories: FinanceCategory[] = ['SALES', 'SERVICES', 'OTHER'];
const expenseCategories: FinanceCategory[] = ['TAXES', 'RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'TRANSPORT', 'SUPPLIERS', 'OTHER'];

export function TransactionEditor({
  transaction,
  onSaveAction,
  onCancelAction
}: {
  transaction: FinanceTransaction;
  onSaveAction: (input: TransactionUpdateInput) => Promise<void>;
  onCancelAction: () => void;
}) {
  const [type, setType] = useState(transaction.type);
  const [category, setCategory] = useState(transaction.category);
  const [subcategory, setSubcategory] = useState(transaction.subcategory ?? '');
  const [description, setDescription] = useState(transaction.description);
  const [amount, setAmount] = useState(transaction.amount.toFixed(2).replace('.', ','));
  const [occurredAt, setOccurredAt] = useState(transaction.occurredAt.slice(0, 10));
  const [dueAt, setDueAt] = useState(transaction.dueAt?.slice(0, 10) ?? '');
  const [status, setStatus] = useState<'PAID' | 'PENDING'>(
    transaction.status === 'PENDING' || transaction.status === 'OVERDUE' ? 'PENDING' : 'PAID'
  );
  const [counterpartyId, setCounterpartyId] = useState<string | null>(transaction.counterpartyId);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const categories = type === 'INCOME' ? incomeCategories : expenseCategories;

  function changeType(nextType: 'INCOME' | 'EXPENSE') {
    setType(nextType);
    setCategory(nextType === 'INCOME' ? 'SALES' : 'TAXES');
    setCounterpartyId(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const parsed = transactionUpdateSchema.safeParse({
      type,
      category,
      subcategory: subcategory.trim() || null,
      description,
      amount,
      occurredAt,
      dueAt: dueAt || null,
      counterpartyId,
      status
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira os dados informados.');
      return;
    }

    setSaving(true);
    try {
      await onSaveAction(parsed.data);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o lançamento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="transaction-editor" onSubmit={handleSubmit} noValidate>
      <fieldset className="transaction-type" disabled={saving}>
        <legend className="sr-only">Tipo de lançamento</legend>
        <label className={type === 'INCOME' ? 'is-selected' : ''}>
          <input type="radio" name={`edit-type-${transaction.id}`} value="INCOME" checked={type === 'INCOME'} onChange={() => changeType('INCOME')} />
          Receita
        </label>
        <label className={type === 'EXPENSE' ? 'is-selected' : ''}>
          <input type="radio" name={`edit-type-${transaction.id}`} value="EXPENSE" checked={type === 'EXPENSE'} onChange={() => changeType('EXPENSE')} />
          Despesa
        </label>
      </fieldset>
      <div className="transaction-form__grid">
        <label className="dashboard-field dashboard-field--wide">
          <span>Descrição</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={160} autoComplete="off" disabled={saving} />
        </label>
        <label className="dashboard-field">
          <span>Valor (R$)</span>
          <input type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} autoComplete="off" disabled={saving} />
        </label>
        <label className="dashboard-field">
          <span>Data do lançamento</span>
          <input type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} disabled={saving} />
        </label>
        <label className="dashboard-field">
          <span>Categoria</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as FinanceCategory)} disabled={saving}>
            {categories.map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}
          </select>
        </label>
        <label className="dashboard-field">
          <span>Subcategoria (opcional)</span>
          <input value={subcategory} onChange={(event) => setSubcategory(event.target.value)} maxLength={80} autoComplete="off" disabled={saving} />
        </label>
        <label className="dashboard-field">
          <span>Situação</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as 'PAID' | 'PENDING')} disabled={saving}>
            <option value="PAID">Pago</option>
            <option value="PENDING">Pendente</option>
          </select>
        </label>
        <label className="dashboard-field">
          <span>Vencimento (opcional)</span>
          <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} disabled={saving} />
        </label>
        <CounterpartySelector entryType={type} value={counterpartyId} selectedCounterparty={transaction.counterparty} disabled={saving} onChangeAction={setCounterpartyId} />
      </div>
      {error ? <p className="notice notice--error transaction-form__error" role="alert">{error}</p> : null}
      <div className="transaction-editor__actions">
        <button className="dashboard-submit" type="submit" disabled={saving}>
          {saving ? <LoaderCircle className="spinner" size={16} /> : <Save size={16} aria-hidden="true" />}
          {saving ? 'Salvando…' : 'Salvar alterações'}
        </button>
        <button className="transaction-history__reset" type="button" onClick={onCancelAction} disabled={saving} aria-label="Cancelar edição">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
