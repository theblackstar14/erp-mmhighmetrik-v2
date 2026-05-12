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

// F3 · Compras / Logística
export const reqUrgenciaEnum = pgEnum('req_urgencia', ['baja', 'media', 'alta', 'urgente']);
export const reqEstadoEnum = pgEnum('req_estado', ['borrador', 'pendiente_aprobacion', 'aprobado', 'cotizando', 'oc_emitida', 'rechazado']);
export const ocEstadoEnum = pgEnum('oc_estado', ['borrador', 'pendiente_aprobacion', 'aprobada', 'emitida', 'en_transito', 'entregada', 'anulada', 'rechazada']);
export const ocConceptoEnum = pgEnum('oc_concepto', ['BIEN', 'SERVICIO']);
export const ocMonedaEnum = pgEnum('oc_moneda', ['PEN', 'USD']);

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
    pctIgv: decimal('pct_igv', { precision: 5, scale: 4 }).default('0.18'),
    montoSubtotal: decimal('monto_subtotal', { precision: 14, scale: 2 }).default('0'),
    montoIgv: decimal('monto_igv', { precision: 14, scale: 2 }).default('0'),
    montoReferencial: decimal('monto_referencial', { precision: 14, scale: 2 }).default('0'), // expediente técnico
    montoContractual: decimal('monto_contractual', { precision: 14, scale: 2 }).default('0'), // oferta ganadora
    factorOferta: decimal('factor_oferta', { precision: 7, scale: 6 }), // monto_contractual / monto_referencial · ej 0.95
    montoVigente: decimal('monto_vigente', { precision: 14, scale: 2 }).default('0'), // contractual ± modificaciones aprobadas
    presupuestoMeta: decimal('presupuesto_meta', { precision: 14, scale: 2 }), // meta interna constructora · objetivo utility

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
    precioUnitario: decimal('precio_unitario', { precision: 14, scale: 4 }), // legacy · referencia simple
    precioUnitarioReferencial: decimal('pu_referencial', { precision: 14, scale: 4 }), // del expediente técnico
    precioUnitarioContractual: decimal('pu_contractual', { precision: 14, scale: 4 }), // = pu_referencial × factor_oferta
    costoMetaUnitario: decimal('costo_meta_unitario', { precision: 14, scale: 4 }), // objetivo interno
    presupuesto: decimal('presupuesto', { precision: 14, scale: 2 }).default('0'), // referencial × cantidad
    presupuestoContractual: decimal('presupuesto_contractual', { precision: 14, scale: 2 }).default('0'),
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
    factorReajusteK: decimal('factor_reajuste_k', { precision: 8, scale: 6 }), // FP global
    montoReajuste: decimal('monto_reajuste', { precision: 14, scale: 2 }),
    // Detalle Reajuste S10
    vProgramado: decimal('v_programado', { precision: 14, scale: 2 }), // V-PROG cronograma
    reajusteReal: decimal('reajuste_real', { precision: 14, scale: 2 }), // V × (K-1)
    reajusteProgramado: decimal('reajuste_programado', { precision: 14, scale: 2 }), // V-PROG × (K-1)
    reajusteReconocido: decimal('reajuste_reconocido', { precision: 14, scale: 2 }), // el menor abs
    reajustePagado: decimal('reajuste_pagado', { precision: 14, scale: 2 }),
    vrConReajuste: decimal('vr_con_reajuste', { precision: 14, scale: 2 }), // V + R
    reajusteAcumAnterior: decimal('reajuste_acum_anterior', { precision: 14, scale: 2 }),
    reajusteAcumActual: decimal('reajuste_acum_actual', { precision: 14, scale: 2 }),
    reajustePresente: decimal('reajuste_presente', { precision: 14, scale: 2 }),
    condicion: varchar('condicion', { length: 20 }), // Normal · Especial · etc
    mesPeriodo: varchar('mes_periodo', { length: 7 }), // 2025-10
    // Cabecera RES. VALO
    montoDeducciones: decimal('monto_deducciones', { precision: 14, scale: 2 }).default('0'),
    montoValorizacionBruta: decimal('monto_valorizacion_bruta', { precision: 14, scale: 2 }),
    montoAmortizaciones: decimal('monto_amortizaciones', { precision: 14, scale: 2 }).default('0'),
    montoValorizacionNeta: decimal('monto_valorizacion_neta', { precision: 14, scale: 2 }),
    multa: decimal('multa', { precision: 14, scale: 2 }).default('0'),
    montoTotalConIgv: decimal('monto_total_con_igv', { precision: 14, scale: 2 }),
    montoRetencion: decimal('monto_retencion', { precision: 14, scale: 2 }).default('0'),
    totalContratista: decimal('total_contratista', { precision: 14, scale: 2 }), // pago final
    archivoXlsx: varchar('archivo_xlsx', { length: 255 }),
    status: valorizacionStatusEnum('status').notNull().default('borrador'),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>(), // hojas K + Reajuste + RES.VALO + Ios/Irs
    observaciones: text('observaciones'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('val_proyecto_idx').on(t.proyectoId),
    numeroUq: index('val_numero_uq').on(t.proyectoId, t.numero),
  }),
);

// ─── Valorizaciones · detalle por partida ─────────────────────
// Snapshot inmutable: metrado periodo, acumulado, monto contractual
export const valorizacionesPartidas = pgTable(
  'valorizaciones_partidas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    valorizacionId: uuid('valorizacion_id').notNull().references(() => valorizaciones.id, { onDelete: 'cascade' }),
    partidaId: uuid('partida_id').notNull().references(() => partidas.id, { onDelete: 'cascade' }),
    subpresupuestoCodigo: varchar('subpresupuesto_codigo', { length: 10 }), // '001'..'005'
    metradoContractual: decimal('metrado_contractual', { precision: 14, scale: 4 }).notNull(),
    metradoAnterior: decimal('metrado_anterior', { precision: 14, scale: 4 }).notNull().default('0'),
    metradoPeriodo: decimal('metrado_periodo', { precision: 14, scale: 4 }).notNull(),
    metradoAcumulado: decimal('metrado_acumulado', { precision: 14, scale: 4 }).notNull(),
    precioUnitario: decimal('precio_unitario', { precision: 14, scale: 2 }).notNull(), // contractual
    montoPeriodo: decimal('monto_periodo', { precision: 14, scale: 2 }).notNull(),
    montoAcumulado: decimal('monto_acumulado', { precision: 14, scale: 2 }).notNull(),
    pctAvance: decimal('pct_avance', { precision: 5, scale: 2 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    valIdx: index('valpart_val_idx').on(t.valorizacionId),
    partIdx: index('valpart_partida_idx').on(t.partidaId),
    subIdx: index('valpart_subp_idx').on(t.valorizacionId, t.subpresupuestoCodigo),
  }),
);

// ─── Valorizaciones · reajuste K por subpresupuesto/FP ───────
// 1 fila por FP (subp) por valorización · K = Σ coef × (Ir/Io)
export const valorizacionesReajustes = pgTable(
  'valorizaciones_reajustes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    valorizacionId: uuid('valorizacion_id').notNull().references(() => valorizaciones.id, { onDelete: 'cascade' }),
    formulaId: uuid('formula_id').notNull().references(() => formulasPolinomicas.id, { onDelete: 'cascade' }),
    subpresupuestoCodigo: varchar('subpresupuesto_codigo', { length: 10 }).notNull(),
    anioMesIndice: varchar('anio_mes_indice', { length: 7 }).notNull(), // mes Ir
    kCalculado: decimal('k_calculado', { precision: 8, scale: 6 }).notNull(),
    montoSubpresupuesto: decimal('monto_subpresupuesto', { precision: 14, scale: 2 }).notNull(), // suma valpart
    montoReajuste: decimal('monto_reajuste', { precision: 14, scale: 2 }).notNull(), // (K-1) × monto
    detalleK: jsonb('detalle_k').$type<Array<{ monomio: number; simbolo: string; coef: number; ir: number; io: number; relacion: number }>>().notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    valIdx: index('valrea_val_idx').on(t.valorizacionId),
    fpIdx: index('valrea_fp_idx').on(t.formulaId),
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

// ════════════════════════════════════════════════════════════════
// FASE 0 · FOUNDATION · Schema enterprise extensions
// ════════════════════════════════════════════════════════════════

// ─── Recursos · catálogo materiales/MO/equipos ────────────────
export const recursoTipoEnum = pgEnum('recurso_tipo', ['material', 'mano_obra', 'equipo', 'herramienta', 'subcontrato']);

export const recursos = pgTable(
  'recursos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: varchar('codigo', { length: 50 }).notNull(), // CEM-001, AC-1/2", etc
    descripcion: text('descripcion').notNull(),
    unidad: varchar('unidad', { length: 20 }).notNull(),
    tipo: recursoTipoEnum('tipo').notNull(),
    categoria: varchar('categoria', { length: 100 }), // 'cemento','acero','peon','mezcladora'
    precioReferencial: decimal('precio_referencial', { precision: 14, scale: 4 }),
    iuCodigo: varchar('iu_codigo', { length: 3 }), // → indices_unificados
    iuClasificacionOrigen: varchar('iu_clasificacion_origen', { length: 20 }), // 'manual'|'auto_ml'|'reglas'
    iuConfianza: decimal('iu_confianza', { precision: 3, scale: 2 }),
    activo: boolean('activo').default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    codigoIdx: index('recursos_codigo_idx').on(t.codigo),
    iuIdx: index('recursos_iu_idx').on(t.iuCodigo),
  }),
);

// ─── APUs · Análisis Costos Unitarios por partida ─────────────
export const apus = pgTable(
  'apus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partidaId: uuid('partida_id').notNull().references(() => partidas.id, { onDelete: 'cascade' }),
    rendimiento: decimal('rendimiento', { precision: 14, scale: 4 }), // m/dia, m³/dia, etc
    unidadRendimiento: varchar('unidad_rendimiento', { length: 20 }),
    costoMaterial: decimal('costo_material', { precision: 14, scale: 4 }).default('0'),
    costoManoObra: decimal('costo_mano_obra', { precision: 14, scale: 4 }).default('0'),
    costoEquipo: decimal('costo_equipo', { precision: 14, scale: 4 }).default('0'),
    costoHerramientas: decimal('costo_herramientas', { precision: 14, scale: 4 }).default('0'),
    costoSubcontrato: decimal('costo_subcontrato', { precision: 14, scale: 4 }).default('0'),
    costoTotal: decimal('costo_total', { precision: 14, scale: 4 }).default('0'),
    notas: text('notas'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    partidaUq: index('apus_partida_uq').on(t.partidaId),
  }),
);

// ─── APU Insumos (desglose recursos por APU) ──────────────────
export const apusInsumos = pgTable(
  'apus_insumos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    apuId: uuid('apu_id').notNull().references(() => apus.id, { onDelete: 'cascade' }),
    recursoId: uuid('recurso_id').notNull().references(() => recursos.id),
    cantidad: decimal('cantidad', { precision: 14, scale: 6 }).notNull(),
    precioUnitario: decimal('precio_unitario', { precision: 14, scale: 4 }).notNull(),
    parcial: decimal('parcial', { precision: 14, scale: 4 }).notNull(),
    cuadrillaCantidad: decimal('cuadrilla_cantidad', { precision: 6, scale: 2 }), // si MO · 1.00 capataz, 0.50 peón
    orden: integer('orden').default(0),
  },
  (t) => ({
    apuIdx: index('apus_insumos_apu_idx').on(t.apuId),
    recursoIdx: index('apus_insumos_recurso_idx').on(t.recursoId),
  }),
);

// ─── Índices Unificados (catálogo INEI) ───────────────────────
export const indicesUnificados = pgTable('indices_unificados', {
  codigo: varchar('codigo', { length: 3 }).primaryKey(), // '21' cemento, '47' MO, etc
  descripcion: text('descripcion').notNull(),
  categoria: varchar('categoria', { length: 50 }), // 'Materiales · Cemento'
  unidadMedida: varchar('unidad_medida', { length: 20 }),
  vigente: boolean('vigente').default(true),
  baseLegal: text('base_legal'),
});

// ─── Índices INEI mensuales por área ──────────────────────────
export const indicesMensuales = pgTable(
  'indices_mensuales',
  {
    iuCodigo: varchar('iu_codigo', { length: 3 }).notNull().references(() => indicesUnificados.codigo),
    area: varchar('area', { length: 20 }).notNull(), // 'lima','norte','centro','sur','oriente'
    anioMes: varchar('anio_mes', { length: 7 }).notNull(), // '2025-12'
    valor: decimal('valor', { precision: 10, scale: 4 }).notNull(),
    resolucionJefatural: varchar('resolucion_jefatural', { length: 80 }),
    fechaPublicacion: date('fecha_publicacion'),
    cargadoAt: timestamp('cargado_at').notNull().defaultNow(),
    cargadoPor: varchar('cargado_por', { length: 50 }), // 'api_inei'|'manual'|'scraper'
  },
  (t) => ({
    pk: primaryKey({ columns: [t.iuCodigo, t.area, t.anioMes] }),
  }),
);

// ─── Domain Events · Event Sourcing append-only ───────────────
// IMPORTANT: NUNCA permitir UPDATE/DELETE · trigger lo bloquea
export const domainEvents = pgTable(
  'domain_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sequenceNumber: integer('sequence_number').notNull(), // bigserial via raw SQL en migration custom
    aggregateType: varchar('aggregate_type', { length: 100 }).notNull(), // 'Proyecto','Valorizacion','OC'
    aggregateId: uuid('aggregate_id').notNull(),
    aggregateVersion: integer('aggregate_version').notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(), // 'ProyectoCreated','ValAprobada'
    eventVersion: integer('event_version').default(1),
    payload: jsonb('payload').notNull(),
    metadata: jsonb('metadata').notNull(), // user_id, ip, request_id, correlation_id
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    aggregateIdx: index('de_aggregate_idx').on(t.aggregateType, t.aggregateId, t.sequenceNumber),
    eventTypeIdx: index('de_event_type_idx').on(t.eventType),
    occurredAtIdx: index('de_occurred_at_idx').on(t.occurredAt),
  }),
);

// ─── Audit log INMUTABLE con hash chain ───────────────────────
export const auditLogImmutable = pgTable(
  'audit_log_immutable',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id'),
    userEmail: varchar('user_email', { length: 255 }).notNull(),
    userRole: varchar('user_role', { length: 50 }).notNull(),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 100 }),
    entityId: uuid('entity_id'),
    payloadBefore: jsonb('payload_before'),
    payloadAfter: jsonb('payload_after'),
    payloadDiff: jsonb('payload_diff'),
    ip: varchar('ip', { length: 45 }),
    userAgent: text('user_agent'),
    requestId: uuid('request_id'),
    correlationId: uuid('correlation_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    previousHash: varchar('previous_hash', { length: 64 }),
    currentHash: varchar('current_hash', { length: 64 }), // computed via trigger SQL custom
  },
  (t) => ({
    userIdx: index('alog_user_idx').on(t.userId),
    entityIdx: index('alog_entity_idx').on(t.entityType, t.entityId),
    occurredIdx: index('alog_occurred_idx').on(t.occurredAt),
  }),
);

// ─── Períodos contables (cierre mensual + bloqueo) ────────────
export const periodoEstadoEnum = pgEnum('periodo_estado', ['abierto', 'en_cierre', 'cerrado', 'bloqueado', 'reabierto']);

export const periodosContables = pgTable(
  'periodos_contables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'cascade' }), // null = empresa
    anio: integer('anio').notNull(),
    mes: integer('mes').notNull(),
    fechaInicio: date('fecha_inicio').notNull(),
    fechaFin: date('fecha_fin').notNull(),
    estado: periodoEstadoEnum('estado').notNull().default('abierto'),
    fechaCierre: timestamp('fecha_cierre'),
    cerradoPor: uuid('cerrado_por').references(() => users.id),
    reabiertoPor: uuid('reabierto_por').references(() => users.id),
    motivoReapertura: text('motivo_reapertura'),
    fechaReapertura: timestamp('fecha_reapertura'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    periodoUq: index('periodos_uq').on(t.proyectoId, t.anio, t.mes),
    estadoIdx: index('periodos_estado_idx').on(t.estado),
  }),
);

// ─── Motor de parámetros (configuración con vigencia) ─────────
export const parametrosCategorias = pgTable('parametros_categorias', {
  id: varchar('id', { length: 50 }).primaryKey(), // 'tributario','capeco','indices','contractual','workflow','kpi'
  descripcion: text('descripcion').notNull(),
  orden: integer('orden').default(0),
});

export const parametroTipoDatoEnum = pgEnum('parametro_tipo_dato', ['decimal', 'integer', 'varchar', 'boolean', 'json', 'date']);
export const parametroScopeEnum = pgEnum('parametro_scope', ['global', 'empresa', 'proyecto']);
export const parametroEstadoEnum = pgEnum('parametro_estado', ['vigente', 'futuro', 'obsoleto', 'observado']);

export const parametros = pgTable(
  'parametros',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoriaId: varchar('categoria_id', { length: 50 }).notNull().references(() => parametrosCategorias.id),
    codigo: varchar('codigo', { length: 100 }).notNull(),
    descripcion: text('descripcion'),
    tipoDato: parametroTipoDatoEnum('tipo_dato').notNull(),
    scope: parametroScopeEnum('scope').notNull().default('global'),
    empresaId: integer('empresa_id'), // referencia futura · empresa multi-tenant
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'cascade' }),
    valorDecimal: decimal('valor_decimal', { precision: 18, scale: 6 }),
    valorInteger: integer('valor_integer'),
    valorVarchar: text('valor_varchar'),
    valorBoolean: boolean('valor_boolean'),
    valorJson: jsonb('valor_json'),
    valorDate: date('valor_date'),
    vigenciaDesde: date('vigencia_desde').notNull(),
    vigenciaHasta: date('vigencia_hasta'),
    rangoMin: decimal('rango_min', { precision: 18, scale: 6 }),
    rangoMax: decimal('rango_max', { precision: 18, scale: 6 }),
    valoresPermitidos: jsonb('valores_permitidos').$type<string[]>(),
    regexValidacion: text('regex_validacion'),
    baseLegal: text('base_legal'),
    fuenteOficialUrl: text('fuente_oficial_url'),
    observaciones: text('observaciones'),
    version: integer('version').default(1),
    parametroPadreId: uuid('parametro_padre_id'),
    estado: parametroEstadoEnum('estado').notNull().default('vigente'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (t) => ({
    codigoIdx: index('param_codigo_idx').on(t.codigo, t.vigenciaDesde),
    categoriaIdx: index('param_categoria_idx').on(t.categoriaId),
    scopeIdx: index('param_scope_idx').on(t.scope, t.empresaId, t.proyectoId),
    estadoIdx: index('param_estado_idx').on(t.estado),
  }),
);

// ─── Documentos (DMS base) ────────────────────────────────────
export const documentoEstadoEnum = pgEnum('documento_estado', [
  'borrador',
  'en_revision',
  'aprobado',
  'publicado',
  'obsoleto',
  'archivado',
]);

export const documentos = pgTable(
  'documentos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'cascade' }),
    codigo: varchar('codigo', { length: 100 }).unique(),
    tipo: varchar('tipo', { length: 50 }).notNull(), // contrato·plano·acta·valorizacion·rfi·spec
    subtipo: varchar('subtipo', { length: 50 }),
    titulo: text('titulo').notNull(),
    descripcion: text('descripcion'),
    clasificacion: varchar('clasificacion', { length: 30 }).default('interno'), // publico·interno·privado·confidencial
    disciplina: varchar('disciplina', { length: 50 }),
    fase: varchar('fase', { length: 50 }), // bases·perfeccionamiento·ejecucion·liquidacion
    tags: jsonb('tags').$type<string[]>().default([]),
    estado: documentoEstadoEnum('estado').notNull().default('borrador'),
    versionActualId: uuid('version_actual_id'),
    partidaId: uuid('partida_id').references(() => partidas.id, { onDelete: 'set null' }),
    valorizacionId: uuid('valorizacion_id').references(() => valorizaciones.id, { onDelete: 'set null' }),
    rutaNas: text('ruta_nas'), // path completo NAS
    visibilityRoles: jsonb('visibility_roles').$type<string[]>().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => ({
    proyectoIdx: index('docs_proyecto_idx').on(t.proyectoId),
    tipoIdx: index('docs_tipo_idx').on(t.tipo),
    estadoIdx: index('docs_estado_idx').on(t.estado),
  }),
);

// ─── Fórmulas Polinómicas por subpresupuesto ──────────────────
// Cada subpresupuesto (01·02·03·04·05) tiene SU propia FP
export const formulasPolinomicas = pgTable(
  'formulas_polinomicas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    subpresupuestoCodigo: varchar('subpresupuesto_codigo', { length: 10 }).notNull(), // '001' o 'GLOBAL'
    subpresupuestoNombre: varchar('subpresupuesto_nombre', { length: 200 }).notNull(),
    fechaBase: date('fecha_base').notNull(),
    areaGeografica: varchar('area_geografica', { length: 50 }), // '150140 LIMA-LIMA-SANTIAGO DE SURCO'
    formulaTexto: text('formula_texto').notNull(), // 'K = 0.125·MO + ...'
    archivoPdfNas: text('archivo_pdf_nas'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoSubpUq: index('fp_proyecto_subp_uq').on(t.proyectoId, t.subpresupuestoCodigo),
  }),
);

export const formulasMonomios = pgTable(
  'formulas_monomios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formulaId: uuid('formula_id').notNull().references(() => formulasPolinomicas.id, { onDelete: 'cascade' }),
    numero: integer('numero').notNull(), // 1, 2, 3...
    coeficiente: decimal('coeficiente', { precision: 5, scale: 4 }).notNull(),
    simbolo: varchar('simbolo', { length: 5 }), // 'MO','C','AC','D','GU'
    descripcion: text('descripcion'),
  },
  (t) => ({
    formulaIdx: index('fm_formula_idx').on(t.formulaId),
  }),
);

export const formulasMonomiosIus = pgTable(
  'formulas_monomios_ius',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    monomioId: uuid('monomio_id').notNull().references(() => formulasMonomios.id, { onDelete: 'cascade' }),
    iuCodigo: varchar('iu_codigo', { length: 3 }).notNull(),
    pesoPorcentual: decimal('peso_porcentual', { precision: 7, scale: 3 }), // 100.000, 65.789, etc
    descripcionIu: text('descripcion_iu'),
  },
  (t) => ({
    monomioIdx: index('fmi_monomio_idx').on(t.monomioId),
  }),
);

// ─── Cronograma adquisiciones (curva valorizada por mes) ─────
export const cronogramaAdquisiciones = pgTable(
  'cronograma_adquisiciones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    recursoId: uuid('recurso_id').references(() => recursos.id, { onDelete: 'set null' }),
    mesIndex: integer('mes_index').notNull(), // 1, 2, 3, 4
    mesEtiqueta: varchar('mes_etiqueta', { length: 20 }), // 'Oct-25'
    fechaDesde: date('fecha_desde'),
    fechaHasta: date('fecha_hasta'),
    cantidad: decimal('cantidad', { precision: 14, scale: 4 }),
    monto: decimal('monto', { precision: 14, scale: 2 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoMesIdx: index('cronog_adq_proy_mes_idx').on(t.proyectoId, t.mesIndex),
    recursoIdx: index('cronog_adq_recurso_idx').on(t.recursoId),
  }),
);

// ═══════════════════════════════════════════════════════════════
// F3 · COMPRAS / LOGÍSTICA
// ═══════════════════════════════════════════════════════════════

// ─── Proveedores ──────────────────────────────────────────────
export const proveedores = pgTable(
  'proveedores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruc: varchar('ruc', { length: 11 }).notNull().unique(),
    razonSocial: varchar('razon_social', { length: 255 }).notNull(),
    nombreComercial: varchar('nombre_comercial', { length: 255 }),
    categoria: varchar('categoria', { length: 100 }), // 'Cemento', 'Acero', 'Maquinaria', etc
    domicilio: text('domicilio'),
    distrito: varchar('distrito', { length: 100 }),
    departamento: varchar('departamento', { length: 100 }),
    email: varchar('email', { length: 255 }),
    telefono: varchar('telefono', { length: 50 }),
    contacto: varchar('contacto', { length: 255 }), // nombre persona contacto
    contactoCargo: varchar('contacto_cargo', { length: 100 }),
    estadoSunat: varchar('estado_sunat', { length: 30 }), // 'ACTIVO','SUSPENDIDO','BAJA'
    condicionSunat: varchar('condicion_sunat', { length: 30 }), // 'HABIDO','NO HABIDO','NO HALLADO'
    tipoContribuyente: varchar('tipo_contribuyente', { length: 100 }), // 'PJ - SAC', 'PN', etc
    rating: decimal('rating', { precision: 3, scale: 1 }), // 0.0 - 5.0
    leadTimeDias: integer('lead_time_dias'),
    cuentaBancaria: varchar('cuenta_bancaria', { length: 50 }),
    cuentaCci: varchar('cuenta_cci', { length: 20 }),
    cuentaDetraccionesBn: varchar('cuenta_detracciones_bn', { length: 30 }),
    notas: text('notas'),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    rucIdx: index('proveedores_ruc_idx').on(t.ruc),
    razonSocialIdx: index('proveedores_razon_idx').on(t.razonSocial),
    categoriaIdx: index('proveedores_cat_idx').on(t.categoria),
  }),
);

// ─── Requerimientos (RQ) · pipeline pre-OC ───────────────────
export const requerimientos = pgTable(
  'requerimientos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    numero: varchar('numero', { length: 20 }).notNull().unique(), // REQ-2026-0001
    correlativo: integer('correlativo').notNull(),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    solicitanteId: uuid('solicitante_id').references(() => users.id, { onDelete: 'set null' }),
    solicitanteNombre: varchar('solicitante_nombre', { length: 255 }),
    fecha: date('fecha').notNull(),
    fechaNecesaria: date('fecha_necesaria'),
    urgencia: reqUrgenciaEnum('urgencia').notNull().default('media'),
    descripcion: text('descripcion').notNull(),
    justificacion: text('justificacion'),
    estado: reqEstadoEnum('estado').notNull().default('borrador'),
    aprobadoPorId: uuid('aprobado_por_id').references(() => users.id, { onDelete: 'set null' }),
    aprobadoEn: timestamp('aprobado_en'),
    rechazadoMotivo: text('rechazado_motivo'),
    montoEstimado: decimal('monto_estimado', { precision: 14, scale: 2 }),
    notas: text('notas'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('req_proyecto_idx').on(t.proyectoId),
    estadoIdx: index('req_estado_idx').on(t.estado),
    numeroIdx: index('req_numero_idx').on(t.numero),
  }),
);

// ─── Requerimiento líneas ─────────────────────────────────────
export const requerimientosLineas = pgTable(
  'requerimientos_lineas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requerimientoId: uuid('requerimiento_id').notNull().references(() => requerimientos.id, { onDelete: 'cascade' }),
    numero: integer('numero').notNull(), // 1, 2, 3...
    recursoId: uuid('recurso_id').references(() => recursos.id, { onDelete: 'set null' }),
    descripcion: text('descripcion').notNull(),
    unidad: varchar('unidad', { length: 10 }).notNull(),
    cantidad: decimal('cantidad', { precision: 14, scale: 4 }).notNull(),
    precioReferencial: decimal('precio_referencial', { precision: 14, scale: 4 }),
    notas: text('notas'),
  },
  (t) => ({
    requerimientoIdx: index('req_lineas_req_idx').on(t.requerimientoId),
  }),
);

// ─── Órdenes de Compra (OC) ──────────────────────────────────
export const ordenesCompra = pgTable(
  'ordenes_compra',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    numero: varchar('numero', { length: 20 }).notNull().unique(), // OC-2026-0001
    correlativo: integer('correlativo').notNull(),
    anio: integer('anio').notNull(), // 2026
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    proveedorId: uuid('proveedor_id').notNull().references(() => proveedores.id, { onDelete: 'restrict' }),
    requerimientoId: uuid('requerimiento_id').references(() => requerimientos.id, { onDelete: 'set null' }),
    // Fechas
    fechaEmision: date('fecha_emision').notNull(),
    fechaEntrega: date('fecha_entrega'),
    lugarEntrega: text('lugar_entrega'),
    // Comercial
    moneda: ocMonedaEnum('moneda').notNull().default('PEN'),
    tipoCambio: decimal('tipo_cambio', { precision: 8, scale: 4 }), // si USD
    concepto: ocConceptoEnum('concepto').notNull().default('BIEN'),
    medioPago: varchar('medio_pago', { length: 50 }), // 'Transferencia Bancaria','Cheque','Efectivo'
    formaPago: varchar('forma_pago', { length: 50 }), // 'Al contado','Crédito 30 días', etc
    cotizacion: varchar('cotizacion', { length: 100 }),
    // Montos · IGV configurable
    pctIgv: decimal('pct_igv', { precision: 5, scale: 2 }).notNull().default('18.00'),
    incluyeIgv: boolean('incluye_igv').notNull().default(true), // si PUs ya tienen IGV
    subtotalSinIgv: decimal('subtotal_sin_igv', { precision: 14, scale: 2 }).notNull().default('0'),
    igv: decimal('igv', { precision: 14, scale: 2 }).notNull().default('0'),
    total: decimal('total', { precision: 14, scale: 2 }).notNull().default('0'),
    // Detracción
    aplicaDetraccion: boolean('aplica_detraccion').notNull().default(false),
    pctDetraccion: decimal('pct_detraccion', { precision: 5, scale: 2 }), // 4, 10, 12
    montoDetraccion: decimal('monto_detraccion', { precision: 14, scale: 2 }).default('0'),
    montoNetoPagar: decimal('monto_neto_pagar', { precision: 14, scale: 2 }), // total - detracción
    // Workflow
    estado: ocEstadoEnum('estado').notNull().default('borrador'),
    creadoPorId: uuid('creado_por_id').references(() => users.id, { onDelete: 'set null' }),
    creadoPorEmail: varchar('creado_por_email', { length: 255 }),
    gestorEmail: varchar('gestor_email', { length: 255 }),
    gestorNombre: varchar('gestor_nombre', { length: 255 }),
    aprobadoPorId: uuid('aprobado_por_id').references(() => users.id, { onDelete: 'set null' }),
    aprobadoEn: timestamp('aprobado_en'),
    emitidaEn: timestamp('emitida_en'),
    entregadaEn: timestamp('entregada_en'),
    canceladaMotivo: text('cancelada_motivo'),
    // Documentos
    terminos: text('terminos'),
    pdfNasPath: varchar('pdf_nas_path', { length: 500 }),
    notas: text('notas'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('oc_proyecto_idx').on(t.proyectoId),
    proveedorIdx: index('oc_proveedor_idx').on(t.proveedorId),
    estadoIdx: index('oc_estado_idx').on(t.estado),
    numeroIdx: index('oc_numero_idx').on(t.numero),
    anioCorrelativoIdx: index('oc_anio_corr_idx').on(t.anio, t.correlativo),
  }),
);

// ─── OC líneas (items) ────────────────────────────────────────
export const ocLineas = pgTable(
  'oc_lineas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ordenCompraId: uuid('orden_compra_id').notNull().references(() => ordenesCompra.id, { onDelete: 'cascade' }),
    numero: integer('numero').notNull(), // 1, 2, 3...
    partidaId: uuid('partida_id').references(() => partidas.id, { onDelete: 'set null' }),
    recursoId: uuid('recurso_id').references(() => recursos.id, { onDelete: 'set null' }),
    descripcion: text('descripcion').notNull(),
    unidad: varchar('unidad', { length: 10 }).notNull(),
    cantidad: decimal('cantidad', { precision: 14, scale: 4 }).notNull(),
    precioUnitario: decimal('precio_unitario', { precision: 14, scale: 5 }).notNull(), // 5 decimales v1
    subtotal: decimal('subtotal', { precision: 14, scale: 2 }).notNull(),
    notas: text('notas'),
  },
  (t) => ({
    ocIdx: index('oc_lineas_oc_idx').on(t.ordenCompraId),
  }),
);

// ─── OC aprobaciones log ──────────────────────────────────────
export const ocAprobaciones = pgTable(
  'oc_aprobaciones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ordenCompraId: uuid('orden_compra_id').notNull().references(() => ordenesCompra.id, { onDelete: 'cascade' }),
    estadoFrom: varchar('estado_from', { length: 30 }),
    estadoTo: varchar('estado_to', { length: 30 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    userNombre: varchar('user_nombre', { length: 255 }),
    comentario: text('comentario'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    ocIdx: index('oc_aprob_oc_idx').on(t.ordenCompraId),
  }),
);

// ─── Correlativos globales (OC, RQ por año) ──────────────────
export const correlativos = pgTable('correlativos', {
  clave: varchar('clave', { length: 50 }).primaryKey(), // 'OC-2026', 'REQ-2026'
  ultimoNumero: integer('ultimo_numero').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Imports S10 (registro histórico) ─────────────────────────
export const importsS10 = pgTable(
  'imports_s10',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }),
    archivoNombre: varchar('archivo_nombre', { length: 255 }),
    archivoHash: varchar('archivo_hash', { length: 64 }),
    tipo: varchar('tipo', { length: 30 }).notNull(), // 'presupuesto','calendario','mpp','fp'
    fechaImport: timestamp('fecha_import').notNull().defaultNow(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    estado: varchar('estado', { length: 30 }).notNull().default('procesando'),
    partidasImportadas: integer('partidas_importadas').default(0),
    apusImportadas: integer('apus_importadas').default(0),
    insumosImportados: integer('insumos_importados').default(0),
    montoTotalCalculado: decimal('monto_total_calculado', { precision: 14, scale: 2 }),
    montoReferenciaArchivo: decimal('monto_referencia_archivo', { precision: 14, scale: 2 }),
    diferencia: decimal('diferencia', { precision: 14, scale: 2 }),
    errorsLog: jsonb('errors_log').$type<string[]>().default([]),
    warningsLog: jsonb('warnings_log').$type<string[]>().default([]),
    duracionMs: integer('duracion_ms'),
  },
  (t) => ({
    proyectoIdx: index('imports_proyecto_idx').on(t.proyectoId),
    estadoIdx: index('imports_estado_idx').on(t.estado),
  }),
);

// ─── Documento versiones ──────────────────────────────────────
export const documentosVersiones = pgTable(
  'documentos_versiones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentoId: uuid('documento_id').notNull().references(() => documentos.id, { onDelete: 'cascade' }),
    versionNumero: varchar('version_numero', { length: 20 }).notNull(), // '1.0','1.1','2.0'
    versionOrden: integer('version_orden').notNull(), // 1,2,3
    archivoNasPath: text('archivo_nas_path'),
    archivoS3Url: text('archivo_s3_url'),
    mimeType: varchar('mime_type', { length: 100 }),
    sizeBytes: integer('size_bytes'),
    hashSha256: varchar('hash_sha256', { length: 64 }),
    hashMd5: varchar('hash_md5', { length: 32 }),
    textoExtraido: text('texto_extraido'), // OCR
    ocrCompletadoAt: timestamp('ocr_completado_at'),
    cambioResumen: text('cambio_resumen'),
    estado: documentoEstadoEnum('estado').notNull().default('borrador'),
    fechaPublicacion: timestamp('fecha_publicacion'),
    fechaObsolescencia: timestamp('fecha_obsolescencia'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => ({
    docIdx: index('docs_ver_doc_idx').on(t.documentoId),
    hashIdx: index('docs_ver_hash_idx').on(t.hashSha256),
  }),
);

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
export type NewValorizacion = typeof valorizaciones.$inferInsert;
export type ValorizacionPartida = typeof valorizacionesPartidas.$inferSelect;
export type NewValorizacionPartida = typeof valorizacionesPartidas.$inferInsert;
export type ValorizacionReajuste = typeof valorizacionesReajustes.$inferSelect;
export type NewValorizacionReajuste = typeof valorizacionesReajustes.$inferInsert;
export type Trabajador = typeof trabajadores.$inferSelect;
export type Asiento = typeof asientos.$inferSelect;
export type AsientoLinea = typeof asientosLineas.$inferSelect;
export type Cliente = typeof clientes.$inferSelect;
export type ConsorcioIntegrante = typeof consorciosIntegrantes.$inferSelect;
export type Garantia = typeof garantias.$inferSelect;
export type Adelanto = typeof adelantos.$inferSelect;
export type PenalidadCatalogo = typeof penalidadesCatalogo.$inferSelect;
export type PenalidadAplicada = typeof penalidadesAplicadas.$inferSelect;

// F0 Foundation types
export type Recurso = typeof recursos.$inferSelect;
export type NewRecurso = typeof recursos.$inferInsert;
export type Apu = typeof apus.$inferSelect;
export type NewApu = typeof apus.$inferInsert;
export type ApuInsumo = typeof apusInsumos.$inferSelect;
export type IndiceUnificado = typeof indicesUnificados.$inferSelect;
export type IndiceMensual = typeof indicesMensuales.$inferSelect;
export type DomainEvent = typeof domainEvents.$inferSelect;
export type NewDomainEvent = typeof domainEvents.$inferInsert;
export type AuditLogImmutable = typeof auditLogImmutable.$inferSelect;
export type PeriodoContable = typeof periodosContables.$inferSelect;
export type Parametro = typeof parametros.$inferSelect;
export type NewParametro = typeof parametros.$inferInsert;
export type Documento = typeof documentos.$inferSelect;
export type DocumentoVersion = typeof documentosVersiones.$inferSelect;
export type FormulaPolinomica = typeof formulasPolinomicas.$inferSelect;
export type FormulaMonomio = typeof formulasMonomios.$inferSelect;
export type FormulaMonomioIu = typeof formulasMonomiosIus.$inferSelect;
export type CronogramaAdquisicion = typeof cronogramaAdquisiciones.$inferSelect;

// F3 · Compras / Logística
export type Proveedor = typeof proveedores.$inferSelect;
export type NewProveedor = typeof proveedores.$inferInsert;
export type Requerimiento = typeof requerimientos.$inferSelect;
export type NewRequerimiento = typeof requerimientos.$inferInsert;
export type RequerimientoLinea = typeof requerimientosLineas.$inferSelect;
export type NewRequerimientoLinea = typeof requerimientosLineas.$inferInsert;
export type OrdenCompra = typeof ordenesCompra.$inferSelect;
export type NewOrdenCompra = typeof ordenesCompra.$inferInsert;
export type OcLinea = typeof ocLineas.$inferSelect;
export type NewOcLinea = typeof ocLineas.$inferInsert;
export type OcAprobacion = typeof ocAprobaciones.$inferSelect;
export type NewOcAprobacion = typeof ocAprobaciones.$inferInsert;
export type ImportS10 = typeof importsS10.$inferSelect;
