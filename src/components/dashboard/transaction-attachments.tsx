'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FilePlus2, LoaderCircle, Trash2 } from 'lucide-react';
import {
  allowedAttachmentContentTypes,
  deleteTransactionAttachment,
  listTransactionAttachments,
  MAX_ATTACHMENT_BYTES,
  type PublicAttachment,
  uploadTransactionAttachment
} from '@/features/finance/attachments';

const accept = allowedAttachmentContentTypes.join(',');

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function browserFileError(file: File): string | null {
  if (file.size <= 0) return 'O arquivo não pode estar vazio.';
  if (file.size > MAX_ATTACHMENT_BYTES) return 'O arquivo deve ter no máximo 5 MB.';
  if (!(allowedAttachmentContentTypes as readonly string[]).includes(file.type)) return 'Escolha PDF, PNG, JPEG, WEBP, CSV ou texto simples.';
  return null;
}

export function TransactionAttachments({ transactionId }: { transactionId: string }) {
  const [attachments, setAttachments] = useState<PublicAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void listTransactionAttachments(transactionId)
      .then((items) => { if (active) setAttachments(items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os anexos.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [transactionId]);

  async function handleFile(file: File) {
    const validationError = browserFileError(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setUploading(true);
    setError('');
    try {
      const uploaded = await uploadTransactionAttachment({ transactionId, file });
      setAttachments((current) => [...current, uploaded]);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar o anexo.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove(attachment: PublicAttachment) {
    if (!window.confirm(`Remover o anexo “${attachment.fileName}”?`)) return;
    setRemovingId(attachment.id);
    setError('');
    try {
      await deleteTransactionAttachment(attachment.id);
      setAttachments((current) => current.filter((item) => item.id !== attachment.id));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível remover o anexo.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="dashboard-panel" aria-labelledby={`transaction-attachments-${transactionId}`}>
      <div className="dashboard-panel__heading">
        <div>
          <p className="dashboard-panel__kicker">DOCUMENTOS</p>
          <h2 id={`transaction-attachments-${transactionId}`}>Anexos do lançamento</h2>
        </div>
        <label className="dashboard-submit" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: uploading ? 'wait' : 'pointer' }}>
          {uploading ? <LoaderCircle className="spinner" size={15} aria-hidden="true" /> : <FilePlus2 size={15} aria-hidden="true" />}
          {uploading ? 'Enviando…' : 'Adicionar arquivo'}
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void handleFile(file);
            }}
            disabled={loading || uploading}
            style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
          />
        </label>
      </div>
      <p className="field-hint">PDF, PNG, JPEG, WEBP, CSV ou TXT · até 5 MB por arquivo.</p>
      {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
      {loading ? (
        <div className="transaction-history__status" role="status"><LoaderCircle className="spinner" size={17} /> Carregando anexos…</div>
      ) : attachments.length > 0 ? (
        <ul className="transaction-history__list" aria-live="polite">
          {attachments.map((attachment) => (
            <li className="transaction-history__row" key={attachment.id}>
              <div className="transaction-history__details">
                <strong>{attachment.fileName}</strong>
                <small>{attachment.contentType} · {formatBytes(attachment.byteSize)}</small>
              </div>
              <div className="transaction-history__row-actions">
                <a href={`/api/finance/attachments/${attachment.id}`} download={attachment.fileName} aria-label={`Baixar ${attachment.fileName}`} title="Baixar anexo">
                  <Download size={15} aria-hidden="true" />
                </a>
                <button type="button" onClick={() => void handleRemove(attachment)} disabled={removingId === attachment.id || uploading} aria-label={`Remover ${attachment.fileName}`} title="Remover anexo">
                  {removingId === attachment.id ? <LoaderCircle className="spinner" size={15} /> : <Trash2 size={15} aria-hidden="true" />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="transaction-history__status">Nenhum anexo neste lançamento.</p>
      )}
    </section>
  );
}
