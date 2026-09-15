// Extrae el catálogo de cuentas del texto plano del PDF del PCGE (desde "ELEMENTO 1:" hasta "PARTE III").

export type CuentaPcge = { codigo: string; descripcion: string; tipo: string; nivel: number; parentCodigo: string | null; clasificable: boolean };

const CUENTA = /^(\d{2,5})\s+(\S.*)$/;
const RUIDO = [/^=== PAGINA \d+$/, /^\d{1,3}$/, /^PLAN CONTABLE GENERAL EMPRESARIAL$/i, /^CAT[ÁA]LOGO DE CUENTAS$/i, /^CUENTAS DE ORDEN (DEUDORAS|ACREEDORAS)$/i];

function tipoDe(codigo: string): string {
  if (codigo.startsWith('88')) return 'Gasto';
  if (codigo.startsWith('89')) return 'Patrimonio';
  return ({ '1': 'Activo', '2': 'Activo', '3': 'Activo', '4': 'Pasivo', '5': 'Patrimonio', '6': 'Gasto', '7': 'Ingreso', '8': 'Resultado', '9': 'Costo', '0': 'Orden' } as Record<string, string>)[codigo[0]];
}

export function extraerCuentasPcge(texto: string): CuentaPcge[] {
  const out: CuentaPcge[] = [];
  const vistos = new Set<string>();
  let dentro = false;
  let prev: CuentaPcge | null = null;
  for (const bruto of texto.split('\n')) {
    const linea = bruto.replace(/\s+/g, ' ').trim();
    if (!linea) continue;
    if (!dentro) { if (/^ELEMENTO 1:/i.test(linea)) dentro = true; continue; }
    if (/PARTE III/i.test(linea)) break;
    if (/^ELEMENTO /i.test(linea)) { prev = null; continue; } // títulos de elemento (y su línea partida) no son cuentas
    if (RUIDO.some((re) => re.test(linea))) continue;
    const m = CUENTA.exec(linea);
    if (m) {
      const codigo = m[1];
      if (vistos.has(codigo)) { prev = null; continue; }
      const e = codigo[0];
      prev = { codigo, descripcion: m[2], tipo: tipoDe(codigo), nivel: codigo.length - 1, parentCodigo: codigo.length > 2 ? codigo.slice(0, -1) : null, clasificable: e === '6' || e === '9' };
      out.push(prev);
      vistos.add(codigo);
    } else if (prev) {
      prev.descripcion = `${prev.descripcion} ${linea}`; // descripción partida en dos líneas
      prev = null;
    }
  }
  return out;
}
