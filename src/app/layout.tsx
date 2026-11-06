import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'GFT Inteligente | Gestão financeira com clareza',
  description: 'Acesse sua gestão financeira para MEIs e pequenas empresas.',
  applicationName: 'GFT Inteligente'
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
