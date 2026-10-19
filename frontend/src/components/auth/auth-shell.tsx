import Link from 'next/link';
import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={`brand-lockup${compact ? ' brand-lockup--compact' : ''}`} href="/login" aria-label="GFT Inteligente — início">
      <span className="brand-symbol" aria-hidden="true">
        <svg viewBox="0 0 44 44" role="img">
          <path d="M32.2 13.1A15 15 0 1 0 36.7 23H23.5" />
          <path d="M26 29.5v-8.2h10.7" />
          <path d="M18.1 28.5v-8.2M22 28.5v-5.1M25.9 28.5v-9.3" className="brand-bars" />
        </svg>
      </span>
      <span className="brand-name">
        <strong>GFT</strong>
        <span>inteligente</span>
      </span>
    </Link>
  );
}

const narrative = {
  login: {
    eyebrow: 'ROTINA FINANCEIRA, SEM RUÍDO',
    title: 'Suas contas, com mais clareza.',
    body: 'Um espaço simples para acompanhar a saúde financeira do seu negócio — no seu ritmo, com informação organizada.'
  },
  register: {
    eyebrow: 'UM BOM COMEÇO PARA SUA EMPRESA',
    title: 'Organização que começa com você.',
    body: 'Crie seu acesso e prepare o caminho para uma gestão financeira mais clara e consistente.'
  }
} as const;

export function AuthShell({ children, variant }: { children: ReactNode; variant: keyof typeof narrative }) {
  const copy = narrative[variant];

  return (
    <div className={`auth-layout auth-layout--${variant}`}>
      <aside className="brand-panel">
        <BrandMark />
        <div className="brand-story">
          <p className="brand-eyebrow">{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <p className="brand-description">{copy.body}</p>
        </div>
        <div className="ledger-art" aria-hidden="true">
          <div className="ledger-art__topline"><span>FLUXO</span><span>VISÃO DO NEGÓCIO</span></div>
          <svg viewBox="0 0 460 150" preserveAspectRatio="none">
            <path className="ledger-grid" d="M0 32H460M0 75H460M0 118H460M52 0V150M154 0V150M256 0V150M358 0V150" />
            <path className="ledger-area" d="M0 114 C34 110 47 96 78 102 S125 123 151 93 S207 95 230 73 S275 87 303 54 S356 76 379 47 S428 42 460 22 V150 H0Z" />
            <path className="ledger-line" d="M0 114 C34 110 47 96 78 102 S125 123 151 93 S207 95 230 73 S275 87 303 54 S356 76 379 47 S428 42 460 22" />
            <circle cx="303" cy="54" r="5" />
            <circle cx="460" cy="22" r="5" />
          </svg>
          <div className="ledger-art__bottomline"><span>CLAREZA NO DIA A DIA</span><span>GFT · FINANÇAS</span></div>
        </div>
        <p className="panel-note"><ShieldCheck size={16} strokeWidth={1.8} /> Acesso protegido para cuidar do que é seu.</p>
      </aside>

      <main className="auth-main">
        <div className="mobile-brand"><BrandMark compact /></div>
        <div className="auth-content">{children}</div>
        <p className="auth-footer">GFT Inteligente <span aria-hidden="true">·</span> Gestão financeira para negócios reais</p>
      </main>
    </div>
  );
}
