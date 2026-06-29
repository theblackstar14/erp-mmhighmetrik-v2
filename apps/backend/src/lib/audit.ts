// H1 · Audit trail real · helper único reutilizable → tabla audit_log (ya existía, estaba muerta).
// No-throw por diseño: el audit NUNCA debe romper la operación de negocio.
// (La tabla audit_log_immutable con hash-chain queda para tamper-evidence futuro.)
import { db, schema } from '@erp/db';
import type { Request } from 'express';

type AuditEvent = {
  action: string;        // create · anular · pago_oc · cobro_valo · cerrar_periodo · reabrir_periodo · update_104x · update_config
  entityType: string;    // movimiento · orden_compra · valorizacion · periodo · cuenta_bancaria · configuracion
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  motivo?: string | null;
};

export async function audit(req: Request, e: AuditEvent): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      userId: req.user?.id ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      changes: { before: e.before ?? null, after: e.after ?? null, motivo: e.motivo ?? null },
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  } catch (err) {
    console.warn(`[audit] fallo registrando ${e.action}/${e.entityType} (no rompe operación):`, (err as Error).message);
  }
}
