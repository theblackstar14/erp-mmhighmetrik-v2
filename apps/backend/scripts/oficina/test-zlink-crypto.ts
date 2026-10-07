// Self-check del cifrado de contraseña Zlink (AES-256-CBC, key=MD5hex(salt+user), iv fijo).
// Importa cifrarPassword REAL, no una copia: si el esquema cambia en zlinkAsistencia.ts,
// el vector fijo de abajo deja de salir y esto falla. No toca red ni DB.
import { createDecipheriv, createHash } from 'node:crypto';
import { cifrarPassword } from '../../src/lib/zlinkAsistencia.js';

const SALT = 'ZlkLgInSeCetKKrEy:';
const IV = 'VrdMiseryEbcDzEK';

function descifrar(b64: string, user: string): string {
  const key = createHash('md5').update(SALT + user).digest('hex');
  const d = createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(IV, 'utf8'));
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
}

const assert = (c: boolean, m: string) => { if (!c) { console.error('✗', m); process.exit(1); } console.log('✓', m); };

const user = 'contador@mmhigh.com';
const pw = 'Cl4veSecreta!';

// Vector fijo congelado de NUESTRA implementación con el esquema reversiado del portal
// (salt + iv de la cabecera de zlinkAsistencia.ts). No viene de una captura del portal:
// lo que pinnea es la deriva nuestra. Si alguien cambia salt, iv o modo, esto falla antes
// de que el login contra Zlink empiece a dar 401 en producción.
const ESPERADO = 'FhzauVut3ft0RUHrGDk4MA==';

assert(cifrarPassword(pw, user) === ESPERADO, `vector fijo congelado (esperado ${ESPERADO})`);
assert(descifrar(cifrarPassword(pw, user), user) === pw, 'round-trip descifra al original');
assert(cifrarPassword(pw, 'otro@user.com') !== ESPERADO, 'user distinto → ciphertext distinto (key depende del user)');
assert(createHash('md5').update(SALT + user).digest('hex').length === 32, 'key MD5hex = 32 chars (AES-256)');
assert(IV.length === 16, 'iv = 16 bytes');

console.log('\n✅ cifrado Zlink OK · esquema estable');
process.exit(0);
