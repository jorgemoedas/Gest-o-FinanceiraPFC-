'use client';

import { Download, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { erasePrivacyData, exportPrivacyData } from '@/features/privacy/privacy-client';

const CONFIRMATION = 'ELIMINAR MEUS DADOS';

export function PrivacyPanel() {
  const [confirmation, setConfirmation] = useState('');
  const [loadingExport, setLoadingExport] = useState(false);
  const [loadingErase, setLoadingErase] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleExport() {
    setError('');
    setNotice('');
    setLoadingExport(true);
    try {
      const data = await exportPrivacyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'gft-dados-privacidade.json';
      link.click();
      URL.revokeObjectURL(url);
      setNotice('Seu arquivo de dados foi preparado para download.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível exportar seus dados.');
    } finally {
      setLoadingExport(false);
    }
  }

  async function handleErase() {
    setError('');
    setNotice('');
    setLoadingErase(true);
    try {
      const result = await erasePrivacyData(confirmation);
      setNotice(`Dados pessoais eliminados. ${result.retained.join(' ')}`);
      setConfirmation('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível eliminar seus dados.');
    } finally {
      setLoadingErase(false);
    }
  }

  return (
    <section className="dashboard-panel privacy-panel" aria-labelledby="privacy-panel-title">
      <div className="dashboard-panel__heading">
        <div>
          <p className="dashboard-panel__kicker">CONTROLE DOS SEUS DADOS</p>
          <h2 id="privacy-panel-title">Privacidade e conta</h2>
        </div>
        <span className="privacy-panel__mark" aria-hidden="true"><ShieldCheck size={18} /></span>
      </div>
      <p className="privacy-panel__intro">Exporte uma cópia dos seus dados ou solicite a eliminação da conta. A eliminação desativa o acesso e remove seus vínculos de empresa.</p>
      <div className="privacy-panel__actions">
        <button className="dashboard-submit" type="button" onClick={handleExport} disabled={loadingExport || loadingErase}>
          {loadingExport ? <LoaderCircle size={15} className="spinner" /> : <Download size={15} />}
          {loadingExport ? 'Preparando arquivo…' : 'Exportar meus dados'}
        </button>
        <div className="privacy-panel__erase">
          <label className="dashboard-field" htmlFor="privacy-confirmation">Para eliminar, digite exatamente “{CONFIRMATION}”</label>
          <div className="privacy-panel__erase-row">
            <input id="privacy-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} maxLength={40} placeholder={CONFIRMATION} disabled={loadingExport || loadingErase} />
            <button className="dashboard-submit dashboard-submit--danger" type="button" onClick={handleErase} disabled={loadingExport || loadingErase || confirmation !== CONFIRMATION}>
              {loadingErase ? <LoaderCircle size={15} className="spinner" /> : <Trash2 size={15} />}
              {loadingErase ? 'Eliminando…' : 'Eliminar dados'}
            </button>
          </div>
        </div>
      </div>
      <p className="privacy-panel__retention"><strong>O que será preservado:</strong> lançamentos financeiros e trilha de auditoria permanecem guardados por obrigação legal e contábil. O e-mail será anonimizado e o acesso, suspenso.</p>
      {error ? <div className="notice notice--error" role="alert">{error}</div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}
    </section>
  );
}
