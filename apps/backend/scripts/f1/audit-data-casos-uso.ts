// Auditoría de data para los casos de uso con Kelly: ¿qué apartado de Finanzas/Contabilidad
// tiene data real y qué está vacío? Corre: tsx apps/backend/scripts/f1/audit-data-casos-uso.ts
import 'dotenv/config';
import { db } from '@erp/db';
import { sql } from 'drizzle-orm';

const q = async (label: string, query: string) => {
  try {
    const r: any = await db.execute(sql.raw(query));
    const rows = r.rows ?? r;
    console.log(`\n── ${label}`);
    for (const row of rows) console.log('   ' + JSON.stringify(row));
    if (!rows.length) console.log('   (vacío)');
  } catch (e: any) {
    console.log(`\n── ${label}\n   ERROR: ${e.message}`);
  }
};

const main = async () => {
  // el periodo efectivo es periodo_contable si viene, si no el mes de emisión (igual que contabilidad.ts)
  await q('COMPRAS · gastos por periodo contable efectivo', `
    select coalesce(periodo_contable, to_char(fecha,'YYYY-MM')) periodo, count(*) n, sum(total)::numeric(14,2) total,
           count(*) filter (where moneda <> 'PEN') usd,
           count(*) filter (where tipo_comprobante ilike '%nota de cr%') nc,
           count(*) filter (where periodo_contable is not null and periodo_contable <> to_char(fecha,'YYYY-MM')) anot_posterior,
           count(*) filter (where cuenta_contable is not null) cta_manual,
           count(*) filter (where orden_compra_id is not null) con_oc
    from gastos group by 1 order by 1`);

  // las provisiones 48 son movimientos con cuenta_contable 48xx (NO filas de documento_pendiente)
  await q('PROVISIONES 48 · movimientos + extornos', `
    select m.cuenta_contable, count(*) n, sum(m.monto)::numeric(14,2) monto,
           count(*) filter (where m.anulado is true) anulados,
           (select count(*) from asientos a where a.origen = 'extorno_provision') extornos
    from movimientos m where m.cuenta_contable like '48%' group by 1 order by 1`);

  await q('COMPRAS · detracciones (detraccion_documento)', `
    select estado, count(*) n, sum(monto)::numeric(14,2) monto,
           count(*) filter (where constancia_numero is not null) con_constancia
    from detraccion_documento group by 1`);

  await q('VENTAS · por periodo + tipo CPE', `
    select to_char(fecha_emision,'YYYY-MM') periodo, tipo_cpe, count(*) n, sum(total)::numeric(14,2) total,
           count(*) filter (where retencion_igv is not null and retencion_igv > 0) con_ret_igv
    from ventas group by 1,2 order by 1,2`);

  await q('VALORIZACIONES', `
    select status, count(*) n, sum(monto_total)::numeric(14,2) total,
           count(*) filter (where monto_retencion > 0) con_retencion,
           count(*) filter (where comprobante_serie is not null) facturadas
    from valorizaciones group by 1 order by 2 desc`);

  await q('CxP / CxC · documento_pendiente (incluye provisiones 48)', `
    select tipo, cuenta_control, estado, count(*) n, sum(saldo_pendiente)::numeric(14,2) saldo
    from documento_pendiente group by 1,2,3 order by 1,2`);

  await q('APLICACIONES (pagos contra documento)', `select estado, count(*) n, sum(monto_aplicado)::numeric(14,2) monto from aplicacion_documento group by 1`);

  await q('CAJAS de obra', `
    select c.estado, count(*) cajas, count(distinct c.proyecto_id) obras from cajas c group by 1`);

  await q('RENDICIONES de oficina', `
    select r.estado, count(*) n, sum(r.monto_anticipo)::numeric(14,2) anticipo, sum(r.monto_rendido)::numeric(14,2) rendido,
           (select count(*) from rendicion_items i where i.rendicion_id = any(array_agg(r.id))) items,
           (select count(*) from rendicion_items i where i.rendicion_id = any(array_agg(r.id)) and i.archivo is not null) con_archivo
    from rendiciones r group by 1`);

  await q('MOVIMIENTOS por periodo/tipo', `
    select to_char(fecha,'YYYY-MM') periodo, tipo_movimiento, count(*) n, sum(monto)::numeric(14,2) monto
    from movimientos where anulado is not true group by 1,2 order by 1,2`);

  await q('CONCILIACIÓN · extractos y líneas', `
    select e.nombre_archivo, e.banco, e.total_filas, count(l.id) lineas,
           count(l.id) filter (where l.movimiento_id is not null) conciliadas,
           count(l.id) filter (where l.movimiento_id is null) sueltas
    from extractos_bancarios e left join extracto_lineas l on l.extracto_id = e.id group by 1,2,3 order by 1`);

  await q('CONTABILIDAD · asientos por periodo', `
    select periodo, origen, status, count(*) n from asientos group by 1,2,3 order by 1,2`);

  await q('CONTABILIDAD · cuadre debe/haber por periodo', `
    select a.periodo, sum(l.debe)::numeric(14,2) debe, sum(l.haber)::numeric(14,2) haber,
           (sum(l.debe)-sum(l.haber))::numeric(14,2) dif, count(distinct l.cuenta) cuentas
    from asientos a join asientos_lineas l on l.asiento_id = a.id
    where a.status = 'registrado' group by 1 order by 1`);

  await q('CONTABILIDAD · catálogos', `
    select (select count(*) from plan_contable) cuentas_pcge,
           (select count(*) from gasto_cuenta_map) ruteo_filas,
           (select count(*) from tipo_cambio) tc_filas,
           (select min(fecha)::text || ' .. ' || max(fecha)::text from tipo_cambio) tc_rango,
           (select count(*) from detraccion_tasa) detraccion_tasas,
           (select count(*) from catalogo_sunat) catalogo_sunat,
           (select count(*) from mapa_cuenta_clase) mapa_clase`);

  await q('CIERRE / periodos contables', `
    select anio, mes, estado, count(*) n from periodos_contables group by 1,2,3 order by 1,2`);

  await q('CPE · bandeja', `select estado, clasificacion, tipo_cpe, count(*) n from cpe_bandeja group by 1,2,3 order by 1`);

  await q('OC disponibles para 3-way', `select estado, count(*) n, sum(total)::numeric(14,2) total from ordenes_compra group by 1`);

  await q('PROYECTOS', `select codigo, left(nombre,40) nombre, status from proyectos where deleted_at is null order by codigo`);

  process.exit(0);
};
main();
