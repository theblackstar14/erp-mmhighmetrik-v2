/**
 * La cookie de sesión no debe salir `Secure` cuando se sirve por HTTP plano (demo por IP): el
 * navegador la descarta y el login responde 200 pero rebota al login, sin mensaje.
 *   COOKIE_SECURE=0 NODE_ENV=production node <tsx> scripts/f1/test-cookie-secure.ts
 * Corre los 3 casos en subprocesos porque env.ts parsea el entorno una sola vez, al importar.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = fileURLToPath(import.meta.url);
const CASOS: [Record<string, string>, boolean, string][] = [
  [{ NODE_ENV: 'production' }, true, 'producción sin override → Secure (comportamiento de siempre)'],
  [{ NODE_ENV: 'production', COOKIE_SECURE: '0' }, false, 'producción + COOKIE_SECURE=0 → sin Secure (demo por IP)'],
  [{ NODE_ENV: 'development' }, false, 'desarrollo → sin Secure'],
];

if (process.env.CASO_COOKIE) {
  const { lucia } = await import('../../src/auth.js');
  process.stdout.write(lucia.createSessionCookie('x').serialize());
} else {
  for (const [envCaso, esperaSecure, desc] of CASOS) {
    // execArgv arrastra el loader de tsx al subproceso (si no, node no sabe leer el .ts)
    const salida = execFileSync(process.execPath, [...process.execArgv, AQUI], {
      env: { ...process.env, ...envCaso, CASO_COOKIE: '1' },
      encoding: 'utf8',
    });
    const tieneSecure = /;\s*Secure/i.test(salida);
    assert.equal(tieneSecure, esperaSecure, `${desc} · cookie: ${salida}`);
    console.log(`  ✓ ${desc}`);
  }
  console.log('✅ COOKIE_SECURE controla el flag Secure');
}
