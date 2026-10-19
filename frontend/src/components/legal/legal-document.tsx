import Link from 'next/link';
import { BrandMark } from '@/components/auth/auth-shell';

export interface LegalSection {
  heading: string;
  paragraphs: string[];
  points?: string[];
}

interface LegalDocumentProps {
  title: string;
  version: string;
  sections: LegalSection[];
  draftNotice: string;
}

export function LegalDocument({ title, version, sections, draftNotice }: LegalDocumentProps) {
  return (
    <main className="legal-page">
      <header className="legal-header">
        <BrandMark compact />
        <nav className="legal-nav" aria-label="Documentos legais">
          <Link href="/termos">Termos</Link>
          <Link href="/privacidade">Privacidade</Link>
          <Link className="legal-nav__back" href="/register">Voltar ao cadastro</Link>
        </nav>
      </header>

      <article className="legal-document">
        <p className="legal-kicker">DOCUMENTO DE DEMONSTRAÇÃO · VERSÃO {version}</p>
        <h1>{title}</h1>
        <p className="legal-lead">
          Texto de apoio ao protótipo acadêmico do GFT Inteligente. Leia o documento antes de marcar o aceite no cadastro.
        </p>

        <aside className="legal-draft-notice" role="note">
          <strong>Minuta acadêmica — não é uma política jurídica final</strong>
          <p>{draftNotice}</p>
        </aside>

        <div className="legal-sections">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.points ? (
                <ul>
                  {section.points.map((point) => <li key={point}>{point}</li>)}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <footer className="legal-document__footer">
          <p>Versão registrada no cadastro: <strong>{version}</strong>.</p>
          <Link href="/register">Voltar ao cadastro e revisar os aceites</Link>
        </footer>
      </article>

      <footer className="legal-page__footer">
        GFT Inteligente <span aria-hidden="true">·</span> Gestão financeira para negócios reais
      </footer>
    </main>
  );
}
