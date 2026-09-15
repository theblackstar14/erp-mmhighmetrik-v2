// Extrae el catálogo de cuentas del texto plano del PDF del PCGE (desde "ELEMENTO 1:" hasta "PARTE III").

export type CuentaPcge = { codigo: string; descripcion: string; tipo: string; nivel: number; parentCodigo: string | null; clasificable: boolean };

const CUENTA = /^(\d{2,5})\s+(\S.*)$/;
const CODIGO_SOLO = /^\d{2,5}$/;
const PAGINA = /^=== PAGINA \d+$/;
const NUMERO_PAGINA_SUELTO = /^\d{1,5}$/;
const RUIDO = [/^PLAN CONTABLE GENERAL EMPRESARIAL$/i, /^CAT[ÁA]LOGO DE CUENTAS$/i, /^CUENTAS DE ORDEN (DEUDORAS|ACREEDORAS)$/i];

function tipoDe(codigo: string): string {
  if (codigo.startsWith('88')) return 'Gasto';
  if (codigo.startsWith('89')) return 'Patrimonio';
  return ({ '1': 'Activo', '2': 'Activo', '3': 'Activo', '4': 'Pasivo', '5': 'Patrimonio', '6': 'Gasto', '7': 'Ingreso', '8': 'Resultado', '9': 'Costo', '0': 'Orden' } as Record<string, string>)[codigo[0]];
}

function construir(codigo: string, descripcion: string): CuentaPcge {
  const e = codigo[0];
  return { codigo, descripcion, tipo: tipoDe(codigo), nivel: codigo.length - 1, parentCodigo: codigo.length > 2 ? codigo.slice(0, -1) : null, clasificable: e === '6' || e === '9' };
}

// Cuántos códigos en línea propia (p.ej. "4692") quedaron sin descripción (llegó otro código o un
// título de ELEMENTO antes de que a todos les tocara su línea de texto) y por lo tanto se descartaron.
// gen-pcge.ts lo imprime.
export let ultimoSinDescripcion = 0;

export function extraerCuentasPcge(texto: string): CuentaPcge[] {
  const out: CuentaPcge[] = [];
  const vistos = new Set<string>();
  let dentro = false;
  let prev: CuentaPcge | null = null;
  let pendientes: string[] = []; // cola FIFO de códigos en línea propia esperando su descripción
  let justAfterPagina = false;
  let sinDescripcion = 0;

  for (const bruto of texto.split('\n')) {
    const linea = bruto.replace(/\s+/g, ' ').trim();
    if (!linea) continue;
    if (!dentro) { if (/^ELEMENTO 1:/i.test(linea)) dentro = true; continue; }
    if (/PARTE III/i.test(linea)) break;

    if (PAGINA.test(linea)) { justAfterPagina = true; continue; }
    const esPaginaSiguiente = justAfterPagina;
    justAfterPagina = false;
    if (esPaginaSiguiente && NUMERO_PAGINA_SUELTO.test(linea)) continue; // número de página suelto justo después del marcador

    if (/^ELEMENTO /i.test(linea)) { // títulos de elemento (y su línea partida) no son cuentas
      if (pendientes.length) { sinDescripcion += pendientes.length; pendientes = []; } // cola sin resolver: se descarta entera
      prev = null;
      continue;
    }
    if (RUIDO.some((re) => re.test(linea))) continue;

    const m = CUENTA.exec(linea);
    if (m) {
      if (pendientes.length) { sinDescripcion += pendientes.length; pendientes = []; } // otro código llegó antes de resolver la cola: se descarta entera
      const codigo = m[1];
      if (vistos.has(codigo)) { prev = null; continue; }
      const cuenta = construir(codigo, m[2]);
      out.push(cuenta);
      vistos.add(codigo);
      prev = cuenta;
      continue;
    }

    if (CODIGO_SOLO.test(linea)) { // código en línea propia: se encola, su descripción viene después (en orden)
      pendientes.push(linea);
      prev = null;
      continue;
    }

    if (pendientes.length) { // esta línea de texto es la descripción del código más antiguo de la cola
      const codigo = pendientes.shift()!;
      if (vistos.has(codigo)) { prev = null; continue; }
      const cuenta = construir(codigo, linea);
      out.push(cuenta);
      vistos.add(codigo);
      prev = cuenta;
      continue;
    }

    if (prev) {
      prev.descripcion = `${prev.descripcion} ${linea}`; // descripción partida en dos líneas
      prev = null;
    }
  }
  if (pendientes.length) sinDescripcion += pendientes.length; // quedó colgada al terminar (o al llegar a PARTE III)
  ultimoSinDescripcion = sinDescripcion;
  return out;
}
