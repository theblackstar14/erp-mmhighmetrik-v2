import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { hash } = await import('@node-rs/argon2');
const { db } = await import('./client.js');
const {
  empresa,
  users,
  clientes,
  proyectos,
  consorciosIntegrantes,
  garantias,
  penalidadesCatalogo,
  parametrosCategorias,
  parametros,
  indicesUnificados,
  periodosContables,
} = await import('./schema.js');

console.log('🌱 Seeding F0 Foundation data...');

// ═══════════════════════════════════════════════════════════
// 1. EMPRESA singleton
// ═══════════════════════════════════════════════════════════
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

console.log('✓ Empresa MM HighMetrik');

// ═══════════════════════════════════════════════════════════
// 2. USUARIO ADMIN inicial
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
// 3. CLIENTE · Municipalidad Santiago de Surco (PG0005)
// ═══════════════════════════════════════════════════════════
const [clienteSurco] = await db
  .insert(clientes)
  .values({
    ruc: '20131367423',
    razonSocial: 'MUNICIPALIDAD DISTRITAL DE SANTIAGO DE SURCO',
    tipo: 'publico',
    tipoEntidad: 'municipalidad',
    contacto: 'Gerencia de Administración y Finanzas',
    direccion: 'Calle Loma de Los Amarilis N° 100, Santiago de Surco, Lima',
    representante: 'RICHARD HENRRY ACUÑA FLORES',
    dniRepresentante: '18859192',
    cargoRepresentante: 'Gerente de Administración y Finanzas',
  })
  .onConflictDoNothing()
  .returning();

console.log('✓ Cliente · Municipalidad Santiago de Surco');

// ═══════════════════════════════════════════════════════════
// 4. PROYECTO PG0005 CREMATORIO SURCO · datos contractuales reales
// ═══════════════════════════════════════════════════════════
const clienteId = clienteSurco?.id ?? null;

const [proyectoPG0005] = await db
  .insert(proyectos)
  .values({
    codigo: 'PG0005',
    nombre:
      'CONSTRUCCIÓN DE NICHO, COLUMBARIO Y CREMATORIO; REMODELACIÓN DE VELATORIO; EN EL (LA) CEMENTERIO MUNICIPAL EN EL CENTRO POBLADO SANTIAGO DE SURCO, DISTRITO DE SANTIAGO DE SURCO, PROVINCIA LIMA, DEPARTAMENTO LIMA',
    clienteId,
    ubicacion: 'SANTIAGO DE SURCO - LIMA - LIMA',
    tipo: 'Edificación',
    modalidad: 'suma_alzada',
    status: 'ejecucion',

    // Montos
    costoDirecto: '1319122.00',
    pctGg: '0.10',
    pctUtilidad: '0.07',
    pctIgv: '0.18',
    montoReferencial: '1821179.83',
    montoContractual: '1730120.84',
    // Factor oferta EXACTO (oferta consorcio = 95% del referencial)
    // Confirmado vs calendario adquisiciones: 1,253,165.90 / 1,319,122.00 = 0.95 exacto
    factorOferta: '0.950000',
    montoVigente: '1675933.17', // post reducción Resol 35-2026
    montoIgv: '263995.39', // sobre contractual

    // Plazos
    diasPlazo: 120,
    fechaBuenaPro: '2025-09-05',
    fechaConsentimiento: '2025-09-15',
    fechaFirmaContrato: '2025-10-07',

    // Identificación contractual
    numeroContrato: '037-2025-GAF-MSS',
    numeroProcesoLicitacion: '004-2025-CS-MSS-1',
    cui: '2658565',
    etapa: 'ETAPA I',
    marcoLegal: 'Ley N° 32069 General de Contrataciones Públicas + DS N° 009-2025-EF',

    // Adelantos (cláusulas 8-10)
    pctAdelantoDirecto: '0.10',
    pctAdelantoMateriales: '0.20',
    pctAdelantoAvance: '0.10',

    // Garantías (cláusula 11 · retención sustituye)
    pctRetencion: '0.10',
    pctFielCumplimiento: null,

    // Penalidades (cláusula 15)
    formulaPenalidadMora: '0.10 × monto / (F × plazo)',
    factorFPenalidad: '0.250', // F=0.25 plazo 61-120 días
    pctPenalidadTope: '0.10',

    risk: 'medium',
    nasFolder: '/volume1/Proyectos/PG0005 CREMATORIO SURCO',
  })
  .onConflictDoNothing()
  .returning();

console.log('✓ Proyecto PG0005 CREMATORIO SURCO');

// ═══════════════════════════════════════════════════════════
// 5. CONSORCIO LIMA · DORATTA + LCL (50/50)
// ═══════════════════════════════════════════════════════════
if (proyectoPG0005) {
  await db
    .insert(consorciosIntegrantes)
    .values([
      {
        proyectoId: proyectoPG0005.id,
        nombreConsorcio: 'CONSORCIO LIMA',
        razonSocial: 'DORATTA INGENIERIA Y CONSTRUCCION S.A.C.',
        ruc: '20609286360',
        pctParticipacion: '0.5000',
        representanteComun: 'MARIO GUILLERMO GARCIA CALDERON',
        dniRepresentante: '48448443',
        domicilioComun: 'Av. República de Colombia 625 Of. 501, San Isidro, Lima',
        emailNotificaciones: 'dorattaing@gmail.com',
        esLider: true, // operador tributario · factura 100% a entidad
      },
      {
        proyectoId: proyectoPG0005.id,
        nombreConsorcio: 'CONSORCIO LIMA',
        razonSocial: 'LCL CONTRATISTAS S.A.C.',
        ruc: '20544771478',
        pctParticipacion: '0.5000',
        representanteComun: 'MARIO GUILLERMO GARCIA CALDERON',
        dniRepresentante: '48448443',
        domicilioComun: 'Av. República de Colombia 625 Of. 501, San Isidro, Lima',
        emailNotificaciones: 'dorattaing@gmail.com',
        esLider: false,
      },
    ])
    .onConflictDoNothing();

  console.log('✓ Consorcio LIMA · DORATTA 50% + LCL 50%');

  // ═══════════════════════════════════════════════════════════
  // 6. GARANTÍA · Retención 10% sustitutiva FC
  // ═══════════════════════════════════════════════════════════
  await db
    .insert(garantias)
    .values({
      proyectoId: proyectoPG0005.id,
      tipo: 'retencion',
      numeroCarta: 'S/N',
      monto: '173012.08',
      bancoEmisor: null,
      fechaEmision: '2025-10-06',
      vigenciaDesde: '2025-10-07',
      vigenciaHasta: null, // hasta liquidación
      estado: 'vigente',
      notas: 'Retención 10% sustituye carta fianza Fiel Cumplimiento (cláusula 11 contrato 037)',
    })
    .onConflictDoNothing();

  console.log('✓ Garantía · Retención 10% S/ 173,012.08');

  // ═══════════════════════════════════════════════════════════
  // 7. PENALIDADES CATÁLOGO · 10 supuestos contrato 037 cláusula 15
  // ═══════════════════════════════════════════════════════════
  await db
    .insert(penalidadesCatalogo)
    .values([
      {
        proyectoId: proyectoPG0005.id,
        numero: 1,
        supuesto:
          'Sustitución de un mismo integrante del plantel técnico por segunda vez (no fortuito · no fuerza mayor · no imputable contratista)',
        formula: '5.5 UIT por cada sustitución',
        procedimiento: 'Una vez autorizada la sustitución del mismo integrante del plantel técnico por la entidad contratante',
      },
      {
        proyectoId: proyectoPG0005.id,
        numero: 2,
        supuesto: 'No cumplir con uso de materiales según estándares calidad expediente técnico',
        formula: '0.5% del monto valorización del mes en que ocurrió',
        procedimiento: 'Según informe supervisor · previo descargo contratista',
      },
      {
        proyectoId: proyectoPG0005.id,
        numero: 3,
        supuesto: 'No cumplir con entrega de EPPS y uniformes al personal obrero',
        formula: '0.5% del monto valorización del mes',
        procedimiento: 'Según informe supervisor · previo descargo',
      },
      {
        proyectoId: proyectoPG0005.id,
        numero: 4,
        supuesto: 'No cumplir medidas seguridad colectiva en obra',
        formula: '0.5% del monto valorización del mes',
        procedimiento: 'Según informe supervisor · previo descargo',
      },
      {
        proyectoId: proyectoPG0005.id,
        numero: 5,
        supuesto: 'Incumplimiento cronograma aprobado plan de trabajo',
        formula: '5% UIT por cada día de incumplimiento',
        procedimiento: 'Según informe supervisor',
      },
      {
        proyectoId: proyectoPG0005.id,
        numero: 6,
        supuesto: 'Incumplimiento plazo entrega levantamiento observaciones',
        formula: '5% UIT por cada día de incumplimiento',
        procedimiento: 'Según informe supervisor',
      },
      {
        proyectoId: proyectoPG0005.id,
        numero: 7,
        supuesto: 'Ausencia personal propuesto por contratista durante servicio horario laboral',
        formula: '5% UIT por ocurrencia',
        procedimiento: 'Según informe supervisor',
      },
      {
        proyectoId: proyectoPG0005.id,
        numero: 8,
        supuesto: 'Cuando el contratista no cuenta con dispositivos seguridad obra (peatonal/vehicular)',
        formula: '0.5% del monto valorización del mes',
        procedimiento: 'Según informe supervisor',
      },
      {
        proyectoId: proyectoPG0005.id,
        numero: 9,
        supuesto: 'No estar al día con anotaciones cuaderno de incidencias digital',
        formula: '0.5% del monto valorización del mes',
        procedimiento: 'Según informe supervisor',
      },
      {
        proyectoId: proyectoPG0005.id,
        numero: 10,
        supuesto: 'En caso de incumplimiento de los plazos regulador para las prestaciones adicionales',
        formula: '0.5% del monto valorización del mes',
        procedimiento: 'Según informe supervisor',
      },
    ])
    .onConflictDoNothing();

  console.log('✓ Penalidades catálogo · 10 supuestos contrato 037');

  // ═══════════════════════════════════════════════════════════
  // 8. PERÍODO CONTABLE inicial · diciembre 2025 (mes acta inicio aprox)
  // ═══════════════════════════════════════════════════════════
  await db
    .insert(periodosContables)
    .values({
      proyectoId: proyectoPG0005.id,
      anio: 2025,
      mes: 12,
      fechaInicio: '2025-12-01',
      fechaFin: '2025-12-31',
      estado: 'abierto',
    })
    .onConflictDoNothing();

  console.log('✓ Período contable diciembre 2025 · abierto');
}

// ═══════════════════════════════════════════════════════════
// 9. PARÁMETROS · CATEGORÍAS
// ═══════════════════════════════════════════════════════════
await db
  .insert(parametrosCategorias)
  .values([
    { id: 'tributario', descripcion: 'Tributación SUNAT · IGV · detracciones · retenciones', orden: 1 },
    { id: 'capeco', descripcion: 'Acuerdo CAPECO · jornales · BUC · leyes sociales', orden: 2 },
    { id: 'contractual', descripcion: 'Topes legales · factores · plazos contractuales', orden: 3 },
    { id: 'workflow', descripcion: 'Niveles aprobación por monto y tipo documento', orden: 4 },
    { id: 'kpi', descripcion: 'Umbrales alertas · indicadores gerenciales', orden: 5 },
    { id: 'sistema', descripcion: 'Configuración técnica del sistema', orden: 6 },
  ])
  .onConflictDoNothing();

console.log('✓ Parámetros categorías · 6 categorías');

// ═══════════════════════════════════════════════════════════
// 10. PARÁMETROS TRIBUTARIOS · SUNAT
// ═══════════════════════════════════════════════════════════
await db
  .insert(parametros)
  .values([
    {
      categoriaId: 'tributario',
      codigo: 'detraccion_construccion_pct',
      descripcion: 'Detracción contratos construcción · código SUNAT 012',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.04',
      vigenciaDesde: '2014-11-01',
      baseLegal: 'RS 183-2004/SUNAT modificada',
    },
    {
      categoriaId: 'tributario',
      codigo: 'detraccion_servicios_general_pct',
      descripcion: 'Detracción demás servicios gravados · código 037',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.12',
      vigenciaDesde: '2014-11-01',
      baseLegal: 'RS 183-2004/SUNAT',
    },
    {
      categoriaId: 'tributario',
      codigo: 'detraccion_cemento_pct',
      descripcion: 'Detracción cemento · código 020',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.015',
      vigenciaDesde: '2014-11-01',
      baseLegal: 'RS 183-2004/SUNAT',
    },
    {
      categoriaId: 'tributario',
      codigo: 'retencion_igv_pct',
      descripcion: 'Régimen retención IGV (3%) · operaciones > S/700',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.03',
      vigenciaDesde: '2002-06-01',
      baseLegal: 'RS 037-2002/SUNAT',
    },
    {
      categoriaId: 'tributario',
      codigo: 'igv_pct',
      descripcion: 'Tasa IGV vigente',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.18',
      vigenciaDesde: '2011-03-01',
      baseLegal: 'D.Leg 1116',
    },
    {
      categoriaId: 'tributario',
      codigo: 'renta_pct',
      descripcion: 'Tasa Impuesto Renta empresas',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.30',
      vigenciaDesde: '2017-01-01',
      baseLegal: 'Ley General Tributaria',
    },
    {
      categoriaId: 'tributario',
      codigo: 'bancarizacion_minimo',
      descripcion: 'Monto mínimo bancarización obligatoria',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '3500.00',
      vigenciaDesde: '2024-01-01',
      baseLegal: 'Ley 28194 modificada',
    },
    {
      categoriaId: 'tributario',
      codigo: 'uit_vigente',
      descripcion: 'Unidad Impositiva Tributaria vigente',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '5350.00',
      vigenciaDesde: '2026-01-01',
      baseLegal: 'DS 309-2025-EF',
    },
  ])
  .onConflictDoNothing();

console.log('✓ Parámetros tributarios · 8 parámetros SUNAT');

// ═══════════════════════════════════════════════════════════
// 11. PARÁMETROS CAPECO 2025-2026
// ═══════════════════════════════════════════════════════════
await db
  .insert(parametros)
  .values([
    {
      categoriaId: 'capeco',
      codigo: 'jornal_capataz',
      descripcion: 'Jornal diario Capataz · CAPECO',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '127.75',
      vigenciaDesde: '2025-06-01',
      baseLegal: 'Acta CAPECO 2025-2026',
    },
    {
      categoriaId: 'capeco',
      codigo: 'jornal_operario',
      descripcion: 'Jornal diario Operario · CAPECO',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '88.10',
      vigenciaDesde: '2025-06-01',
      baseLegal: 'Acta CAPECO 2025-2026',
    },
    {
      categoriaId: 'capeco',
      codigo: 'jornal_oficial',
      descripcion: 'Jornal diario Oficial · CAPECO',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '74.50',
      vigenciaDesde: '2025-06-01',
      baseLegal: 'Acta CAPECO 2025-2026',
    },
    {
      categoriaId: 'capeco',
      codigo: 'jornal_peon',
      descripcion: 'Jornal diario Peón · CAPECO',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '66.50',
      vigenciaDesde: '2025-06-01',
      baseLegal: 'Acta CAPECO 2025-2026',
    },
    {
      categoriaId: 'capeco',
      codigo: 'buc_operario_pct',
      descripcion: 'Bonificación Unificada Construcción Operario',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.32',
      vigenciaDesde: '2010-01-01',
      baseLegal: 'Convenio Construcción Civil',
    },
    {
      categoriaId: 'capeco',
      codigo: 'buc_oficial_pct',
      descripcion: 'BUC Oficial',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.30',
      vigenciaDesde: '2010-01-01',
      baseLegal: 'Convenio CC',
    },
    {
      categoriaId: 'capeco',
      codigo: 'buc_peon_pct',
      descripcion: 'BUC Peón',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.30',
      vigenciaDesde: '2010-01-01',
      baseLegal: 'Convenio CC',
    },
    {
      categoriaId: 'capeco',
      codigo: 'sctr_pension_pct',
      descripcion: 'SCTR Pensión',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.0125',
      vigenciaDesde: '2024-01-01',
      baseLegal: 'EsSalud',
    },
    {
      categoriaId: 'capeco',
      codigo: 'sctr_salud_pct',
      descripcion: 'SCTR Salud',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.0205',
      vigenciaDesde: '2024-01-01',
      baseLegal: 'EsSalud',
    },
    {
      categoriaId: 'capeco',
      codigo: 'conafoviser_pct',
      descripcion: 'CONAFOVISER',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.02',
      vigenciaDesde: '1999-01-01',
      baseLegal: 'Ley 27000',
    },
    {
      categoriaId: 'capeco',
      codigo: 'sencico_pct',
      descripcion: 'SENCICO',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.002',
      vigenciaDesde: '1989-01-01',
      baseLegal: 'D.Leg 147',
    },
  ])
  .onConflictDoNothing();

console.log('✓ Parámetros CAPECO · 11 parámetros laborales');

// ═══════════════════════════════════════════════════════════
// 12. PARÁMETROS CONTRACTUALES · Ley 32069
// ═══════════════════════════════════════════════════════════
await db
  .insert(parametros)
  .values([
    {
      categoriaId: 'contractual',
      codigo: 'tope_adicionales_pct',
      descripcion: 'Tope máximo adicionales acumulados vs contrato',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.50',
      vigenciaDesde: '2024-04-01',
      baseLegal: 'Art 109.2 RLGCP DS 009-2025-EF',
    },
    {
      categoriaId: 'contractual',
      codigo: 'tope_reducciones_pct',
      descripcion: 'Tope máximo reducciones acumuladas vs contrato',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.25',
      vigenciaDesde: '2024-04-01',
      baseLegal: 'Art 109.1 RLGCP',
    },
    {
      categoriaId: 'contractual',
      codigo: 'tope_penalidades_pct',
      descripcion: 'Tope máximo penalidades acumuladas',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.10',
      vigenciaDesde: '2024-04-01',
      baseLegal: 'Art 120 RLGCP',
    },
    {
      categoriaId: 'contractual',
      codigo: 'factor_f_plazo_corto',
      descripcion: 'Factor F penalidad mora · plazo ≤ 60 días',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.40',
      vigenciaDesde: '2024-04-01',
      baseLegal: 'Art 120 RLGCP',
    },
    {
      categoriaId: 'contractual',
      codigo: 'factor_f_plazo_medio',
      descripcion: 'Factor F penalidad mora · plazo 61-120 días',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.25',
      vigenciaDesde: '2024-04-01',
      baseLegal: 'Art 120 RLGCP',
    },
    {
      categoriaId: 'contractual',
      codigo: 'factor_f_plazo_largo',
      descripcion: 'Factor F penalidad mora · plazo > 120 días',
      tipoDato: 'decimal',
      scope: 'global',
      valorDecimal: '0.15',
      vigenciaDesde: '2024-04-01',
      baseLegal: 'Art 120 RLGCP',
    },
    {
      categoriaId: 'contractual',
      codigo: 'plazo_aprobacion_tacita_dias',
      descripcion: 'Plazo aprobación tácita modificación contractual (días)',
      tipoDato: 'integer',
      scope: 'global',
      valorInteger: 15,
      vigenciaDesde: '2024-04-01',
      baseLegal: 'Art 179.4 RLGCP',
    },
  ])
  .onConflictDoNothing();

console.log('✓ Parámetros contractuales · 7 parámetros Ley 32069');

// ═══════════════════════════════════════════════════════════
// 13. ÍNDICES UNIFICADOS · catálogo INEI base
// ═══════════════════════════════════════════════════════════
await db
  .insert(indicesUnificados)
  .values([
    // Catálogo IUs · CAPECO/INEI oficial · descripciones reales
    { codigo: '02', descripcion: 'ACERO DE CONSTRUCCION LISO', categoria: 'Materiales · Acero' },
    { codigo: '03', descripcion: 'ACERO DE CONSTRUCCION CORRUGADO', categoria: 'Materiales · Acero' },
    { codigo: '05', descripcion: 'AGREGADO GRUESO', categoria: 'Materiales · Agregados' },
    { codigo: '07', descripcion: 'ALAMBRE Y CABLE TIPO TW Y THW', categoria: 'Materiales · Eléctricos' },
    { codigo: '10', descripcion: 'APARATO SANITARIO CON GRIFERIA', categoria: 'Materiales · Sanitarios' },
    { codigo: '12', descripcion: 'ARTEFACTO DE ALUMBRADO INTERIOR', categoria: 'Materiales · Eléctricos' },
    { codigo: '17', descripcion: 'BLOQUE Y LADRILLO', categoria: 'Materiales · Albañilería' },
    { codigo: '21', descripcion: 'CEMENTO PORTLAND TIPO I', categoria: 'Materiales · Cemento' },
    { codigo: '24', descripcion: 'CERAMICA ESMALTADA Y SIN ESMALTAR', categoria: 'Materiales · Acabados' },
    { codigo: '30', descripcion: 'DOLAR MAS INFLACION DEL MERCADO USA', categoria: 'Importados' },
    { codigo: '32', descripcion: 'FLETE TERRESTRE', categoria: 'Logística' },
    { codigo: '39', descripcion: 'INDICE GENERAL DE PRECIOS AL CONSUMIDOR', categoria: 'General' },
    { codigo: '43', descripcion: 'MADERA NACIONAL PARA ENCOFRADO Y CARPINTERIA', categoria: 'Materiales · Madera' },
    { codigo: '44', descripcion: 'MADERA TERCIADA PARA CARPINTERIA', categoria: 'Materiales · Madera' },
    { codigo: '47', descripcion: 'MANO DE OBRA', categoria: 'Mano de obra · Construcción' },
    { codigo: '48', descripcion: 'MAQUINARIA Y EQUIPO NACIONAL', categoria: 'Equipos' },
    { codigo: '72', descripcion: 'TUBERIA DE PVC', categoria: 'Materiales · Sanitarios' },
    { codigo: '79', descripcion: 'VIDRIO INCOLORO NACIONAL', categoria: 'Materiales · Carpintería' },
  ])
  .onConflictDoNothing();

console.log('✓ Índices Unificados INEI · 18 códigos CAPECO/PG0005');

// ═══════════════════════════════════════════════════════════
// FIN
// ═══════════════════════════════════════════════════════════
console.log('\n✅ F0 Foundation seed complete');
console.log('   · 1 empresa · 1 cliente · 1 proyecto PG0005');
console.log('   · 2 consorciados · 1 garantía · 10 penalidades catálogo');
console.log('   · 26 parámetros (8 trib + 11 capeco + 7 contractual)');
console.log('   · 29 índices INEI');
console.log('   · 1 período contable diciembre 2025');
console.log('\nUsuario admin: admin@mmhighmetrik.com / admin');

process.exit(0);
