/**
 * F6 · Clasificador de líneas del extracto → caso de uso + entrada sugerida del formulario.
 * El sistema PROPONE (cuenta default editable, entrada preseleccionada); Kelly confirma.
 * Casos sin heurística segura (factoring, devoluciones) quedan como abono/cargo genérico
 * → cuenta contra MANUAL obligatoria en el formulario.
 */
export type CasoLinea = 'itf' | 'cargo_banco' | 'transfer_propia' | 'abono' | 'cargo';

export function clasificarLinea(descripcion: string | null, monto: number): {
  caso: CasoLinea;
  cuentaSugerida: string | null; // solo cargos del banco (lote): ITF→6412 · resto→679
  entradaSugerida: 'ingreso' | 'pago' | 'bancario' | null; // preselección en el formulario
} {
  const d = (descripcion ?? '').toUpperCase();
  if (monto < 0 && /\bITF\b|IMPUESTO ITF/.test(d)) return { caso: 'itf', cuentaSugerida: '6412', entradaSugerida: null };
  if (monto < 0 && /COM\.|COMISION|MANT\b|MANTENIM|PORTES|MEMBRES|SEGURO DESGRAV/.test(d)) return { caso: 'cargo_banco', cuentaSugerida: '679', entradaSugerida: null };
  if (/TRAN\.CTAS\.PROP/.test(d)) return { caso: 'transfer_propia', cuentaSugerida: null, entradaSugerida: 'bancario' };
  return monto > 0
    ? { caso: 'abono', cuentaSugerida: null, entradaSugerida: 'ingreso' }
    : { caso: 'cargo', cuentaSugerida: null, entradaSugerida: 'pago' };
}
