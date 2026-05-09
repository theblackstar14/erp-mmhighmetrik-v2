const API_BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
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
  montoContractual: string;
  fechaInicio: string | null;
  fechaFin: string | null;
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
  presupuesto: string;
  duracionDias: number | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  isSummary: boolean | null;
  isMilestone: boolean | null;
  isCritical: boolean | null;
  percentComplete: string | null;
  predecessors: string[] | null;
  orden: number | null;
};
