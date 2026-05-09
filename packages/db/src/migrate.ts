import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh';

console.log('🔄 Running Drizzle migrations...');
const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') });
console.log('✅ Drizzle migrations applied');

// Post-migrate: SQL custom (triggers + functions inmutables)
const postMigratePath = path.resolve(__dirname, 'post-migrate.sql');
if (fs.existsSync(postMigratePath)) {
  console.log('🔧 Running post-migrate SQL custom (triggers + functions)...');
  const postSql = fs.readFileSync(postMigratePath, 'utf-8');
  // Drizzle separa con --> statement-breakpoint
  // Split por breakpoint · NO filtrar comentarios (Postgres los acepta)
  const statements = postSql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length === 0) return false;
      // Skip si solo contiene comentarios (sin SQL ejecutable)
      const sqlContent = s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim();
      return sqlContent.length > 0;
    });

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await sql.unsafe(stmt);
      process.stdout.write(`  ✓ statement ${i + 1}/${statements.length}\r`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Ignora "already exists" para idempotencia
      if (
        msg.includes('already exists') ||
        msg.includes('does not exist') && stmt.includes('DROP')
      ) {
        process.stdout.write(`  ~ statement ${i + 1}/${statements.length} (skip)\r`);
      } else {
        console.error(`\n❌ Error en statement ${i + 1}: ${msg.slice(0, 200)}`);
        throw err;
      }
    }
  }
  console.log(`\n✅ Post-migrate completado · ${statements.length} statements`);
}

await sql.end();
process.exit(0);
