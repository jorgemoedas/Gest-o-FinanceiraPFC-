import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CounterpartySelector, isRegistryReviewCurrent, resolveCounterpartyRole } from './counterparty-selector';

describe('CounterpartySelector', () => {
  it('redefines the default role when the entry type changes while preserving BOTH for the current type', () => {
    expect(resolveCounterpartyRole('EXPENSE', { entryType: 'INCOME', role: 'BOTH' })).toBe('SUPPLIER');
    expect(resolveCounterpartyRole('INCOME', { entryType: 'INCOME', role: 'BOTH' })).toBe('BOTH');
  });

  it('keeps a compatible selected record visible and exposes server-side name search', () => {
    const counterparty = {
      id: '5d2a9a0e-339a-470e-9cc0-4624044cae86',
      name: 'Fornecedor Antigo',
      role: 'SUPPLIER' as const
    };
    const markup = renderToStaticMarkup(createElement(CounterpartySelector, {
      entryType: 'EXPENSE',
      value: counterparty.id,
      selectedCounterparty: counterparty,
      onChangeAction: () => undefined
    }));

    expect(markup).toContain('Buscar por nome');
    expect(markup).toContain('value="5d2a9a0e-339a-470e-9cc0-4624044cae86" selected=""');
    expect(markup).toContain('Fornecedor Antigo · Fornecedor');
  });

  it('does not show a selected supplier as a compatible income option', () => {
    const supplier = { id: '5d2a9a0e-339a-470e-9cc0-4624044cae86', name: 'Fornecedor', role: 'SUPPLIER' as const };
    const markup = renderToStaticMarkup(createElement(CounterpartySelector, {
      entryType: 'INCOME',
      value: supplier.id,
      selectedCounterparty: supplier,
      onChangeAction: () => undefined
    }));

    expect(markup).not.toContain('Fornecedor · Fornecedor');
  });

  it('requires a current ReceitaWS review before a CNPJ can be confirmed', () => {
    const record = {
      cnpj: '11378117000120',
      legalName: 'Empresa Exemplo Ltda.',
      tradeName: 'Exemplo',
      registrationStatus: 'ATIVA',
      companyType: 'MATRIZ',
      size: 'ME',
      openingDate: '24/11/2009',
      mainActivity: null,
      address: { street: null, number: null, complement: null, district: null, city: null, state: null, postalCode: null },
      source: 'ReceitaWS' as const,
      sourceUpdatedAt: '2026-10-20T20:00:00.000Z'
    };
    expect(isRegistryReviewCurrent('11.378.117/0001-20', '11378117000120', record)).toBe(true);
    expect(isRegistryReviewCurrent('11.378.117/0001-21', '11378117000120', record)).toBe(false);
    expect(isRegistryReviewCurrent('11378117000120', null, null)).toBe(false);
  });
});
