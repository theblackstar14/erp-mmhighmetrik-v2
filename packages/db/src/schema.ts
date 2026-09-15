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
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Enums ───────────────────────────────────────────────────
export const userRoleEnum = pgEnum('user_role', ['admin', 'gerente', 'residente', 'contadora', 'almacen']);
export const projectStatusEnum = pgEnum('project_status', ['licitacion', 'adjudicado', 'ejecucion', 'liquidacion', 'cerrado', 'cancelado']);
export const projectModalityEnum = pgEnum('project_modality', ['suma_alzada', 'precios_unitarios', 'mixto', 'llave_en_mano']);
// Inversión padre (agrupa N proyectos-colegio bajo un CUI · ej. Obras por Impuestos)
export const modalidadInversionEnum = pgEnum('modalidad_inversion', ['oxi', 'contrata', 'administracion_directa', 'app', 'nucleo_ejecutor']);
// Cómo se calculan GG + Utilidad en el presupuesto del proyecto-colegio
//   separado    · GG y UT como % sobre CD (clásico S10)
//   embebido_cd · CD ya incluye GG+UT (pctGg/pctUtilidad deben ir NULL)
//   simple_pct  · % simple sobre CD, sin mobiliario/adicionales
export const ggUtModoEnum = pgEnum('gg_ut_modo', ['separado', 'embebido_cd', 'simple_pct']);
export const trabajadorCategoriaEnum = pgEnum('trabajador_categoria', ['Capataz', 'Operario', 'Oficial', 'Peon']);
export const trabajadorEstadoEnum = pgEnum('trabajador_estado', ['Activo', 'Permiso', 'Vacaciones', 'Cesado']);
// Flujo: borrador → emitida(presentada) → conformidad_supervision → aprobada → facturada → cobrada(pagada) · rechazada
export const valorizacionStatusEnum = pgEnum('valorizacion_status', [
  'borrador',
  'emitida',
  'conformidad_supervision',
  'aprobada',
  'facturada',
  'cobrada',
  'rechazada',
]);
export const asientoStatusEnum = pgEnum('asiento_status', ['borrador', 'registrado', 'cerrado', 'anulado']);

// F3 · Compras / Logística
export const reqUrgenciaEnum = pgEnum('req_urgencia', ['baja', 'media', 'alta', 'urgente']);
export const reqEstadoEnum = pgEnum('req_estado', ['borrador', 'pendiente_aprobacion', 'aprobado', 'cotizando', 'oc_emitida', 'rechazado']);
export const ocEstadoEnum = pgEnum('oc_estado', ['borrador', 'pendiente_aprobacion', 'aprobada', 'emitida', 'en_transito', 'entregada', 'anulada', 'rechazada']);
export const ocConceptoEnum = pgEnum('oc_concepto', ['BIEN', 'SERVICIO']);
export const ocEstadoPagoEnum = pgEnum('oc_estado_pago', ['pendiente', 'pagada']);
export const ocMonedaEnum = pgEnum('oc_moneda', ['PEN', 'USD']);

// RBAC dinámico · módulos del ERP (matriz de permisos rol→módulo).
// Enum (no tabla): un módulo nuevo es código nuevo (ruta+página), no lo crea el admin.
export const moduloEnum = pgEnum('modulo', [
  'dashboard', 'finanzas', 'contabilidad', 'logistica', 'inventario', 'personal', 'proyectos', 'oficina', 'usuarios',
]);
export const nivelAccesoEnum = pgEnum('nivel_acceso', ['ninguno', 'lectura', 'edicion']);

// ─── Auth · Users + Sessions ─────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  nombres: varchar('nombres', { length: 100 }).notNull(),
  apellidos: varchar('apellidos', { length: 100 }).notNull(),
  role: userRoleEnum('role').notNull().default('admin'), // legacy · reemplazado por usuario_empresa.role_id · drop tras cutover
  telefono: varchar('telefono', { length: 30 }),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  lastLogin: timestamp('last_login'),
  activo: boolean('activo').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

// ─── Empresas (multi · grupo empresarial, 1 dueño, varias RUC) ─
// Antes singleton (id=1). Ahora N filas. id manual (max+1 en el create route) ·
// tabla chica, sin sequence. ponytail: pocas empresas, id a mano · serial si crecen.
export const empresas = pgTable('empresa', {
  id: integer('id').primaryKey(),
  ruc: varchar('ruc', { length: 11 }).notNull(),
  razonSocial: varchar('razon_social', { length: 255 }).notNull(),
  nombreCorto: varchar('nombre_corto', { length: 50 }), // MM · MG · para el selector
  direccion: text('direccion'),
  email: varchar('email', { length: 255 }),
  telefono: varchar('telefono', { length: 30 }),
  web: varchar('web', { length: 255 }),
  logoUrl: text('logo_url'),
  tieneProyectos: boolean('tiene_proyectos').notNull().default(false), // solo MM por ahora
  activo: boolean('activo').notNull().default(true),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── RBAC dinámico · roles (datos, no enum) + matriz + membresía ─
// roles: el admin los crea/edita en UI. Los 4 base llevan esSistema=true (no se borran).
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: varchar('nombre', { length: 50 }).notNull().unique(),
  descripcion: varchar('descripcion', { length: 255 }),
  esSistema: boolean('es_sistema').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Matriz rol → módulo → nivel. Fila ausente = sin acceso (igual que 'ninguno').
export const roleModulo = pgTable(
  'role_modulo',
  {
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
    modulo: moduloEnum('modulo').notNull(),
    nivel: nivelAccesoEnum('nivel').notNull().default('ninguno'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.roleId, t.modulo] }) }),
);

// Membresía: qué usuario, en qué empresa, con qué rol. Un usuario en varias empresas = varias filas.
export const usuarioEmpresa = pgTable(
  'usuario_empresa',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull().references(() => roles.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.empresaId] }) }),
);

export type Empresa = typeof empresas.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type UsuarioEmpresa = typeof usuarioEmpresa.$inferSelect;

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

// ─── Inversiones (padre · agrupa colegios bajo un CUI) ───────
// 1 inversión = 1 CUI MEF (ej. 2355883 · 4 colegios). Cada colegio es 1 proyecto.
// Liviana: se crea solo con {cui, nombre, modalidad}. 08-A/convenio opcionales.
export const inversiones = pgTable(
  'inversiones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cui: varchar('cui', { length: 30 }).notNull().unique(), // Código Único Inversión · 2355883
    nombre: varchar('nombre', { length: 1000 }).notNull(), // nombre largo MEF (multi-colegio)
    modalidad: modalidadInversionEnum('modalidad').notNull().default('oxi'),
    clienteId: uuid('cliente_id').references(() => clientes.id, { onDelete: 'set null' }),
    ubicacion: text('ubicacion'),

    // Montos MEF · Formato 08-A (referencia del padre · NULL hasta cargar 08-A)
    montoInversionMef: decimal('monto_inversion_mef', { precision: 16, scale: 2 }), // costo total inversión actualizado
    montoComponentes: decimal('monto_componentes', { precision: 16, scale: 2 }), // obra física Σ colegios
    montoExpedienteTecnico: decimal('monto_expediente_tecnico', { precision: 16, scale: 2 }),
    montoSupervision: decimal('monto_supervision', { precision: 16, scale: 2 }),
    montoGestion: decimal('monto_gestion', { precision: 16, scale: 2 }),
    montoLiquidacion: decimal('monto_liquidacion', { precision: 16, scale: 2 }),

    // Fechas marco MEF (ejecución física de toda la inversión)
    fechaInicioEjecucion: date('fecha_inicio_ejecucion'),
    fechaFinEjecucion: date('fecha_fin_ejecucion'),
    fechaEntregaOym: date('fecha_entrega_oym'),

    // Identificación MEF Invierte.pe
    ueiNombre: varchar('uei_nombre', { length: 255 }), // Unidad Ejecutora de Inversiones
    ufNombre: varchar('uf_nombre', { length: 255 }), // Unidad Formuladora
    uepNombre: varchar('uep_nombre', { length: 255 }), // Unidad Ejecutora Presupuestal
    proveidoAprobacion: varchar('proveido_aprobacion', { length: 120 }),

    // Convenio / contrato OxI (pendiente · siguiente revisión)
    empresaFinancista: varchar('empresa_financista', { length: 255 }), // empresa privada OxI · null hasta convenio
    pendienteContrato: boolean('pendiente_contrato').notNull().default(true),

    snapshot: jsonb('snapshot').$type<Record<string, unknown>>(), // parse completo 08-A / fuente
    nasFolder: text('nas_folder'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => ({
    cuiIdx: index('inversiones_cui_idx').on(t.cui),
  }),
);

// ─── Proyectos ────────────────────────────────────────────────
export const proyectos = pgTable(
  'proyectos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: varchar('codigo', { length: 50 }).notNull().unique(), // OB-2026-009
    nombre: varchar('nombre', { length: 500 }).notNull(),
    clienteId: uuid('cliente_id').references(() => clientes.id, { onDelete: 'set null' }),
    responsableUserId: uuid('responsable_user_id').references(() => users.id, { onDelete: 'set null' }), // residente/gerente de obra
    ubicacion: text('ubicacion'),
    lat: decimal('lat', { precision: 10, scale: 6 }),
    lng: decimal('lng', { precision: 10, scale: 6 }),
    tipo: varchar('tipo', { length: 100 }), // Edificación · Saneamiento · Vial · etc
    modalidad: projectModalityEnum('modalidad').default('suma_alzada'),
    status: projectStatusEnum('status').notNull().default('licitacion'),

    // Inversión padre (OxI · agrupa colegios bajo un CUI). NULL = proyecto suelto.
    inversionId: uuid('inversion_id').references(() => inversiones.id, { onDelete: 'set null' }),
    codigoIe: varchar('codigo_ie', { length: 20 }), // 16647 · nº institución educativa
    // Modo de cálculo GG+Utilidad de este presupuesto (separado | embebido_cd | simple_pct)
    ggUtModo: ggUtModoEnum('gg_ut_modo').notNull().default('separado'),
    // Fuente que gobierna los montos vigentes (valorizacion | cronograma | resumen | cuadro)
    fuenteMontos: varchar('fuente_montos', { length: 30 }),

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

    // Componentes inversión (OxI / MEF) · base del avance financiero-inversión.
    // montoReferencial = monto de inversión total (suma de estos + obra). Obra-CD vive en costoDirecto.
    montoMobiliario: decimal('monto_mobiliario', { precision: 14, scale: 2 }), // mobiliario y equipamiento
    montoExpedienteTecnico: decimal('monto_expediente_tecnico', { precision: 14, scale: 2 }), // documento de trabajo
    montoSupervisionExpediente: decimal('monto_supervision_expediente', { precision: 14, scale: 2 }), // supervisión doc trabajo
    montoSupervisionObra: decimal('monto_supervision_obra', { precision: 14, scale: 2 }),
    // Plan financiero-inversión mensual · MONTO DE INVERSIÓN distribuido (cronograma valorizado).
    // [{ ym: '2026-04', monto }] · PV inversión. Σ = montoReferencial. Distinto de partidas.distribucionMensual (obra-CD).
    distribucionInversion: jsonb('distribucion_inversion').$type<Array<{ ym: string; monto: number }>>().default([]),

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

    // Participación propia (MM) en esta obra · 1.0000 = 100% · base del P&L "mi bolsillo"
    pctParticipacionPropia: decimal('pct_participacion_propia', { precision: 5, scale: 4 }).default('1.0000'),

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

    // Hitos contractuales sugeridos por IA al parsear el .mpp (cronograma). Se confirman → hitos_obra.
    hitosSugeridos: jsonb('hitos_sugeridos')
      .$type<Array<{ tipo: string; fechaPlan: string; confianza: number; fuente: string; razon: string }>>()
      .default([]),

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
    // Distribución mensual exacta · array [{ym: '2026-04', monto: 12345.67}]
    // Si null/vacío · curva S backend cae a distribución lineal fechaInicio/fechaFin
    distribucionMensual: jsonb('distribucion_mensual').$type<Array<{ ym: string; monto: number }>>().default([]),
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
    // WS1 · cuenta de ingreso (Kelly confirma · default fuerte 7041). CD/GG no aplica (70x).
    cuentaContable: varchar('cuenta_contable', { length: 10 }).references(() => planContable.codigo),
    cuentaContableOrigen: varchar('cuenta_contable_origen', { length: 10 }), // USUARIO | SUGERIDO | AUTOMATICO
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
    // Inversión (bloque totales del Excel · financiero-inversión real)
    montoInversionPeriodo: decimal('monto_inversion_periodo', { precision: 16, scale: 2 }),
    montoInversionAcumulado: decimal('monto_inversion_acumulado', { precision: 16, scale: 2 }),
    pctInversionAcumulado: decimal('pct_inversion_acumulado', { precision: 6, scale: 2 }),
    archivoXlsx: varchar('archivo_xlsx', { length: 255 }),
    // Comprobante electrónico emitido (factura de la valo) · para Registro de Ventas / RVIE · mock hasta captura real
    comprobanteTipo: varchar('comprobante_tipo', { length: 12 }).default('factura'),
    comprobanteSerie: varchar('comprobante_serie', { length: 20 }),
    comprobanteNumero: varchar('comprobante_numero', { length: 40 }),
    comprobanteFecha: date('comprobante_fecha'),
    comprobanteFechaVenc: date('comprobante_fecha_venc'), // RVIE campo 5 · vencimiento/pago
    comprobanteDetraccion: decimal('comprobante_detraccion', { precision: 14, scale: 2 }), // RVIE campo 39 · monto detracción (constructora)
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

// ─── Profesionales · padrón de staff técnico (sin login) ─────
// Pool del que se elige el "Equipo profesional" de cada obra. Distinto de users (login).
export const profesionales = pgTable('profesionales', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: varchar('nombre', { length: 160 }).notNull(),
  profesion: varchar('profesion', { length: 120 }), // Ingeniero Civil · Arquitecto · Técnico...
  colegiatura: varchar('colegiatura', { length: 40 }), // CIP / CAP
  dni: varchar('dni', { length: 12 }),
  telefono: varchar('telefono', { length: 30 }),
  email: varchar('email', { length: 255 }),
  cargoDefault: varchar('cargo_default', { length: 100 }), // rol sugerido (Residente, Supervisor...)
  activo: boolean('activo').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
export type Profesional = typeof profesionales.$inferSelect;
export type NewProfesional = typeof profesionales.$inferInsert;

// ─── Equipo profesional asignado a una obra ──────────────────
export const equipoProyecto = pgTable(
  'equipo_proyecto',
  {
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    profesionalId: uuid('profesional_id').notNull().references(() => profesionales.id, { onDelete: 'cascade' }),
    rol: varchar('rol', { length: 100 }).notNull(), // Residente · Supervisor · Capataz · etc
    asignadoEn: timestamp('asignado_en').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.proyectoId, t.profesionalId] }),
  }),
);

// ─── Plan Contable (PCGE 2020) ───────────────────────────────
export const planContable = pgTable('plan_contable', {
  codigo: varchar('codigo', { length: 10 }).primaryKey(),
  descripcion: text('descripcion').notNull(),
  tipo: varchar('tipo', { length: 30 }).notNull(), // Activo · Pasivo · Patrimonio · Ingreso · Gasto · Costo
  parentCodigo: varchar('parent_codigo', { length: 10 }),
  nivel: integer('nivel').notNull(),
  // WS0 · promoción a cuenta_contable canónica (in situ)
  clasificable: boolean('clasificable'), // true si cuenta de gasto/costo (elem 6/9) · alimenta derivarClase
  esDivisionaria: boolean('es_divisionaria').notNull().default(false),
  empresaId: integer('empresa_id').references(() => empresas.id, { onDelete: 'set null' }), // null = compartida
  activa: boolean('activa').notNull().default(true),
});
export type PlanContable = typeof planContable.$inferSelect;

// ─── Fase 0 finanzas · catálogos globales ────────────────────
// Catálogos SUNAT (Anexo 8 reglas CPE): 01 tipo doc · 06 doc identidad · 07 afectación IGV ·
// 09/10 motivos NC/ND · 51 tipo operación · 52 leyendas · 53 cargos/descuentos · 54 detracciones · 59 medios de pago
export const catalogoSunat = pgTable(
  'catalogo_sunat',
  {
    catalogo: varchar('catalogo', { length: 4 }).notNull(),
    codigo: varchar('codigo', { length: 10 }).notNull(),
    descripcion: text('descripcion').notNull(),
    extra: jsonb('extra').$type<Record<string, string>>().notNull().default({}),
  },
  (t) => ({ pk: primaryKey({ columns: [t.catalogo, t.codigo] }) }),
);

// Tasa de detracción por código con vigencia. monto_minimo: la operación detrae si total PEN > mínimo.
export const detraccionTasa = pgTable(
  'detraccion_tasa',
  {
    codigo: varchar('codigo', { length: 3 }).notNull(),
    descripcion: text('descripcion').notNull(),
    anexo: varchar('anexo', { length: 12 }),
    porcentaje: decimal('porcentaje', { precision: 5, scale: 2 }),
    montoMinimo: decimal('monto_minimo', { precision: 12, scale: 2 }).notNull().default('700'),
    vigenciaDesde: date('vigencia_desde').notNull().default('2000-01-01'),
    vigenciaHasta: date('vigencia_hasta'),
    observacion: text('observacion'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.codigo, t.vigenciaDesde] }) }),
);
export type DetraccionTasa = typeof detraccionTasa.$inferSelect;

// Tipo de cambio cargado a mano (sin API SUNAT). Si no hay TC del día se usa el último publicado.
export const tipoCambio = pgTable(
  'tipo_cambio',
  {
    fecha: date('fecha').notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull(),
    compra: decimal('compra', { precision: 8, scale: 4 }).notNull(),
    venta: decimal('venta', { precision: 8, scale: 4 }).notNull(),
    fuente: varchar('fuente', { length: 30 }).notNull().default('manual'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.fecha, t.moneda] }) }),
);

// ─── Asientos contables ──────────────────────────────────────
export const asientos = pgTable(
  'asientos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    correlativo: varchar('correlativo', { length: 20 }).notNull(), // AS-202601-0001
    fecha: date('fecha').notNull(),
    periodo: varchar('periodo', { length: 7 }), // YYYY-MM (derivado de fecha)
    glosa: text('glosa').notNull(),
    docOrigen: varchar('doc_origen', { length: 50 }),
    tipoDoc: varchar('tipo_doc', { length: 50 }),
    // Motor automático · liga el asiento al documento fuente (idempotencia)
    origen: varchar('origen', { length: 20 }).notNull().default('manual'), // manual·gasto·pago_oc·valorizacion·cobro_valo·planilla
    origenId: uuid('origen_id'), // id del doc fuente (gasto/oc/valorizacion/semana)
    moneda: varchar('moneda', { length: 3 }).notNull().default('PEN'),
    tipoCambio: decimal('tipo_cambio', { precision: 8, scale: 4 }), // TC SUNAT si USD
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }),
    contraparteRuc: varchar('contraparte_ruc', { length: 11 }),
    contraparteRazon: varchar('contraparte_razon', { length: 255 }),
    status: asientoStatusEnum('status').notNull().default('borrador'),
    cerradoMes: varchar('cerrado_mes', { length: 7 }), // YYYY-MM si está cerrado
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    // WS0 · un asiento = una empresa (único lugar de la verdad de empresa · header, no línea)
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    anulaAAsientoId: uuid('anula_a_asiento_id'), // self-ref (contra-asiento) · FK en DB
    hash: varchar('hash', { length: 64 }), // idempotencia de contenido (apertura, etc.)
  },
  (t) => ({
    fechaIdx: index('asientos_fecha_idx').on(t.fecha),
    correlativoUq: index('asientos_correlativo_uq').on(t.correlativo),
    proyectoIdx: index('asientos_proyecto_idx').on(t.proyectoId),
    empresaIdx: index('asientos_empresa_idx').on(t.empresaId),
    // idempotencia apertura: máx 1 apertura activa por empresa (índice único parcial · existe en DB)
    aperturaUq: uniqueIndex('asientos_apertura_uq').on(t.empresaId).where(sql`origen = 'apertura' AND status <> 'anulado'`),
  }),
);

export const asientosLineas = pgTable(
  'asientos_lineas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    asientoId: uuid('asiento_id').notNull().references(() => asientos.id, { onDelete: 'cascade' }),
    correlativo: integer('correlativo').notNull(), // 1,2,3...
    cuenta: varchar('cuenta', { length: 10 }).notNull(), // legacy varchar (se mantiene · = cuenta_contable)
    descripcion: text('descripcion'),
    debe: decimal('debe', { precision: 14, scale: 2 }).default('0'),
    haber: decimal('haber', { precision: 14, scale: 2 }).default('0'),
    // WS0 · la cuenta contable es el EJE (FK), obra por LÍNEA, clase DERIVADA (nunca input)
    cuentaContable: varchar('cuenta_contable', { length: 10 }).references(() => planContable.codigo), // FK VALIDADA en DB (WS-1 hardening · historico limpio)
    obraId: uuid('obra_id').references(() => proyectos.id, { onDelete: 'set null' }),
    claseDerivada: varchar('clase_derivada', { length: 10 }), // CD | GG_OBRA | GG_CORP · cache de derivarClase()
    cuentaOrigen: varchar('cuenta_origen', { length: 10 }), // WS1 · MANUAL | SUGERIDO | INFERIDO (procedencia de la cuenta)
  },
  (t) => ({
    asientoIdx: index('lineas_asiento_idx').on(t.asientoId),
    cuentaIdx: index('lineas_cuenta_idx').on(t.cuenta),
    cuentaContableIdx: index('lineas_cuenta_contable_idx').on(t.cuentaContable),
    obraIdx: index('lineas_obra_idx').on(t.obraId),
  }),
);

// ─── WS0 · Sub-mayor CxC/CxP (documento_pendiente) ────────────
// El asiento golpea la cuenta CONTROL (1212/4212) a nivel mayor; el detalle por tercero/documento
// (aging, pago parcial, apertura) vive aquí. saldo_pendiente = DERIVADO = monto_original − Σ aplicaciones activas.
export const documentoPendiente = pgTable(
  'documento_pendiente',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    tipo: varchar('tipo', { length: 3 }).notNull(), // cxc | cxp (CHECK en DB)
    cuentaControl: varchar('cuenta_control', { length: 10 }).notNull().references(() => planContable.codigo),
    terceroRuc: varchar('tercero_ruc', { length: 11 }),
    terceroRazon: varchar('tercero_razon', { length: 255 }),
    docTipo: varchar('doc_tipo', { length: 20 }),
    docSerie: varchar('doc_serie', { length: 20 }),
    docNumero: varchar('doc_numero', { length: 30 }),
    fechaEmision: date('fecha_emision'),
    fechaVenc: date('fecha_venc'),
    moneda: varchar('moneda', { length: 3 }).notNull().default('PEN'),
    tipoCambio: decimal('tipo_cambio', { precision: 8, scale: 4 }),
    montoOriginal: decimal('monto_original', { precision: 14, scale: 2 }).notNull(), // moneda nativa
    montoPen: decimal('monto_pen', { precision: 14, scale: 2 }).notNull(), // equivalente PEN (mayor)
    saldoPendiente: decimal('saldo_pendiente', { precision: 14, scale: 2 }).notNull(), // DERIVADO (cache)
    estado: varchar('estado', { length: 10 }).notNull().default('abierto'), // abierto | parcial | cancelado (CHECK)
    obraId: uuid('obra_id').references(() => proyectos.id, { onDelete: 'set null' }),
    asientoOrigenId: uuid('asiento_origen_id').references(() => asientos.id, { onDelete: 'set null' }),
    docOrigenTipo: varchar('doc_origen_tipo', { length: 20 }),
    docOrigenId: uuid('doc_origen_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex('docpend_uq').on(t.empresaId, t.tipo, t.docTipo, t.docSerie, t.docNumero),
    controlIdx: index('docpend_control_idx').on(t.empresaId, t.cuentaControl),
    asientoIdx: index('docpend_asiento_idx').on(t.asientoOrigenId),
  }),
);
export type DocumentoPendiente = typeof documentoPendiente.$inferSelect;

// ─── WS0 · Aplicación pago↔documento (N↔M) ────────────────────
// El saldo se DERIVA de estas aplicaciones (nunca se resta a ciegas). Anular pago → estado=anulada → saldo se recompone.
export const aplicacionDocumento = pgTable(
  'aplicacion_documento',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentoPendienteId: uuid('documento_pendiente_id').notNull().references(() => documentoPendiente.id, { onDelete: 'cascade' }),
    asientoId: uuid('asiento_id').notNull().references(() => asientos.id, { onDelete: 'cascade' }),
    asientoLineaId: uuid('asiento_linea_id').references(() => asientosLineas.id, { onDelete: 'set null' }),
    montoAplicado: decimal('monto_aplicado', { precision: 14, scale: 2 }).notNull(), // > 0 (CHECK)
    moneda: varchar('moneda', { length: 3 }).notNull().default('PEN'),
    tipoCambio: decimal('tipo_cambio', { precision: 8, scale: 4 }),
    fecha: date('fecha'),
    estado: varchar('estado', { length: 10 }).notNull().default('activa'), // activa | anulada (CHECK)
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    origenRef: varchar('origen_ref', { length: 80 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // idempotencia: un asiento aplica una sola vez a un documento (N↔M por filas distintas)
    asientoDocUq: uniqueIndex('aplic_asiento_doc_uq').on(t.asientoId, t.documentoPendienteId),
    docIdx: index('aplic_doc_idx').on(t.documentoPendienteId),
  }),
);
export type AplicacionDocumento = typeof aplicacionDocumento.$inferSelect;

// ─── WS0 · mapa_cuenta_clase (DATA de derivarClase · cuenta→clase_obra) ───
export const mapaCuentaClase = pgTable('mapa_cuenta_clase', {
  cuenta: varchar('cuenta', { length: 10 }).primaryKey().references(() => planContable.codigo),
  claseObra: varchar('clase_obra', { length: 10 }).notNull(), // CD | GG_OBRA (CHECK) · GG_CORP se deriva por obra_id null
});
export type MapaCuentaClase = typeof mapaCuentaClase.$inferSelect;

// ─── WS0 · asiento_plantilla (patrones débito/haber · precarga de formularios) ───
export const asientoPlantilla = pgTable('asiento_plantilla', {
  id: uuid('id').primaryKey().defaultRandom(),
  codigo: varchar('codigo', { length: 30 }).notNull().unique(),
  nombre: varchar('nombre', { length: 120 }).notNull(),
  origen: varchar('origen', { length: 20 }).notNull(),
  lineasPatron: jsonb('lineas_patron').$type<Array<Record<string, unknown>>>().notNull().default([]),
  activa: boolean('activa').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
export type AsientoPlantilla = typeof asientoPlantilla.$inferSelect;

// ─── FIN-1 · Finanzas operativas (modelo "Plantilla MM" · ledger de gastos) ───
// Cuentas bancarias / caja chica
export const cuentasBancarias = pgTable('cuentas_bancarias', {
  id: uuid('id').primaryKey().defaultRandom(),
  codigo: varchar('codigo', { length: 60 }).notNull().unique(), // 194-9927833-0-39 · REND-KELY
  banco: varchar('banco', { length: 80 }),
  moneda: varchar('moneda', { length: 3 }).notNull().default('PEN'),
  descripcion: varchar('descripcion', { length: 120 }), // Cuenta Corriente Principal · Caja Chica Oficina
  cuentaContable: varchar('cuenta_contable', { length: 10 }), // F1 · sub-cuenta PCGE 104x (104101…) para asientos de caja
  activo: boolean('activo').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
export type CuentaBancaria = typeof cuentasBancarias.$inferSelect;

// Presupuesto de oficina por mes (tope editable · gastos administrativos)
export const presupuestoOficina = pgTable('presupuesto_oficina', {
  mes: varchar('mes', { length: 7 }).primaryKey(), // 2026-04
  monto: decimal('monto', { precision: 14, scale: 2 }).notNull().default('0'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export type PresupuestoOficina = typeof presupuestoOficina.$inferSelect;

// F3 · configuración contable key/value (CUTOVER del 104x, parallel-run, futuros flags) · editable + auditable
export const configuracionContable = pgTable('configuracion_contable', {
  clave: varchar('clave', { length: 60 }).primaryKey(), // MOVIMIENTOS_104X_CUTOVER · MOVIMIENTOS_104X_PARALLEL
  valor: text('valor'),
  comentario: text('comentario'),
  actualizadoPor: varchar('actualizado_por', { length: 120 }),
  actualizadoEn: timestamp('actualizado_en').notNull().defaultNow(),
});
export type ConfiguracionContable = typeof configuracionContable.$inferSelect;

// Determinación de cuentas · mapa editable tipoGasto → cuenta PCGE (estilo ERP: config, no hardcode).
// esActivo=true → el motor rutea a activo fijo (33x) en vez de gasto (6x). esGasto=false → no es gasto
// (financiamiento/CxC); el motor no lo provisiona como compra.
export const gastoCuentaMap = pgTable('gasto_cuenta_map', {
  tipoGasto: varchar('tipo_gasto', { length: 60 }).primaryKey(),
  cuenta: varchar('cuenta', { length: 10 }).notNull(),
  esActivo: boolean('es_activo').notNull().default(false),
  esGasto: boolean('es_gasto').notNull().default(true),
  clase: varchar('clase', { length: 10 }).notNull().default('CD'), // CD | GG_OBRA | GG_CORP · sugerencia para el form
  actualizadoEn: timestamp('actualizado_en').notNull().defaultNow(),
});
export type GastoCuentaMap = typeof gastoCuentaMap.$inferSelect;

// Gastos (Fact de Compras) · costo REAL ejecutado por proyecto
export const gastos = pgTable(
  'gastos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: varchar('codigo', { length: 30 }), // CMP-09001
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }), // null = VARIOS
    fecha: date('fecha').notNull(),
    tipoRegistro: varchar('tipo_registro', { length: 40 }), // Gasto Directo · etc
    tipoIgv: varchar('tipo_igv', { length: 20 }), // IGV · Exonerado
    ordenCompraId: uuid('orden_compra_id').references(() => ordenesCompra.id, { onDelete: 'set null' }),
    proveedorId: uuid('proveedor_id').references(() => proveedores.id, { onDelete: 'set null' }),
    proveedorRuc: varchar('proveedor_ruc', { length: 11 }),
    proveedorRazon: varchar('proveedor_razon', { length: 255 }),
    tipoComprobante: varchar('tipo_comprobante', { length: 40 }),
    serie: varchar('serie', { length: 20 }),
    numero: varchar('numero', { length: 40 }),
    moneda: varchar('moneda', { length: 3 }).notNull().default('PEN'),
    formaPago: varchar('forma_pago', { length: 40 }),
    fuentePago: varchar('fuente_pago', { length: 40 }),
    cuentaId: uuid('cuenta_id').references(() => cuentasBancarias.id, { onDelete: 'set null' }),
    descripcionItem: text('descripcion_item'),
    subtotal: decimal('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
    igv: decimal('igv', { precision: 14, scale: 2 }).notNull().default('0'),
    exonerado: decimal('exonerado', { precision: 14, scale: 2 }).notNull().default('0'),
    total: decimal('total', { precision: 14, scale: 2 }).notNull().default('0'),
    tipoGasto: varchar('tipo_gasto', { length: 40 }), // Compra Materiales · Planilla · etc
    destino: varchar('destino', { length: 12 }).notNull().default('proyecto'), // proyecto | corporativo
    clasificacion: varchar('clasificacion', { length: 10 }).notNull().default('CD'), // CD | GG_OBRA | GG_CORP
    clasificacionOrigen: varchar('clasificacion_origen', { length: 12 }).notNull().default('AUTOMATICO'), // AUTOMATICO | USUARIO | BACKFILL
    // WS1 · cuenta contable MANUAL (Kelly). null = no eligió → motor infiere. El motor la re-lee y NO la pisa.
    cuentaContable: varchar('cuenta_contable', { length: 10 }).references(() => planContable.codigo),
    cuentaContableOrigen: varchar('cuenta_contable_origen', { length: 10 }), // MANUAL | SUGERIDO (null = no elegida)
    prorrateable: boolean('prorrateable').notNull().default(false),
    observaciones: text('observaciones'),
    lockedAt: timestamp('locked_at'), // H2 · congelado por cierre de periodo
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('gastos_proyecto_idx').on(t.proyectoId),
    fechaIdx: index('gastos_fecha_idx').on(t.fecha),
    tipoIdx: index('gastos_tipo_idx').on(t.tipoGasto),
  }),
);
export type Gasto = typeof gastos.$inferSelect;
export type NewGasto = typeof gastos.$inferInsert;

// FIN-2 · Movimientos de cuenta (Fact de Flujo Cuentas) · caja real por cuenta bancaria
export const movimientos = pgTable(
  'movimientos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: varchar('codigo', { length: 30 }), // BN-090001
    fecha: date('fecha').notNull(),
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }),
    tipoMovimiento: varchar('tipo_movimiento', { length: 10 }).notNull(), // Ingreso · Egreso
    fuentePago: varchar('fuente_pago', { length: 40 }), // Cuenta Corriente · Caja Chica
    cuentaId: uuid('cuenta_id').references(() => cuentasBancarias.id, { onDelete: 'set null' }),
    fuenteMovimiento: varchar('fuente_movimiento', { length: 40 }), // Cliente · Socio · Otros · Préstamo
    clienteId: uuid('cliente_id').references(() => clientes.id, { onDelete: 'set null' }),
    clienteNombre: varchar('cliente_nombre', { length: 255 }),
    tipoComprobante: varchar('tipo_comprobante', { length: 40 }),
    serie: varchar('serie', { length: 20 }),
    numero: varchar('numero', { length: 40 }),
    moneda: varchar('moneda', { length: 3 }).notNull().default('PEN'),
    monto: decimal('monto', { precision: 14, scale: 2 }).notNull(), // positivo · el signo lo da tipoMovimiento · = subtotal+igv (importe comprobante)
    descripcion: text('descripcion'),
    numOperacion: varchar('num_operacion', { length: 40 }),
    gastoId: uuid('gasto_id').references(() => gastos.id, { onDelete: 'set null' }), // si paga un gasto
    // Desglose fiscal (form rico v1) · subtotal+igv = monto · detracción/retención son splits informativos
    subtipo: varchar('subtipo', { length: 60 }), // Materiales · Comisión · Transferencia entre cuentas · etc
    subtotal: decimal('subtotal', { precision: 14, scale: 2 }).default('0'),
    igv: decimal('igv', { precision: 14, scale: 2 }).default('0'),
    detraccion: decimal('detraccion', { precision: 14, scale: 2 }).default('0'),
    retencion: decimal('retencion', { precision: 14, scale: 2 }).default('0'),
    cuentaDestinoId: uuid('cuenta_destino_id'), // transferencias bancarias (egreso origen ↔ ingreso destino) · sin .references por orden
    transferenciaId: uuid('transferencia_id'), // liga las 2 filas de una transferencia
    // F1 · contabilidad: naturaleza estructurada (→ cuenta PCGE) + link a documento (contrapartida exacta)
    naturalezaContable: varchar('naturaleza_contable', { length: 30 }), // key de NATURALEZAS_CONTABLES (@erp/shared)
    // WS1 · cuenta contable contra MANUAL (Kelly). null = infiere de naturaleza. Motor la re-lee y NO la pisa.
    cuentaContable: varchar('cuenta_contable', { length: 10 }).references(() => planContable.codigo),
    cuentaContableOrigen: varchar('cuenta_contable_origen', { length: 10 }), // MANUAL | SUGERIDO
    ordenCompraId: uuid('orden_compra_id'), // si el movimiento paga/cobra una OC · uuid plano (orden tablas)
    valorizacionId: uuid('valorizacion_id'), // si el movimiento cobra una valorización
    fechaVencimiento: date('fecha_vencimiento'),
    estado: varchar('estado', { length: 20 }), // Pendiente · Pagada · Por cobrar · Cobrada · Completada
    // H1 · trazabilidad + anulación formal (audit hardening · NO toca estado operacional)
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }), // quién creó el movimiento
    anulado: boolean('anulado').notNull().default(false), // soft-anular (reemplaza hard-delete operacional)
    anuladoPor: uuid('anulado_por').references(() => users.id, { onDelete: 'set null' }),
    anuladoEn: timestamp('anulado_en'),
    anuladoMotivo: text('anulado_motivo'),
    lockedAt: timestamp('locked_at'), // H2 · congelado por cierre de periodo (freeze row-level)
    // H3.1 · TC histórico · monedaBase = PEN. tipoCambio snapshot (nunca recalcular). montoBase = monto*tc.
    tipoCambio: decimal('tipo_cambio', { precision: 10, scale: 4 }), // null/1 = PEN
    montoBase: decimal('monto_base', { precision: 14, scale: 2 }), // monto convertido a PEN (para sumas/shadow)
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('mov_proyecto_idx').on(t.proyectoId),
    cuentaIdx: index('mov_cuenta_idx').on(t.cuentaId),
    fechaIdx: index('mov_fecha_idx').on(t.fecha),
  }),
);
export type Movimiento = typeof movimientos.$inferSelect;
export type NewMovimiento = typeof movimientos.$inferInsert;

// ─── H3 · Conciliación bancaria (ERP ↔ extracto banco) ───────
export const conciliacionEstadoEnum = pgEnum('conciliacion_estado', ['pendiente', 'conciliado', 'diferencia', 'ignorado']);
export const extractosBancarios = pgTable('extractos_bancarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  cuentaId: uuid('cuenta_id').references(() => cuentasBancarias.id, { onDelete: 'set null' }),
  banco: varchar('banco', { length: 80 }),
  moneda: varchar('moneda', { length: 3 }).notNull().default('PEN'),
  nombreArchivo: varchar('nombre_archivo', { length: 255 }),
  totalFilas: integer('total_filas').notNull().default(0),
  importadoPor: uuid('importado_por').references(() => users.id, { onDelete: 'set null' }),
  importadoEn: timestamp('importado_en').notNull().defaultNow(),
  contenidoHash: varchar('contenido_hash', { length: 64 }), // F4B.3 · dedup de import (sha256 cuenta+totales+contenido) · UNIQUE
}, (t) => ({
  hashIdx: uniqueIndex('extbanc_hash_unq').on(t.contenidoHash),
}));
export const extractoLineas = pgTable(
  'extracto_lineas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    extractoId: uuid('extracto_id').notNull().references(() => extractosBancarios.id, { onDelete: 'cascade' }),
    fecha: date('fecha').notNull(),
    descripcion: text('descripcion'),
    referencia: varchar('referencia', { length: 120 }), // nº operación / glosa banco
    monto: decimal('monto', { precision: 14, scale: 2 }).notNull(), // signo: + abono / − cargo (normalizado)
    moneda: varchar('moneda', { length: 3 }).notNull().default('PEN'),
    saldo: decimal('saldo', { precision: 14, scale: 2 }),
    estado: conciliacionEstadoEnum('estado').notNull().default('pendiente'),
    movimientoId: uuid('movimiento_id').references(() => movimientos.id, { onDelete: 'set null' }), // match ERP
    score: decimal('score', { precision: 5, scale: 2 }), // 0-100 confianza del match sugerido
    confianza: varchar('confianza', { length: 10 }), // alta · media · baja
    matchedPor: uuid('matched_por').references(() => users.id, { onDelete: 'set null' }),
    matchedEn: timestamp('matched_en'),
  },
  (t) => ({
    extractoIdx: index('extlin_extracto_idx').on(t.extractoId),
    estadoIdx: index('extlin_estado_idx').on(t.estado),
    movIdx: index('extlin_mov_idx').on(t.movimientoId),
  }),
);
export type ExtractoBancario = typeof extractosBancarios.$inferSelect;
export type ExtractoLinea = typeof extractoLineas.$inferSelect;

// ─── F4.2 · Snapshots de estabilidad pre-cutover (tendencia histórica · read-only) ───
// Captura idempotente 1/día/periodo bajo PARALLEL (o manual). Evidencia objetiva antes del flip.
export const cutoverSnapshots = pgTable(
  'cutover_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    periodo: varchar('periodo', { length: 7 }).notNull(), // 'YYYY-MM'
    fechaSnapshot: date('fecha_snapshot').notNull(),       // día de captura (dedup)
    diff: decimal('diff', { precision: 14, scale: 2 }).notNull().default('0'),
    realDiffsCount: integer('real_diffs_count').notNull().default(0),
    ownershipAmbiguo: integer('ownership_ambiguo').notNull().default(0),
    movimientosSinCuenta: integer('movimientos_sin_cuenta').notNull().default(0),
    cuentasSin104x: integer('cuentas_sin_104x').notNull().default(0),
    conciliacionPendiente: integer('conciliacion_pendiente').notNull().default(0),
    listoParaFlip: boolean('listo_para_flip').notNull().default(false),
    meta: jsonb('meta'),                                   // {cutover, parallel, fuente, ...}
    hash: varchar('hash', { length: 64 }),                 // sha256 de las métricas (tamper-evidence)
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    unq: uniqueIndex('cutsnap_periodo_fecha_unq').on(t.periodo, t.fechaSnapshot), // 1/día/periodo
    periodoIdx: index('cutsnap_periodo_idx').on(t.periodo),
  }),
);
export type CutoverSnapshot = typeof cutoverSnapshots.$inferSelect;

// ─── Notificaciones / alertas (dashboard · campana) ──────────
// Materializadas por un generador idempotente (dedup por `clave`). El estado leído
// vive en `leidoEn`. ponytail: read-state global (equipo chico); si crece, tabla
// notificacion_lecturas por (userId, notificacionId).
export const notificaciones = pgTable('notificaciones', {
  id: uuid('id').primaryKey().defaultRandom(),
  clave: varchar('clave', { length: 140 }).notNull().unique(), // 'valo-vencida-<valoId>' · idempotencia
  tipo: varchar('tipo', { length: 40 }).notNull(), // valo_vencida · oc_pendiente · sobrecosto · stock · oportunidad
  severidad: varchar('severidad', { length: 10 }).notNull().default('media'), // alta · media · baja
  titulo: varchar('titulo', { length: 200 }).notNull(),
  detalle: text('detalle'),
  proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'cascade' }),
  proyectoCodigo: varchar('proyecto_codigo', { length: 50 }),
  accionUrl: varchar('accion_url', { length: 300 }),
  leidoEn: timestamp('leido_en'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
export type Notificacion = typeof notificaciones.$inferSelect;

// FIN-3 · Inventario (Fact de Inventario) · items de almacén por proyecto
export const inventarioItems = pgTable(
  'inventario_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: varchar('codigo', { length: 30 }), // ITM-090001
    fecha: date('fecha').notNull(),
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }),
    proveedorRuc: varchar('proveedor_ruc', { length: 11 }),
    proveedorRazon: varchar('proveedor_razon', { length: 255 }),
    tipoComprobante: varchar('tipo_comprobante', { length: 40 }),
    serie: varchar('serie', { length: 20 }),
    numero: varchar('numero', { length: 40 }),
    cantidad: decimal('cantidad', { precision: 14, scale: 4 }).notNull().default('0'),
    descripcionItem: text('descripcion_item'),
    valorUnitario: decimal('valor_unitario', { precision: 14, scale: 4 }).notNull().default('0'),
    categoria: varchar('categoria', { length: 40 }), // Compra Materiales · Herramientas · EPPS...
    estado: varchar('estado', { length: 30 }).default('Disponible'), // Disponible · Usado · Devuelto · Bajado
    responsable: varchar('responsable', { length: 120 }),
    observacion: text('observacion'),
    gastoId: uuid('gasto_id').references(() => gastos.id, { onDelete: 'set null' }), // compra de origen (Opción B · costo vive en el gasto)
    activoId: uuid('activo_id'), // si se promovió a activo (FK activos en DB · sin .references por orden)
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('inv_proyecto_idx').on(t.proyectoId),
    fechaIdx: index('inv_fecha_idx').on(t.fecha),
    gastoIdx: index('inv_gasto_idx').on(t.gastoId),
  }),
);
export type InventarioItem = typeof inventarioItems.$inferSelect;
export type NewInventarioItem = typeof inventarioItems.$inferInsert;

// ─── Activos · herramientas y equipos (NO consumibles) ───────
// Depreciación SUNAT calculada: valorNeto = valorAdq − (valorAdq × pctAnual × años transcurridos)
export const activos = pgTable(
  'activos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: varchar('codigo', { length: 20 }).notNull().unique(), // MM-A-0001
    rfidTag: varchar('rfid_tag', { length: 64 }).unique(), // UID tag UHF/RFID · null hasta vincular lector
    nombre: varchar('nombre', { length: 255 }).notNull(),
    categoria: varchar('categoria', { length: 40 }).notNull(), // Herramienta eléctrica · Andamios · Cómputo...
    marca: varchar('marca', { length: 80 }),
    serie: varchar('serie', { length: 120 }), // n° serie del fabricante
    fechaAdquisicion: date('fecha_adquisicion').notNull(),
    valorAdquisicion: decimal('valor_adquisicion', { precision: 14, scale: 2 }).notNull(),
    pctDepreciacionAnual: decimal('pct_depreciacion_anual', { precision: 5, scale: 2 }).notNull().default('10.00'), // SUNAT · editable
    estado: varchar('estado', { length: 20 }).notNull().default('operativo'), // operativo · baja · perdido
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }), // null = almacén/oficina
    ubicacion: varchar('ubicacion', { length: 160 }), // detalle libre (Almacén central · contenedor N1)
    responsable: varchar('responsable', { length: 120 }),
    notas: text('notas'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('activos_proyecto_idx').on(t.proyectoId),
    categoriaIdx: index('activos_categoria_idx').on(t.categoria),
  }),
);
export type Activo = typeof activos.$inferSelect;

// Historial de traslados del activo (trazabilidad obra→obra)
export const activoMovimientos = pgTable(
  'activo_movimientos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    activoId: uuid('activo_id').notNull().references(() => activos.id, { onDelete: 'cascade' }),
    fecha: date('fecha').notNull(),
    desde: varchar('desde', { length: 200 }), // texto resuelto (obra X · Almacén)
    hacia: varchar('hacia', { length: 200 }).notNull(),
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }), // destino
    responsable: varchar('responsable', { length: 120 }),
    notas: text('notas'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    activoIdx: index('actmov_activo_idx').on(t.activoId),
  }),
);
export type ActivoMovimiento = typeof activoMovimientos.$inferSelect;

// ─── FIN-4 · Planilla construcción civil (CAPECO) ────────────
// Empleados (obreros + administrativos)
export const empleados = pgTable('empleados', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: varchar('nombre', { length: 200 }).notNull(),
  tipoDoc: varchar('tipo_doc', { length: 10 }).default('DNI'),
  numDoc: varchar('num_doc', { length: 20 }),
  fechaNacimiento: date('fecha_nacimiento'),
  sistemaPension: varchar('sistema_pension', { length: 40 }), // AFP Habitat · S.N.P. · etc
  cuspp: varchar('cuspp', { length: 30 }),
  fechaIngreso: date('fecha_ingreso'),
  categoria: varchar('categoria', { length: 30 }), // Operario · Oficial · Peón · Maestro · Empleado
  tieneHijos: boolean('tiene_hijos').default(false),
  numHijos: integer('num_hijos').default(0),
  aplicaMovilidad: boolean('aplica_movilidad').default(false),
  bonifAltura: boolean('bonif_altura').default(false), // CC · trabajo en altura
  bonifAgua: boolean('bonif_agua').default(false), // CC · contacto con agua
  banco: varchar('banco', { length: 40 }),
  numCuenta: varchar('num_cuenta', { length: 40 }),
  tipoPlanilla: varchar('tipo_planilla', { length: 10 }).notNull().default('obrero'), // obrero · admin
  // Modalidad contractual · 'practicante' (modalidad formativa) no aporta pension ni EsSalud
  tipoTrabajador: varchar('tipo_trabajador', { length: 12 }).notNull().default('planilla'), // planilla · practicante
  proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }), // obra asignada (null = oficina)
  sctrVigencia: date('sctr_vigencia'), // vencimiento póliza SCTR
  activo: boolean('activo').notNull().default(true),
  // Planilla oficina (regimen general)
  cargo: varchar('cargo', { length: 80 }),
  sueldoBaseMensual: decimal('sueldo_base_mensual', { precision: 14, scale: 2 }),
  fechaCese: date('fecha_cese'),
  asignacionFamiliar: boolean('asignacion_familiar').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
export type Empleado = typeof empleados.$inferSelect;

// Tasas legales globales (singleton) · EDITABLE en Configuración
// Cambian por ley/convenio · separadas de los % por categoría
export const configPlanilla = pgTable('config_planilla', {
  id: varchar('id', { length: 12 }).primaryKey().default('singleton'),
  uit: decimal('uit', { precision: 10, scale: 2 }).notNull().default('5350'), // UIT 2026
  pctEsSalud: decimal('pct_essalud', { precision: 6, scale: 4 }).notNull().default('0.09'),
  pctOnp: decimal('pct_onp', { precision: 6, scale: 4 }).notNull().default('0.13'),
  pctSencico: decimal('pct_sencico', { precision: 6, scale: 4 }).notNull().default('0.002'),
  pctConafovicer: decimal('pct_conafovicer', { precision: 6, scale: 4 }).notNull().default('0.02'),
  pctSctrSalud: decimal('pct_sctr_salud', { precision: 6, scale: 4 }).notNull().default('0.0155'),
  pctSctrPension: decimal('pct_sctr_pension', { precision: 6, scale: 4 }).notNull().default('0.0174'),
  pctBonifAltura: decimal('pct_bonif_altura', { precision: 6, scale: 4 }).notNull().default('0.07'),
  pctBonifAgua: decimal('pct_bonif_agua', { precision: 6, scale: 4 }).notNull().default('0.20'),
  asignEscolarJornales: decimal('asign_escolar_jornales', { precision: 6, scale: 2 }).notNull().default('30'), // jornales/año/hijo
  // Planilla oficina (regimen general)
  rmv: decimal('rmv', { precision: 14, scale: 2 }).notNull().default('1025'),
  topeSeguroAfp: decimal('tope_seguro_afp', { precision: 14, scale: 2 }).notNull().default('12786.4'),
  horasMesBase: integer('horas_mes_base').notNull().default(240),
});
export type ConfigPlanilla = typeof configPlanilla.$inferSelect;

// Asistencia diaria (tareo) · base legal de la planilla · grid semanal
export const asistencia = pgTable(
  'asistencia',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empleadoId: uuid('empleado_id').notNull().references(() => empleados.id, { onDelete: 'cascade' }),
    semanaId: uuid('semana_id').references(() => planillaSemanas.id, { onDelete: 'set null' }),
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }),
    fecha: date('fecha').notNull(),
    // normal · tardanza · falta_inj · falta_just · descanso_med · feriado_trab · vacaciones · dominical
    tipo: varchar('tipo', { length: 15 }).notNull().default('normal'),
  },
  (t) => ({
    empFechaUq: index('asist_emp_fecha_uq').on(t.empleadoId, t.fecha),
    semanaIdx: index('asist_semana_idx').on(t.semanaId),
  }),
);
export type Asistencia = typeof asistencia.$inferSelect;

// Parámetros por categoría (jornal + %s) · EDITABLE
export const paramPlanilla = pgTable('param_planilla', {
  id: uuid('id').primaryKey().defaultRandom(),
  categoria: varchar('categoria', { length: 30 }).notNull().unique(),
  jornalBase: decimal('jornal_base', { precision: 10, scale: 2 }).notNull().default('0'),
  movilidad: decimal('movilidad', { precision: 10, scale: 2 }).default('0'),
  pctBuc: decimal('pct_buc', { precision: 6, scale: 4 }).default('0'),
  pctDominical: decimal('pct_dominical', { precision: 6, scale: 4 }).default('0.1667'),
  pctCompVac: decimal('pct_comp_vac', { precision: 6, scale: 4 }).default('0.10'),
  pctCts: decimal('pct_cts', { precision: 6, scale: 4 }).default('0.15'),
  pctGratif: decimal('pct_gratif', { precision: 6, scale: 4 }).default('0'),
  pctHe60: decimal('pct_he60', { precision: 6, scale: 4 }).default('0.20'),
  pctHe100: decimal('pct_he100', { precision: 6, scale: 4 }).default('0.25'),
});
export type ParamPlanilla = typeof paramPlanilla.$inferSelect;

// Tasas AFP (comisión + seguro) · EDITABLE
export const afpTasas = pgTable('afp_tasas', {
  id: uuid('id').primaryKey().defaultRandom(),
  afp: varchar('afp', { length: 40 }).notNull().unique(),
  pctAporte: decimal('pct_aporte', { precision: 6, scale: 4 }).notNull().default('0.10'),
  pctComision: decimal('pct_comision', { precision: 6, scale: 4 }).notNull().default('0'),
  pctSeguro: decimal('pct_seguro', { precision: 6, scale: 4 }).notNull().default('0.0184'),
});
export type AfpTasa = typeof afpTasas.$inferSelect;

// Planilla semana (corrida)
export const planillaSemanas = pgTable('planilla_semanas', {
  id: uuid('id').primaryKey().defaultRandom(),
  proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }),
  fechaInicio: date('fecha_inicio').notNull(),
  fechaFin: date('fecha_fin').notNull(),
  mes: varchar('mes', { length: 7 }), // 2026-04
  estado: varchar('estado', { length: 20 }).notNull().default('borrador'), // borrador · cerrada · pagada
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
export type PlanillaSemana = typeof planillaSemanas.$inferSelect;

// Detalle por obrero · snapshot + asistencia + montos calculados
export const planillaDetalle = pgTable(
  'planilla_detalle',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    semanaId: uuid('semana_id').notNull().references(() => planillaSemanas.id, { onDelete: 'cascade' }),
    empleadoId: uuid('empleado_id').references(() => empleados.id, { onDelete: 'set null' }),
    // WS1 · cuenta de costo del obrero (Kelly imputa · default fuerte 621). El motor agrupa por cuenta.
    cuentaContable: varchar('cuenta_contable', { length: 10 }).references(() => planContable.codigo),
    cuentaContableOrigen: varchar('cuenta_contable_origen', { length: 10 }), // USUARIO | SUGERIDO | AUTOMATICO
    // snapshot (congelado al correr)
    nombre: varchar('nombre', { length: 200 }),
    categoria: varchar('categoria', { length: 30 }),
    sistemaPension: varchar('sistema_pension', { length: 40 }),
    jornalUsado: decimal('jornal_usado', { precision: 10, scale: 2 }),
    // asistencia
    diasTrabajados: integer('dias_trabajados').default(0),
    jornadaDominical: boolean('jornada_dominical').default(false),
    horasExtra60: decimal('horas_extra_60', { precision: 6, scale: 2 }).default('0'),
    horasExtra100: decimal('horas_extra_100', { precision: 6, scale: 2 }).default('0'),
    // ingresos
    montoJornada: decimal('monto_jornada', { precision: 12, scale: 2 }).default('0'),
    montoDominical: decimal('monto_dominical', { precision: 12, scale: 2 }).default('0'),
    montoBuc: decimal('monto_buc', { precision: 12, scale: 2 }).default('0'),
    montoCompVac: decimal('monto_comp_vac', { precision: 12, scale: 2 }).default('0'),
    montoGratif: decimal('monto_gratif', { precision: 12, scale: 2 }).default('0'),
    montoBonifExtra: decimal('monto_bonif_extra', { precision: 12, scale: 2 }).default('0'),
    montoCts: decimal('monto_cts', { precision: 12, scale: 2 }).default('0'),
    montoMovilidad: decimal('monto_movilidad', { precision: 12, scale: 2 }).default('0'),
    montoHorasExtra: decimal('monto_horas_extra', { precision: 12, scale: 2 }).default('0'),
    montoEscolaridad: decimal('monto_escolaridad', { precision: 12, scale: 2 }).default('0'),
    montoBonifAltura: decimal('monto_bonif_altura', { precision: 12, scale: 2 }).default('0'),
    montoBonifAgua: decimal('monto_bonif_agua', { precision: 12, scale: 2 }).default('0'),
    totalIngreso: decimal('total_ingreso', { precision: 12, scale: 2 }).default('0'),
    totalAfecto: decimal('total_afecto', { precision: 12, scale: 2 }).default('0'),
    // descuentos
    montoAfpAporte: decimal('monto_afp_aporte', { precision: 12, scale: 2 }).default('0'),
    montoAfpComision: decimal('monto_afp_comision', { precision: 12, scale: 2 }).default('0'),
    montoAfpSeguro: decimal('monto_afp_seguro', { precision: 12, scale: 2 }).default('0'),
    montoOnp: decimal('monto_onp', { precision: 12, scale: 2 }).default('0'),
    montoConafovicer: decimal('monto_conafovicer', { precision: 12, scale: 2 }).default('0'),
    montoRenta5ta: decimal('monto_renta_5ta', { precision: 12, scale: 2 }).default('0'), // manual
    montoAdelanto: decimal('monto_adelanto', { precision: 12, scale: 2 }).default('0'), // manual
    montoSindical: decimal('monto_sindical', { precision: 12, scale: 2 }).default('0'), // manual
    totalDescuentos: decimal('total_descuentos', { precision: 12, scale: 2 }).default('0'),
    netoPago: decimal('neto_pago', { precision: 12, scale: 2 }).default('0'),
    // empleador (aportes · no afectan neto · suman al costo)
    montoEsSalud: decimal('monto_essalud', { precision: 12, scale: 2 }).default('0'),
    montoSctrSalud: decimal('monto_sctr_salud', { precision: 12, scale: 2 }).default('0'),
    montoSctrPension: decimal('monto_sctr_pension', { precision: 12, scale: 2 }).default('0'),
    montoSencico: decimal('monto_sencico', { precision: 12, scale: 2 }).default('0'),
    montoCostoTotal: decimal('monto_costo_total', { precision: 12, scale: 2 }).default('0'),
  },
  (t) => ({
    semanaIdx: index('pld_semana_idx').on(t.semanaId),
  }),
);
export type PlanillaDetalle = typeof planillaDetalle.$inferSelect;

// ─── Planilla oficina (regimen general) ──────────────────────
export const planillaOficinaMes = pgTable(
  'planilla_oficina_mes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    mes: varchar('mes', { length: 7 }).notNull(),
    estado: varchar('estado', { length: 12 }).notNull().default('borrador'),
    tasasSnapshot: jsonb('tasas_snapshot').$type<Record<string, unknown>>(),
    asientoId: uuid('asiento_id').references(() => asientos.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    cerradoPor: uuid('cerrado_por').references(() => users.id, { onDelete: 'set null' }),
    cerradoEn: timestamp('cerrado_en'),
  },
  (t) => ({
    empresaMesUq: uniqueIndex('pom_empresa_mes_uq').on(t.empresaId, t.mes),
  }),
);
export type PlanillaOficinaMes = typeof planillaOficinaMes.$inferSelect;

export const planillaOficinaDetalle = pgTable(
  'planilla_oficina_detalle',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planillaMesId: uuid('planilla_mes_id').notNull().references(() => planillaOficinaMes.id, { onDelete: 'cascade' }),
    empleadoId: uuid('empleado_id').notNull().references(() => empleados.id),
    boletaCorrelativo: varchar('boleta_correlativo', { length: 20 }),
    nombre: varchar('nombre', { length: 200 }),
    cargo: varchar('cargo', { length: 80 }),
    dni: varchar('dni', { length: 15 }),
    afp: varchar('afp', { length: 40 }),
    cuspp: varchar('cuspp', { length: 40 }),
    cuentaBancaria: varchar('cuenta_bancaria', { length: 40 }),
    diasTrab: integer('dias_trab').default(30),
    horasTrab: integer('horas_trab').default(240),
    sueldoMensual: decimal('sueldo_mensual', { precision: 14, scale: 2 }).default('0'),
    valorHora: decimal('valor_hora', { precision: 14, scale: 4 }).default('0'),
    cantHe25: decimal('cant_he25', { precision: 8, scale: 2 }).default('0'),
    montoHe25: decimal('monto_he25', { precision: 14, scale: 2 }).default('0'),
    cantHe35: decimal('cant_he35', { precision: 8, scale: 2 }).default('0'),
    montoHe35: decimal('monto_he35', { precision: 14, scale: 2 }).default('0'),
    totalHe: decimal('total_he', { precision: 14, scale: 2 }).default('0'),
    diasDominical: integer('dias_dominical').default(0),
    montoDominical: decimal('monto_dominical', { precision: 14, scale: 2 }).default('0'),
    diasFeriado: integer('dias_feriado').default(0),
    montoFeriado: decimal('monto_feriado', { precision: 14, scale: 2 }).default('0'),
    asigFamiliar: decimal('asig_familiar', { precision: 14, scale: 2 }).default('0'),
    gratificacion: decimal('gratificacion', { precision: 14, scale: 2 }).default('0'),
    vacaciones: decimal('vacaciones', { precision: 14, scale: 2 }).default('0'),
    comisiones: decimal('comisiones', { precision: 14, scale: 2 }).default('0'),
    bonificacion: decimal('bonificacion', { precision: 14, scale: 2 }).default('0'),
    totalBruto: decimal('total_bruto', { precision: 14, scale: 2 }).default('0'),
    onp: decimal('onp', { precision: 14, scale: 2 }).default('0'),
    afpAporte: decimal('afp_aporte', { precision: 14, scale: 2 }).default('0'),
    afpSeguro: decimal('afp_seguro', { precision: 14, scale: 2 }).default('0'),
    afpComision: decimal('afp_comision', { precision: 14, scale: 2 }).default('0'),
    imptoRenta5ta: decimal('impto_renta5ta', { precision: 14, scale: 2 }).default('0'),
    retencionJudicial: decimal('retencion_judicial', { precision: 14, scale: 2 }).default('0'),
    adelantoCuota: decimal('adelanto_cuota', { precision: 14, scale: 2 }).default('0'),
    otrosDescuentos: decimal('otros_descuentos', { precision: 14, scale: 2 }).default('0'),
    totalDescuento: decimal('total_descuento', { precision: 14, scale: 2 }).default('0'),
    essalud: decimal('essalud', { precision: 14, scale: 2 }).default('0'),
    essaludVida: decimal('essalud_vida', { precision: 14, scale: 2 }).default('0'),
    totalAporte: decimal('total_aporte', { precision: 14, scale: 2 }).default('0'),
    netoPago: decimal('neto_pago', { precision: 14, scale: 2 }).default('0'),
    costoTotal: decimal('costo_total', { precision: 14, scale: 2 }).default('0'),
    cuentaContable: varchar('cuenta_contable', { length: 10 }).references(() => planContable.codigo),
    cuentaContableOrigen: varchar('cuenta_contable_origen', { length: 10 }),
    fechaIngreso: date('fecha_ingreso'),
    fechaCese: date('fecha_cese'),
    renta5taManual: boolean('renta5ta_manual').notNull().default(false),
  },
  (t) => ({
    mesIdx: index('pod_mes_idx').on(t.planillaMesId),
  }),
);
export type PlanillaOficinaDetalle = typeof planillaOficinaDetalle.$inferSelect;

export const adelantoOficina = pgTable(
  'adelanto_oficina',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empleadoId: uuid('empleado_id').notNull().references(() => empleados.id),
    fecha: date('fecha').notNull(),
    montoTotal: decimal('monto_total', { precision: 14, scale: 2 }).notNull(),
    numCuotas: integer('num_cuotas').notNull().default(1),
    motivo: varchar('motivo', { length: 200 }),
    estado: varchar('estado', { length: 12 }).notNull().default('vigente'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    empleadoIdx: index('adel_empleado_idx').on(t.empleadoId),
  }),
);
export type AdelantoOficina = typeof adelantoOficina.$inferSelect;

export const adelantoCuotaAplicada = pgTable(
  'adelanto_cuota_aplicada',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adelantoId: uuid('adelanto_id').notNull().references(() => adelantoOficina.id, { onDelete: 'cascade' }),
    planillaDetalleId: uuid('planilla_detalle_id').notNull().references(() => planillaOficinaDetalle.id, { onDelete: 'cascade' }),
    monto: decimal('monto', { precision: 14, scale: 2 }).notNull(),
    fecha: date('fecha').notNull(),
  },
  (t) => ({
    acaUq: uniqueIndex('aca_uq').on(t.adelantoId, t.planillaDetalleId),
  }),
);
export type AdelantoCuotaAplicada = typeof adelantoCuotaAplicada.$inferSelect;

export const descuentoOficina = pgTable(
  'descuento_oficina',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planillaDetalleId: uuid('planilla_detalle_id').notNull().references(() => planillaOficinaDetalle.id, { onDelete: 'cascade' }),
    tipo: varchar('tipo', { length: 20 }).notNull(),
    monto: decimal('monto', { precision: 14, scale: 2 }).notNull(),
    motivo: varchar('motivo', { length: 200 }),
  },
);
export type DescuentoOficina = typeof descuentoOficina.$inferSelect;

export const documentoAdjunto = pgTable(
  'documento_adjunto',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entidadTipo: varchar('entidad_tipo', { length: 30 }).notNull(),
    entidadId: uuid('entidad_id').notNull(),
    docTipo: varchar('doc_tipo', { length: 20 }).notNull(),
    nasPath: varchar('nas_path', { length: 400 }).notNull(),
    nombreArchivo: varchar('nombre_archivo', { length: 200 }),
    subidoPor: uuid('subido_por').references(() => users.id, { onDelete: 'set null' }),
    fecha: date('fecha'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    entidadIdx: index('docadj_entidad_idx').on(t.entidadTipo, t.entidadId),
  }),
);
export type DocumentoAdjunto = typeof documentoAdjunto.$inferSelect;

// ─── FIN-5 · Oficina · Rendiciones / Viáticos ────────────────
// Cualquier usuario registra un gasto; admin/contador aprueba → genera gasto + egreso.
export const rendiciones = pgTable(
  'rendiciones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: varchar('codigo', { length: 30 }), // REN-2026-0001
    solicitanteUserId: uuid('solicitante_user_id').references(() => users.id, { onDelete: 'set null' }),
    solicitanteNombre: varchar('solicitante_nombre', { length: 200 }), // snapshot
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }), // obra opcional · null = oficina
    modo: varchar('modo', { length: 12 }).notNull().default('reembolso'), // reembolso · anticipo
    tipo: varchar('tipo', { length: 20 }).notNull().default('viatico'), // viatico·movilidad·utiles·servicio·compra_menor·otro
    concepto: text('concepto'),
    fecha: date('fecha').notNull(),
    montoAnticipo: decimal('monto_anticipo', { precision: 12, scale: 2 }).notNull().default('0'),
    montoRendido: decimal('monto_rendido', { precision: 12, scale: 2 }).notNull().default('0'),
    // borrador · pendiente · aprobado · rendido · cerrado · rechazado
    estado: varchar('estado', { length: 12 }).notNull().default('borrador'),
    cuentaId: uuid('cuenta_id').references(() => cuentasBancarias.id, { onDelete: 'set null' }),
    aprobadoPorUserId: uuid('aprobado_por_user_id').references(() => users.id, { onDelete: 'set null' }),
    aprobadoEn: timestamp('aprobado_en'),
    motivoRechazo: text('motivo_rechazo'),
    gastoId: uuid('gasto_id').references(() => gastos.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    estadoIdx: index('rend_estado_idx').on(t.estado),
    solicitanteIdx: index('rend_solicitante_idx').on(t.solicitanteUserId),
  }),
);
export type Rendicion = typeof rendiciones.$inferSelect;

// Comprobantes de la rendición (sustento fiscal)
export const rendicionItems = pgTable(
  'rendicion_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rendicionId: uuid('rendicion_id').notNull().references(() => rendiciones.id, { onDelete: 'cascade' }),
    tipoComprobante: varchar('tipo_comprobante', { length: 12 }).notNull().default('boleta'), // factura·boleta·rh·recibo
    serie: varchar('serie', { length: 20 }),
    numero: varchar('numero', { length: 40 }),
    ruc: varchar('ruc', { length: 11 }),
    razon: varchar('razon', { length: 255 }),
    fecha: date('fecha'),
    categoria: varchar('categoria', { length: 20 }), // alimentacion·movilidad·hospedaje·utiles·otro
    subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
    igv: decimal('igv', { precision: 12, scale: 2 }).notNull().default('0'),
    total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
    deducible: boolean('deducible').notNull().default(true), // recibo interno / exceso viático = false
    archivo: varchar('archivo', { length: 300 }), // ruta NAS (opcional)
  },
  (t) => ({
    rendIdx: index('rend_item_idx').on(t.rendicionId),
  }),
);
export type RendicionItem = typeof rendicionItems.$inferSelect;

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

// ─── Hitos de obra (ciclo de vida · actas) ───────────────────
// entrega_terreno → inicio_plazo → (ampliacion_plazo) → culminacion → recepcion → liquidacion → consentimiento
export const hitoTipoEnum = pgEnum('hito_tipo', [
  'entrega_terreno',
  'inicio_plazo',
  'ampliacion_plazo',
  'culminacion',
  'recepcion',
  'liquidacion',
  'consentimiento_liquidacion',
]);

export const hitosObra = pgTable(
  'hitos_obra',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    tipo: hitoTipoEnum('tipo').notNull(),
    fecha: date('fecha').notNull(),
    numeroDocumento: varchar('numero_documento', { length: 120 }), // N° acta / asiento cuaderno
    adjuntoNas: text('adjunto_nas'), // ruta NAS al PDF (acta escaneada)
    notas: text('notas'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('hitos_proyecto_idx').on(t.proyectoId),
  }),
);

export type HitoObra = typeof hitosObra.$inferSelect;
export type NewHitoObra = typeof hitosObra.$inferInsert;

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
    estado: varchar('estado', { length: 30 }).notNull().default('vigente'), // vigente · ejecutada · devuelta
    liberaEnHito: hitoTipoEnum('libera_en_hito'), // hito que libera la garantía (recepcion/consentimiento_liquidacion)
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

// ─── Liquidación de obra (snapshot del saldo final · reversible) ──
export const liquidacionEstadoEnum = pgEnum('liquidacion_estado', ['practicada', 'reabierta']);

export const liquidaciones = pgTable(
  'liquidaciones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proyectoId: uuid('proyecto_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    fechaPractica: date('fecha_practica').notNull(),
    practicadaPorUserId: uuid('practicada_por_user_id'),
    estado: liquidacionEstadoEnum('estado').notNull().default('practicada'),
    snapshot: jsonb('snapshot'), // desglose congelado (cada componente del saldo + conciliación)
    saldoFinal: decimal('saldo_final', { precision: 16, scale: 2 }).notNull().default('0'),
    hash: text('hash'),
    reabiertaPorUserId: uuid('reabierta_por_user_id'),
    motivoReapertura: text('motivo_reapertura'),
    reabiertaAt: timestamp('reabierta_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    proyectoIdx: index('liquidaciones_proyecto_idx').on(t.proyectoId),
  }),
);
export type Liquidacion = typeof liquidaciones.$inferSelect;

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
    cierreMeta: jsonb('cierre_meta').$type<Record<string, unknown>>(), // H2.5 · snapshot del estado al cierre (totals/diff/hash)
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
    ruc: varchar('ruc', { length: 11 }).unique(), // nullable · permite proveedores informales sin RUC
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
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }), // null = oficina/empresa (MM)
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
    // Documentos · NAS
    terminos: text('terminos'),
    pdfNasPath: varchar('pdf_nas_path', { length: 500 }), // OC.pdf generado
    cotizacionNasPath: varchar('cotizacion_nas_path', { length: 500 }), // cotización adjunta (obligatoria)
    comprobantePagoNasPath: varchar('comprobante_pago_nas_path', { length: 500 }), // captura transferencia (Finanzas)
    // Pago (eje separado del estado logístico)
    estadoPago: ocEstadoPagoEnum('estado_pago').notNull().default('pendiente'),
    pagadoEn: timestamp('pagado_en'),
    pagadoPorEmail: varchar('pagado_por_email', { length: 255 }),
    gastoId: uuid('gasto_id'), // FK→gastos.id (constraint en DB · sin .references() para evitar ciclo de tipos OC↔gastos)
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
export type Inversion = typeof inversiones.$inferSelect;
export type NewInversion = typeof inversiones.$inferInsert;
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
