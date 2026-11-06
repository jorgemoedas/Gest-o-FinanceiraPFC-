'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Calculator, ExternalLink, Info } from 'lucide-react';
import {
  calculateMeiEstimate,
  calculateSimplesEstimate,
  MEI_CARGO_INSS,
  MEI_ICMS,
  MEI_ISS,
  MEI_MONTHLY_MINIMUM_WAGE,
  MEI_REGULAR_INSS,
  SIMPLES_FACTORS,
  TAX_YEAR,
  type EstimateError,
  type MeiEstimate,
  type SimplesEstimate,
  type MeiActivity,
  type SimplesAnnex
} from '@/features/tax/simulator';

function formatDecimalCurrency(value: string): string {
  const [whole, fraction = '00'] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${grouped},${fraction.padEnd(2, '0')}`;
}

function formatDecimalPercent(value: string): string {
  return value.replace('.', ',');
}

function errorEstimate(error: unknown): EstimateError {
  return { ok: false, message: error instanceof Error ? error.message : 'O cálculo fiscal não pôde ser concluído.' };
}

const annexOptions: { value: SimplesAnnex; label: string }[] = [
  { value: 'I', label: 'Anexo I — Comércio' },
  { value: 'II', label: 'Anexo II — Indústria' },
  { value: 'III', label: 'Anexo III — Serviços e locação' },
  { value: 'IV', label: 'Anexo IV — Serviços específicos' },
  { value: 'V', label: 'Anexo V — Serviços específicos' }
];

const activityLabels: Record<MeiActivity, string> = {
  COMMERCE_INDUSTRY: 'Comércio ou indústria',
  SERVICES: 'Prestação de serviços',
  BOTH: 'Comércio/indústria e serviços',
  CARGO_TRANSPORT: 'Transportador autônomo de cargas'
};

export function TaxEstimatorPanel() {
  const [mode, setMode] = useState<'SIMPLES' | 'MEI'>('SIMPLES');
  const [annex, setAnnex] = useState<SimplesAnnex>('I');
  const [rbt12, setRbt12] = useState('');
  const [monthRevenue, setMonthRevenue] = useState('');
  const [meiActivity, setMeiActivity] = useState<MeiActivity>('SERVICES');
  const [yearToDateRevenue, setYearToDateRevenue] = useState('');
  const [includeIcms, setIncludeIcms] = useState(false);
  const [includeIss, setIncludeIss] = useState(true);
  const [simples, setSimples] = useState<SimplesEstimate | EstimateError | null>(null);
  const [mei, setMei] = useState<MeiEstimate | EstimateError | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!rbt12.trim() || !monthRevenue.trim()) {
      setSimples(null);
      return () => { cancelled = true; };
    }
    void calculateSimplesEstimate({ annex, rbt12, monthRevenue })
      .then((result) => { if (!cancelled) setSimples(result); })
      .catch((error: unknown) => { if (!cancelled) setSimples(errorEstimate(error)); });
    return () => { cancelled = true; };
  }, [annex, monthRevenue, rbt12]);

  useEffect(() => {
    let cancelled = false;
    if (!yearToDateRevenue.trim()) {
      setMei(null);
      return () => { cancelled = true; };
    }
    void calculateMeiEstimate({ activity: meiActivity, yearToDateRevenue, includeIcms, includeIss })
      .then((result) => { if (!cancelled) setMei(result); })
      .catch((error: unknown) => { if (!cancelled) setMei(errorEstimate(error)); });
    return () => { cancelled = true; };
  }, [includeIcms, includeIss, meiActivity, yearToDateRevenue]);

  function handleActivityChange(value: MeiActivity) {
    setMeiActivity(value);
    setIncludeIcms(value === 'COMMERCE_INDUSTRY' || value === 'BOTH' || value === 'CARGO_TRANSPORT');
    setIncludeIss(value === 'SERVICES' || value === 'BOTH');
  }

  return (
    <section className="dashboard-panel tax-panel" aria-labelledby="tax-estimator-title">
      <div className="tax-panel__heading">
        <div>
          <p className="tax-panel__kicker">IMPOSTOS · ESTIMATIVA EDUCATIVA</p>
          <h2 id="tax-estimator-title">Uma referência tributária para planejar.</h2>
          <p className="tax-panel__intro">Simule uma estimativa com valores e tabelas consultados para o ano-base {TAX_YEAR}.</p>
        </div>
        <span className="tax-year-badge">ANO-BASE {TAX_YEAR}</span>
      </div>

      <div className="tax-mode-switch" role="group" aria-label="Escolha o tipo de simulação">
        <button type="button" aria-pressed={mode === 'SIMPLES'} onClick={() => setMode('SIMPLES')}>ME / EPP · Simples Nacional</button>
        <button type="button" aria-pressed={mode === 'MEI'} onClick={() => setMode('MEI')}>MEI / SIMEI</button>
      </div>

      {mode === 'SIMPLES' ? (
        <div className="tax-workspace">
          <div className="tax-input-grid">
            <div className="tax-field tax-field--wide">
              <label htmlFor="tax-annex">Anexo informado para a atividade</label>
              <select id="tax-annex" value={annex} onChange={(event) => setAnnex(event.target.value as SimplesAnnex)}>
                {annexOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <small>Confirme o enquadramento da atividade com seu contador; o sistema não classifica CNAE nem receita.</small>
            </div>
            <div className="tax-field">
              <label htmlFor="tax-rbt12">RBT12 — 12 meses anteriores (R$)</label>
              <input id="tax-rbt12" type="number" min="0.01" step="0.01" inputMode="decimal" value={rbt12} onChange={(event) => setRbt12(event.target.value)} placeholder="Ex.: 180000" />
            </div>
            <div className="tax-field">
              <label htmlFor="tax-month-revenue">Receita bruta do mês (R$)</label>
              <input id="tax-month-revenue" type="number" min="0" step="0.01" inputMode="decimal" value={monthRevenue} onChange={(event) => setMonthRevenue(event.target.value)} placeholder="Ex.: 15000" />
            </div>
          </div>

          <div className="tax-results" aria-live="polite">
            {!simples ? <p className="tax-empty"><Calculator size={17} aria-hidden="true" /> Informe o RBT12 e a receita do mês para ver a estimativa.</p> : null}
            {simples && !simples.ok ? <p className="tax-error" role="alert">{simples.message}</p> : null}
            {simples?.ok ? (
              <>
                <div className="tax-result__primary">
                  <span>Estimativa de tributo do mês</span>
                  <strong>{formatDecimalCurrency(simples.estimatedTax)}</strong>
                  <small>Aplicada sobre {formatDecimalCurrency(simples.monthRevenue)} de receita do mês</small>
                </div>
                <dl className="tax-result__metrics">
                  <div><dt>Anexo e faixa</dt><dd>{simples.annex} · {simples.bracket}</dd></div>
                  <div><dt>Alíquota nominal</dt><dd>{formatDecimalPercent(simples.nominalRatePercent)}%</dd></div>
                  <div><dt>Alíquota efetiva estimada</dt><dd>{formatDecimalPercent(simples.effectiveRatePercent)}%</dd></div>
                  <div><dt>Parcela a deduzir</dt><dd>{formatDecimalCurrency(simples.deduction)}</dd></div>
                </dl>
              </>
            ) : null}
          </div>

          <p className="tax-formula"><strong>Fórmula legal:</strong> {SIMPLES_FACTORS.formula}. Para atividades de serviço sujeitas ao Fator R, confirme o anexo: razão folha/RBT12 ≥ 28% pode levar ao Anexo III; abaixo de 28%, ao Anexo V.</p>
          {annex === 'IV' ? <p className="tax-inline-warning"><AlertTriangle size={16} aria-hidden="true" /> No Anexo IV, a contribuição previdenciária patronal não integra esta estimativa do DAS e pode ser recolhida separadamente.</p> : null}
        </div>
      ) : (
        <div className="tax-workspace">
          <div className="tax-input-grid">
            <div className="tax-field tax-field--wide">
              <label htmlFor="tax-mei-activity">Categoria de atividade MEI</label>
              <select id="tax-mei-activity" value={meiActivity} onChange={(event) => handleActivityChange(event.target.value as MeiActivity)}>
                {(Object.keys(activityLabels) as MeiActivity[]).map((value) => <option key={value} value={value}>{activityLabels[value]}</option>)}
              </select>
            </div>
            <div className="tax-field">
              <label htmlFor="tax-mei-revenue">Faturamento acumulado no ano (R$)</label>
              <input id="tax-mei-revenue" type="number" min="0" step="0.01" inputMode="decimal" value={yearToDateRevenue} onChange={(event) => setYearToDateRevenue(event.target.value)} placeholder="Ex.: 40500" />
            </div>
          </div>

          <fieldset className="tax-additions">
            <legend>Adicionais do DAS, conforme a atividade registrada</legend>
            <label><input type="checkbox" checked={includeIcms} onChange={(event) => setIncludeIcms(event.target.checked)} /> ICMS (+{formatDecimalCurrency(MEI_ICMS)})</label>
            <label><input type="checkbox" checked={includeIss} onChange={(event) => setIncludeIss(event.target.checked)} /> ISS (+{formatDecimalCurrency(MEI_ISS)})</label>
            <small>Marque apenas os adicionais aplicáveis à sua ocupação; confirme no Portal do Simples Nacional.</small>
          </fieldset>

          <div className="tax-results" aria-live="polite">
            {!mei ? <p className="tax-empty"><Calculator size={17} aria-hidden="true" /> Informe o faturamento acumulado para comparar com o limite e ver o DAS mensal.</p> : null}
            {mei && !mei.ok ? <p className="tax-error" role="alert">{mei.message}</p> : null}
            {mei?.ok ? (
              <>
                <div className="tax-result__primary">
                  <span>Estimativa mensal do DAS-MEI</span>
                  <strong>{formatDecimalCurrency(mei.monthlyDas)}</strong>
                  <small>Base previdenciária 2026: {formatDecimalCurrency(mei.activity === 'CARGO_TRANSPORT' ? MEI_CARGO_INSS : MEI_REGULAR_INSS)} sobre salário mínimo de {formatDecimalCurrency(MEI_MONTHLY_MINIMUM_WAGE)}</small>
                </div>
                <dl className="tax-result__metrics">
                  <div><dt>Limite anual confirmado</dt><dd>{formatDecimalCurrency(mei.annualLimit)}</dd></div>
                  <div><dt>Faturamento informado</dt><dd>{formatDecimalCurrency(mei.yearToDateRevenue)}</dd></div>
                  <div><dt>Limite restante</dt><dd>{formatDecimalCurrency(mei.remainingLimit)}</dd></div>
                  <div><dt>Uso do limite</dt><dd>{formatDecimalPercent(mei.limitUsedPercent)}%</dd></div>
                </dl>
                <progress className="tax-limit-progress" max="100" value={mei.limitUsedPercent} aria-label={`Uso do limite anual: ${formatDecimalPercent(mei.limitUsedPercent)} por cento`} />
                <p className="tax-limit-note">Faturamento dentro do limite anual confirmado pelo serviço fiscal.</p>
              </>
            ) : null}
          </div>
          <p className="tax-formula">Em {TAX_YEAR}, o INSS regular informado pela Receita é {formatDecimalCurrency(MEI_REGULAR_INSS)} (5% de {formatDecimalCurrency(MEI_MONTHLY_MINIMUM_WAGE)}). Para transportador autônomo de cargas, a contribuição previdenciária informada é {formatDecimalCurrency(MEI_CARGO_INSS)} (12%); ICMS/ISS são adicionais selecionáveis.</p>
        </div>
      )}

      <div className="tax-disclaimer" role="note">
        <Info size={17} aria-hidden="true" />
        <p><strong>Estimativa educativa — não é apuração fiscal.</strong> Não substitui contador, não classifica atividade, não considera todas as exceções, segregações de receita, retenções, sublimites ou opções IBS/CBS de 2027, e não gera DAS nem transmite declarações. Os valores digitados são enviados ao cálculo fiscal autenticado, não salvos e não enviados ao Gemini.</p>
      </div>

      <nav className="tax-sources" aria-label="Fontes oficiais da estimativa">
        <a href="https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm" target="_blank" rel="noopener noreferrer">LC 123/2006 <ExternalLink size={13} aria-hidden="true" /></a>
        <a href="https://www8.receita.fazenda.gov.br/simplesnacional/noticias/NoticiaCompleta.aspx?id=c3b2044c-ff97-432a-b33c-ecf2a3df6dc3" target="_blank" rel="noopener noreferrer">Valores MEI 2026 · Receita Federal <ExternalLink size={13} aria-hidden="true" /></a>
        <a href="https:
      </nav>
    </section>
  );
}
