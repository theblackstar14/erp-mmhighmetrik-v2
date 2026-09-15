/**
 * Genera data/pcge-2010.json desde el PDF del PCGE que pasó el cliente (edición 2010).
 * Si Kelly confirma el PCGE modificado 2019, se vuelve a correr con ese PDF.
 *   pnpm --filter @erp/db exec tsx src/generadores/gen-pcge.ts "C:/Users/gabri/Downloads/Gabriel/DOCUMENTOS PARA GABRIEL/DINAMICA CONTABLE - PLAN CONTABLE.pdf"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extraerCuentasPcge, ultimoSinDescripcion } from './pcge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const origen = process.argv[2];
if (!origen) throw new Error('uso: gen-pcge.ts <ruta PDF PCGE>');

// pdf-parse v2 usa clase PDFParse; import dinámico porque el import estático falla en runtime bajo tsx
// (mismo patrón que packages/db/src/importers/formula-polinomica.ts).
const { PDFParse } = await import('pdf-parse');
const parser = new PDFParse({ data: fs.readFileSync(origen) });
const res = await parser.getText();
const texto = res.pages.map((p: { num: number; text: string }) => `=== PAGINA ${p.num}\n${p.text}`).join('\n');
const cuentas = extraerCuentasPcge(texto);

const destino = path.resolve(__dirname, '../data/pcge-2010.json');
fs.writeFileSync(destino, `${JSON.stringify({ fuente: `PCGE 2010 · ${path.basename(origen)}`, cuentas }, null, 1)}\n`);
const porNivel = cuentas.reduce<Record<number, number>>((a, c) => ((a[c.nivel] = (a[c.nivel] ?? 0) + 1), a), {});
console.log(`${cuentas.length} cuentas · por nivel ${JSON.stringify(porNivel)} · ${ultimoSinDescripcion} codigos en linea propia sin descripcion (descartados) →`, destino);
