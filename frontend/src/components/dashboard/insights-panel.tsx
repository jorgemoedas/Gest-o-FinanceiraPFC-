'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { generateFinanceInsights } from '@/features/finance/finance-client';
import type { FinanceInsight } from '@/features/finance/types';

export function InsightsPanel({ months, transactionCount }: { months: 3 | 6 | 12; transactionCount: number }) {
  const [result, setResult] = useState<FinanceInsight | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setResult(null);
    setError('');
  }, [months]);

  async function handleGenerate() {
    setLoading(true);
    setError('');
    try {
      setResult(await generateFinanceInsights(months));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível gerar os insights.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="dashboard-panel dashboard-panel--insights" aria-labelledby="insights-title">
      <div className="dashboard-panel__heading">
        <div>
          <p className="dashboard-panel__kicker">LEITURA ASSISTIDA</p>
          <h2 id="insights-title">Insights financeiros</h2>
        </div>
        <span className="insights-mark" aria-hidden="true"><Sparkles size={18} /></span>
      </div>
      <p className="insights-intro">Uma leitura breve dos totais e tendências deste período, sem enviar descrições dos lançamentos.</p>
      {result ? <p className="insights-output" role="status">{result.insights}</p> : null}
      {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
      <button className="insights-button" type="button" onClick={handleGenerate} disabled={loading || transactionCount === 0}>
        {loading ? <LoaderCircle className="spinner" size={16} /> : <Sparkles size={16} />}
        {loading ? 'Analisando métricas…' : result ? 'Gerar nova leitura' : 'Analisar este período'}
      </button>
      {transactionCount === 0 ? <p className="insights-empty">Registre lançamentos antes de solicitar uma análise.</p> : null}
      <p className="insights-disclaimer">O texto é gerado por IA com métricas agregadas; confira os dados antes de tomar decisões.</p>
    </section>
  );
}
