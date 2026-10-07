// Pesos chilenos: enteros, miles con punto, sin decimales ("$40.000").
// Sin Intl a propósito: el resultado no debe variar entre navegadores.
export function formatCLP(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const digits = Math.abs(Math.round(amount)).toString()
  return `${sign}$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}
