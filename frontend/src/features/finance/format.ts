import type { FinanceCategory } from './types';

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
});

export const categoryLabels: Record<FinanceCategory, string> = {
  SALES: 'Vendas',
  SERVICES: 'Serviços',
  TAXES: 'Impostos',
  RENT: 'Aluguel',
  PAYROLL: 'Folha de pagamento',
  UTILITIES: 'Contas e serviços',
  MARKETING: 'Marketing',
  TRANSPORT: 'Transporte',
  SUPPLIERS: 'Fornecedores',
  OTHER: 'Outros'
};

export function formatCurrency(value: number): string {
  return currencyFormatter.format(Number.isFinite(value) ? value : 0);
}

export function formatAxisMoney(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `R$ ${(amount / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `R$ ${(amount / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${amount.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return dateFormatter.format(date).replace('.', '');
}
