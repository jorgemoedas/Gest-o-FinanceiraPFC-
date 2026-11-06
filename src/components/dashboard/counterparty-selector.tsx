'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Plus, UserRoundPlus } from 'lucide-react';
import { createFinanceCounterparty, getFinanceCounterparties } from '@/features/finance/finance-client';
import { lookupBusinessRegistry, normalizeCnpjInput } from '@/features/business-registry/business-registry-client';
import type { BusinessRegistryRecord } from '@/features/business-registry/types';
import type { CounterpartyRole, FinanceCounterparty } from '@/features/finance/types';

type EntryType = 'INCOME' | 'EXPENSE';
type RoleChoice = { entryType: EntryType; role: CounterpartyRole };
type Props = {
  entryType: EntryType;
  value: string | null;
  selectedCounterparty?: FinanceCounterparty | null;
  disabled?: boolean;
  onChangeAction: (id: string | null) => void;
};

const PAGE_SIZE = 100;
const roleLabels: Record<CounterpartyRole, string> = {
  CUSTOMER: 'Cliente',
  SUPPLIER: 'Fornecedor',
  BOTH: 'Cliente e fornecedor'
};

function roleForEntryType(entryType: EntryType): CounterpartyRole {
  return entryType === 'INCOME' ? 'CUSTOMER' : 'SUPPLIER';
}

export function isRegistryReviewCurrent(cnpj: string, reviewedCnpj: string | null, record: BusinessRegistryRecord | null): boolean {
  const normalized = normalizeCnpjInput(cnpj);
  return Boolean(normalized && record && reviewedCnpj === normalized && record.cnpj === normalized);
}

export function resolveCounterpartyRole(entryType: EntryType, choice: RoleChoice): CounterpartyRole {
  return choice.entryType === entryType ? choice.role : roleForEntryType(entryType);
}

export function CounterpartySelector({ entryType, value, selectedCounterparty = null, disabled = false, onChangeAction }: Props) {
  const requiredRole = roleForEntryType(entryType);
  const initialItems = selectedCounterparty && (selectedCounterparty.role === requiredRole || selectedCounterparty.role === 'BOTH')
    ? [selectedCounterparty]
    : [];
  const [items, setItems] = useState<FinanceCounterparty[]>(initialItems);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [registryPreview, setRegistryPreview] = useState<BusinessRegistryRecord | null>(null);
  const [reviewedCnpj, setReviewedCnpj] = useState<string | null>(null);
  const [registryConfirmed, setRegistryConfirmed] = useState(false);
  const [reviewingRegistry, setReviewingRegistry] = useState(false);
  const [search, setSearch] = useState('');
  const [roleChoice, setRoleChoice] = useState<RoleChoice>({ entryType, role: requiredRole });
  const role = resolveCounterpartyRole(entryType, roleChoice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);

  useEffect(() => {
    setRoleChoice({ entryType, role: requiredRole });
  }, [entryType, requiredRole]);

  useEffect(() => {
    if (!adding) return;
    function closeCreatePanel(event: KeyboardEvent) {
      if (event.key !== 'Escape' || saving) return;
      event.preventDefault();
      setAdding(false);
      setError('');
    }

    window.addEventListener('keydown', closeCreatePanel);
    return () => window.removeEventListener('keydown', closeCreatePanel);
  }, [adding, saving]);

  useEffect(() => {
    const version = ++requestVersion.current;
    let active = true;
    setLoading(true);
    setLoadingMore(false);
    setError('');
    setItems(initialItems);
    setPage(1);
    setTotalPages(0);
    const timer = window.setTimeout(() => {
      const query = search.trim();
      void getFinanceCounterparties({
        page: 1,
        limit: PAGE_SIZE,
        role: requiredRole,
        ...(query ? { search: query } : {})
      })
        .then((result) => {
          if (!active || requestVersion.current !== version) return;
          const items = [...result.items];
          if (selectedCounterparty && (selectedCounterparty.role === requiredRole || selectedCounterparty.role === 'BOTH')
            && !items.some((item) => item.id === selectedCounterparty.id)) items.unshift(selectedCounterparty);
          setItems(items);
          setPage(result.page);
          setTotalPages(result.totalPages);
        })
        .catch((reason: unknown) => {
          if (active && requestVersion.current === version) {
            setError(reason instanceof Error ? reason.message : 'Não foi possível carregar clientes e fornecedores.');
          }
        })
        .finally(() => { if (active && requestVersion.current === version) setLoading(false); });
    }, search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [requiredRole, search, selectedCounterparty]);

  async function loadNextPage() {
    if (loading || loadingMore || page >= totalPages) return;
    const version = requestVersion.current;
    setLoadingMore(true);
    setError('');
    try {
      const query = search.trim();
      const result = await getFinanceCounterparties({
        page: page + 1,
        limit: PAGE_SIZE,
        role: requiredRole,
        ...(query ? { search: query } : {})
      });
      if (requestVersion.current !== version) return;
      setItems((current) => {
        const ids = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !ids.has(item.id))];
      });
      setPage(result.page);
      setTotalPages(result.totalPages);
    } catch (reason: unknown) {
      if (requestVersion.current === version) {
        setError(reason instanceof Error ? reason.message : 'Não foi possível carregar mais cadastros.');
      }
    } finally {
      if (requestVersion.current === version) setLoadingMore(false);
    }
  }

  function openCreate() {
    setName('');
    setCnpj('');
    setRegistryPreview(null);
    setReviewedCnpj(null);
    setRegistryConfirmed(false);
    setRoleChoice({ entryType, role: requiredRole });
    setError('');
    setAdding(true);
  }

  async function reviewRegistry() {
    const normalizedCnpj = normalizeCnpjInput(cnpj);
    if (!/^[A-Z0-9]{12}\d{2}$/.test(normalizedCnpj)) {
      setError('Informe um CNPJ válido com 14 caracteres para consultar os dados cadastrais.');
      return;
    }
    setReviewingRegistry(true);
    setRegistryPreview(null);
    setReviewedCnpj(null);
    setRegistryConfirmed(false);
    setError('');
    try {
      const record = await lookupBusinessRegistry(normalizedCnpj);
      setRegistryPreview(record);
      setReviewedCnpj(normalizedCnpj);
      const suggestedName = record.tradeName || record.legalName;
      if (suggestedName.length <= 160) setName(suggestedName);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível consultar os dados cadastrais.');
    } finally {
      setReviewingRegistry(false);
    }
  }

  async function saveCounterparty() {
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 160) {
      setError('Informe um nome com até 160 caracteres.');
      return;
    }
    const normalizedCnpj = normalizeCnpjInput(cnpj);
    if (normalizedCnpj && !isRegistryReviewCurrent(cnpj, reviewedCnpj, registryPreview)) {
      setError('Consulte e revise os dados do CNPJ antes de salvar.');
      return;
    }
    if (normalizedCnpj && !registryConfirmed) {
      setError('Confirme a revisão dos dados retornados pela ReceitaWS antes de salvar.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await createFinanceCounterparty({
        name: cleanName,
        role,
        ...(normalizedCnpj ? { cnpj: normalizedCnpj } : {})
      });
      setItems((current) => [...current.filter((item) => item.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      onChangeAction(created.id);
      setAdding(false);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível cadastrar o cliente ou fornecedor.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="counterparty-selector dashboard-field dashboard-field--wide">
      <label className="counterparty-selector__field dashboard-field">
        <span>Buscar por nome</span>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Digite parte do nome" disabled={disabled || adding} />
      </label>
      <label className="counterparty-selector__field dashboard-field">
        <span>{requiredRole === 'CUSTOMER' ? 'Cliente (opcional)' : 'Fornecedor (opcional)'}</span>
        <select value={value ?? ''} onChange={(event) => onChangeAction(event.target.value || null)} disabled={disabled || loading || adding}>
          <option value="">Sem vínculo</option>
          {items.map((item) => <option key={item.id} value={item.id}>{item.name} · {roleLabels[item.role]}</option>)}
        </select>
      </label>
      {!loading && page < totalPages ? (
        <button className="counterparty-selector__add" type="button" onClick={loadNextPage} disabled={disabled || loadingMore || adding}>
          {loadingMore ? <LoaderCircle className="spinner" size={15} /> : null}
          {loadingMore ? 'Carregando…' : 'Carregar mais cadastros'}
        </button>
      ) : null}
      {!loading && items.length === 0 ? <small className="counterparty-selector__privacy">{search.trim() ? 'Nenhum cadastro corresponde à busca.' : 'Nenhum cliente ou fornecedor cadastrado.'}</small> : null}
      <button className="counterparty-selector__add" type="button" onClick={openCreate} disabled={disabled || loading || saving || adding} aria-expanded={adding} aria-controls="counterparty-create-panel">
        {loading ? <LoaderCircle className="spinner" size={15} /> : <UserRoundPlus size={15} aria-hidden="true" />}
        {requiredRole === 'CUSTOMER' ? 'Cadastrar cliente' : 'Cadastrar fornecedor'}
      </button>
      {adding ? (
        <div id="counterparty-create-panel" className="counterparty-selector__create" role="region" aria-label="Novo cadastro de cliente ou fornecedor">
          <label className="dashboard-field">
            <span>Nome</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} autoComplete="organization" disabled={saving} />
          </label>
          <label className="dashboard-field">
            <span>CNPJ (opcional)</span>
            <input
              value={cnpj}
              onChange={(event) => {
                setCnpj(event.target.value);
                setRegistryPreview(null);
                setReviewedCnpj(null);
                setRegistryConfirmed(false);
              }}
              inputMode="text"
              autoComplete="off"
              placeholder="14 caracteres"
              maxLength={18}
              disabled={saving || reviewingRegistry}
            />
          </label>
          {cnpj.trim() ? (
            <div className="counterparty-selector__registry-review" role="status">
              <button className="counterparty-selector__add" type="button" onClick={reviewRegistry} disabled={saving || reviewingRegistry}>
                {reviewingRegistry ? <LoaderCircle className="spinner" size={15} /> : null}
                {reviewingRegistry ? 'Consultando…' : 'Consultar dados cadastrais'}
              </button>
              {registryPreview ? (
                <div className="counterparty-selector__registry-summary">
                  <strong>Revise o retorno da ReceitaWS</strong>
                  <span>Razão social: {registryPreview.legalName}</span>
                  {registryPreview.tradeName ? <span>Nome fantasia: {registryPreview.tradeName}</span> : null}
                  <small>O nome sugerido pode ser ajustado antes de confirmar o cadastro.</small>
                  <small>O servidor consultará novamente este CNPJ ao salvar. Endereço e contatos não são coletados.</small>
                  <label>
                    <input type="checkbox" checked={registryConfirmed} onChange={(event) => setRegistryConfirmed(event.target.checked)} disabled={saving} />
                    Confirmo que revisei os dados cadastrais retornados.
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
          <label className="dashboard-field">
            <span>Papel</span>
            <select value={role} onChange={(event) => setRoleChoice({ entryType, role: event.target.value as CounterpartyRole })} disabled={saving}>
              {requiredRole === 'CUSTOMER' ? <option value="CUSTOMER">Cliente</option> : <option value="SUPPLIER">Fornecedor</option>}
              <option value="BOTH">Cliente e fornecedor</option>
            </select>
          </label>
          <div className="counterparty-selector__buttons">
            <button className="dashboard-submit" type="button" onClick={saveCounterparty} disabled={saving || reviewingRegistry || Boolean(cnpj.trim()) && (!registryConfirmed || !isRegistryReviewCurrent(cnpj, reviewedCnpj, registryPreview))}>
              {saving ? <LoaderCircle className="spinner" size={15} /> : <Plus size={15} aria-hidden="true" />}
              {saving ? 'Salvando…' : 'Salvar cadastro'}
            </button>
            <button className="transaction-history__reset" type="button" onClick={() => { setAdding(false); setError(''); }} disabled={saving}>Cancelar</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="notice notice--error counterparty-selector__error" role="alert">{error}</p> : null}
      <small className="counterparty-selector__privacy">O cadastro guarda nome e papel; CNPJ é opcional e os dados cadastrais vêm somente da ReceitaWS. Não solicita contatos ou endereço.</small>
    </div>
  );
}
