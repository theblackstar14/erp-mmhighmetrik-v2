import { z } from 'zod';

// ─── Auth ────────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ─── Proyecto ────────────────────────────────────────────────
export const proyectoCreateSchema = z.object({
  codigo: z.string().min(3).max(50),
  nombre: z.string().min(3).max(500),
  clienteId: z.string().uuid().optional(),
  ubicacion: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  tipo: z.string().optional(),
  modalidad: z.enum(['suma_alzada', 'precios_unitarios', 'mixto', 'llave_en_mano']).optional(),
  status: z
    .enum(['licitacion', 'adjudicado', 'ejecucion', 'liquidacion', 'cerrado', 'cancelado'])
    .optional(),
  costoDirecto: z.number().nonnegative().optional(),
  igvEnXml: z.boolean().optional(),
  pctGg: z.number().min(0).max(1).optional(),
  pctUtilidad: z.number().min(0).max(1).optional(),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pctAdelantoDirecto: z.number().min(0).max(1).optional(),
  pctAdelantoMateriales: z.number().min(0).max(1).optional(),
  pctFielCumplimiento: z.number().min(0).max(1).optional(),
  pctPenalidadDia: z.number().min(0).max(1).optional(),
  pctPenalidadTope: z.number().min(0).max(1).optional(),
});
export type ProyectoCreate = z.infer<typeof proyectoCreateSchema>;

// ─── Avance ──────────────────────────────────────────────────
export const avanceCreateSchema = z.object({
  partidaId: z.string().uuid(),
  avancePct: z.number().min(0).max(100),
  realCost: z.number().nonnegative(),
  nota: z.string().optional(),
});
export type AvanceCreate = z.infer<typeof avanceCreateSchema>;

// ─── Trabajador ──────────────────────────────────────────────
export const trabajadorCreateSchema = z.object({
  proyectoId: z.string().uuid(),
  dni: z.string().regex(/^\d{8}$/),
  nombres: z.string().min(2).max(100),
  apellidos: z.string().min(2).max(100),
  fechaNacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categoria: z.enum(['Capataz', 'Operario', 'Oficial', 'Peon']),
  especialidad: z.string().optional(),
  jornal: z.number().nonnegative(),
  fechaIngreso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  estado: z.enum(['Activo', 'Permiso', 'Vacaciones', 'Cesado']).default('Activo'),
  sctrVigencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  regimen: z.string().optional(),
  telefono: z.string().optional(),
});
export type TrabajadorCreate = z.infer<typeof trabajadorCreateSchema>;

// ─── Valorización ────────────────────────────────────────────
export const valorizacionCreateSchema = z.object({
  proyectoId: z.string().uuid(),
  fechaDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fechaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observaciones: z.string().optional(),
});
export type ValorizacionCreate = z.infer<typeof valorizacionCreateSchema>;

// ─── Constants ───────────────────────────────────────────────
export const JORNALES_CAPECO_2025 = {
  Capataz: 95,
  Operario: 89,
  Oficial: 71,
  Peon: 63,
} as const;

export const ESPECIALIDADES_CONSTRUCCION = [
  'Albañilería',
  'Fierrería',
  'Encofrado',
  'Carpintería',
  'Gasfitería',
  'Electricidad',
  'Soldadura',
  'Pintura',
  'Acabados',
  'General',
] as const;

export const CARPETAS_PROYECTO_ESTANDAR = [
  '00_Generales',
  '01_Contratos',
  '02_Planos',
  '03_Cronograma',
  '04_Presupuestos',
  '05_Valorizaciones',
  '06_Fotografias',
  '07_Personal',
  '08_Calidad',
  '09_SSOMA',
  '10_Actas',
  '11_RFI_RDI',
  '12_Adicionales',
] as const;
