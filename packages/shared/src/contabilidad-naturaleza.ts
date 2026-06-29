// Catálogo NATURALEZA CONTABLE → cuenta PCGE · corazón del motor contable (F1).
// El `subtipo` del movimiento es etiqueta libre (descripción operativa); la CUENTA contable
// se deriva SIEMPRE de aquí o del documento enlazado (OC/valo/gasto) · nunca del texto libre.
//
// `cuenta` = contrapartida que va CONTRA el banco (104x). Para docLinked=true normalmente se
// infiere del documento (cobro→1212, pago→4212) y este código es el fallback si no hay link.
// `tipo` filtra qué naturalezas se ofrecen según Ingreso/Egreso/Transferencia.
//
// Todos los códigos existen en el seed PCGE. Ajustables por el contador (1 línea):
//  · APORTE_SOCIO usa 501 (capital). El estándar sugería 52x (capital adicional) pero NO está
//    en el seed; si el aporte es no-capitalizable, cambiar a una cuenta por pagar accionistas.
//  · CAJA_CHICA → 631 (gasto operativo menor) · GASTO_OPERATIVO → 639 · ajustar a gusto.

export const NATURALEZAS_CONTABLES = {
  APORTE_SOCIO:      { label: 'Aporte de socio',            cuenta: '501',  tipo: 'ingreso',  docLinked: false },
  PRESTAMO_RECIBIDO: { label: 'Préstamo recibido',          cuenta: '451',  tipo: 'ingreso',  docLinked: false },
  PRESTAMO_OTORGADO: { label: 'Préstamo otorgado',          cuenta: '161',  tipo: 'egreso',   docLinked: false },
  COBRO_CLIENTE:     { label: 'Cobro de cliente',           cuenta: '1212', tipo: 'ingreso',  docLinked: true  },
  PAGO_PROVEEDOR:    { label: 'Pago a proveedor',           cuenta: '4212', tipo: 'egreso',   docLinked: true  },
  PAGO_PLANILLA:     { label: 'Pago de planilla',           cuenta: '411',  tipo: 'egreso',   docLinked: false },
  IMPUESTO:          { label: 'Pago de impuesto',           cuenta: '401',  tipo: 'egreso',   docLinked: false },
  TRANSFERENCIA:     { label: 'Transferencia entre cuentas', cuenta: null,  tipo: 'transfer', docLinked: false },
  CAJA_CHICA:        { label: 'Caja chica / reposición',    cuenta: '631',  tipo: 'egreso',   docLinked: false },
  GASTO_OPERATIVO:   { label: 'Gasto operativo',            cuenta: '639',  tipo: 'egreso',   docLinked: false },
  OTRO_INGRESO:      { label: 'Otro ingreso',               cuenta: '759',  tipo: 'ingreso',  docLinked: false },
  OTRO_EGRESO:       { label: 'Otro egreso',                cuenta: '659',  tipo: 'egreso',   docLinked: false },
} as const;

export type NaturalezaContable = keyof typeof NATURALEZAS_CONTABLES;
export type NaturalezaTipo = 'ingreso' | 'egreso' | 'transfer';

export const NATURALEZA_KEYS = Object.keys(NATURALEZAS_CONTABLES) as NaturalezaContable[];

// Cuenta de contrapartida para una naturaleza "suelta" (sin documento enlazado). null = transferencia.
export function cuentaDeNaturaleza(n: NaturalezaContable): string | null {
  return NATURALEZAS_CONTABLES[n].cuenta;
}
