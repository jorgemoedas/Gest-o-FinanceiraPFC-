'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Download, LoaderCircle, Plus, RefreshCw, WandSparkles } from 'lucide-react';
import {
  createFiscalObligation,
  generateDefaultFiscalCalendar,
  getFiscalCalendar,
  updateFiscalObligationStatus,
  type FiscalObligation
} from '@/features/fiscal/calendar';
import { downloadFiscalCsv, downloadFiscalPdf } from '@/features/fiscal/export';

type Status = 'PENDING' | 'DONE' | 'DISMISSED';

function isoDay(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function rangeForMonth(date = new Date()): { from: string; to: string } {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { from: from.toISOString(), to: to.toISOString() };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

function label(status: Status): string {
  return status === 'PENDING' ? 'Pendente' : status === 'DONE' ? 'Concluída' : 'Dispensada';
}

export function FiscalCalendarPanel() {
  const initial = useMemo(() => rangeForMonth(), []);
  const [from, setFrom] = useState(isoDay(initial.from));
  const [to, setTo] = useState(isoDay(initial.to));
  const [items, setItems] = useState<FiscalObligation[]>([]);
  const [summary, setSummary] = useState({ pending: 0, overdue: 0, dueSoon: 0, done: 0 });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [regime, setRegime] = useState<'MEI' | 'SIMPLES_ME_EPP'>('MEI');
  const [newTitle, setNewTitle] = useState('');
  const [newDueAt, setNewDueAt] = useState('');

  const query = useMemo(() => ({ from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` }), [from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getFiscalCalendar(query);
      setItems(result.items);
      setSummary(result.summary);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o calendário fiscal.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  async function changeStatus(item: FiscalObligation, status: Status) {
    setWorking(true);
    setError('');
    try {
      await updateFiscalObligationStatus(item.id, { status, version: item.version });
      setNotice('Situação da obrigação atualizada.');
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a obrigação.');
    } finally {
      setWorking(false);
    }
  }

  async function addManual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTitle.trim() || !newDueAt) return;
    setWorking(true);
    setError('');
    try {
      await createFiscalObligation({ kind: 'MANUAL', title: newTitle.trim(), dueAt: `${newDueAt}T12:00:00.000Z` });
      setNewTitle('');
      setNewDueAt('');
      setNotice('Obrigação manual adicionada ao calendário.');
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível criar a obrigação.');
    } finally {
      setWorking(false);
    }
  }

  async function generate() {
    setWorking(true);
    setError('');
    try {
      const result = await generateDefaultFiscalCalendar({ ...query, regime });
      setNotice(`${result.created} obrigação(ões) criada(s); ${result.skipped} já existente(s).`);
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível gerar o calendário padrão.');
    } finally {
      setWorking(false);
    }
  }

  async function exportFile(format: 'csv' | 'pdf') {
    setWorking(true);
    setError('');
    try {
      if (format === 'csv') await downloadFiscalCsv(query);
      else await downloadFiscalPdf(query);
      setNotice(`Exportação ${format.toUpperCase()} iniciada.`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível exportar o calendário.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="dashboard-panel" aria-labelledby="fiscal-calendar-title">
      <div className="dashboard-panel__heading">
        <div><p className="dashboard-panel__kicker">OBRIGAÇÕES</p><h2 id="fiscal-calendar-title"><CalendarDays size={17} aria-hidden="true" /> Calendário fiscal</h2></div>
        <button className="dashboard-refresh" type="button" onClick={() => void load()} disabled={loading || working} aria-label="Atualizar calendário">{loading ? <LoaderCircle className="spinner" size={16} /> : <RefreshCw size={15} />}</button>
      </div>
      <p className="dashboard-empty-copy">Referências de vencimento para organização. A data pode mudar por regra oficial e o sistema não transmite declarações.</p>
      <div className="transaction-history__filters" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <label className="dashboard-field"><span>De</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="dashboard-field"><span>Até</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <div className="dashboard-summary" style={{ marginTop: 15 }}>
        <div className="dashboard-metric"><span className="dashboard-metric__label">Pendentes</span><strong className="dashboard-metric__value">{summary.pending}</strong></div>
        <div className="dashboard-metric"><span className="dashboard-metric__label">Atrasadas</span><strong className="dashboard-metric__value">{summary.overdue}</strong></div>
        <div className="dashboard-metric"><span className="dashboard-metric__label">Próximas</span><strong className="dashboard-metric__value">{summary.dueSoon}</strong></div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <select className="dashboard-field" style={{ minHeight: 38, width: 'auto' }} value={regime} onChange={(event) => setRegime(event.target.value as typeof regime)} aria-label="Regime do calendário"><option value="MEI">MEI</option><option value="SIMPLES_ME_EPP">Simples ME/EPP</option></select>
        <button className="dashboard-submit" type="button" onClick={() => void generate()} disabled={working}><WandSparkles size={14} /> Gerar padrão</button>
        <button className="dashboard-submit" type="button" onClick={() => void exportFile('csv')} disabled={working}><Download size={14} /> CSV</button>
        <button className="dashboard-submit" type="button" onClick={() => void exportFile('pdf')} disabled={working}><Download size={14} /> PDF</button>
      </div>
      {error ? <div className="notice notice--error dashboard-error" role="alert">{error}</div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}
      <form onSubmit={addManual} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 150px auto', alignItems: 'end', gap: 8, marginTop: 16 }}>
        <label className="dashboard-field"><span>Nova obrigação manual</span><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={160} placeholder="Ex.: Entrega de documento" /></label>
        <label className="dashboard-field"><span>Vencimento</span><input type="date" value={newDueAt} onChange={(event) => setNewDueAt(event.target.value)} /></label>
        <button className="dashboard-submit" type="submit" disabled={working || !newTitle.trim() || !newDueAt}><Plus size={14} /> Adicionar</button>
      </form>
      {loading ? <div className="dashboard-loading" role="status"><LoaderCircle className="spinner" size={17} /> Carregando calendário…</div> : items.length === 0 ? <p className="dashboard-empty-copy">Nenhuma obrigação encontrada no período.</p> : (
        <ul className="recent-list" aria-label="Obrigações fiscais">
          {items.map((item) => <li className="recent-row" key={item.id} style={{ borderLeft: item.isOverdue ? '3px solid var(--danger)' : item.daysUntilDue >= 0 && item.daysUntilDue <= 7 ? '3px solid var(--copper)' : undefined, paddingLeft: 10 }}>
            <span className="recent-row__mark recent-row__mark--income" aria-hidden="true"><CalendarDays size={15} /></span>
            <span className="recent-row__details"><strong>{item.title}</strong><small>{formatDate(item.dueAt)} · {item.kind} · {item.isOverdue ? 'Em atraso' : item.daysUntilDue <= 7 && item.daysUntilDue >= 0 ? `Em ${item.daysUntilDue} dia(s)` : label(item.status)}</small></span>
            <select value={item.status} onChange={(event) => void changeStatus(item, event.target.value as Status)} disabled={working} aria-label={`Situação de ${item.title}`}><option value="PENDING">Pendente</option><option value="DONE">Concluída</option><option value="DISMISSED">Dispensada</option></select>
            {item.status === 'DONE' ? <Check size={15} aria-label="Concluída" /> : null}
          </li>)}
        </ul>
      )}
    </section>
  );
}
