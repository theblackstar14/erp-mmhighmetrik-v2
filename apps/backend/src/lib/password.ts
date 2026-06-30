// Hash de contraseña (argon2id · mismos params en todo el backend) + clave temporal.
import { randomInt } from 'node:crypto';
import { hash } from '@node-rs/argon2';

const OPTS = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 };

export const hashPassword = (pw: string) => hash(pw, OPTS);

// Clave temporal legible para que el admin se la entregue al usuario (sin 0/O/1/I/l).
export function genTempPassword(len = 10): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += abc[randomInt(abc.length)];
  return s;
}
