'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, CheckCircle2, LoaderCircle, Save, Search } from 'lucide-react';
import {
  getCompanyProfile,
  lookupBusinessRegistry,
  saveCompanyProfile
} from '@/features/business-registry/business-registry-client';
import type { BusinessRegistryRecord } from '@/features/business-registry/types';

type BusinessRegistryPanelProps = { canManageProfile: boolean };

function display(value: string | null): string {
  return value?.trim() || 'Não informado';
}

function formatCnpj(value: string): string {
  if (value.length !== 14) return value;
  return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
}

function formatPostalCode(value: string | null): string {
  return value && /^\d{8}$/.test(value) ? `${value.slice(0, 5)}-${value.slice(5)}` : display(value);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function BusinessRegistryPanel({ canManageProfile }: BusinessRegistryPanelProps) {
  const router = useRouter();
  const [cnpj, setCnpj] = useState('');
  const [record, setRecord] = useState<BusinessRegistryRecord | null>(null);
  const [savedProfile, setSavedProfile] = useState<BusinessRegistryRecord | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const profile = await getCompanyProfile();
        if (!active) return;
        setSavedProfile(profile);
        if (profile) setCnpj(profile.cnpj);
      } catch (reason: unknown) {
        const message = errorMessage(reason, 'Não foi possível carregar o perfil empresarial.');
        if (message.toLowerCase().includes('sessão expirou')) {
          router.replace('/login');
          return;
        }
        if (active) setError(message);
      } finally {
        if (active) setLoadingProfile(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    setRecord(null);
    try {
      setRecord(await lookupBusinessRegistry(cnpj));
    } catch (reason: unknown) {
      const message = errorMessage(reason, 'Não foi possível consultar este CNPJ.');
      if (message.toLowerCase().includes('sessão expirou')) {
        router.replace('/login');
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveProfile() {
    if (!record || !canManageProfile) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const saved = await saveCompanyProfile(record.cnpj);
      setSavedProfile(saved);
      setRecord(saved);
      setCnpj(saved.cnpj);
      setNotice('Perfil empresarial atualizado com dados consultados na ReceitaWS.');
    } catch (reason: unknown) {
      const message = errorMessage(reason, 'Não foi possível salvar o perfil da empresa.');
      if (message.toLowerCase().includes('sessão expirou')) {
        router.replace('/login');
        return;
      }
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  const displayedRecord = record ?? savedProfile;

  return (
    <section className="dashboard-panel registry-panel" aria-labelledby="registry-title">
      <div className="dashboard-panel__heading">
        <div>
          <p className="dashboard-panel__kicker">CADASTRO EMPRESARIAL</p>
          <h2 id="registry-title">Consulte e preencha o perfil</h2>
        </div>
        <span className="registry-mark" aria-hidden="true"><Building2 size={17} /></span>
      </div>
      <p className="registry-intro">Consulte os dados públicos da ReceitaWS e revise o resultado antes de atualizar o cadastro da empresa.</p>

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
            disabled={loadingProfile || loading || saving}
            required
          />
          <span className="registry-hint">Aceita CNPJ numérico ou alfanumérico de 2026.</span>
        </label>
        <button className="dashboard-submit" type="submit" disabled={loadingProfile || loading || saving}>
          {loading ? <LoaderCircle className="spinner" size={15} /> : <Search size={15} />}
          {loading ? 'Consultando…' : 'Consultar CNPJ'}
        </button>
      </form>

      {error ? <p className="notice notice--error registry-error" role="alert">{error}</p> : null}
      {notice ? <p className="registry-saved" role="status"><CheckCircle2 size={15} />{notice}</p> : null}
      {loadingProfile ? <p className="registry-note" role="status">Carregando o perfil salvo da empresa…</p> : null}

      {displayedRecord ? (
        <>
          <dl className="registry-result" aria-live="polite">
            <div className="registry-result__item"><dt>CNPJ</dt><dd>{formatCnpj(displayedRecord.cnpj)}</dd></div>
            <div className="registry-result__item registry-result__item--wide"><dt>Razão social</dt><dd>{display(displayedRecord.legalName)}</dd></div>
            <div className="registry-result__item"><dt>Nome fantasia</dt><dd>{display(displayedRecord.tradeName)}</dd></div>
            <div className="registry-result__item"><dt>Situação cadastral</dt><dd>{display(displayedRecord.registrationStatus)}</dd></div>
            <div className="registry-result__item"><dt>Porte</dt><dd>{display(displayedRecord.size)}</dd></div>
            <div className="registry-result__item"><dt>Tipo de estabelecimento</dt><dd>{display(displayedRecord.companyType)}</dd></div>
            <div className="registry-result__item"><dt>Início da atividade</dt><dd>{display(displayedRecord.openingDate)}</dd></div>
            <div className="registry-result__item"><dt>Código CNAE</dt><dd>{display(displayedRecord.mainActivity?.code ?? null)}</dd></div>
            <div className="registry-result__item registry-result__item--wide"><dt>Atividade principal</dt><dd>{display(displayedRecord.mainActivity?.description ?? null)}</dd></div>
            <div className="registry-result__item registry-result__item--wide"><dt>Endereço</dt><dd>{[
              displayedRecord.address.street,
              displayedRecord.address.number,
              displayedRecord.address.district,
              displayedRecord.address.city,
              displayedRecord.address.state,
              displayedRecord.address.postalCode ? formatPostalCode(displayedRecord.address.postalCode) : null
            ].filter(Boolean).join(', ') || 'Não informado'}</dd></div>
          </dl>
          <p className="registry-source">Fonte: {displayedRecord.source} · consultado em {formatTimestamp(displayedRecord.sourceUpdatedAt)}.</p>
          {record && savedProfile?.cnpj === record.cnpj ? (
            <p className="registry-saved registry-saved--subtle" role="status">Este CNPJ já consta no perfil salvo; confirme abaixo para atualizar a consulta.</p>
          ) : null}
          {record && canManageProfile ? (
            <div className="registry-save">
              <button className="dashboard-submit registry-save__button" type="button" onClick={handleSaveProfile} disabled={saving}>
                {saving ? <LoaderCircle className="spinner" size={15} /> : <Save size={15} />}
                {saving ? 'Salvando…' : savedProfile?.cnpj === record.cnpj ? 'Atualizar perfil da empresa' : 'Salvar no perfil da empresa'}
              </button>
              <p className="registry-note">Ao confirmar, o servidor consulta novamente a ReceitaWS e registra a alteração na auditoria da empresa.</p>
            </div>
          ) : null}
          {record && !canManageProfile ? (
            <p className="registry-note">Seu perfil permite consultar os dados. Apenas OWNER ou ADMIN pode salvar o cadastro empresarial.</p>
          ) : null}
          {!record && savedProfile ? (
            <p className="registry-saved" role="status"><CheckCircle2 size={15} />Perfil empresarial salvo.</p>
          ) : null}
        </>
      ) : !loadingProfile ? (
        <p className="registry-note">A consulta apenas exibe os dados. O perfil só é persistido após confirmação de OWNER ou ADMIN.</p>
      ) : null}
    </section>
  );
}
