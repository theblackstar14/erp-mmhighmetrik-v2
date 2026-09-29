/**
 * F8 · Test descargas PLE/SIRE (in-process, router real, data real del periodo).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/test-ple-descargas.ts
 * Por libro: status 200, nombre LE… oficial en Content-Disposition, conteo de campos por línea
 * (5.1/6.1=21, 8.1=41, 14.1=34 con pipe final · RCE=32/RVIE=40 sin pipe final), CRLF,
 * periodo AAAAMM00, correlativo A/M/C, montos 2 decimales. No escribe nada. Exit 0 = verde.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import { lucia } from '../../src/auth.js';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const PERIODOS = ['2026-01', '2026-02']; // 01 = compras/diario real · 02 = valo facturada (ejercita 14.1/RVIE)

// campos oficiales (XLS SUNAT Anexo 2 Ver 5) · PLE lleva pipe final, SIRE no
const LIBROS: Record<string, { campos: number; codigo?: string; sire?: boolean }> = {
  '5.1': { campos: 21, codigo: '050100' },
  '6.1': { campos: 21, codigo: '060100' },
  '8.1': { campos: 41, codigo: '080100' },
  '14.1': { campos: 34, codigo: '140100' },
  RCE: { campos: 32, sire: true },
  RVIE: { campos: 40, sire: true },
};

(async () => {
  let failed = false;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/contabilidad', contabilidadRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();

  try {
    for (const PERIODO of PERIODOS) {
    const AAAAMM = PERIODO.replace('-', '');
    console.log(`════ F8 · descargas PLE/SIRE · periodo ${PERIODO} ════`);
    for (const [libro, def] of Object.entries(LIBROS)) {
      const r = await fetch(`http://localhost:${port}/api/contabilidad/ple?periodo=${PERIODO}&libro=${encodeURIComponent(libro)}`, { headers: { cookie } });
      assert.equal(r.status, 200, `${libro}: status ${r.status}`);
      const cd = r.headers.get('content-disposition') ?? '';
      const nombre = /filename="([^"]+)"/.exec(cd)?.[1] ?? '';
      const body = await r.text();
      const lineas = body.split('\r\n').filter((l) => l.length > 0);

      if (def.sire) {
        assert.match(nombre, new RegExp(`^SIRE_${libro}_${AAAAMM}\\.txt$`), `${libro}: nombre SIRE (${nombre})`);
      } else {
        // LE + RUC(11) + AAAA MM 00 + código(6) + 00 + oper(1) + contenido(1) + moneda(1) + generado(1)
        assert.match(nombre, new RegExp(`^LE\\d{11}${AAAAMM}00${def.codigo}00[01]1[12]1\\.TXT$`), `${libro}: nombre PLE (${nombre})`);
        const oper = nombre.charAt(2 + 11 + 8 + 6 + 2); // indicador de operaciones
        assert.equal(oper, lineas.length > 0 ? '1' : '0', `${libro}: indicador operaciones=${oper} con ${lineas.length} líneas`);
        if (lineas.length > 0) assert.ok(body.endsWith('\r\n'), `${libro}: última línea debe terminar en CRLF`);
      }

      for (const [i, l] of lineas.entries()) {
        const partes = l.split('|');
        const nCampos = def.sire ? partes.length : partes.length - 1; // PLE: pipe final → última parte vacía
        assert.equal(nCampos, def.campos, `${libro} línea ${i + 1}: ${nCampos} campos ≠ ${def.campos}\n  ${l}`);
        if (!def.sire) {
          assert.equal(partes[def.campos], '', `${libro} línea ${i + 1}: falta pipe final`);
          assert.equal(partes[0], `${AAAAMM}00`, `${libro} línea ${i + 1}: periodo ${partes[0]}`);
        }
        if (libro === '5.1' || libro === '6.1') {
          assert.match(partes[2], /^[AMC]/, `${libro} línea ${i + 1}: correlativo ${partes[2]} no inicia A/M/C`);
          assert.match(partes[17], /^\d+\.\d{2}$/, `${libro} línea ${i + 1}: debe ${partes[17]}`);
          assert.match(partes[18], /^\d+\.\d{2}$/, `${libro} línea ${i + 1}: haber ${partes[18]}`);
          assert.match(partes[12], /^\d{2}\/\d{2}\/\d{4}$/, `${libro} línea ${i + 1}: fecha ${partes[12]}`);
          assert.equal(partes[20], '1', `${libro} línea ${i + 1}: estado ${partes[20]}`);
        }
        if (libro === '8.1') assert.match(partes[40], /^[169]$/, `8.1 línea ${i + 1}: estado ${partes[40]}`);
        if (libro === '14.1') assert.match(partes[33], /^[1289]$/, `14.1 línea ${i + 1}: estado ${partes[33]}`);
      }
      console.log(`  ✓ ${libro.padEnd(4)} ${String(lineas.length).padStart(4)} líneas · ${def.campos} campos · ${nombre}`);
    }

    // 5.1 debe cuadrar: Σdebe = Σhaber
    const rd = await fetch(`http://localhost:${port}/api/contabilidad/ple?periodo=${PERIODO}&libro=5.1`, { headers: { cookie } });
    const ld = (await rd.text()).split('\r\n').filter(Boolean);
    const sd = ld.reduce((s, l) => s + Number(l.split('|')[17]), 0);
    const sh = ld.reduce((s, l) => s + Number(l.split('|')[18]), 0);
    assert.ok(Math.abs(sd - sh) < 0.01, `5.1 descuadrado: debe ${sd.toFixed(2)} ≠ haber ${sh.toFixed(2)}`);
    console.log(`  ✓ 5.1 cuadra · debe = haber = S/ ${sd.toFixed(2)}`);
    }

    // libro inválido → 400
    const rb = await fetch(`http://localhost:${port}/api/contabilidad/ple?periodo=2026-01&libro=9.9`, { headers: { cookie } });
    assert.equal(rb.status, 400, 'libro inválido debe dar 400');
    console.log('  ✓ libro inválido → 400');

    console.log('\n✅ F8 descargas PLE/SIRE · TODO VERDE');
  } catch (e) {
    failed = true;
    console.error('\n❌', e instanceof Error ? e.message : e);
  } finally {
    await lucia.invalidateSession(session.id);
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
