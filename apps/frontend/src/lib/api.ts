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
