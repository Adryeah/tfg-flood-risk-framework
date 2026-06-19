/**
 * Producto comercial de una póliza a partir de su tipo de activo.
 * Fuente única para policy-map y portfolio-explorer (antes duplicada).
 *
 * @param {{ product?: string, type?: string }} client
 * @returns {'particulares' | 'autos' | 'pymes'}
 */
export function productOf(client) {
  if (client.product) return client.product;
  if (client.type === 'residential') return 'particulares';
  if (client.type === 'auto') return 'autos';
  return 'pymes'; // commercial + industrial collapse here
}
