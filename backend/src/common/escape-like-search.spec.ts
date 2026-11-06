import { describe, expect, it } from '@jest/globals';
import { escapeLikeSearch } from './escape-like-search';

describe('escapeLikeSearch', () => {
  it('escapa todos os metacaracteres de LIKE como texto literal', () => {
    expect(escapeLikeSearch('%_\\')).toBe(String.raw`\%\_\\`);
  });

  it('preserva texto comum sem alterar a busca', () => {
    expect(escapeLikeSearch('Clínica Exemplo')).toBe('Clínica Exemplo');
  });
});
