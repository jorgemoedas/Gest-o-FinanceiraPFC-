'use client';

import { useState, type FormEvent } from 'react';
import { ArrowDownRight, ArrowUpRight, LoaderCircle, Plus } from 'lucide-react';
import { categoryLabels } from '@/features/finance/format';
import { transactionInputSchema } from '@/features/finance/validation';
import type { FinanceCategory } from '@/features/finance/types';
import type { TransactionInput } from '@/features/finance/validation';

const incomeCategories: FinanceCategory[] = ['SALES', 'SERVICES', 'OTHER'];
const expenseCategories: FinanceCategory[] = ['TAXES', 'RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'TRANSPORT', 'SUPPLIERS', 'OTHER'];
const today = new Date().toISOString().slice(0, 10);

export function TransactionForm({ onSubmit }: { onSubmit: (input: TransactionInput) => Promise<void> }) {
  const [type, setType] = useState<'INCOME' | 'EXPENSE'>('INCOME');
  const [category, setCategory] = useState<FinanceCategory>('SALES');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(today);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const categories = type === 'INCOME' ? incomeCategories : expenseCategories;

  function changeType(nextType: 'INCOME' | 'EXPENSE') {
    setType(nextType);
    setCategory(nextType === 'INCOME' ? 'SALES' : 'TAXES');
    setError('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const parsed = transactionInputSchema.safeParse({ type, category, description, amount, occurredAt });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira os dados informados.');
      return;
    }

    setSaving(true);
    try {
      await onSubmit(parsed.data);
      setDescription('');
      setAmount('');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o lançamento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="dashboard-panel dashboard-panel--form" aria-labelledby="transaction-form-title">
      <div className="dashboard-panel__heading">
        <div>
          <p className="dashboard-panel__kicker">REGISTRO</p>
          <h2 id="transaction-form-title">Novo lançamento</h2>
        </div>
      </div>
      <form className="transaction-form" onSubmit={handleSubmit} noValidate>
        <fieldset className="transaction-type" disabled={saving}>
          <legend className="sr-only">Tipo de lançamento</legend>
          <label className={type === 'INCOME' ? 'is-selected' : ''}>
            <input type="radio" name="transaction-type" value="INCOME" checked={type === 'INCOME'} onChange={() => changeType('INCOME')} />
            <ArrowUpRight size={16} aria-hidden="true" /> Receita
          </label>
          <label className={type === 'EXPENSE' ? 'is-selected' : ''}>
            <input type="radio" name="transaction-type" value="EXPENSE" checked={type === 'EXPENSE'} onChange={() => changeType('EXPENSE')} />
            <ArrowDownRight size={16} aria-hidden="true" /> Despesa
          </label>
        </fieldset>

        <div className="transaction-form__grid">
          <label className="dashboard-field dashboard-field--wide">
            <span>Descrição</span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={160} placeholder="Ex.: venda de produtos" autoComplete="off" disabled={saving} />
          </label>
          <label className="dashboard-field">
            <span>Valor (R$)</span>
            <input type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" autoComplete="off" disabled={saving} />
          </label>
          <label className="dashboard-field">
            <span>Data</span>
            <input type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} disabled={saving} />
          </label>
          <label className="dashboard-field dashboard-field--wide">
            <span>Categoria</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as FinanceCategory)} disabled={saving}>
              {categories.map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}
            </select>
          </label>
        </div>

        {error ? <p className="notice notice--error transaction-form__error" role="alert">{error}</p> : null}
        <button className="dashboard-submit" type="submit" disabled={saving}>
          {saving ? <LoaderCircle className="spinner" size={17} /> : <Plus size={17} />}
          {saving ? 'Salvando…' : 'Adicionar lançamento'}
        </button>
        <p className="transaction-form__privacy">A descrição fica no seu cadastro financeiro e não é enviada ao Gemini.</p>
      </form>
    </section>
  );
}
