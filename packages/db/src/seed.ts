import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { hash } = await import('@node-rs/argon2');
const { db } = await import('./client.js');
const { empresa, users } = await import('./schema.js');

console.log('🌱 Seeding initial data...');

// Empresa singleton
await db
  .insert(empresa)
  .values({
    id: 1,
    ruc: '20610639764',
    razonSocial: 'MM HIGH METRIK ENGINEERS S.A.C.',
    direccion: 'Av. República de Colombia 625 Of. 501, San Isidro, Lima',
    email: 'mmhighmetrik@gmail.com',
    telefono: '+51 955 137 140',
    web: 'www.mmhighmetrik.com',
  })
  .onConflictDoNothing();

console.log('✓ Empresa seeded');

// Usuario admin inicial
const passwordHash = await hash('admin', {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
});

await db
  .insert(users)
  .values({
    email: 'admin@mmhighmetrik.com',
    passwordHash,
    nombres: 'Admin',
    apellidos: 'Sistema',
    role: 'admin',
  })
  .onConflictDoNothing();

console.log('✓ Admin user · admin@mmhighmetrik.com / admin');

console.log('\n✅ Seed complete');
process.exit(0);
