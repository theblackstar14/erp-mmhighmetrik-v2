const API_BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    // 304 Not Modified · no body · re-fetch fresco
    if (res.status === 304) {
      return req<T>(`${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}`, init);
    }
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText, body);
  }
  return res.json();
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    req<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => req('/api/auth/logout', { method: 'POST' }),
  me: () => req<{ user: User | null }>('/api/auth/me'),

  // Proyectos
  proyectos: {
    list: () => req<{ proyectos: Proyecto[] }>('/api/proyectos'),
    get: (id: string) => req<{ proyecto: Proyecto }>(`/api/proyectos/${id}`),
    create: (data: Record<string, unknown>) =>
      req<{ proyecto: Proyecto }>('/api/proyectos', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      req<{ proyecto: Proyecto }>(`/api/proyectos/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => req(`/api/proyectos/${id}`, { method: 'DELETE' }),

    uploadCronograma: async (
      id: string,
      file: File,
    ): Promise<{ ok: boolean; stats: { totalTasks: number; partidasInsertadas: number; totalCost: number } }> => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/api/proyectos/${id}/cronograma`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error ?? res.statusText, body);
      }
      return res.json();
    },

    listPartidas: (id: string) => req<{ partidas: Partida[] }>(`/api/proyectos/${id}/partidas`),
    getAvances: (id: string) => req<AvancesResponse>(`/api/proyectos/${id}/avances`),
    getCurvaS: (id: string) => req<{ data: CurvaSData | null }>(`/api/proyectos/${id}/curva-s`),
    getRecursos: (id: string) => req<RecursosResponse>(`/api/proyectos/${id}/recursos`),
    getIusCatalogo: () => req<{ ius: IndiceUnificado[] }>(`/api/proyectos/_ius/catalogo`),
    createIu: (data: { codigo: string; descripcion: string; categoria?: string }) =>
      req<{ iu: IndiceUnificado }>(`/api/proyectos/_ius`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateRecurso: (proyectoId: string, recursoId: string, data: { iuCodigo?: string | null; categoria?: string | null }) =>
      req<{ recurso: Recurso }>(`/api/proyectos/${proyectoId}/recursos/${recursoId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    getValorizaciones: (id: string) => req<ValorizacionesResponse>(`/api/proyectos/${id}/valorizaciones`),
    uploadValorizacion: async (id: string, file: File): Promise<UploadValResponse> => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/api/proyectos/${id}/valorizaciones`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error ?? res.statusText, body);
      }
      return res.json();
    },
  },

  // Logística · catálogos globales
  logistica: {
    listRecursos: () =>
      req<{
        recursos: Recurso[];
        stats: {
          total: number;
          porTipo: Record<string, number>;
          iuClasificados: number;
          sinIu: number;
        };
      }>(`/api/logistica/recursos`),
    updateRecurso: (id: string, data: {
      iuCodigo?: string | null;
      categoria?: string | null;
      descripcion?: string;
      tipo?: Recurso['tipo'];
    }) =>
      req<{ recurso: Recurso }>(`/api/logistica/recursos/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    createRecurso: (data: {
      codigo: string;
      descripcion: string;
      unidad: string;
      tipo: Recurso['tipo'];
      categoria?: string;
      precioReferencial?: number;
      iuCodigo?: string;
    }) =>
      req<{ recurso: Recurso }>(`/api/logistica/recursos`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    listIus: () =>
      req<{
        ius: (IndiceUnificado & { recursosCount: number })[];
        stats: {
          total: number;
          enUso: number;
          sinUso: number;
          totalRecursosClasificados: number;
          totalRecursosSinClasificar: number;
        };
      }>(`/api/logistica/ius`),
    createIu: (data: { codigo: string; descripcion: string; categoria?: string }) =>
      req<{ iu: IndiceUnificado }>(`/api/logistica/ius`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateIu: (codigo: string, data: { descripcion?: string; categoria?: string; vigente?: boolean }) =>
      req<{ iu: IndiceUnificado }>(`/api/logistica/ius/${codigo}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    deleteIu: (codigo: string) =>
      req<{ ok: boolean }>(`/api/logistica/ius/${codigo}`, { method: 'DELETE' }),
    autoClasificarPreview: () =>
      req<{
        ok: boolean;
        sugerencias: Array<{
          recursoId: string;
          recursoCodigo: string;
          recursoDescripcion: string;
          recursoTipo: string;
          iuCodigo: string | null;
          confianza: number;
          razon: string;
        }>;
        total: number;
        sinMatch: number;
        altaConfianza: number;
        mediaConfianza: number;
        bajaConfianza: number;
      }>(`/api/logistica/recursos/auto-clasificar`, {
        method: 'POST',
        body: JSON.stringify({ dryRun: true }),
      }),
    aplicarSugerencias: (sugerencias: Array<{ recursoId: string; iuCodigo: string | null; confianza: number }>) =>
      req<{ ok: boolean; aplicados: number }>(
        `/api/logistica/recursos/aplicar-sugerencias`,
        {
          method: 'POST',
          body: JSON.stringify({ sugerencias }),
        },
      ),
    // F3 · Proveedores
    listProveedores: () =>
      req<{
        proveedores: Array<Proveedor & { ocCount: number; volumenAnual: number }>;
        stats: { total: number; conRating: number; categorias: string[] };
      }>(`/api/logistica/proveedores`),
    getProveedor: (id: string) =>
      req<{ proveedor: Proveedor; ocs: OrdenCompra[] }>(`/api/logistica/proveedores/${id}`),
    createProveedor: (data: Partial<Proveedor>) =>
      req<{ proveedor: Proveedor }>(`/api/logistica/proveedores`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateProveedor: (id: string, data: Partial<Proveedor>) =>
      req<{ proveedor: Proveedor }>(`/api/logistica/proveedores/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    deleteProveedor: (id: string) =>
      req<{ ok: boolean; soft: boolean }>(`/api/logistica/proveedores/${id}`, { method: 'DELETE' }),

    // F3 · Requerimientos
    listRequerimientos: (proyectoId?: string) =>
      req<{ requerimientos: Requerimiento[] }>(
        `/api/logistica/requerimientos${proyectoId ? `?proyectoId=${proyectoId}` : ''}`,
      ),
    getRequerimiento: (id: string) =>
      req<{ requerimiento: Requerimiento; lineas: RequerimientoLinea[] }>(
        `/api/logistica/requerimientos/${id}`,
      ),
    createRequerimiento: (data: Partial<Requerimiento> & { lineas?: Partial<RequerimientoLinea>[] }) =>
      req<{ requerimiento: Requerimiento }>(`/api/logistica/requerimientos`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateRequerimiento: (id: string, data: Partial<Requerimiento> & { rechazadoMotivo?: string }) =>
      req<{ requerimiento: Requerimiento }>(`/api/logistica/requerimientos/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    // F3 · Órdenes de Compra
    listOcs: (filters?: { proyectoId?: string; proveedorId?: string; estado?: string }) => {
      const qs = new URLSearchParams();
      if (filters?.proyectoId) qs.set('proyectoId', filters.proyectoId);
      if (filters?.proveedorId) qs.set('proveedorId', filters.proveedorId);
      if (filters?.estado) qs.set('estado', filters.estado);
      return req<{
        ordenes: Array<
          OrdenCompra & {
            proveedor: { id: string; razonSocial: string; ruc: string } | null;
            proyecto: { id: string; codigo: string; nombre: string } | null;
          }
        >;
        stats: {
          total: number;
          porEstado: Record<string, number>;
          montoTotal: number;
          montoEmitidas: number;
        };
      }>(`/api/logistica/ordenes-compra${qs.toString() ? `?${qs}` : ''}`);
    },
    getOc: (id: string) =>
      req<{
        oc: OrdenCompra;
        lineas: OcLinea[];
        aprobaciones: OcAprobacion[];
        proveedor: Proveedor | null;
        proyecto: Proyecto | null;
      }>(`/api/logistica/ordenes-compra/${id}`),
    createOc: (data: Partial<OrdenCompra> & { lineas: Array<Partial<OcLinea>> }) =>
      req<{ oc: OrdenCompra }>(`/api/logistica/ordenes-compra`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    aprobarOc: (id: string, data: { userId?: string; userNombre?: string; comentario?: string }) =>
      req<{ oc: OrdenCompra }>(`/api/logistica/ordenes-compra/${id}/aprobar`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    emitirOc: (id: string, data: { userId?: string; userNombre?: string }) =>
      req<{ oc: OrdenCompra }>(`/api/logistica/ordenes-compra/${id}/emitir`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    cambiarEstadoOc: (
      id: string,
      data: { estado: string; comentario?: string; userId?: string; userNombre?: string },
    ) =>
      req<{ oc: OrdenCompra }>(`/api/logistica/ordenes-compra/${id}/cambiar-estado`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  // Avances
  partidas: {
    createAvance: (partidaId: string, data: { avancePct: number; realCost: number; nota?: string }) =>
      req<{ avance: AvanceEntry }>(`/api/partidas/${partidaId}/avances`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    listAvances: (partidaId: string) =>
      req<{ avances: AvanceEntry[] }>(`/api/partidas/${partidaId}/avances`),
  },

  // IA
  ia: {
    parseContract: async (file: File): Promise<{ ok: boolean; data: ParsedContract }> => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/api/ia/parse-contract`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error ?? res.statusText, body);
      }
      return res.json();
    },
  },
};

export type ParsedContract = {
  proyecto?: {
    nombre?: string | null;
    ubicacion?: string | null;
    codigoCui?: string | null;
    etapa?: string | null;
  };
  contrato?: {
    numeroContrato?: string | null;
    numeroProcesoLicitacion?: string | null;
    tipoModalidad?: string | null;
    marcoLegal?: string | null;
    montoContractual?: number | null;
    moneda?: string | null;
    diasPlazo?: number | null;
    fechaBuenaPro?: string | null;
    fechaConsentimiento?: string | null;
    fechaFirmaContrato?: string | null;
    fechaInicio?: string | null;
    fechaFin?: string | null;
  };
  entidadContratante?: {
    razonSocial?: string | null;
    ruc?: string | null;
    tipoEntidad?: string | null;
    domicilio?: string | null;
    representante?: string | null;
    dniRepresentante?: string | null;
    cargoRepresentante?: string | null;
  };
  contratista?: {
    esConsorcio?: boolean;
    nombreConsorcio?: string | null;
    razonSocial?: string | null;
    ruc?: string | null;
    domicilio?: string | null;
    representanteComun?: string | null;
    dniRepresentante?: string | null;
    email?: string | null;
  };
  consorcioIntegrantes?: Array<{
    razonSocial: string;
    ruc: string;
    pctParticipacion?: number | null;
  }>;
  adelantos?: {
    directoPct?: number | null;
    materialesPct?: number | null;
    avancePct?: number | null;
  };
  garantias?: {
    fielCumplimientoPct?: number | null;
    retencionPct?: number | null;
  };
  penalidades?: {
    formulaMora?: string | null;
    factorF?: number | null;
    topePct?: number | null;
  };
};

export type User = {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  role: 'admin' | 'gerente' | 'residente' | 'contadora' | 'almacen';
};

export type Proyecto = {
  id: string;
  codigo: string;
  nombre: string;
  ubicacion: string | null;
  status: string;
  modalidad: string;
  costoDirecto: string;
  montoReferencial: string | null;
  montoContractual: string;
  factorOferta: string | null;
  montoVigente: string | null;
  presupuestoMeta: string | null;
  pctGg: string | null;
  pctUtilidad: string | null;
  pctIgv: string | null;
  costoDirectoSinIgv: string | null;
  montoSubtotal: string | null;
  montoIgv: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  fechaBuenaPro: string | null;
  fechaConsentimiento: string | null;
  fechaFirmaContrato: string | null;
  fechaActaInicio: string | null;
  diasPlazo: number | null;
  numeroContrato: string | null;
  numeroProcesoLicitacion: string | null;
  cui: string | null;
  etapa: string | null;
  marcoLegal: string | null;
  pctAdelantoDirecto: string | null;
  pctAdelantoMateriales: string | null;
  pctAdelantoAvance: string | null;
  pctRetencion: string | null;
  pctFielCumplimiento: string | null;
  factorFPenalidad: string | null;
  pctPenalidadTope: string | null;
  risk: string;
  ganttFile: string | null;
  createdAt: string;
};

export type AvanceEntry = {
  id: string;
  partidaId: string;
  fecha: string;
  avancePct: string;
  realCost: string;
  nota: string | null;
  userId: string | null;
  createdAt: string;
};

export type AvanceState = {
  avancePct: number;
  realCost: number;
  budget: number;
  source: 'direct' | 'rollup' | 'none';
  fecha?: string;
  nota?: string | null;
};

export type CurvaSBucket = {
  key: string;
  idx: number;
  year: number;
  month: number;
  start: string;
  finish: string;
};

export type CurvaSData = {
  buckets: CurvaSBucket[];
  plan: number[];
  planAcum: number[];
  real: number[];
  realAcum: number[];
  earned: number[];
  earnedAcum: number[];
  hoyIdx: number;
  fuente: 'avances' | 'valorizaciones' | 'mixed' | 'plan-only';
  evm: {
    BAC: number;
    PV: number;
    AC: number;
    EV: number;
    SPI: number;
    CPI: number;
    SV: number;
    CV: number;
    EAC: number;
    pctCompletado: number;
  };
};

// F3 · Compras
export type Proveedor = {
  id: string;
  ruc: string;
  razonSocial: string;
  nombreComercial: string | null;
  categoria: string | null;
  domicilio: string | null;
  distrito: string | null;
  departamento: string | null;
  email: string | null;
  telefono: string | null;
  contacto: string | null;
  contactoCargo: string | null;
  estadoSunat: string | null;
  condicionSunat: string | null;
  tipoContribuyente: string | null;
  rating: string | null;
  leadTimeDias: number | null;
  cuentaBancaria: string | null;
  cuentaCci: string | null;
  cuentaDetraccionesBn: string | null;
  notas: string | null;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Requerimiento = {
  id: string;
  numero: string;
  correlativo: number;
  proyectoId: string;
  solicitanteId: string | null;
  solicitanteNombre: string | null;
  fecha: string;
  fechaNecesaria: string | null;
  urgencia: 'baja' | 'media' | 'alta' | 'urgente';
  descripcion: string;
  justificacion: string | null;
  estado:
    | 'borrador'
    | 'pendiente_aprobacion'
    | 'aprobado'
    | 'cotizando'
    | 'oc_emitida'
    | 'rechazado';
  aprobadoPorId: string | null;
  aprobadoEn: string | null;
  rechazadoMotivo: string | null;
  montoEstimado: string | null;
  notas: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RequerimientoLinea = {
  id: string;
  requerimientoId: string;
  numero: number;
  recursoId: string | null;
  descripcion: string;
  unidad: string;
  cantidad: string;
  precioReferencial: string | null;
  notas: string | null;
};

export type OrdenCompra = {
  id: string;
  numero: string;
  correlativo: number;
  anio: number;
  proyectoId: string;
  proveedorId: string;
  requerimientoId: string | null;
  fechaEmision: string;
  fechaEntrega: string | null;
  lugarEntrega: string | null;
  moneda: 'PEN' | 'USD';
  tipoCambio: string | null;
  concepto: 'BIEN' | 'SERVICIO';
  medioPago: string | null;
  formaPago: string | null;
  cotizacion: string | null;
  pctIgv: string;
  incluyeIgv: boolean;
  subtotalSinIgv: string;
  igv: string;
  total: string;
  aplicaDetraccion: boolean;
  pctDetraccion: string | null;
  montoDetraccion: string;
  montoNetoPagar: string | null;
  estado:
    | 'borrador'
    | 'pendiente_aprobacion'
    | 'aprobada'
    | 'emitida'
    | 'en_transito'
    | 'entregada'
    | 'anulada'
    | 'rechazada';
  creadoPorId: string | null;
  creadoPorEmail: string | null;
  gestorEmail: string | null;
  gestorNombre: string | null;
  aprobadoPorId: string | null;
  aprobadoEn: string | null;
  emitidaEn: string | null;
  entregadaEn: string | null;
  canceladaMotivo: string | null;
  terminos: string | null;
  pdfNasPath: string | null;
  notas: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OcLinea = {
  id: string;
  ordenCompraId: string;
  numero: number;
  partidaId: string | null;
  recursoId: string | null;
  descripcion: string;
  unidad: string;
  cantidad: string;
  precioUnitario: string;
  subtotal: string;
  notas: string | null;
};

export type OcAprobacion = {
  id: string;
  ordenCompraId: string;
  estadoFrom: string | null;
  estadoTo: string;
  userId: string | null;
  userNombre: string | null;
  comentario: string | null;
  createdAt: string;
};

export type IndiceUnificado = {
  codigo: string;
  descripcion: string;
  categoria: string | null;
  unidadMedida: string | null;
  vigente: boolean | null;
  baseLegal: string | null;
};

export type Recurso = {
  id: string;
  codigo: string;
  descripcion: string;
  unidad: string;
  tipo: 'material' | 'mano_obra' | 'equipo' | 'herramienta' | 'subcontrato';
  categoria: string | null;
  precioReferencial: string | null;
  iuCodigo: string | null;
  iuClasificacionOrigen: string | null;
  iuConfianza: string | null;
  activo: boolean;
};

export type CronogramaAdq = {
  id: string;
  proyectoId: string;
  recursoId: string | null;
  mesIndex: number;
  mesEtiqueta: string;
  fechaDesde: string;
  fechaHasta: string;
  cantidad: string;
  monto: string;
};

export type Valorizacion = {
  id: string;
  proyectoId: string;
  numero: number;
  fechaDesde: string;
  fechaHasta: string;
  fechaEmision: string;
  montoCd: string;
  montoIgv: string;
  montoTotal: string;
  pctAvance: string;
  factorReajusteK: string | null;
  montoReajuste: string | null;
  // Reajuste detail
  vProgramado: string | null;
  reajusteReal: string | null;
  reajusteProgramado: string | null;
  reajusteReconocido: string | null;
  reajustePagado: string | null;
  vrConReajuste: string | null;
  reajusteAcumAnterior: string | null;
  reajusteAcumActual: string | null;
  reajustePresente: string | null;
  condicion: string | null;
  mesPeriodo: string | null;
  // Cabecera RES.VALO
  montoDeducciones: string | null;
  montoValorizacionBruta: string | null;
  montoAmortizaciones: string | null;
  montoValorizacionNeta: string | null;
  multa: string | null;
  montoTotalConIgv: string | null;
  montoRetencion: string | null;
  totalContratista: string | null;
  archivoXlsx: string | null;
  snapshot: Record<string, unknown> | null;
  status: 'borrador' | 'emitida' | 'aprobada' | 'cobrada' | 'rechazada';
  observaciones: string | null;
  createdAt: string;
};

export type UploadValResponse = {
  ok: boolean;
  valorizacion: Valorizacion;
  partidasInsertadas: number;
  partidasSinMatch: number;
  warnings: string[];
};

export type ValorizacionReajuste = {
  id: string;
  valorizacionId: string;
  formulaId: string;
  subpresupuestoCodigo: string;
  anioMesIndice: string;
  kCalculado: string;
  montoSubpresupuesto: string;
  montoReajuste: string;
  detalleK: Array<{
    monomio: number;
    simbolo: string;
    coef: number;
    ir: number;
    io: number;
    relacion: number;
  }>;
  createdAt: string;
};

export type ValorizacionesResponse = {
  valorizaciones: Valorizacion[];
  reajustes: ValorizacionReajuste[];
  partidasResumen: number;
  stats: {
    cantidad: number;
    sumCd: number;
    sumIgv: number;
    sumReajuste: number;
    sumTotal: number;
    pctAvanceUltima: number;
    kPromedio: number;
    porSubpresupuesto: Record<string, { monto: number; reajuste: number }>;
  } | null;
};

export type RecursosResponse = {
  recursos: Recurso[];
  cronograma: CronogramaAdq[];
  stats: {
    total: number;
    porTipo: Record<string, number>;
    montosPorTipo: Record<string, number>;
    montoPorMes: number[];
    montoTotal: number;
    iuClasificados: number;
  } | null;
};

export type AvancesResponse = {
  partidas: { id: string; codigo: string; presupuesto: string }[];
  avances: Record<string, AvanceState>;
  kpis: {
    totalCD: number;
    totalReal: number;
    earnedValue: number;
    avanceFisicoPct: number;
    avanceFinancieroPct: number;
  } | null;
};

export type Partida = {
  id: string;
  proyectoId: string;
  codigo: string;
  parentCodigo: string | null;
  nivel: number;
  nombre: string;
  unidad: string | null;
  cantidad: string | null;
  precioUnitario: string | null;
  precioUnitarioReferencial: string | null;
  precioUnitarioContractual: string | null;
  costoMetaUnitario: string | null;
  presupuesto: string;
  presupuestoContractual: string;
  duracionDias: number | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  isSummary: boolean | null;
  isMilestone: boolean | null;
  isCritical: boolean | null;
  percentComplete: string | null;
  predecessors: string[] | null;
  orden: number | null;
  valorizado?: {
    metradoAcumulado: string;
    montoAcumulado: string;
    pctAvanceReal: string;
    ultimaValNumero: number | null;
  } | null;
};
