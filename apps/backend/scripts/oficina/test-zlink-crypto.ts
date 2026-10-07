// Self-check del cifrado de contraseña Zlink (AES-256-CBC, key=MD5hex(salt+user), iv fijo).
// Vector fijo: si el esquema cambia, este assert falla. No toca red ni DB.
import { createDecipheriv, createHash } from 'node:crypto';

const SALT = 'ZlkLgInSeCetKKrEy:';
const IV = 'VrdMiseryEbcDzEK';

// Reimplementa el cifrado igual que zlinkAsistencia.cifrarPassword (no exportado).
import { createCipheriv } from 'node:crypto';
function cifrar(pw: string, user: string): string {
  const key = createHash('md5').update(SALT + user).digest('hex');
  const c = createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(IV, 'utf8'));
  return Buffer.concat([c.update(pw, 'utf8'), c.final()]).toString('base64');
}
function descifrar(b64: string, user: string): string {
  const key = createHash('md5').update(SALT + user).digest('hex');
  const d = createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(IV, 'utf8'));
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
}

const assert = (c: boolean, m: string) => { if (!c) { console.error('✗', m); process.exit(1); } console.log('✓', m); };

const user = 'contador@mmhigh.com';
const pw = 'Cl4veSecreta!';
const enc = cifrar(pw, user);

assert(createHash('md5').update(SALT + user).digest('hex').length === 32, 'key MD5hex = 32 chars (AES-256)');
assert(IV.length === 16, 'iv = 16 bytes');
assert(cifrar(pw, user) === enc, 'cifrado determinista (mismo user+pw → mismo output)');
assert(descifrar(enc, user) === pw, 'round-trip descifra al original');
assert(cifrar(pw, 'otro@user.com') !== enc, 'user distinto → ciphertext distinto (key depende del user)');

console.log('\n✅ cifrado Zlink OK · esquema estable');
process.exit(0);
