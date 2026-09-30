import { DrizzlePostgreSQLAdapter } from '@lucia-auth/adapter-drizzle';
import { db, schema } from '@erp/db';
import { Lucia } from 'lucia';
import { env } from './env.js';

const adapter = new DrizzlePostgreSQLAdapter(db, schema.sessions, schema.users);

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    expires: false,
    attributes: {
      secure: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  },
  getUserAttributes: (attrs) => ({
    email: attrs.email,
    nombres: attrs.nombres,
    apellidos: attrs.apellidos,
    role: attrs.role,
  }),
});

declare module 'lucia' {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: {
      email: string;
      nombres: string;
      apellidos: string;
      role: 'admin' | 'gerente' | 'residente' | 'contadora' | 'almacen';
    };
  }
}
