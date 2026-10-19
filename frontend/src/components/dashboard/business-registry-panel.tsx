'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, LoaderCircle, Search } from 'lucide-react';
import { lookupBusinessRegistry } from '@/features/business-registry/business-registry-client';
import type { BusinessRegistryRecord } from '@/features/business-registry/types';

function display(value: string | null): string {
  return value?.trim() || 'Não informado';
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function BusinessRegistryPanel() {
  const router = useRouter();
  const [cnpj, setCnpj] = useState('');
  const [record, setRecord] = useState<BusinessRegistryRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setRecord(null);
    try {
      setRecord(await lookupBusinessRegistry(cnpj));
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível consultar este CNPJ.';
      if (message.toLowerCase().includes('sessão expirou')) {
        router.replace('/login');
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="dashboard-panel registry-panel" aria-labelledby="registry-title">
      <div className="dashboard-panel__heading">
        <div>
          <p className="dashboard-panel__kicker">CONSULTA CADASTRAL</p>
          <h2 id="registry-title">Consulte um CNPJ</h2>
        </div>
        <span className="registry-mark" aria-hidden="true"><Building2 size={17} /></span>
      </div>
      <p className="registry-intro">Consulte dados públicos da ReceitaWS para apoiar a conferência cadastral de uma empresa.</p>

      <form className="registry-form" onSubmit={handleSubmit}>
        <label className="dashboard-field" htmlFor="registry-cnpj">
          CNPJ
          <input
            id="registry-cnpj"
            name="cnpj"
            autoComplete="off"
            inputMode="text"
            maxLength={18}
            placeholder="00.000.000/0001-91"
            value={cnpj}
            onChange={(event) => setCnpj(event.target.value)}
            disabled={loading}
            required
          />
          <span className="registry-hint">Aceita CNPJ numérico ou alfanumérico de 2026.</span>
        </label>
        <button className="dashboard-submit" type="submit" disabled={loading}>
          {loading ? <LoaderCircle className="spinner" size={15} /> : <Search size={15} />}
          {loading ? 'Consultando…' : 'Consultar CNPJ'}
        </button>
      </form>

      {error ? <p className="notice notice--error registry-error" role="alert">{error}</p> : null}
      {record ? (
        <>
          <dl className="registry-result" aria-live="polite">
            <div className="registry-result__item registry-result__item--wide"><dt>Razão social</dt><dd>{record.legalName}</dd></div>
            <div className="registry-result__item"><dt>Nome fantasia</dt><dd>{display(record.tradeName)}</dd></div>
            <div className="registry-result__item"><dt>Situação</dt><dd>{display(record.registrationStatus)}</dd></div>
            <div className="registry-result__item"><dt>Porte</dt><dd>{display(record.size)}</dd></div>
            <div className="registry-result__item registry-result__item--wide"><dt>Atividade principal</dt><dd>{display(record.mainActivity?.description ?? null)}</dd></div>
            <div className="registry-result__item registry-result__item--wide"><dt>Município / UF</dt><dd>{[record.address.city, record.address.state].filter(Boolean).join(' / ') || 'Não informado'}</dd></div>
          </dl>
          <p className="registry-source">Fonte: {record.source} · consultado em {formatTimestamp(record.sourceUpdatedAt)}. A consulta não cria nem altera cadastro de fornecedor/cliente.</p>
        </>
      ) : null}
      {!record && !error ? <p className="registry-note">Os dados são exibidos para referência e não são persistidos no sistema.</p> : null}
    </section>
  );
}
