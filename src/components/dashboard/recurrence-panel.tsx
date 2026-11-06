'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, Play, Plus, Power } from 'lucide-react';
import { categoryLabels, formatCurrency, formatDate } from '@/features/finance/format';
import {
  createFinanceRecurrence,
  listFinanceRecurrences,
  runDueFinanceRecurrences,
  setFinanceRecurrenceActive,
  type FinanceRecurrence,
  type RecurrenceCreateRequest
} from '@/features/finance/recurrence';

type Props = { onChangedAction?: () => void };

const incomeCategories = ['SALES', 'SERVICES', 'OTHER'] as const;
const expenseCategories = ['TAXES', 'RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'TRANSPORT', 'SUPPLIERS', 'OTHER'] as const;
const today = () => new Date().toISOString().slice(0, 10);

export function RecurrencePanel({ onChangedAction }: Props) {
  const [items, setItems] = useState<FinanceRecurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [type, setType] = useState<RecurrenceCreateRequest['type']>('INCOME');
  const [category, setCategory] = useState<RecurrenceCreateRequest['category']>('SALES');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<RecurrenceCreateRequest['frequency']>('MONTHLY');
  const [intervalCount, setIntervalCount] = useState('1');
  const [startDate, setStartDate] = useState(today);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listFinanceRecurrences({ page: 1, limit: 50 });
      setItems(result.items);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as recorrências.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function onTypeChange(value: RecurrenceCreateRequest['type']) {
    setType(value);
    setCategory(value === 'INCOME' ? 'SALES' : 'TAXES');
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await createFinanceRecurrence({
        type,
        category,
        description,
        amount: Number(amount),
        frequency,
        intervalCount: Number(intervalCount),
        startDate: `${startDate}T00:00:00.000Z`
      });
      setDescription('');
      setAmount('');
      setNotice('Regra de recorrência criada.');
      await load();
      onChangedAction?.();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível criar a recorrência.');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(item: FinanceRecurrence) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await setFinanceRecurrenceActive(item.id, !item.isActive, item.version);
      setNotice(item.isActive ? 'Recorrência desativada.' : 'Recorrência ativada.');
      await load();
      onChangedAction?.();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível alterar o estado da recorrência.');
    } finally {
      setSaving(false);
    }
  }

  async function runDue() {
    setRunning(true);
    setError('');
    setNotice('');
    try {
      const result = await runDueFinanceRecurrences(new Date().toISOString());
      setNotice(`${result.generated} pendência(s) materializada(s)${result.skipped ? `; ${result.skipped} já existente(s)` : ''}.`);
      await load();
      onChangedAction?.();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível materializar as pendências.');
    } finally {
      setRunning(false);
    }
  }

  const categories = type === 'INCOME' ? incomeCategories : expenseCategories;

  return (
    <section className="dashboard-panel" aria-labelledby="recurrence-title">
      <div className="dashboard-panel__heading">
        <div><p className="dashboard-panel__kicker">AUTOMAÇÕES</p><h2 id="recurrence-title">Recorrências financeiras</h2></div>
        <button type="button" onClick={() => void runDue()} disabled={loading || saving || running} aria-label="Materializar pendências">
          {running ? <LoaderCircle className="spinner" size={15} /> : <Play size={15} />} Materializar agora
        </button>
      </div>
      <p className="dashboard-lead">Programe receitas e despesas para que as pendências sejam criadas no vencimento.</p>
      <form onSubmit={(event) => void create(event)} style={{ display: 'grid', gap: 8 }}>
        <div className="dashboard-form-grid">
          <label className="dashboard-field"><span>Tipo</span><select value={type} onChange={(event) => onTypeChange(event.target.value as RecurrenceCreateRequest['type'])}><option value="INCOME">Receita</option><option value="EXPENSE">Despesa</option></select></label>
          <label className="dashboard-field"><span>Categoria</span><select value={category} onChange={(event) => setCategory(event.target.value as RecurrenceCreateRequest['category'])}>{categories.map((item) => <option key={item} value={item}>{categoryLabels[item]}</option>)}</select></label>
          <label className="dashboard-field"><span>Descrição</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={160} required /></label>
          <label className="dashboard-field"><span>Valor</span><input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min="0.01" step="0.01" required /></label>
          <label className="dashboard-field"><span>Frequência</span><select value={frequency} onChange={(event) => setFrequency(event.target.value as RecurrenceCreateRequest['frequency'])}><option value="WEEKLY">Semanal</option><option value="MONTHLY">Mensal</option><option value="YEARLY">Anual</option></select></label>
          <label className="dashboard-field"><span>Intervalo</span><input value={intervalCount} onChange={(event) => setIntervalCount(event.target.value)} type="number" min="1" max="12" step="1" required /></label>
          <label className="dashboard-field"><span>Primeira execução</span><input value={startDate} onChange={(event) => setStartDate(event.target.value)} type="date" required /></label>
        </div>
        <div><button type="submit" disabled={saving || loading}><Plus size={15} /> {saving ? 'Salvando…' : 'Adicionar recorrência'}</button></div>
      </form>
      {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
      {notice ? <p className="dashboard-notice" role="status">{notice}</p> : null}
      {loading ? <p className="dashboard-loading" role="status"><LoaderCircle className="spinner" size={17} /> Carregando recorrências…</p> : null}
      {!loading && items.length === 0 ? <p className="dashboard-empty-copy">Nenhuma regra de recorrência cadastrada.</p> : null}
      {!loading && items.length > 0 ? (
        <ul className="recent-list">
          {items.map((item) => (
            <li className="recent-row" key={item.id}>
              <span className={`recent-row__mark recent-row__mark--${item.type.toLowerCase()}`} aria-hidden="true"><Power size={16} /></span>
              <span className="recent-row__details"><strong>{item.description}</strong><small>{item.type === 'INCOME' ? 'Receita' : 'Despesa'} · {categoryLabels[item.category]} · {formatCurrency(item.amount)} · próxima em {formatDate(item.nextRunAt)}</small></span>
              <button type="button" onClick={() => void toggle(item)} disabled={saving || running} aria-label={item.isActive ? 'Desativar recorrência' : 'Ativar recorrência'}>{item.isActive ? 'Desativar' : 'Ativar'}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
