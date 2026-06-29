/**
 * Contabilidad · ALTER asientos + periodos_contables + seed PCGE 2020.
 * Idempotente: ALTER IF NOT EXISTS · seed upsert por código.
 * Plan adaptado a constructora (MM HIGH METRIK · MYPE).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

// ── ALTERs ──
const alters = [
  `ALTER TABLE asientos ADD COLUMN IF NOT EXISTS periodo varchar(7);`,
  `ALTER TABLE asientos ADD COLUMN IF NOT EXISTS origen varchar(20) NOT NULL DEFAULT 'manual';`,
  `ALTER TABLE asientos ADD COLUMN IF NOT EXISTS origen_id uuid;`,
  `ALTER TABLE asientos ADD COLUMN IF NOT EXISTS moneda varchar(3) NOT NULL DEFAULT 'PEN';`,
  `ALTER TABLE asientos ADD COLUMN IF NOT EXISTS tipo_cambio numeric(8,4);`,
  // periodos_contables ya existe (migración drizzle · shape anio/mes/estado)
  `CREATE INDEX IF NOT EXISTS asientos_periodo_idx ON asientos (periodo);`,
  `CREATE INDEX IF NOT EXISTS asientos_origen_idx ON asientos (origen, origen_id);`,
];
for (const s of alters) { await sql.unsafe(s); }
console.log('✅ ALTERs aplicados');

// ── Seed PCGE 2020 · [codigo, descripcion, tipo] · nivel/parent derivados ──
type Row = [string, string, string];
const A = 'Activo', P = 'Pasivo', PT = 'Patrimonio', G = 'Gasto', I = 'Ingreso', C = 'Costo';
const CUENTAS: Row[] = [
  // CLASE 1 · ACTIVO DISPONIBLE Y EXIGIBLE
  ['10', 'Efectivo y equivalentes de efectivo', A],
  ['101', 'Caja', A],
  ['104', 'Cuentas corrientes en instituciones financieras', A],
  ['1041', 'Cuentas corrientes operativas', A],
  ['106', 'Depósitos en instituciones financieras', A],
  ['107', 'Fondos sujetos a restricción', A],
  ['1071', 'Detracciones · Banco de la Nación', A],
  ['12', 'Cuentas por cobrar comerciales – Terceros', A],
  ['121', 'Facturas, boletas y otros comprobantes por cobrar', A],
  ['1212', 'Emitidas en cartera', A],
  ['14', 'Cuentas por cobrar al personal, accionistas y directores', A],
  ['141', 'Personal', A],
  ['16', 'Cuentas por cobrar diversas – Terceros', A],
  ['161', 'Préstamos', A],
  ['168', 'Otras cuentas por cobrar diversas', A],
  ['18', 'Servicios y otros contratados por anticipado', A],
  ['182', 'Seguros', A],
  ['183', 'Alquileres', A],
  ['189', 'Otros gastos contratados por anticipado', A],
  ['19', 'Estimación de cuentas de cobranza dudosa', A],
  ['191', 'Cuentas por cobrar comerciales – Terceros', A],
  // CLASE 2 · EXISTENCIAS
  ['24', 'Materias primas', A],
  ['241', 'Materias primas para productos manufacturados', A],
  ['25', 'Materiales auxiliares, suministros y repuestos', A],
  ['251', 'Materiales auxiliares', A],
  ['252', 'Suministros', A],
  ['253', 'Repuestos', A],
  ['28', 'Existencias por recibir', A],
  // CLASE 3 · ACTIVO INMOVILIZADO
  ['32', 'Activos por derecho de uso', A],
  ['33', 'Propiedad, planta y equipo', A],
  ['331', 'Terrenos', A],
  ['332', 'Edificaciones', A],
  ['333', 'Maquinarias y equipos de explotación', A],
  ['334', 'Unidades de transporte', A],
  ['335', 'Muebles y enseres', A],
  ['336', 'Equipos diversos', A],
  ['337', 'Herramientas y unidades de reemplazo', A],
  ['34', 'Intangibles', A],
  ['343', 'Programas de computadora (software)', A],
  ['39', 'Depreciación y amortización acumulados', A],
  ['391', 'Depreciación acumulada · propiedad, planta y equipo', A],
  ['392', 'Amortización acumulada · intangibles', A],
  // CLASE 4 · PASIVO
  ['40', 'Tributos, contraprestaciones y aportes por pagar', P],
  ['401', 'Gobierno nacional', P],
  ['4011', 'Impuesto general a las ventas (IGV)', P],
  ['40111', 'IGV – cuenta propia', P],
  ['4017', 'Impuesto a la renta', P],
  ['40171', 'Renta de tercera categoría', P],
  ['40172', 'Renta de cuarta categoría (retenciones RH)', P],
  ['40173', 'Renta de quinta categoría', P],
  ['403', 'Instituciones públicas', P],
  ['4031', 'EsSalud', P],
  ['4032', 'ONP', P],
  ['4033', 'SENCICO', P],
  ['4039', 'Otras instituciones (CONAFOVICER)', P],
  ['407', 'Administradoras de fondos de pensiones (AFP)', P],
  ['41', 'Remuneraciones y participaciones por pagar', P],
  ['411', 'Remuneraciones por pagar', P],
  ['415', 'Beneficios sociales de los trabajadores por pagar', P],
  ['4151', 'Compensación por tiempo de servicios (CTS)', P],
  ['42', 'Cuentas por pagar comerciales – Terceros', P],
  ['421', 'Facturas, boletas y otros comprobantes por pagar', P],
  ['4212', 'Emitidas', P],
  ['422', 'Anticipos a proveedores', A],
  ['45', 'Obligaciones financieras', P],
  ['451', 'Préstamos de instituciones financieras', P],
  ['46', 'Cuentas por pagar diversas – Terceros', P],
  ['469', 'Otras cuentas por pagar diversas', P],
  ['48', 'Provisiones', P],
  ['481', 'Provisión para litigios', P],
  ['49', 'Pasivo diferido', P],
  // CLASE 5 · PATRIMONIO
  ['50', 'Capital', PT],
  ['501', 'Capital social', PT],
  ['58', 'Reservas', PT],
  ['582', 'Reserva legal', PT],
  ['59', 'Resultados acumulados', PT],
  ['591', 'Utilidades no distribuidas', PT],
  ['592', 'Pérdidas acumuladas', PT],
  // CLASE 6 · GASTOS POR NATURALEZA
  ['60', 'Compras', G],
  ['602', 'Materias primas', G],
  ['603', 'Materiales auxiliares, suministros y repuestos', G],
  ['609', 'Costos vinculados con las compras', G],
  ['61', 'Variación de existencias', G],
  ['612', 'Materias primas', G],
  ['613', 'Materiales auxiliares, suministros y repuestos', G],
  ['62', 'Gastos de personal, directores y gerentes', G],
  ['621', 'Remuneraciones', G],
  ['627', 'Seguridad y previsión social', G],
  ['6271', 'Régimen de prestaciones de salud (EsSalud)', G],
  ['6279', 'Otras contribuciones (CONAFOVICER)', G],
  ['629', 'Beneficios sociales de los trabajadores', G],
  ['63', 'Gastos de servicios prestados por terceros', G],
  ['631', 'Transporte, correos y gastos de viaje', G],
  ['632', 'Asesoría y consultoría', G],
  ['634', 'Mantenimiento y reparaciones', G],
  ['635', 'Alquileres', G],
  ['636', 'Servicios básicos (agua, luz, internet)', G],
  ['637', 'Publicidad, publicaciones y relaciones públicas', G],
  ['638', 'Servicios de contratistas (subcontratos obra)', G],
  ['639', 'Otros servicios prestados por terceros', G],
  ['64', 'Gastos por tributos', G],
  ['641', 'Gobierno nacional', G],
  ['6419', 'Otros (SENCICO)', G],
  ['65', 'Otros gastos de gestión', G],
  ['651', 'Seguros', G],
  ['659', 'Otros gastos de gestión', G],
  ['67', 'Gastos financieros', G],
  ['673', 'Intereses por préstamos', G],
  ['675', 'Diferencia de cambio (pérdida)', G],
  ['679', 'Otros gastos financieros (comisiones bancarias)', G],
  ['68', 'Valuación y deterioro de activos y provisiones', G],
  ['681', 'Depreciación', G],
  ['69', 'Costo de ventas', C],
  ['691', 'Costo de servicios de construcción', C],
  // CLASE 7 · INGRESOS
  ['70', 'Ventas', I],
  ['704', 'Prestación de servicios', I],
  ['7041', 'Servicios de construcción · terceros', I],
  ['75', 'Otros ingresos de gestión', I],
  ['759', 'Otros ingresos de gestión', I],
  ['77', 'Ingresos financieros', I],
  ['772', 'Rendimientos ganados (intereses)', I],
  ['776', 'Diferencia de cambio (ganancia)', I],
  ['79', 'Cargas imputables a cuentas de costos y gastos', I],
  ['791', 'Cargas imputables a cuentas de costos y gastos', I],
  // CLASE 8 · SALDOS INTERMEDIARIOS
  ['88', 'Impuesto a la renta', G],
  ['881', 'Impuesto a la renta – corriente', G],
  ['89', 'Determinación del resultado del ejercicio', PT],
  ['891', 'Utilidad', PT],
  ['892', 'Pérdida', PT],
  // CLASE 9 · ANALÍTICA (destino)
  ['92', 'Costos de producción (obras)', C],
  ['94', 'Gastos administrativos', C],
  ['95', 'Gastos de ventas', C],
  ['97', 'Gastos financieros (destino)', C],
];

const parentOf = (cod: string): string | null => {
  if (cod.length <= 2) return null;
  // padre = prefijo un nivel arriba (5→4, 4→3, 3→2 dígitos)
  return cod.slice(0, cod.length - 1);
};

let inserted = 0;
for (const [codigo, descripcion, tipo] of CUENTAS) {
  const nivel = codigo.length - 1; // 2díg=1 · 3díg=2 · 4díg=3 · 5díg=4
  const parent = parentOf(codigo);
  await sql`
    INSERT INTO plan_contable (codigo, descripcion, tipo, parent_codigo, nivel)
    VALUES (${codigo}, ${descripcion}, ${tipo}, ${parent}, ${nivel})
    ON CONFLICT (codigo) DO UPDATE SET descripcion = EXCLUDED.descripcion, tipo = EXCLUDED.tipo
  `;
  inserted++;
}
console.log(`✅ PCGE seed: ${inserted} cuentas`);
await sql.end();
process.exit(0);
