import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Enums ───────────────────────────────────────────────────
export const userRoleEnum = pgEnum('user_role', ['admin', 'gerente', 'residente', 'contadora', 'almacen']);
export const projectStatusEnum = pgEnum('project_status', ['licitacion', 'adjudicado', 'ejecucion', 'liquidacion', 'cerrado', 'cancelado']);
export const projectModalityEnum = pgEnum('project_modality', ['suma_alzada', 'precios_unitarios', 'mixto', 'llave_en_mano']);
export const trabajadorCategoriaEnum = pgEnum('trabajador_categoria', ['Capataz', 'Operario', 'Oficial', 'Peon']);
export const trabajadorEstadoEnum = pgEnum('trabajador_estado', ['Activo', 'Permiso', 'Vacaciones', 'Cesado']);
export const valorizacionStatusEnum = pgEnum('valorizacion_status', ['borrador', 'emitida', 'aprobada', 'cobrada', 'rechazada']);
export const asientoStatusEnum = pgEnum('asiento_status', ['borrador', 'registrado', 'cerrado', 'anulado']);

// ─── Auth · Users + Sessions ─────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  nombres: varchar('nombres', { length: 100 }).notNull(),
  apellidos: varchar('apellidos', { length: 100 }).notNull(),
  role: userRoleEnum('role').notNull().default('admin'),
  activo: boolean('activo').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

// ─── Empresa (singleton) ─────────────────────────────────────
export const empresa = pgTable('empresa', {
  id: integer('id').primaryKey().default(1),
  ruc: varchar('ruc', { length: 11 }).notNull(),
  razonSocial: varchar('razon_social', { length: 255 }).notNull(),
  direccion: text('direccion'),
  email: varchar('email', { length: 255 }),
  telefono: varchar('telefono', { length: 30 }),
  web: varchar('web', { length: 255 }),
  logoUrl: text('logo_url'),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Clientes (entidades públicas / privadas) ────────────────
export const clientes = pgTable('clientes', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruc: varchar('ruc', { length: 11 }).unique(),
  razonSocial: varchar('razon_social', { length: 255 }).notNull(),
  tipo: varchar('tipo', { length: 50 }).notNull().default('publico'), // publico | privado
  tipoEntidad: varchar('tipo_entidad', { length: 100 }), // municipalidad · gobierno_regional · ministerio · privado
  contacto: varchar('contacto', { length: 100 }),
  email: varchar('email', { length: 255 }),
  telefono: varchar('telefono', { length: 30 }),
  direccion: text('direccion'),
  representante: varchar('representante', { length: 200 }),
  dniRepresentante: varchar('dni_representante', { length: 12 }),
  cargoRepresentante: varchar('cargo_representante', { length: 100 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── Proyectos ────────────────────────────────────────────────
export const proyectos = pgTable(
  'proyectos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: varchar('codigo', { length: 50 }).notNull().unique(), // OB-2026-009
    nombre: varchar('nombre', { length: 500 }).notNull(),
    clienteId: uuid('cliente_id').references(() => clientes.id, { onDelete: 'set null' }),
    ubicacion: text('ubicacion'),
    lat: decimal('lat', { precision: 10, scale: 6 }),
    lng: decimal('lng', { precision: 10, scale: 6 }),
    tipo: varchar('tipo', { length: 100 }), // Edificación · Saneamiento · Vial · etc
    modalidad: projectModalityEnum('modalidad').default('suma_alzada'),
    status: projectStatusEnum('status').notNull().default('licitacion'),

    // Montos
    costoDirecto: decimal('costo_directo', { precision: 14, scale: 2 }).default('0'),
    costoDirectoSinIgv: decimal('costo_directo_sin_igv', { precision: 14, scale: 2 }).default('0'),
    igvEnXml: boolean('igv_en_xml').default(true),
    pctGg: decimal('pct_gg', { precision: 5, scale: 4 }).default('0.10'),
    pctUtilidad: decimal('pct_utilidad', { precision: 5, scale: 4 }).default('0.10'),
    montoSubtotal: decimal('monto_subtotal', { precision: 14, scale: 2 }).default('0'),
    montoIgv: decimal('monto_igv', { precision: 14, scale: 2 }).default('0'),
    montoContractual: decimal('monto_contractual', { precision: 14, scale: 2 }).default('0'),

    // Plazos
    fechaInicio: date('fecha_inicio'),
    fechaFin: date('fecha_fin'),
    diasPlazo: integer('dias_plazo'),

    // Identificación contractual (sector público)
    numeroContrato: varchar('numero_contrato', { length: 80 }), // 037-2025-GAF-MSS
    numeroProcesoLicitacion: varchar('numero_proceso_licitacion', { length: 80 }), // 004-2025-CS-MSS-1
    cui: varchar('cui', { length: 30 }), // Código Único Inversión 2658565 (obras públicas)
    etapa: varchar('etapa', { length: 30 }), // Etapa I, Etapa II
    marcoLegal: text('marco_legal'), // Ley 32069 + DS 009-2025-EF
    fechaBuenaPro: date('fecha_buena_pro'),
    fechaConsentimiento: date('fecha_consentimiento'),
    fechaFirmaContrato: date('fecha_firma_contrato'),
    fechaActaInicio: date('fecha_acta_inicio'),

    // Contractual · adelantos
    pctAdelantoDirecto: decimal('pct_adelanto_directo', { precision: 5, scale: 4 }),
    pctAdelantoMateriales: decimal('pct_adelanto_materiales', { precision: 5, scale: 4 }),
    pctAdelantoAvance: decimal('pct_adelanto_avance', { precision: 5, scale: 4 }), // 10% adicional cláusula

    // Garantías · % retención + fiel cumplimiento
    pctRetencion: decimal('pct_retencion', { precision: 5, scale: 4 }),
    pctFielCumplimiento: decimal('pct_fiel_cumplimiento', { precision: 5, scale: 4 }),

    // Penalidades
    formulaPenalidadMora: text('formula_penalidad_mora'), // "0.10 × monto / (F × plazo)"
    factorFPenalidad: decimal('factor_f_penalidad', { precision: 5, scale: 3 }), // 0.40 / 0.25 / 0.15
    pctPenalidadDia: decimal('pct_penalidad_dia', { precision: 7, scale: 6 }),
    pctPenalidadTope: decimal('pct_penalidad_tope', { precision: 5, scale: 4 }), // 10% típico

    // Fórmula Polinómica (JSON: { coeficientes: {a,b,c,d,e}, monomios: [...] })
    formulaPolinomica: jsonb('formula_polinomica').$type<{
      coeficientes: Record<string, number>;
      monomios: Array<{ letra: string; concepto: string; indiceInei: string }>;
    } | null>(),

    // Riesgo · análisis IA
    risk: varchar('risk', { length: 20 }).default('medium'), // low | medium | high
    nasFolder: text('nas_folder'), // /Proyectos/OB-2026-009

    // Meta
    ganttFile: text('gantt_file'), // path al XML
    managerId: uuid('manager_id').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => ({
    statusIdx: index('proyectos_status_idx').on(t.status),
    codigoIdx: index('proyectos_codigo_idx').on(t.codigo),
  }),
);

// ─── Partidas (jerárquicas) ──────────────────────────────────
export const partidas = pgTable(
  'partidas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    codigo: varchar('codigo', { length: 50 }).notNull(), // 1.2.1.1
    parentCodigo: varchar('parent_codigo', { length: 50 }),
    nivel: integer('nivel').notNull(),
    nombre: text('nombre').notNull(),
    unidad: varchar('unidad', { length: 20 }),
    cantidad: decimal('cantidad', { precision: 14, scale: 4 }),
    precioUnitario: decimal('precio_unitario', { precision: 14, scale: 4 }),
    presupuesto: decimal('presupuesto', { precision: 14, scale: 2 }).default('0'),
    duracionDias: integer('duracion_dias'),
    fechaInicio: date('fecha_inicio'),
    fechaFin: date('fecha_fin'),
    isSummary: boolean('is_summary').default(false),
    isMilestone: boolean('is_milestone').default(false),
    isCritical: boolean('is_critical').default(false),
    percentComplete: decimal('percent_complete', { precision: 5, scale: 2 }).default('0'),
    predecessors: jsonb('predecessors').$type<string[]>().default([]),
    orden: integer('orden').default(0),
  },
  (t) => ({
    proyectoIdx: index('partidas_proyecto_idx').on(t.proyectoId),
    codigoIdx: index('partidas_codigo_idx').on(t.proyectoId, t.codigo),
  }),
);

// ─── Avances (histórico timestamped) ─────────────────────────
export const avances = pgTable(
  'avances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partidaId: uuid('partida_id').notNull().references(() => partidas.id, { onDelete: 'cascade' }),
    fecha: timestamp('fecha').notNull().defaultNow(),
    avancePct: decimal('avance_pct', { precision: 5, scale: 2 }).notNull(),
    realCost: decimal('real_cost', { precision: 14, scale: 2 }).notNull().default('0'),
    nota: text('nota'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    partidaIdx: index('avances_partida_idx').on(t.partidaId, t.fecha),
  }),
);

// ─── Valorizaciones ──────────────────────────────────────────
export const valorizaciones = pgTable(
  'valorizaciones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    numero: integer('numero').notNull(),
    fechaDesde: date('fecha_desde').notNull(),
    fechaHasta: date('fecha_hasta').notNull(),
    fechaEmision: date('fecha_emision').notNull().defaultNow(),
    montoCd: decimal('monto_cd', { precision: 14, scale: 2 }).notNull(),
    montoIgv: decimal('monto_igv', { precision: 14, scale: 2 }).notNull(),
    montoTotal: decimal('monto_total', { precision: 14, scale: 2 }).notNull(),
    pctAvance: decimal('pct_avance', { precision: 5, scale: 2 }).notNull(),
    factorReajusteK: decimal('factor_reajuste_k', { precision: 7, scale: 6 }), // FP
    montoReajuste: decimal('monto_reajuste', { precision: 14, scale: 2 }),
    status: valorizacionStatusEnum('status').notNull().default('borrador'),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>(), // copia inmutable rows
    observaciones: text('observaciones'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('val_proyecto_idx').on(t.proyectoId),
    numeroUq: index('val_numero_uq').on(t.proyectoId, t.numero),
  }),
);

// ─── Trabajadores (personal de obra · CAPECO) ────────────────
export const trabajadores = pgTable(
  'trabajadores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    dni: varchar('dni', { length: 8 }).notNull(),
    nombres: varchar('nombres', { length: 100 }).notNull(),
    apellidos: varchar('apellidos', { length: 100 }).notNull(),
    fechaNacimiento: date('fecha_nacimiento'),
    categoria: trabajadorCategoriaEnum('categoria').notNull(),
    especialidad: varchar('especialidad', { length: 50 }),
    jornal: decimal('jornal', { precision: 10, scale: 2 }).notNull(),
    fechaIngreso: date('fecha_ingreso').notNull(),
    estado: trabajadorEstadoEnum('estado').notNull().default('Activo'),
    sctrVigencia: date('sctr_vigencia'),
    regimen: varchar('regimen', { length: 50 }).default('Eventual por obra'),
    telefono: varchar('telefono', { length: 30 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    dniUq: index('trab_dni_proyecto_uq').on(t.proyectoId, t.dni),
  }),
);

// ─── Equipo profesional asignado ─────────────────────────────
export const equipoProyecto = pgTable(
  'equipo_proyecto',
  {
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    rol: varchar('rol', { length: 100 }).notNull(), // Residente · Supervisor · Capataz · etc
    asignadoEn: timestamp('asignado_en').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.proyectoId, t.userId] }),
  }),
);

// ─── Plan Contable (PCGE 2020) ───────────────────────────────
export const planContable = pgTable('plan_contable', {
  codigo: varchar('codigo', { length: 10 }).primaryKey(),
  descripcion: text('descripcion').notNull(),
  tipo: varchar('tipo', { length: 30 }).notNull(), // Activo · Pasivo · Patrimonio · Ingreso · Gasto · Costo
  parentCodigo: varchar('parent_codigo', { length: 10 }),
  nivel: integer('nivel').notNull(),
});

// ─── Asientos contables ──────────────────────────────────────
export const asientos = pgTable(
  'asientos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    correlativo: varchar('correlativo', { length: 20 }).notNull(), // AS-0001
    fecha: date('fecha').notNull(),
    glosa: text('glosa').notNull(),
    docOrigen: varchar('doc_origen', { length: 50 }),
    tipoDoc: varchar('tipo_doc', { length: 50 }),
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }),
    contraparteRuc: varchar('contraparte_ruc', { length: 11 }),
    contraparteRazon: varchar('contraparte_razon', { length: 255 }),
    status: asientoStatusEnum('status').notNull().default('borrador'),
    cerradoMes: varchar('cerrado_mes', { length: 7 }), // YYYY-MM si está cerrado
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    fechaIdx: index('asientos_fecha_idx').on(t.fecha),
    correlativoUq: index('asientos_correlativo_uq').on(t.correlativo),
    proyectoIdx: index('asientos_proyecto_idx').on(t.proyectoId),
  }),
);

export const asientosLineas = pgTable(
  'asientos_lineas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    asientoId: uuid('asiento_id').notNull().references(() => asientos.id, { onDelete: 'cascade' }),
    correlativo: integer('correlativo').notNull(), // 1,2,3...
    cuenta: varchar('cuenta', { length: 10 }).notNull(),
    descripcion: text('descripcion'),
    debe: decimal('debe', { precision: 14, scale: 2 }).default('0'),
    haber: decimal('haber', { precision: 14, scale: 2 }).default('0'),
  },
  (t) => ({
    asientoIdx: index('lineas_asiento_idx').on(t.asientoId),
    cuentaIdx: index('lineas_cuenta_idx').on(t.cuenta),
  }),
);

// ─── Consorcios · empresas integrantes (cuando contratista = consorcio) ───
export const consorciosIntegrantes = pgTable(
  'consorcios_integrantes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    nombreConsorcio: varchar('nombre_consorcio', { length: 200 }), // CONSORCIO LIMA
    razonSocial: varchar('razon_social', { length: 255 }).notNull(),
    ruc: varchar('ruc', { length: 11 }).notNull(),
    pctParticipacion: decimal('pct_participacion', { precision: 5, scale: 4 }), // 0.5000 = 50%
    representanteComun: varchar('representante_comun', { length: 200 }),
    dniRepresentante: varchar('dni_representante', { length: 12 }),
    domicilioComun: text('domicilio_comun'),
    emailNotificaciones: varchar('email_notificaciones', { length: 255 }),
    esLider: boolean('es_lider').default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('consorcios_proyecto_idx').on(t.proyectoId),
  }),
);

// ─── Garantías ────────────────────────────────────────────────
export const garantiaTipoEnum = pgEnum('garantia_tipo', [
  'fiel_cumplimiento',
  'adelanto_directo',
  'adelanto_materiales',
  'adelanto_avance',
  'retencion',
  'beneficios_sociales',
]);

export const garantias = pgTable(
  'garantias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    tipo: garantiaTipoEnum('tipo').notNull(),
    numeroCarta: varchar('numero_carta', { length: 80 }),
    monto: decimal('monto', { precision: 14, scale: 2 }).notNull(),
    bancoEmisor: varchar('banco_emisor', { length: 100 }),
    fechaEmision: date('fecha_emision'),
    vigenciaDesde: date('vigencia_desde'),
    vigenciaHasta: date('vigencia_hasta'),
    estado: varchar('estado', { length: 30 }).notNull().default('vigente'), // vigente · vencida · ejecutada · devuelta
    adjuntoNas: text('adjunto_nas'), // ruta NAS al PDF
    notas: text('notas'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('garantias_proyecto_idx').on(t.proyectoId),
  }),
);

// ─── Adelantos solicitados/recibidos ─────────────────────────
export const adelantoEstadoEnum = pgEnum('adelanto_estado', ['solicitado', 'aprobado', 'pagado', 'amortizado', 'rechazado']);

export const adelantos = pgTable(
  'adelantos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    tipo: garantiaTipoEnum('tipo').notNull(), // reuse enum tipo (directo · materiales · avance)
    monto: decimal('monto', { precision: 14, scale: 2 }).notNull(),
    pctMontoContrato: decimal('pct_monto_contrato', { precision: 5, scale: 4 }),
    fechaSolicitud: date('fecha_solicitud'),
    fechaPago: date('fecha_pago'),
    estado: adelantoEstadoEnum('estado').notNull().default('solicitado'),
    montoAmortizado: decimal('monto_amortizado', { precision: 14, scale: 2 }).default('0'),
    notas: text('notas'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('adelantos_proyecto_idx').on(t.proyectoId),
  }),
);

// ─── Penalidades catálogo + aplicadas ────────────────────────
export const penalidadesCatalogo = pgTable(
  'penalidades_catalogo',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    numero: integer('numero').notNull(), // 1, 2, 3... según contrato
    supuesto: text('supuesto').notNull(), // descripción del supuesto
    formula: text('formula').notNull(), // "0.5% del monto valorización" · "5.5 UIT"
    procedimiento: text('procedimiento'),
    activo: boolean('activo').default(true),
  },
  (t) => ({
    proyectoIdx: index('pen_cat_proyecto_idx').on(t.proyectoId),
  }),
);

export const penalidadesAplicadas = pgTable(
  'penalidades_aplicadas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    catalogoId: uuid('catalogo_id').references(() => penalidadesCatalogo.id, { onDelete: 'set null' }),
    valorizacionId: uuid('valorizacion_id').references(() => valorizaciones.id, { onDelete: 'set null' }),
    tipo: varchar('tipo', { length: 50 }).notNull(), // mora · uit · pct_valorizacion
    fechaAplicacion: date('fecha_aplicacion').notNull(),
    montoBase: decimal('monto_base', { precision: 14, scale: 2 }),
    monto: decimal('monto', { precision: 14, scale: 2 }).notNull(),
    diasRetraso: integer('dias_retraso'),
    justificacion: text('justificacion'),
    informeSupervisor: text('informe_supervisor'),
    descargoContratista: text('descargo_contratista'),
    estado: varchar('estado', { length: 30 }).default('aplicada'), // aplicada · justificada · anulada
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('pen_apl_proyecto_idx').on(t.proyectoId),
  }),
);

// ─── Valorización · checklist documentos requeridos ──────────
export const valorizacionChecklist = pgTable(
  'valorizacion_checklist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    valorizacionId: uuid('valorizacion_id').notNull().references(() => valorizaciones.id, { onDelete: 'cascade' }),
    item: varchar('item', { length: 100 }).notNull(), // panel_fotografico · sctr · car · conafoviserv · sencico · cuaderno · curva_s · etc
    descripcion: text('descripcion'),
    cumple: boolean('cumple').default(false),
    adjuntoNas: text('adjunto_nas'),
    notas: text('notas'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    valorizacionIdx: index('val_checklist_idx').on(t.valorizacionId),
  }),
);

// ─── Audit log ────────────────────────────────────────────────
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(), // create · update · delete · login · etc
  entityType: varchar('entity_type', { length: 50 }), // proyecto · partida · asiento · etc
  entityId: text('entity_id'),
  changes: jsonb('changes').$type<Record<string, unknown>>(),
  ip: varchar('ip', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── Type exports ─────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Proyecto = typeof proyectos.$inferSelect;
export type NewProyecto = typeof proyectos.$inferInsert;
export type Partida = typeof partidas.$inferSelect;
export type NewPartida = typeof partidas.$inferInsert;
export type Avance = typeof avances.$inferSelect;
export type NewAvance = typeof avances.$inferInsert;
export type Valorizacion = typeof valorizaciones.$inferSelect;
export type Trabajador = typeof trabajadores.$inferSelect;
export type Asiento = typeof asientos.$inferSelect;
export type AsientoLinea = typeof asientosLineas.$inferSelect;
export type Cliente = typeof clientes.$inferSelect;
export type ConsorcioIntegrante = typeof consorciosIntegrantes.$inferSelect;
export type Garantia = typeof garantias.$inferSelect;
export type Adelanto = typeof adelantos.$inferSelect;
export type PenalidadCatalogo = typeof penalidadesCatalogo.$inferSelect;
export type PenalidadAplicada = typeof penalidadesAplicadas.$inferSelect;
