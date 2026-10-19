import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TaxEstimatorPanel } from '../../components/dashboard/tax-estimator-panel';

describe('TaxEstimatorPanel', () => {
  it('renderiza a modalidade Simples Nacional, os campos e as ressalvas educativas', () => {
    const html = renderToStaticMarkup(createElement(TaxEstimatorPanel));

    expect(html).toContain('Uma referência tributária para planejar.');
    expect(html).toContain('ME / EPP · Simples Nacional');
    expect(html).toContain('MEI / SIMEI');
    expect(html).toContain('RBT12 — 12 meses anteriores');
    expect(html).toContain('Receita bruta do mês');
    expect(html).toContain('Fórmula legal:');
    expect(html).toContain('Estimativa educativa — não é apuração fiscal.');
    expect(html).toContain('não salvos e não enviados ao Gemini');
    expect(html).toContain('Fontes oficiais da estimativa');
  });
});
