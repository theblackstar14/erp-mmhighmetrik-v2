/**
 * Genera fixture placeholder IUs INEI mensuales · Lima · 2025-06 → 2026-04
 *
 * NOTAS:
 *   · Io (junio 2025) = 100 para todos los IUs (base normalizada)
 *   · Ir(t) = Io × (1 + delta_iu)^t · delta_iu varía por categoría
 *   · K factor reajuste real depende de IUs INEI publicados via R.J.
 *
 * REEMPLAZAR cuando user provea CSV con valores INEI reales
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FIXTURE = path.resolve(__dirname, '../fixtures/ius-inei-placeholder.csv');

// 18 IUs CAPECO usados PG0005 + delta mensual placeholder
const IUS = [
  { codigo: '02', desc: 'Acero liso', delta: 0.0040 },
  { codigo: '03', desc: 'Acero corrugado', delta: 0.0040 },
  { codigo: '05', desc: 'Agregado grueso', delta: 0.0035 },
  { codigo: '07', desc: 'Cable TW/THW', delta: 0.0045 },
  { codigo: '10', desc: 'Aparato sanitario', delta: 0.0030 },
  { codigo: '12', desc: 'Artefacto alumbrado', delta: 0.0035 },
  { codigo: '17', desc: 'Bloque/ladrillo', delta: 0.0035 },
  { codigo: '21', desc: 'Cemento Portland I', delta: 0.0035 },
  { codigo: '24', desc: 'Cerámica esmaltada', delta: 0.0030 },
  { codigo: '30', desc: 'Dólar+infl EEUU', delta: 0.0025 },
  { codigo: '32', desc: 'Flete terrestre', delta: 0.0050 },
  { codigo: '39', desc: 'IPC general', delta: 0.0040 },
  { codigo: '43', desc: 'Madera nacional encofrado', delta: 0.0055 },
  { codigo: '44', desc: 'Madera terciada', delta: 0.0050 },
  { codigo: '47', desc: 'Mano de obra', delta: 0.0050 },
  { codigo: '48', desc: 'Maquinaria/equipo nac', delta: 0.0030 },
  { codigo: '72', desc: 'Tubería PVC', delta: 0.0035 },
  { codigo: '79', desc: 'Vidrio incoloro', delta: 0.0035 },
];

const MESES = [
  '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02', '2026-03', '2026-04',
];

const lines: string[] = [];
lines.push('iu_codigo,area,anio_mes,valor,resolucion_jefatural,fecha_publicacion');

for (const iu of IUS) {
  for (let i = 0; i < MESES.length; i++) {
    const valor = (100 * Math.pow(1 + iu.delta, i)).toFixed(4);
    const mes = MESES[i];
    const rj = `RJ-PLACEHOLDER-${mes}`;
    const fp = `${mes}-15`;
    lines.push(`${iu.codigo},lima,${mes},${valor},${rj},${fp}`);
  }
}

fs.mkdirSync(path.dirname(OUT_FIXTURE), { recursive: true });
fs.writeFileSync(OUT_FIXTURE, `${lines.join('\n')}\n`);

console.log(`✓ Fixture placeholder generado · ${OUT_FIXTURE}`);
console.log(`  ${IUS.length} IUs × ${MESES.length} meses = ${IUS.length * MESES.length} filas`);
console.log(`\n⚠ DATOS PLACEHOLDER · reemplazar con CSV INEI real cuando esté disponible`);
