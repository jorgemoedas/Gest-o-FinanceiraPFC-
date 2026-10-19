const CNPJ_PATTERN = /^[A-Z0-9]{12}\d{2}$/;
const FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const SECOND_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

export function normalizeCnpj(input: string): string {
  return input.replace(/[.\-/\s]/g, '').toUpperCase();
}

function cnpjNumericValue(character: string): number {
  return character.charCodeAt(0) - 48;
}

function calculateDigit(value: string, weights: readonly number[]): number {
  const sum = [...value].reduce((total, character, index) => {
    return total + cnpjNumericValue(character) * weights[index];
  }, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCnpj(input: string): boolean {
  const cnpj = normalizeCnpj(input);
  if (!CNPJ_PATTERN.test(cnpj) || /^([A-Z0-9])\1{13}$/.test(cnpj)) return false;

  const base = cnpj.slice(0, 12);
  const firstDigit = calculateDigit(base, FIRST_WEIGHTS);
  const secondDigit = calculateDigit(`${base}${firstDigit}`, SECOND_WEIGHTS);
  return cnpj.slice(12) === `${firstDigit}${secondDigit}`;
}

export function maskCnpj(cnpj: string): string {
  const normalized = normalizeCnpj(cnpj);
  return `${normalized.slice(0, 2)}${'*'.repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-2)}`;
}
