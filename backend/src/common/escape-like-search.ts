/** Escapa caracteres que o PostgreSQL interpreta como curingas em LIKE/ILIKE. */
export function escapeLikeSearch(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
