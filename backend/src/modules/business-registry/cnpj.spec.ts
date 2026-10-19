import { isValidCnpj, maskCnpj, normalizeCnpj } from './cnpj';

describe('CNPJ utilities', () => {
  it('accepts a valid legacy numeric CNPJ with punctuation', () => {
    expect(isValidCnpj('11.378.117/0001-20')).toBe(true);
  });

  it('accepts the Receita Federal alphanumeric modulo-11 example', () => {
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
  });

  it('normalizes punctuation and case before validation', () => {
    expect(normalizeCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });

  it('rejects wrong length, invalid check digits and repeated identifiers', () => {
    expect(isValidCnpj('123')).toBe(false);
    expect(isValidCnpj('11.378.117/0001-21')).toBe(false);
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
  });

  it('masks the CNPJ before it is written to audit metadata', () => {
    expect(maskCnpj('12ABC34501DE35')).toBe('12**********35');
  });
});
