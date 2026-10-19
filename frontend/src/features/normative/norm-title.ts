/** «Resolución 286/2026»: what kind of norm it is and its number. */
export function normTitle(norm: { kind: string; number: string }): string {
  return [norm.kind, norm.number].filter(Boolean).join(' ');
}
