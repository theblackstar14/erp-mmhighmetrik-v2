const API_BASE = import.meta.env.VITE_API_URL ?? '';

// Empresa activa (multi-empresa) · se manda como header x-empresa-id en cada request.
// Persistida en localStorage; el backend valida que el usuario sea miembro.
const EMPRESA_KEY = 'erp.empresaActiva';
export function getActiveEmpresa(): number | null {
  const v = localStorage.getItem(EMPRESA_KEY);
  return v ? Number(v) : null;
}
export function setActiveEmpresa(id: number | null) {
  if (id == null) localStorage.removeItem(EMPRESA_KEY);
  else localStorage.setItem(EMPRESA_KEY, String(id));
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const empresaId = getActiveEmpresa();
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(empresaId ? { 'x-empresa-id': String(empresaId) } : {}),
      ...(init?.headers ?? {}),
    },
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
  me: () => req<MeResponse>('/api/auth/me'),
  cambiarPassword: (actual: string, nueva: string) =>
    req<{ ok: true }>('/api/auth/cambiar-password', { method: 'POST', body: JSON.stringify({ actual, nueva }) }),
  updatePerfil: (data: { nombres?: string; apellidos?: string; telefono?: string | null }) =>
    req<{ ok: true }>('/api/auth/perfil', { method: 'PATCH', body: JSON.stringify(data) }),

  // Admin · usuarios / roles / empresas (gated por permiso 'usuarios' en backend)
  admin: {
    usuarios: {
      list: (todos?: boolean) => req<{ usuarios: AdminUser[] }>(`/api/usuarios${todos ? '?todos=1' : ''}`),
      create: (data: AdminUserInput) =>
        req<{ ok: true; userId: string; tempPassword?: string }>('/api/usuarios', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: Partial<AdminUserInput> & { activo?: boolean }) =>
        req<{ ok: true }>(`/api/usuarios/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      resetPassword: (id: string) =>
        req<{ ok: true; tempPassword: string }>(`/api/usuarios/${id}/reset-password`, { method: 'POST' }),
    },
    roles: {
      list: () => req<{ roles: AdminRole[] }>('/api/admin/roles'),
      create: (data: { nombre: string; descripcion?: string; permisos: Record<string, Nivel> }) =>
        req<{ ok: true; id: string }>('/api/admin/roles', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: { nombre?: string; descripcion?: string; permisos?: Record<string, Nivel> }) =>
        req<{ ok: true }>(`/api/admin/roles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      delete: (id: string) => req<{ ok: true }>(`/api/admin/roles/${id}`, { method: 'DELETE' }),
    },
    modulos: () => req<{ modulos: string[]; niveles: Nivel[] }>('/api/admin/modulos'),
    audit: (f?: { action?: string; entityType?: string; from?: string; to?: string; limit?: number }) => {
      const qs = new URLSearchParams(
        Object.entries(f ?? {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]),
      );
      return req<{ eventos: AuditEvento[]; acciones: string[]; entidades: string[] }>(`/api/admin/audit${qs.toString() ? `?${qs}` : ''}`);
    },
    empresas: {
      list: () => req<{ empresas: EmpresaRow[] }>('/api/admin/empresas'),
      create: (data: Partial<EmpresaRow>) => req<{ ok: true; empresa: EmpresaRow }>('/api/admin/empresas', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: number, data: Partial<EmpresaRow>) => req<{ ok: true; empresa: EmpresaRow }>(`/api/admin/empresas/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    },
  },

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

    previewXlsx: async (file: File): Promise<CvPreviewResponse> => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/api/proyectos/preview-xlsx`, {
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
    rebuildRollup: (id: string) =>
      req<{ ok: boolean; updates: number }>(`/api/proyectos/${id}/rebuild-rollup`, {
        method: 'POST',
      }),
    importXlsx: async (
      file: File,
      meta: {
        codigo: string;
        nombre?: string;
        tipoEntidad?: string;
        inversionId?: string;
        codigoIe?: string;
      },
    ): Promise<{ ok: boolean; proyectoId: string; ggUtModo: GgUtModo; inversionId: string | null; stats: { partidas: number; hojas: number; titulos: number; meses: number; valorReferencial: number | null } }> => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('codigo', meta.codigo);
      if (meta.nombre) fd.append('nombre', meta.nombre);
      if (meta.tipoEntidad) fd.append('tipoEntidad', meta.tipoEntidad);
      if (meta.inversionId) fd.append('inversionId', meta.inversionId);
      if (meta.codigoIe) fd.append('codigoIe', meta.codigoIe);
      const res = await fetch(`${API_BASE}/api/proyectos/import-xlsx`, {
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

    uploadContrato: async (id: string, file: File): Promise<{ ok: boolean }> => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/api/proyectos/${id}/contrato`, { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error ?? res.statusText, body);
      }
      return res.json();
    },

    listPartidas: (id: string) => req<{ partidas: Partida[] }>(`/api/proyectos/${id}/partidas`),
    getAvances: (id: string) => req<AvancesResponse>(`/api/proyectos/${id}/avances`),
    getCurvaS: (id: string) => req<{ data: CurvaSData | null }>(`/api/proyectos/${id}/curva-s`),
    getValorizaciones: (id: string) => req<ValorizacionesResponse>(`/api/proyectos/${id}/valorizaciones`),
    getReconciliacion: (id: string) =>
      req<ReconciliacionResponse>(`/api/proyectos/${id}/reconciliacion`),
    getPnl: (id: string) => req<PnlResponse>(`/api/proyectos/${id}/pnl`),
    getDashboard: () => req<DashboardResponse>(`/api/proyectos/_dashboard`),
    getDashboardSalud: () => req<DashboardSaludResponse>(`/api/proyectos/_dashboard/salud`),
    asignarResponsable: (id: string, responsableUserId: string | null) =>
      req<{ proyecto: { id: string; responsableUserId: string | null } }>(`/api/proyectos/${id}/responsable`, { method: 'PATCH', body: JSON.stringify({ responsableUserId }) }),
    getEquipo: (id: string) => req<{ equipo: EquipoMiembro[] }>(`/api/proyectos/${id}/equipo`),
    addEquipo: (id: string, profesionalId: string, rol: string) => req<{ ok: boolean }>(`/api/proyectos/${id}/equipo`, { method: 'POST', body: JSON.stringify({ profesionalId, rol }) }),
    removeEquipo: (id: string, profesionalId: string) => req<{ ok: boolean }>(`/api/proyectos/${id}/equipo/${profesionalId}`, { method: 'DELETE' }),
    getCashflow: (id: string) => req<CashflowResponse>(`/api/proyectos/${id}/cashflow`),
    getPartidasCostos: (id: string) =>
      req<{ costos: Record<string, { ejecutado: number; comprometido: number }> }>(`/api/proyectos/${id}/partidas-costos`),
    setValorizacionEstado: (proyectoId: string, valId: string, estado: string, opts?: { cuentaId?: string; fechaCobro?: string; cuentaContable?: string; comprobante?: { tipo?: string; serie?: string; numero?: string; fecha?: string; fechaVenc?: string; detraccion?: number } }) =>
      req<{ ok: boolean; valorizacion: Valorizacion }>(`/api/proyectos/${proyectoId}/valorizaciones/${valId}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ estado, ...opts }),
      }),
    setParticipacion: (id: string, pct: number) =>
      req<{ ok: boolean; pctParticipacionPropia: string }>(`/api/proyectos/${id}/participacion`, {
        method: 'PATCH',
        body: JSON.stringify({ pct }),
      }),
    getCierre: (id: string) => req<CierreObra>(`/api/proyectos/${id}/cierre`),
    cerrarObra: (id: string) =>
      req<{ ok: boolean; status: string }>(`/api/proyectos/${id}/cerrar`, { method: 'POST' }),
    getCostosObra: (id: string) => req<CostosObra>(`/api/proyectos/${id}/costos-obra`),
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

  // Finanzas · gastos reales (Fact de Compras) + cuentas bancarias
  finanzas: {
    listGastos: (proyectoId: string, filtros?: { desde?: string; hasta?: string; tipo?: string }) => {
      const qs = new URLSearchParams();
      if (filtros?.desde) qs.set('desde', filtros.desde);
      if (filtros?.hasta) qs.set('hasta', filtros.hasta);
      if (filtros?.tipo) qs.set('tipo', filtros.tipo);
      return req<{ gastos: Gasto[]; stats: GastoStats }>(`/api/proyectos/${proyectoId}/gastos${qs.toString() ? `?${qs}` : ''}`);
    },
    createGasto: (proyectoId: string, data: GastoInput) =>
      req<{ gasto: Gasto }>(`/api/proyectos/${proyectoId}/gastos`, { method: 'POST', body: JSON.stringify(data) }),
    updateGasto: (id: string, data: Partial<GastoInput>) =>
      req<{ gasto: Gasto }>(`/api/gastos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteGasto: (id: string) => req<{ ok: boolean }>(`/api/gastos/${id}`, { method: 'DELETE' }),
    listCuentas: () => req<{ cuentas: CuentaBancaria[] }>('/api/cuentas-bancarias'),
    createCuenta: (data: { codigo: string; banco?: string; moneda?: string; descripcion?: string }) =>
      req<{ cuenta: CuentaBancaria }>('/api/cuentas-bancarias', { method: 'POST', body: JSON.stringify(data) }),
    updateCuenta: (id: string, data: { cuentaContable?: string | null; banco?: string | null; descripcion?: string | null }) =>
      req<{ cuenta: CuentaBancaria }>(`/api/cuentas-bancarias/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    // FIN-2 · Flujo de cuentas
    listMovimientos: (proyectoId: string) =>
      req<{ movimientos: Movimiento[]; stats: { count: number; ingresos: number; egresos: number; neto: number } }>(`/api/proyectos/${proyectoId}/movimientos`),
    createMovimiento: (proyectoId: string, data: MovimientoInput) =>
      req<{ movimiento: Movimiento }>(`/api/proyectos/${proyectoId}/movimientos`, { method: 'POST', body: JSON.stringify(data) }),
    deleteMovimiento: (id: string) => req<{ ok: boolean }>(`/api/movimientos/${id}`, { method: 'DELETE' }), // H1.3 · solo admin (hard-delete)
    anularMovimiento: (id: string, motivo: string) => req<{ movimiento: Movimiento }>(`/api/movimientos/${id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) }),
    saldos: () => req<{ saldos: SaldoCuenta[]; totalSaldo: number }>('/api/tesoreria/saldos'),
    // Vistas GLOBALES (sidebar · proyecto = filtro · 'todos' = sin filtro)
    listGastosGlobal: (proyectoId?: string, tipo?: string) => {
      const qs = new URLSearchParams();
      if (proyectoId && proyectoId !== 'todos') qs.set('proyectoId', proyectoId);
      if (tipo) qs.set('tipo', tipo);
      return req<{ gastos: Gasto[]; stats: GastoStats }>(`/api/gastos${qs.toString() ? `?${qs}` : ''}`);
    },
    listMovimientosGlobal: (proyectoId?: string) => {
      const qs = new URLSearchParams();
      if (proyectoId && proyectoId !== 'todos') qs.set('proyectoId', proyectoId);
      return req<{ movimientos: Movimiento[]; stats: { count: number; ingresos: number; egresos: number; neto: number } }>(`/api/movimientos${qs.toString() ? `?${qs}` : ''}`);
    },
    createGastoGlobal: (data: GastoInput & { proyectoId?: string | null }) =>
      req<{ gasto: Gasto }>('/api/gastos', { method: 'POST', body: JSON.stringify(data) }),
    createMovimientoGlobal: (data: MovimientoInput & { proyectoId?: string | null }) =>
      req<{ movimiento: Movimiento }>('/api/movimientos', { method: 'POST', body: JSON.stringify(data) }),
    getResumen: (proyectoId?: string) => {
      const qs = proyectoId && proyectoId !== 'todos' ? `?proyectoId=${proyectoId}` : '';
      return req<FinanzasResumen>(`/api/finanzas/resumen${qs}`);
    },
    getFlujo: (proyectoId?: string) => {
      const qs = proyectoId && proyectoId !== 'todos' ? `?proyectoId=${proyectoId}` : '';
      return req<FinanzasFlujo>(`/api/finanzas/flujo${qs}`);
    },
    getCashflowDetalle: (proyectoId = 'todos') =>
      req<{ meses: CashflowMes[] }>(`/api/finanzas/cashflow-detalle?proyectoId=${proyectoId}`),
    getCashflowEntries: (proyectoId: string, periodo: string, tab: 'ingresos' | 'egresos') =>
      req<{ entries: CashflowEntry[] }>(`/api/finanzas/cashflow-detalle?proyectoId=${proyectoId}&periodo=${encodeURIComponent(periodo)}&tab=${tab}`),
    setPresupuestoOficina: (mes: string, monto: number) =>
      req<{ presupuesto: { mes: string; monto: string } }>('/api/finanzas/presupuesto-oficina', { method: 'PUT', body: JSON.stringify({ mes, monto }) }),
    // FIN-3 · Inventario
    listInventario: (proyectoId: string) =>
      req<{ items: InventarioItem[]; stats: { count: number; valorTotal: number; porCategoria: Record<string, number>; porEstado: Record<string, number> } }>(`/api/proyectos/${proyectoId}/inventario`),
    createInventario: (proyectoId: string, data: InventarioInput) =>
      req<{ item: InventarioItem }>(`/api/proyectos/${proyectoId}/inventario`, { method: 'POST', body: JSON.stringify(data) }),
    setInventarioEstado: (id: string, estado: string) =>
      req<{ item: InventarioItem }>(`/api/inventario/${id}`, { method: 'PATCH', body: JSON.stringify({ estado }) }),
    deleteInventario: (id: string) => req<{ ok: boolean }>(`/api/inventario/${id}`, { method: 'DELETE' }),
    // FX-4 · factura↔ítems
    inventarioDetalle: (id: string) =>
      req<{ item: InventarioItem; gasto: Gasto | null; itemsFactura: InventarioItem[]; valuacion: Valuacion | null; historial: InventarioItem[] }>(`/api/inventario/${id}/detalle`),
    gastoItems: (id: string) =>
      req<{ gasto: Gasto; items: InventarioItem[]; valuacion: Valuacion }>(`/api/gastos/${id}/items`),
  },

  // Planilla · construcción civil (FIN-4)
  planilla: {
    listEmpleados: (tipo?: string, proyecto?: string) => {
      const qs = new URLSearchParams();
      if (tipo) qs.set('tipo', tipo);
      if (proyecto) qs.set('proyecto', proyecto);
      return req<{ empleados: Empleado[] }>(`/api/empleados${qs.toString() ? `?${qs}` : ''}`);
    },
    createEmpleado: (data: EmpleadoInput) => req<{ empleado: Empleado }>('/api/empleados', { method: 'POST', body: JSON.stringify(data) }),
    updateEmpleado: (id: string, data: Partial<EmpleadoInput>) => req<{ empleado: Empleado }>(`/api/empleados/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteEmpleado: (id: string) => req<{ ok: boolean }>(`/api/empleados/${id}`, { method: 'DELETE' }),
    getDashboard: () => req<PlanillaDashboard>('/api/planilla-dashboard'),
    listParams: () => req<{ params: ParamPlanilla[] }>('/api/param-planilla'),
    updateParam: (categoria: string, data: Record<string, number>) => req<{ param: ParamPlanilla }>(`/api/param-planilla/${encodeURIComponent(categoria)}`, { method: 'PUT', body: JSON.stringify(data) }),
    listAfp: () => req<{ tasas: AfpTasa[] }>('/api/afp-tasas'),
    updateAfp: (afp: string, data: Record<string, number>) => req<{ tasa: AfpTasa }>(`/api/afp-tasas/${encodeURIComponent(afp)}`, { method: 'PUT', body: JSON.stringify(data) }),
    getConfig: () => req<{ config: ConfigPlanilla }>('/api/config-planilla'),
    updateConfig: (data: Record<string, number>) => req<{ config: ConfigPlanilla }>('/api/config-planilla', { method: 'PUT', body: JSON.stringify(data) }),
    getAsistencia: (semanaId: string) => req<{ asistencia: Asistencia[] }>(`/api/planilla-semanas/${semanaId}/asistencia`),
    setAsistencia: (semanaId: string, data: { empleadoId: string; fecha: string; tipo: string; proyectoId?: string | null }) => req<{ ok: boolean }>(`/api/planilla-semanas/${semanaId}/asistencia`, { method: 'POST', body: JSON.stringify(data) }),
    listSemanas: (proyectoId: string) => req<{ semanas: PlanillaSemana[] }>(`/api/proyectos/${proyectoId}/planilla-semanas`),
    createSemana: (proyectoId: string, data: { fechaInicio: string; fechaFin: string; mes?: string }) => req<{ semana: PlanillaSemana }>(`/api/proyectos/${proyectoId}/planilla-semanas`, { method: 'POST', body: JSON.stringify(data) }),
    deleteSemana: (id: string) => req<{ ok: boolean }>(`/api/planilla-semanas/${id}`, { method: 'DELETE' }),
    getSemana: (id: string) => req<{ semana: PlanillaSemana; detalle: PlanillaDetalle[]; totales: PlanillaTotales }>(`/api/planilla-semanas/${id}`),
    calcular: (semanaId: string, lineas: PlanillaLinea[]) => req<{ ok: boolean; calculados: number }>(`/api/planilla-semanas/${semanaId}/calcular`, { method: 'POST', body: JSON.stringify({ lineas }) }),
  },

  // Oficina · rendiciones / viáticos (FIN-5)
  oficina: {
    listRendiciones: (scope: 'mias' | 'aprobar' | 'todas' = 'todas') => req<{ rendiciones: Rendicion[] }>(`/api/oficina/rendiciones?scope=${scope}`),
    getSaldosRendir: () => req<SaldosRendirResponse>('/api/oficina/saldos-rendir'),
    getRendicion: (id: string) => req<{ rendicion: Rendicion; items: RendicionItem[] }>(`/api/oficina/rendiciones/${id}`),
    crearRendicion: (data: RendicionInput) => req<{ rendicion: Rendicion }>('/api/oficina/rendiciones', { method: 'POST', body: JSON.stringify(data) }),
    updateRendicion: (id: string, data: Partial<RendicionInput>) => req<{ rendicion: Rendicion }>(`/api/oficina/rendiciones/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteRendicion: (id: string) => req<{ ok: boolean }>(`/api/oficina/rendiciones/${id}`, { method: 'DELETE' }),
    addItem: (id: string, data: RendicionItemInput) => req<{ ok: boolean }>(`/api/oficina/rendiciones/${id}/items`, { method: 'POST', body: JSON.stringify(data) }),
    deleteItem: (itemId: string) => req<{ ok: boolean }>(`/api/oficina/rendicion-items/${itemId}`, { method: 'DELETE' }),
    accion: (id: string, accion: 'enviar' | 'aprobar' | 'rechazar' | 'rendir' | 'cerrar', body?: Record<string, unknown>) => req<{ rendicion: Rendicion }>(`/api/oficina/rendiciones/${id}/${accion}`, { method: 'POST', body: JSON.stringify(body ?? {}) }),

    // Planilla de oficina (empleados administrativos)
    getPlanillaOficina: (mes: string) => req<{ mes: PlanillaOficinaMes | null; detalle: PlanillaOficinaDetalle[] }>(`/api/oficina/planilla?mes=${encodeURIComponent(mes)}`),
    crearPlanillaOficina: (mes: string) => req<{ mes: PlanillaOficinaMes }>(`/api/oficina/planilla`, { method: 'POST', body: JSON.stringify({ mes }) }),
    calcularPlanillaOficina: (mesId: string) => req<{ mes: PlanillaOficinaMes; detalle: PlanillaOficinaDetalle[] }>(`/api/oficina/planilla/${mesId}/calcular`, { method: 'POST' }),
    cerrarPlanillaOficina: (mesId: string) => req<{ mes: PlanillaOficinaMes; asientoId: string }>(`/api/oficina/planilla/${mesId}/cerrar`, { method: 'POST' }),
    reabrirPlanillaOficina: (mesId: string) => req<{ mes: PlanillaOficinaMes }>(`/api/oficina/planilla/${mesId}/reabrir`, { method: 'POST' }),
    editarDetalleOficina: (detalleId: string, data: Record<string, unknown>) => req<{ detalle: PlanillaOficinaDetalle }>(`/api/oficina/planilla-detalle/${detalleId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    listAdelantosOficina: (empleadoId: string) => req<{ adelantos: AdelantoOficina[] }>(`/api/oficina/adelantos?empleadoId=${empleadoId}`),
    crearAdelantoOficina: (data: { empleadoId: string; fecha: string; montoTotal: number; numCuotas: number; motivo?: string }) => req<{ adelanto: AdelantoOficina }>(`/api/oficina/adelantos`, { method: 'POST', body: JSON.stringify(data) }),
    docsDetalleOficina: (detalleId: string) => req<{ boleta: boolean; comprobante: boolean }>(`/api/oficina/planilla-detalle/${detalleId}/docs`),
    getConfigOficina: () => req<ConfigOficina>(`/api/oficina/config-planilla`),
    putConfigOficina: (data: Partial<ConfigOficina>) => req<ConfigOficina>(`/api/oficina/config-planilla`, { method: 'PUT', body: JSON.stringify(data) }),
    subirDocumentoOficina: async (form: FormData): Promise<{ ok: boolean; nasPath: string }> => {
      const res = await fetch(`${API_BASE}/api/oficina/documentos/upload`, { method: 'POST', credentials: 'include', body: form });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new ApiError(res.status, b.error ?? res.statusText, b); }
      return res.json();
    },
  },

  // Documentos · NAS Synology por proyecto
  documentos: {
    list: (proyectoId: string, path?: string) =>
      req<{ base: string; path: string; files: NasFile[] }>(`/api/proyectos/${proyectoId}/documentos${path ? `?path=${encodeURIComponent(path)}` : ''}`),
    init: (proyectoId: string) =>
      req<{ ok: boolean; base: string; creadas: string[] }>(`/api/proyectos/${proyectoId}/documentos/init`, { method: 'POST' }),
    createFolder: (proyectoId: string, path: string, name: string) =>
      req<{ ok: boolean }>(`/api/proyectos/${proyectoId}/documentos/folder`, { method: 'POST', body: JSON.stringify({ path, name }) }),
    upload: async (proyectoId: string, dest: string, file: File): Promise<{ ok: boolean; archivo: string }> => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('path', dest);
      const res = await fetch(`${API_BASE}/api/proyectos/${proyectoId}/documentos/upload`, { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error ?? res.statusText, body);
      }
      return res.json();
    },
    downloadUrl: (proyectoId: string, path: string) =>
      `${API_BASE}/api/proyectos/${proyectoId}/documentos/download?path=${encodeURIComponent(path)}`,
  },

  // NAS global (Documentos del ERP) · raíces curadas Drive/Proyectos/Administración/Logística
  nas: {
    list: (path: string) => req<{ path: string; files: NasFile[] }>(`/api/nas?path=${encodeURIComponent(path)}`),
    upload: async (dest: string, file: File): Promise<{ ok: boolean; archivo: string }> => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('path', dest);
      const res = await fetch(`${API_BASE}/api/nas/upload`, { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error ?? res.statusText, body);
      }
      return res.json();
    },
    downloadUrl: (path: string) => `${API_BASE}/api/nas/download?path=${encodeURIComponent(path)}`,
  },

  // Reportes financieros · shape unificado headers+data (pantalla + Excel)
  reportes: {
    get: (tipo: string, params?: { anio?: string; mes?: string }) => {
      const qs = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v)).toString();
      return req<ReporteData>(`/api/reportes/${tipo}${qs ? `?${qs}` : ''}`);
    },
    xlsxUrl: (tipo: string, params?: { anio?: string; mes?: string }) => {
      const qs = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v)).toString();
      return `${API_BASE}/api/reportes/${tipo}/xlsx${qs ? `?${qs}` : ''}`;
    },
    // C1 · export modelo PLANTILLA MM (Compras + Flujo Cuentas + Inventario)
    plantillaUrl: (params?: { anio?: string; proyectoId?: string }) => {
      const qs = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v)).toString();
      return `${API_BASE}/api/reportes/plantilla/xlsx${qs ? `?${qs}` : ''}`;
    },
  },

  // Inversiones · padre OxI (agrupa N proyectos-colegio bajo 1 CUI)
  inversiones: {
    list: () => req<{ inversiones: Inversion[] }>('/api/inversiones'),
    get: (id: string) =>
      req<{ inversion: Inversion; proyectos: Proyecto[] }>(`/api/inversiones/${id}`),
    getRollup: (id: string) => req<InversionRollup>(`/api/inversiones/${id}/rollup`),
    create: (data: InversionCreateInput) =>
      req<{ inversion: Inversion }>('/api/inversiones', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<InversionCreateInput>) =>
      req<{ inversion: Inversion }>(`/api/inversiones/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    linkProyecto: (
      id: string,
      data: { proyectoId: string; cui?: string; codigoIe?: string; ggUtModo?: GgUtModo },
    ) =>
      req<{ proyecto: Proyecto }>(`/api/inversiones/${id}/link`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    unlinkProyecto: (id: string, proyectoId: string) =>
      req<{ proyecto: Proyecto }>(`/api/inversiones/${id}/unlink/${proyectoId}`, {
        method: 'POST',
      }),
  },

  // Contractual · hitos de obra · garantías · adelantos
  contractual: {
    listHitos: (proyectoId: string) => req<{ hitos: HitoObra[] }>(`/api/proyectos/${proyectoId}/hitos`),
    listHitosSugeridos: (proyectoId: string) => req<{ sugeridos: HitoSugerido[] }>(`/api/proyectos/${proyectoId}/hitos-sugeridos`),
    createHito: (proyectoId: string, data: HitoInput) =>
      req<{ hito: HitoObra }>(`/api/proyectos/${proyectoId}/hitos`, { method: 'POST', body: JSON.stringify(data) }),
    updateHito: (id: string, data: Partial<HitoInput>) =>
      req<{ hito: HitoObra }>(`/api/hitos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteHito: (id: string) => req<{ ok: boolean }>(`/api/hitos/${id}`, { method: 'DELETE' }),

    listGarantias: (proyectoId: string) => req<{ garantias: Garantia[] }>(`/api/proyectos/${proyectoId}/garantias`),
    createGarantia: (proyectoId: string, data: GarantiaInput) =>
      req<{ garantia: Garantia }>(`/api/proyectos/${proyectoId}/garantias`, { method: 'POST', body: JSON.stringify(data) }),
    updateGarantia: (id: string, data: Partial<GarantiaInput>) =>
      req<{ garantia: Garantia }>(`/api/garantias/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteGarantia: (id: string) => req<{ ok: boolean }>(`/api/garantias/${id}`, { method: 'DELETE' }),
    generarRetencion: (proyectoId: string) =>
      req<{ garantia: Garantia; total: number }>(`/api/proyectos/${proyectoId}/garantias/generar-retencion`, { method: 'POST' }),

    listAdelantos: (proyectoId: string) => req<{ adelantos: Adelanto[]; resumen: { totalAdelantos: number; amortizadoManual: number; amortizadoValos: number; amortizadoReal: number; pendiente: number } }>(`/api/proyectos/${proyectoId}/adelantos`),
    createAdelanto: (proyectoId: string, data: AdelantoInput) =>
      req<{ adelanto: Adelanto }>(`/api/proyectos/${proyectoId}/adelantos`, { method: 'POST', body: JSON.stringify(data) }),
    updateAdelanto: (id: string, data: Partial<AdelantoInput>) =>
      req<{ adelanto: Adelanto }>(`/api/adelantos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteAdelanto: (id: string) => req<{ ok: boolean }>(`/api/adelantos/${id}`, { method: 'DELETE' }),

    // Liquidación de obra (Fase 1)
    getLiquidacion: (proyectoId: string) => req<{ liquidacion: Liquidacion | null; preview: LiquidacionPreview }>(`/api/proyectos/${proyectoId}/liquidacion`),
    practicarLiquidacion: (proyectoId: string, data?: { fecha?: string }) =>
      req<{ liquidacion: Liquidacion }>(`/api/proyectos/${proyectoId}/liquidacion/practicar`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
    reabrirLiquidacion: (id: string, motivo: string) =>
      req<{ liquidacion: Liquidacion }>(`/api/liquidaciones/${id}/reabrir`, { method: 'POST', body: JSON.stringify({ motivo }) }),
  },

  // Logística
  logistica: {
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
    listOcs: (filters?: { proyectoId?: string; proveedorId?: string; estado?: string; tipo?: 'BIEN' | 'SERVICIO' }) => {
      const qs = new URLSearchParams();
      if (filters?.proyectoId) qs.set('proyectoId', filters.proyectoId);
      if (filters?.proveedorId) qs.set('proveedorId', filters.proveedorId);
      if (filters?.estado) qs.set('estado', filters.estado);
      if (filters?.tipo) qs.set('tipo', filters.tipo);
      return req<{
        ordenes: Array<
          OrdenCompra & {
            itemPrincipal: string | null;
            proveedor: { id: string; razonSocial: string; ruc: string | null } | null;
            proyecto: { id: string; codigo: string; nombre: string } | null;
          }
        >;
        stats: {
          total: number;
          porEstado: Record<string, number>;
          porTipo: Record<string, number>;
          pendientesAprobar: number;
          pendientesPago: number;
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
    createOc: (
      data: Partial<OrdenCompra> & {
        lineas: Array<{
          descripcion: string;
          unidad?: string;
          cantidad: number | string;
          precioUnitario: number | string;
          partidaId?: string;
          recursoId?: string;
          notas?: string;
        }>;
        incluyeIgv?: boolean;
        proveedorRazonSocial?: string;
        proveedorDireccion?: string;
        ruc?: string;
        sinRuc?: boolean;
      },
    ) =>
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
    // Cotización (obligatoria) · multipart
    uploadCotizacion: async (id: string, file: File): Promise<{ oc: OrdenCompra; path: string }> => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/api/logistica/ordenes-compra/${id}/cotizacion`, { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new ApiError(res.status, b.error ?? res.statusText, b); }
      return res.json();
    },
    enviarAprobacion: (id: string) =>
      req<{ oc: OrdenCompra }>(`/api/logistica/ordenes-compra/${id}/enviar-aprobacion`, { method: 'POST' }),
    pagarOc: async (id: string, file: File, data?: { pagadoPorEmail?: string; fechaPago?: string; cuentaId?: string }): Promise<{ oc: OrdenCompra; gastoId: string | null }> => {
      const fd = new FormData();
      fd.append('file', file);
      if (data?.pagadoPorEmail) fd.append('pagadoPorEmail', data.pagadoPorEmail);
      if (data?.fechaPago) fd.append('fechaPago', data.fechaPago);
      if (data?.cuentaId) fd.append('cuentaId', data.cuentaId);
      const res = await fetch(`${API_BASE}/api/logistica/ordenes-compra/${id}/pagar`, { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new ApiError(res.status, b.error ?? res.statusText, b); }
      return res.json();
    },
    ocDocUrl: (id: string, tipo: 'oc' | 'cotizacion' | 'comprobante', download = false) =>
      `${API_BASE}/api/logistica/ordenes-compra/${id}/doc/${tipo}${download ? '?download=1' : ''}`,
  },

  // Activos · herramientas y equipos (depreciación + traslados)
  activos: {
    list: () => req<{ activos: ActivoFull[]; stats: ActivosStats }>('/api/activos'),
    create: (data: ActivoInput) => req<{ activo: ActivoFull }>('/api/activos', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<ActivoInput> & { estado?: 'operativo' | 'baja' | 'perdido' }) =>
      req<{ activo: ActivoFull }>(`/api/activos/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    traslado: (id: string, data: { proyectoId?: string | null; ubicacion?: string | null; responsable?: string | null; notas?: string | null; fecha?: string }) =>
      req<{ activo: ActivoFull }>(`/api/activos/${id}/traslado`, { method: 'POST', body: JSON.stringify(data) }),
    historial: (id: string) => req<{ movimientos: ActivoMov[] }>(`/api/activos/${id}/historial`),
    listMovimientos: () => req<{ movimientos: (ActivoMov & { activoCodigo: string; activoNombre: string; categoria: string })[] }>('/api/activos-movimientos'),
    remove: (id: string) => req<{ ok: boolean }>(`/api/activos/${id}`, { method: 'DELETE' }),
    scan: (payload: string) => req<{ activo: ActivoFull }>('/api/activos/scan', { method: 'POST', body: JSON.stringify({ payload }) }),
    // FX-5 · promueve un ítem de inventario a activo (overrides opcionales)
    promover: (itemId: string, data?: { nombre?: string; categoria?: string; marca?: string | null; serie?: string | null; valorAdquisicion?: number; pctDepreciacionAnual?: number; fechaAdquisicion?: string }) =>
      req<{ activo: ActivoFull }>(`/api/activos/promover/${itemId}`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  },

  // Notificaciones / alertas (campana) + usuarios
  notificaciones: {
    list: () => req<{ items: Notificacion[]; noLeidas: number }>('/api/notificaciones'),
    leer: (id: string) => req<{ notificacion: Notificacion }>(`/api/notificaciones/${id}/leer`, { method: 'POST' }),
    leerTodo: () => req<{ ok: boolean }>('/api/notificaciones/leer-todo', { method: 'POST' }),
  },
  usuarios: {
    list: () => req<{ usuarios: Usuario[] }>('/api/usuarios'),
  },

  // Profesionales · padrón de staff técnico (pool del equipo de obra)
  profesionales: {
    list: () => req<{ profesionales: Profesional[] }>('/api/profesionales'),
    create: (data: ProfesionalInput) => req<{ profesional: Profesional }>('/api/profesionales', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<ProfesionalInput>) => req<{ profesional: Profesional }>(`/api/profesionales/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string) => req<{ ok: boolean }>(`/api/profesionales/${id}`, { method: 'DELETE' }),
  },

  // Contabilidad · PCGE 2020 (contador interno)
  contabilidad: {
    getPlan: (periodo?: string) => req<{ cuentas: CuentaPlan[] }>(`/api/contabilidad/plan${periodo ? `?periodo=${periodo}` : ''}`),
    // WS1 · sugerencia de cuenta (2 niveles: proveedor reciente → fallback mapa tipoGasto). Pista, no verdad.
    sugerirCuenta: (opts: { proveedorRuc?: string; tipoGasto?: string }) => {
      const qs = new URLSearchParams();
      if (opts.proveedorRuc) qs.set('proveedorRuc', opts.proveedorRuc);
      if (opts.tipoGasto) qs.set('tipoGasto', opts.tipoGasto);
      return req<{ cuenta: string | null; origen?: 'SUGERIDO' | 'AUTOMATICO' }>(`/api/contabilidad/sugerir-cuenta?${qs}`);
    },
    // WS1 · autocomplete de cuenta contable (código/descripción, activas, por empresa). NO expone CD/GG editable.
    searchPlan: (q: string, opts?: { empresaId?: number; soloHoja?: boolean }) => {
      const qs = new URLSearchParams({ q });
      if (opts?.empresaId) qs.set('empresaId', String(opts.empresaId));
      if (opts?.soloHoja) qs.set('soloHoja', '1');
      return req<{ cuentas: PlanCuentaBusqueda[] }>(`/api/contabilidad/plan?${qs}`);
    },
    getCuentasTipo: () => req<{ mapa: GastoCuentaMapRow[]; plan: { codigo: string; nombre: string }[] }>('/api/contabilidad/cuentas-tipo'),
    updateCuentaTipo: (tipo: string, data: { cuenta: string; esActivo: boolean; esGasto: boolean; clase?: string }) =>
      req<{ ok: boolean; row: GastoCuentaMapRow }>(`/api/contabilidad/cuentas-tipo/${encodeURIComponent(tipo)}`, { method: 'PUT', body: JSON.stringify(data) }),
    createCuenta: (data: { codigo: string; descripcion: string; tipo: string }) =>
      req<{ cuenta: CuentaPlan }>('/api/contabilidad/plan', { method: 'POST', body: JSON.stringify(data) }),
    deleteCuenta: (codigo: string) => req<{ ok: boolean }>(`/api/contabilidad/plan/${codigo}`, { method: 'DELETE' }),
    listAsientos: (filtros?: { periodo?: string; origen?: string }) => {
      const qs = new URLSearchParams();
      if (filtros?.periodo) qs.set('periodo', filtros.periodo);
      if (filtros?.origen) qs.set('origen', filtros.origen);
      return req<{ asientos: AsientoFull[]; stats: { count: number; totalDebe: number; totalHaber: number; porOrigen: Record<string, number> } }>(`/api/contabilidad/asientos${qs.toString() ? `?${qs}` : ''}`);
    },
    createAsiento: (data: { fecha: string; glosa: string; moneda?: string; tipoCambio?: number | null; proyectoId?: string | null; lineas: { cuenta: string; descripcion?: string | null; debe: number; haber: number }[] }) =>
      req<{ asiento: AsientoCab }>('/api/contabilidad/asientos', { method: 'POST', body: JSON.stringify(data) }),
    anularAsiento: (id: string) => req<{ asiento: AsientoCab }>(`/api/contabilidad/asientos/${id}/anular`, { method: 'POST' }),
    getMayor: (cuenta: string, rango?: { desde?: string; hasta?: string }) => {
      const qs = new URLSearchParams({ cuenta });
      if (rango?.desde) qs.set('desde', rango.desde);
      if (rango?.hasta) qs.set('hasta', rango.hasta);
      return req<{ cuenta: string; movimientos: MayorMov[]; totales: { debe: number; haber: number; saldo: number } }>(`/api/contabilidad/mayor?${qs}`);
    },
    getBalance: (periodo?: string) =>
      req<{ filas: BalanceFila[]; totales: { debe: number; haber: number; saldoDeudor: number; saldoAcreedor: number } }>(`/api/contabilidad/balance${periodo ? `?periodo=${periodo}` : ''}`),
    getFiscal: (periodo: string) =>
      req<FiscalResumen>(`/api/contabilidad/fiscal?periodo=${periodo}`),
    generar: (periodo: string) =>
      req<{ ok: boolean; periodo: string; generados: number; detalle: { gastos: number; pagosOc: number; valorizaciones: number; cobros: number; planillas: number; errores: string[] } }>('/api/contabilidad/generar', { method: 'POST', body: JSON.stringify({ periodo }) }),
    listPeriodos: () => req<{ periodos: PeriodoContable[] }>('/api/contabilidad/periodos'),
    cerrarPeriodo: (periodo: string, opts?: { email?: string; force?: boolean }) => req<{ ok: boolean; cierreMeta?: Record<string, unknown>; congeladas?: { movimientos: number; gastos: number; asientos: number }; bloqueos?: { tipo: string; count: number }[] }>(`/api/contabilidad/periodos/${periodo}/cerrar`, { method: 'POST', body: JSON.stringify(opts ?? {}) }),
    reabrirPeriodo: (periodo: string, motivo: string) => req<{ ok: boolean }>(`/api/contabilidad/periodos/${periodo}/reabrir`, { method: 'POST', body: JSON.stringify({ motivo }) }),
    getPrecloseCheck: (periodo: string) => req<PrecloseCheck>(`/api/contabilidad/preclose-check?periodo=${periodo}`),
    getAuditLog: (f?: { periodo?: string; userId?: string; action?: string }) => {
      const qs = new URLSearchParams(Object.entries(f ?? {}).filter(([, v]) => v) as [string, string][]);
      return req<{ eventos: AuditEvento[] }>(`/api/contabilidad/audit-log${qs.toString() ? `?${qs}` : ''}`);
    },
    getCobertura: (periodo: string) => req<CoberturaResumen>(`/api/contabilidad/cobertura?periodo=${periodo}`),
    getMayorResumen: (periodo?: string) =>
      req<{ filas: MayorResumenFila[]; totales: { cuentas: number; movs: number; debe: number; haber: number } }>(`/api/contabilidad/mayor-resumen${periodo ? `?periodo=${periodo}` : ''}`),
    getConciliacion: () =>
      req<{ saldoContable: number; saldoTesoreria: number; diferencia: number; cuentas: { cuenta: CuentaBancaria; saldoTesoreria: number; movimientos: number }[] }>('/api/contabilidad/conciliacion'),
    // F3-B · reporte sombra (read-only · legacy 104x vs movimientos · readiness del flip cutover)
    getReporteSombra: (periodo: string, cutover?: string) =>
      req<ReporteSombra>(`/api/contabilidad/reporte-sombra?periodo=${periodo}${cutover ? `&cutover=${cutover}` : ''}`),
    // F4.1 · config transición 104x (cutover/parallel) · escritura solo admin · auditada
    getConfig: () => req<TransicionConfig>('/api/contabilidad/config'),
    updateConfig: (body: { cutover?: string | null; parallel?: boolean; comentario?: string }) =>
      req<{ ok: boolean; before: { cutover: string | null; parallel: boolean }; after: { cutover: string | null; parallel: boolean } }>('/api/contabilidad/config', { method: 'PUT', body: JSON.stringify(body) }),
    // F4.2 · tendencia histórica de estabilidad pre-cutover (snapshots) + captura manual
    getCutoverTrend: (periodo: string) => req<{ periodo: string; snapshots: CutoverSnapshot[] }>(`/api/contabilidad/cutover-trend?periodo=${periodo}`),
    captureCutoverSnapshot: (periodo: string) => req<{ ok: boolean; snapshot: CutoverSnapshot | null }>(`/api/contabilidad/cutover-snapshot?periodo=${periodo}`, { method: 'POST' }),
    // F4.3 · simulador cutover (read-only) · F4.4 · invariantes (smoke integridad)
    simularCutover: (periodo: string, cutover: string) => req<CutoverSimulacion>(`/api/contabilidad/cutover-simular?periodo=${periodo}&cutover=${cutover}`),
    getInvariantes: (periodo: string) => req<InvariantesResult>(`/api/contabilidad/invariantes?periodo=${periodo}`),
    // F4.6 · watchdog (semáforo consolidado) · smoke operacional · rollback plan · todos read-only
    getWatchdog: (periodo: string) => req<Watchdog>(`/api/contabilidad/watchdog?periodo=${periodo}`),
    runSmoke: (periodo: string) => req<{ periodo: string; ok: boolean; total: number; pasaron: number; checks: { check: string; ok: boolean; detalle: string }[] }>(`/api/contabilidad/smoke?periodo=${periodo}`),
    getRollbackPlan: () => req<RollbackPlan>('/api/contabilidad/rollback-plan'),
    // F4.5-PREP · dry-run / readiness / playbook del flip (todos read-only · NO ejecutan el flip)
    cutoverReadiness: (periodo: string) => req<CutoverReadiness>(`/api/contabilidad/cutover-readiness?periodo=${periodo}`),
    cutoverDryRun: (periodo: string, cutover: string) => req<CutoverDryRun>('/api/contabilidad/cutover-dry-run', { method: 'POST', body: JSON.stringify({ periodo, cutover }) }),
    cutoverPlaybook: (periodo: string, cutover: string) => req<CutoverPlaybook>(`/api/contabilidad/cutover-playbook?periodo=${periodo}&cutover=${cutover}`),
    // PLE SUNAT (C5)
    pleResumen: (periodo: string) =>
      req<{ periodo: string; libros: Record<'5.1' | '6.1' | '8.1' | '14.1' | 'RCE' | 'RVIE', { nombre: string; filas: number }> }>(`/api/contabilidad/ple/resumen?periodo=${periodo}`),
    pleUrl: (periodo: string, libro: '5.1' | '6.1' | '8.1' | '14.1' | 'RCE' | 'RVIE') => `/api/contabilidad/ple?periodo=${periodo}&libro=${libro}`,
    // Estados Financieros · Balance de Comprobación + ESF + ER (IR RMT estimado)
    estadosFinancieros: (anio?: string, uit?: number) =>
      req<EstadosFinancieros>(`/api/contabilidad/estados-financieros${anio ? `?anio=${anio}${uit ? `&uit=${uit}` : ''}` : ''}`),
  },

  // H3 · Conciliación bancaria
  conciliacion: {
    importar: async (file: File, opts: { cuentaId?: string; banco?: string; moneda?: string }) => {
      const fd = new FormData();
      fd.append('file', file);
      if (opts.cuentaId) fd.append('cuentaId', opts.cuentaId);
      if (opts.banco) fd.append('banco', opts.banco);
      if (opts.moneda) fd.append('moneda', opts.moneda);
      const res = await fetch(`${API_BASE}/api/conciliacion/importar`, { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Error al importar');
      return res.json() as Promise<{ extracto: ExtractoBancario; lineas: number; sugeridos: number }>;
    },
    listExtractos: () => req<{ extractos: (ExtractoBancario & { conteos: Record<string, number> })[] }>('/api/conciliacion'),
    getLineas: (extractoId: string) => req<{ lineas: ExtractoLineaUI[] }>(`/api/conciliacion/${extractoId}/lineas`),
    conciliar: (lineaId: string, movimientoId: string) => req<{ linea: ExtractoLineaUI }>(`/api/conciliacion/lineas/${lineaId}/conciliar`, { method: 'POST', body: JSON.stringify({ movimientoId }) }),
    setEstado: (lineaId: string, estado: string, motivo?: string) => req<{ linea: ExtractoLineaUI }>(`/api/conciliacion/lineas/${lineaId}/estado`, { method: 'POST', body: JSON.stringify({ estado, motivo }) }),
    metricas: (periodo?: string) => req<ConciliacionMetricas>(`/api/conciliacion/metricas${periodo ? `?periodo=${periodo}` : ''}`),
    resumen: (cuenta: string, periodo: string) => req<ConciliacionResumen>(`/api/conciliacion/resumen?cuenta=${cuenta}&periodo=${periodo}`),
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
  telefono?: string | null;
  mustChangePassword?: boolean;
  role?: string; // legacy · ya no se usa (el rol vive por empresa)
};

export type Nivel = 'ninguno' | 'lectura' | 'edicion';

export type EmpresaMembresia = {
  id: number;
  nombre: string | null; // nombreCorto · MM / MG
  razonSocial: string;
  rol: string;
  tieneProyectos: boolean;
};

export type MeResponse = {
  user: User | null;
  empresas: EmpresaMembresia[];
  empresaActiva: { id: number; nombre: string | null; rol: string } | null;
  permisos: Record<string, Nivel>;
};

export type AdminUser = {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  telefono: string | null;
  activo: boolean;
  lastLogin: string | null;
  nombre: string;
  empresas: { empresaId: number; empresaNombre: string | null; roleId: string; rol: string }[];
};

export type AdminUserInput = {
  email: string;
  nombres: string;
  apellidos: string;
  telefono?: string;
  password?: string;
  empresas: { empresaId: number; roleId: string }[];
};

export type AdminRole = {
  id: string;
  nombre: string;
  descripcion: string | null;
  esSistema: boolean;
  permisos: Record<string, Nivel>;
};

export type EmpresaRow = {
  id: number;
  ruc: string;
  razonSocial: string;
  nombreCorto: string | null;
  direccion?: string | null;
  email?: string | null;
  telefono?: string | null;
  tieneProyectos: boolean;
  activo: boolean;
};

export type GgUtModo = 'separado' | 'embebido_cd' | 'simple_pct';

export type CostosObra = {
  cd: { presupuesto: number; ejecutado: number; gastos: number; manoObra: number };
  ggObra: { presupuesto: number | null; ejecutado: number; separable: boolean };
  costoTotal: number; valorizacion: number; resultadoObra: number;
  compartidosSinDistribuir: number; ggUtModo: string;
};
export type ModalidadInversion =
  | 'oxi'
  | 'contrata'
  | 'administracion_directa'
  | 'app'
  | 'nucleo_ejecutor';

export type Inversion = {
  id: string;
  cui: string;
  nombre: string;
  modalidad: ModalidadInversion;
  clienteId: string | null;
  ubicacion: string | null;
  montoInversionMef: string | null;
  montoComponentes: string | null;
  montoExpedienteTecnico: string | null;
  montoSupervision: string | null;
  montoGestion: string | null;
  montoLiquidacion: string | null;
  fechaInicioEjecucion: string | null;
  fechaFinEjecucion: string | null;
  fechaEntregaOym: string | null;
  ueiNombre: string | null;
  ufNombre: string | null;
  uepNombre: string | null;
  proveidoAprobacion: string | null;
  empresaFinancista: string | null;
  pendienteContrato: boolean;
  nasFolder: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InversionRollup = {
  ok: boolean;
  epsilon: number;
  inversion: {
    id: string;
    cui: string;
    nombre: string;
    modalidad: ModalidadInversion;
    montoInversionMef: number | null;
    montoComponentes: number | null;
  };
  pctNivelInversion: null;
  colegios: Array<{
    id: string;
    codigo: string;
    nombre: string;
    codigoIe: string | null;
    ggUtModo: GgUtModo;
    costoDirecto: number;
    montoContractual: number;
    montoReferencial: number | null;
  }>;
  totales: {
    costoDirecto: number;
    montoContractual: number;
    montoReferencial: number;
    colegios: number;
  };
  comparaciones: Array<{
    nombre: string;
    descripcion: string;
    rollup: number;
    declarado: number | null;
    diff: number | null;
    ok: boolean | null;
    severidad: 'ok' | 'warn' | 'error' | 'na';
  }>;
  discrepancias: string[];
};

export type InversionCreateInput = {
  cui: string;
  nombre: string;
  modalidad?: ModalidadInversion;
  clienteId?: string;
  ubicacion?: string;
  montoInversionMef?: number;
  montoComponentes?: number;
  montoExpedienteTecnico?: number;
  montoSupervision?: number;
  montoGestion?: number;
  montoLiquidacion?: number;
  fechaInicioEjecucion?: string;
  fechaFinEjecucion?: string;
  fechaEntregaOym?: string;
  ueiNombre?: string;
  ufNombre?: string;
  uepNombre?: string;
  proveidoAprobacion?: string;
  empresaFinancista?: string;
  nasFolder?: string;
};

export type Proyecto = {
  id: string;
  codigo: string;
  nombre: string;
  ubicacion: string | null;
  status: string;
  responsableUserId?: string | null;
  inversionId?: string | null;
  codigoIe?: string | null;
  ggUtModo?: GgUtModo;
  fuenteMontos?: string | null;
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

export type HitoSugerido = {
  tipo: HitoTipo;
  fechaPlan: string; // YYYY-MM-DD
  confianza: number; // 0–1
  fuente: string;
  razon: string;
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
  // Métrica financiero-inversión (base = monto de inversión, incluye obra+mobiliario+ET+supervisiones)
  inversion?: {
    BAC: number;
    plan: number[];
    planAcum: number[];
    ev: number[];
    evAcum: number[];
    PV: number;
    EV: number;
    pctPlanHoy: number;
    pctRealHoy: number;
    spi: number;
    evIngestado: boolean;
  };
};

// F3 · Compras
export type Proveedor = {
  id: string;
  ruc: string | null; // nullable · proveedores informales sin RUC
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
  proyectoId: string | null;
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
  cotizacionNasPath: string | null;
  comprobantePagoNasPath: string | null;
  estadoPago: 'pendiente' | 'pagada';
  pagadoEn: string | null;
  pagadoPorEmail: string | null;
  gastoId: string | null;
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
  // Inversión (bloque totales Excel · financiero-inversión)
  montoInversionPeriodo: string | null;
  montoInversionAcumulado: string | null;
  pctInversionAcumulado: string | null;
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

export type CvValidation = {
  ok: boolean;
  totalChecks: number;
  passed: number;
  discrepancias: Array<{
    campo: string;
    deterministic: number | string | null;
    llm: number | string | null;
    diff: number | null;
    tipo: 'numero' | 'texto';
  }>;
};

export type CvPreviewResponse = {
  ok: boolean;
  sugerencia: { codigo: string; tipoEntidad?: string };
  ggUtModo: GgUtModo; // F3 · estructura GG+UT detectada
  header: {
    obra: string | null;
    ubicacion: string | null;
    cliente: string | null;
    costoBase: string | null;
    fechaBase: string | null;
    diasPlazo: number | null;
  };
  meses: Array<{
    idx: number;
    year: number;
    month: number;
    diasDuracion: number;
    fechaInicio: string;
    fechaFin: string;
    label: string;
  }>;
  totales: {
    costoDirecto: number | null;
    pctGg: number | null;
    montoGg: number | null;
    pctUtilidad: number | null;
    montoUtilidad: number | null;
    subTotal: number | null;
    mobiliario: number | null;
    pctIgv: number | null;
    montoIgv: number | null;
    presupuestoTotal: number | null;
    supervision: number | null;
    valorReferencial: number | null;
  };
  stats: {
    totalPartidas: number;
    totalHojas: number;
    totalTitulos: number;
    sumaParcialesHoja: number;
    cuadre: boolean;
    diferenciaCuadre: number;
  };
  warnings: string[];
  validation: CvValidation | null;
  llmMeta: { modelUsed: string; latencyMs: number; costUsd: number } | null;
  llmError: string | null;
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

export type ReconciliacionCheck = {
  nombre: string;
  descripcion: string;
  grupo: 'obra' | 'inversion';
  a: { fuente: string; valor: number | null };
  b: { fuente: string; valor: number | null };
  diff: number | null;
  ok: boolean | null;
  severidad: 'ok' | 'warn' | 'error' | 'na';
};

export type ReconciliacionResponse = {
  ok: boolean;
  epsilon: number;
  proyecto: { id: string; codigo: string; nombre: string; ggUtModo: GgUtModo };
  fuentes: {
    expedienteCd: number | null;
    partidasCd: number | null;
    partidasHoja: number;
    valorizadoCd: number | null;
    expedienteSubtotal: number | null;
    pctAvanceAcum: number | null;
    valorizaciones: number;
    inversion: {
      montoInversion: number | null;
      componentes: {
        subtotal: number | null;
        igv: number | null;
        mobiliario: number;
        expedienteTecnico: number;
        supervisionExpediente: number;
        supervisionObra: number;
      };
      sumDistribucion: number | null;
      inversionAcum: number | null;
      pctInversionReportado: number | null;
    };
  };
  checks: ReconciliacionCheck[];
  discrepancias: string[];
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

// ─── Contractual · hitos · garantías · adelantos ─────────────
export type HitoTipo =
  | 'entrega_terreno'
  | 'inicio_plazo'
  | 'ampliacion_plazo'
  | 'culminacion'
  | 'recepcion'
  | 'liquidacion'
  | 'consentimiento_liquidacion';

export type CierreItem = { key: string; label: string; ok: boolean; detail: string };
export type CierreObra = {
  status: string;
  veredicto: 'CERRADA' | 'LISTA PARA CERRAR' | 'EN LIQUIDACIÓN' | 'EN EJECUCIÓN';
  canClose: boolean;
  items: CierreItem[];
  faltantes: string[];
  valorizadoConIgv: number;
  vigente: number;
};
export type HitoObra = {
  id: string;
  proyectoId: string;
  tipo: HitoTipo;
  fecha: string;
  numeroDocumento: string | null;
  adjuntoNas: string | null;
  notas: string | null;
  createdAt: string;
};
export type HitoInput = {
  tipo: HitoTipo;
  fecha: string;
  numeroDocumento?: string | null;
  adjuntoNas?: string | null;
  notas?: string | null;
};

export type GarantiaTipo =
  | 'fiel_cumplimiento'
  | 'adelanto_directo'
  | 'adelanto_materiales'
  | 'adelanto_avance'
  | 'retencion'
  | 'beneficios_sociales';

export type Garantia = {
  id: string;
  proyectoId: string;
  tipo: GarantiaTipo;
  numeroCarta: string | null;
  monto: string;
  bancoEmisor: string | null;
  fechaEmision: string | null;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  estado: string;
  liberaEnHito: HitoTipo | null;
  adjuntoNas: string | null;
  notas: string | null;
  createdAt: string;
};
export type GarantiaInput = {
  tipo: GarantiaTipo;
  numeroCarta?: string | null;
  monto: number;
  bancoEmisor?: string | null;
  fechaEmision?: string | null;
  vigenciaDesde?: string | null;
  vigenciaHasta?: string | null;
  estado?: 'vigente' | 'ejecutada' | 'devuelta';
  liberaEnHito?: HitoTipo | null;
  adjuntoNas?: string | null;
  notas?: string | null;
};

export type AdelantoEstado = 'solicitado' | 'aprobado' | 'pagado' | 'amortizado' | 'rechazado';
export type Adelanto = {
  id: string;
  proyectoId: string;
  tipo: GarantiaTipo;
  monto: string;
  pctMontoContrato: string | null;
  fechaSolicitud: string | null;
  fechaPago: string | null;
  estado: AdelantoEstado;
  montoAmortizado: string | null;
  notas: string | null;
  createdAt: string;
};
export type AdelantoInput = {
  tipo: GarantiaTipo;
  monto: number;
  pctMontoContrato?: number | null;
  fechaSolicitud?: string | null;
  fechaPago?: string | null;
  estado?: AdelantoEstado;
  montoAmortizado?: number | null;
  notas?: string | null;
};

// ─── Liquidación de obra (Fase 1) ─────────────────────────────
export type LiquidacionPreview = {
  componentes: {
    facturadoConIgv: number; valorizadoSinIgv: number; reajustes: number; deducciones: number; multas: number;
    amortizAdelantos: number; retencionAcum: number; cobrado: number;
  };
  saldoFinal: number;
  conciliacion: { valorizadoBrutoIgv: number; saldo1212: number; retencionMezclada: number; porCobrarNeto: number; motorSegregaRetencion: boolean; nota: string };
  valos: number;
  valosCobradas: number;
};
export type Liquidacion = {
  id: string; proyectoId: string; fechaPractica: string; estado: 'practicada' | 'reabierta';
  snapshot: LiquidacionPreview | null; saldoFinal: string; hash: string | null;
  motivoReapertura: string | null; reabiertaAt: string | null; createdAt: string;
};

// ─── P&L por obra · "mi bolsillo" ─────────────────────────────
export type PnlResponse = {
  proyecto: { id: string; codigo: string; nombre: string };
  ingresos: { total: number; valorizaciones: number };
  costoReal: { total: number; gastos: number; porTipo: Record<string, number> };
  comprometido: { total: number; ordenes: number; bien: number; servicio: number; ordenesTotal: number };
  egresos: { total: number; ordenes: number; bien: number; servicio: number; ordenesTotal: number };
  utilidad: number;
  margenPct: number;
  indiceRent: number | null;
  miPct: number;
  miUtilidad: number;
};

// ─── Dashboard · cartera + P&L consolidado ────────────────────
export type SaludObra = 'critico' | 'observacion' | 'saludable' | 'sin_datos';
export type DashboardObra = {
  id: string;
  codigo: string;
  nombre: string;
  cliente: string | null;
  status: string;
  ubicacion: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  montoContractual: number;
  presupuesto: number;
  avanceFisico: number;
  ingresos: number;
  egresos: number;
  miPct: number;
  miUtilidad: number;
  responsableUserId: string | null;
  responsable: string | null;
};
// Fila de salud (curva-S) · endpoint /_dashboard/salud aparte
export type SaludRow = {
  id: string;
  codigo: string;
  nombre: string;
  cpi: number | null;
  spi: number | null;
  salud: SaludObra;
  desviacionPct: number | null;
  responsableUserId: string | null;
};
export type EquipoMiembro = { profesionalId: string; rol: string; asignadoEn: string | null; nombre: string; profesion: string | null };

export type Profesional = { id: string; nombre: string; profesion: string | null; colegiatura: string | null; dni: string | null; telefono: string | null; email: string | null; cargoDefault: string | null; activo: boolean; createdAt: string };
export type ProfesionalInput = { nombre: string; profesion?: string | null; colegiatura?: string | null; dni?: string | null; telefono?: string | null; email?: string | null; cargoDefault?: string | null };
export type ForecastPunto = { periodo: string; plan: number; proyectado: number };
export type Forecast = {
  puntos: ForecastPunto[];
  pctPlanHoy: number;
  pctRealHoy: number;
  probabilidadCierreQ2: number;
};
export type DashboardResponse = {
  totales: {
    cartera: number;
    ingresos: number;
    egresos: number;
    miUtilidad: number;
    obrasActivas: number;
    obrasTotal: number;
    licitacion: number;
    avanceFisicoProm: number;
  };
  obras: DashboardObra[];
};
export type DashboardSaludResponse = {
  salud: { critico: number; observacion: number; saludable: number; sinDatos: number };
  forecast: Forecast | null;
  obras: SaludRow[];
};

// ─── Notificaciones / alertas (campana) ───────────────────────
export type Notificacion = {
  id: string;
  clave: string;
  tipo: string;
  severidad: 'alta' | 'media' | 'baja';
  titulo: string;
  detalle: string | null;
  proyectoId: string | null;
  proyectoCodigo: string | null;
  accionUrl: string | null;
  leidoEn: string | null;
  createdAt: string;
};
export type Usuario = { id: string; nombres: string; apellidos: string; role: string; activo: boolean; nombre: string };

// ─── Cashflow · flujo de caja real ────────────────────────────
export type CashflowBucket = {
  ym: string;
  adelantos: number;
  valos: number;
  devolucionRetencion: number;
  compras: number;
  igvSunat: number;
  entradas: number;
  salidas: number;
  neto: number;
  saldoAcum: number;
};
export type CashflowResponse = {
  proyecto: { id: string; codigo: string; nombre: string };
  buckets: CashflowBucket[];
  totales: { entradas: number; salidas: number; saldoFinal: number; retencionAcum: number; retencionDevuelta: boolean; valosCobrado: number; valosPendiente: number };
};

// ─── NAS · documentos ─────────────────────────────────────────
export type NasFile = { name: string; path: string; isDir: boolean; size: number; mtime: number | null };

export type ReporteData = {
  titulo: string;
  headers: string[];
  data: (string | number)[][];
  footer?: (string | number)[];
  nota?: string;
};

// ─── Finanzas · gastos (Fact de Compras) ──────────────────────
export type Gasto = {
  id: string;
  codigo: string | null;
  proyectoId: string | null;
  fecha: string;
  tipoRegistro: string | null;
  tipoIgv: string | null;
  ordenCompraId: string | null;
  proveedorId: string | null;
  proveedorRuc: string | null;
  proveedorRazon: string | null;
  tipoComprobante: string | null;
  serie: string | null;
  numero: string | null;
  moneda: string;
  formaPago: string | null;
  fuentePago: string | null;
  cuentaId: string | null;
  descripcionItem: string | null;
  subtotal: string;
  igv: string;
  exonerado: string;
  total: string;
  tipoGasto: string | null;
  observaciones: string | null;
  createdAt: string;
};
export type GastoInput = {
  fecha: string;
  tipoRegistro?: string | null;
  tipoIgv?: string | null;
  proveedorRuc?: string | null;
  proveedorRazon?: string | null;
  tipoComprobante?: string | null;
  serie?: string | null;
  numero?: string | null;
  moneda?: string;
  formaPago?: string | null;
  fuentePago?: string | null;
  cuentaId?: string | null;
  descripcionItem?: string | null;
  subtotal?: number;
  igv?: number;
  exonerado?: number;
  total?: number;
  tipoGasto?: string | null;
  observaciones?: string | null;
  inventariable?: boolean; // FX · crea ítem de inventario "por completar" ligado al gasto
  destino?: 'proyecto' | 'corporativo';
  clasificacion?: 'CD' | 'GG_OBRA' | 'GG_CORP';
  prorrateable?: boolean;
  cuentaContable?: string | null; // WS1 · cuenta contable manual (Kelly). CD/GG se deriva de ella.
  cuentaContableOrigen?: 'USUARIO' | 'SUGERIDO' | null;
};
// WS1 · fila del autocomplete de plan contable (GET /contabilidad/plan?q=)
export type PlanCuentaBusqueda = { codigo: string; descripcion: string; tipo: string; nivel: number; esDivisionaria: boolean; empresaId: number | null; activa: boolean; clasificable: boolean | null; claseObra: 'CD' | 'GG_OBRA' | null };
export type GastoStats = { count: number; totalGeneral: number; subtotalGeneral: number; porTipo: Record<string, number> };
export type CuentaBancaria = { id: string; codigo: string; banco: string | null; moneda: string; descripcion: string | null; cuentaContable: string | null; activo: boolean };

// ─── Finanzas FIN-2 · movimientos (Flujo de Cuentas) ──────────
export type Movimiento = {
  id: string;
  codigo: string | null;
  fecha: string;
  proyectoId: string | null;
  tipoMovimiento: 'Ingreso' | 'Egreso';
  fuentePago: string | null;
  cuentaId: string | null;
  fuenteMovimiento: string | null;
  clienteNombre: string | null;
  tipoComprobante: string | null;
  serie: string | null;
  numero: string | null;
  moneda: string;
  monto: string;
  descripcion: string | null;
  numOperacion: string | null;
  gastoId: string | null;
  anulado?: boolean;
  tipoCambio?: string | null;
  montoBase?: string | null;
  createdAt: string;
};
export type MovimientoInput = {
  fecha: string;
  tipoMovimiento: 'Ingreso' | 'Egreso';
  fuentePago?: string | null;
  cuentaId?: string | null;
  fuenteMovimiento?: string | null;
  clienteNombre?: string | null;
  tipoComprobante?: string | null;
  serie?: string | null;
  numero?: string | null;
  moneda?: string;
  monto: number;
  descripcion?: string | null;
  numOperacion?: string | null;
  subtipo?: string | null;
  subtotal?: number | null;
  igv?: number | null;
  detraccion?: number | null;
  retencion?: number | null;
  cuentaDestinoId?: string | null;
  fechaVencimiento?: string | null;
  estado?: string | null;
  naturalezaContable?: string | null;
  ordenCompraId?: string | null;
  valorizacionId?: string | null;
  gastoId?: string | null;
  cuentaContable?: string | null; // WS1 · cuenta contra manual (Kelly)
  cuentaContableOrigen?: 'USUARIO' | 'SUGERIDO' | null;
};
export type SaldoCuenta = { cuenta: CuentaBancaria; ingresos: number; egresos: number; saldo: number; movimientos: number };

// ─── Finanzas · resumen consolidado (1 request) ───────────────
export type FinanzasResumen = {
  mesActual: string | null;
  gastosOficina: { mes: string | null; presupuesto: number | null; ejecutado: number; porCategoria: { categoria: string; monto: number; pct: number }[] };
  kpis: { ingresosMes: number; egresosMes: number; saldoMes: number; totalCaja: number; porCobrar: number; porPagar: number };
  flujoMensual: { mes: string; ingresos: number; egresos: number }[];
  tesoreria: { cuentas: SaldoCuenta[]; totalCaja: number };
  porCobrar: { id: string; proyectoId: string; proyectoCodigo: string | null; proyectoNombre: string | null; numero: number; mesPeriodo: string | null; status: string; monto: number }[];
  porPagar: { id: string; proyectoId: string; proyectoCodigo: string | null; proyectoNombre: string | null; numero: string; estado: string; monto: number }[];
  garantias: { id: string; proyectoId: string; proyectoCodigo: string | null; proyectoNombre: string | null; tipo: string; banco: string | null; monto: number; vigenciaHasta: string | null }[];
  totals: { porCobrar: number; porPagar: number; garantias: number };
};

// ─── Activos · herramientas y equipos ─────────────────────────
export type ActivoInput = {
  nombre: string;
  categoria: string;
  marca?: string | null;
  serie?: string | null;
  fechaAdquisicion: string;
  valorAdquisicion: number;
  pctDepreciacionAnual?: number;
  proyectoId?: string | null;
  ubicacion?: string | null;
  responsable?: string | null;
  notas?: string | null;
};
export type ActivoFull = {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string;
  marca: string | null;
  serie: string | null;
  fechaAdquisicion: string;
  valorAdquisicion: string;
  pctDepreciacionAnual: string;
  estado: 'operativo' | 'baja' | 'perdido';
  proyectoId: string | null;
  ubicacion: string | null;
  responsable: string | null;
  notas: string | null;
  // calculados
  aniosUso: number;
  depreciacionAcum: number;
  valorNeto: number;
  pctDepreciado: number;
  proyecto: { id: string; codigo: string; nombre: string; lat: string | null; lng: string | null } | null;
};
export type ActivosStats = {
  total: number;
  operativos: number;
  enObra: number;
  valorAdquisicion: number;
  valorNeto: number;
  porCategoria: Record<string, number>;
};
export type ActivoMov = { id: string; activoId: string; fecha: string; desde: string | null; hacia: string; proyectoId: string | null; responsable: string | null; notas: string | null };

// ─── Contabilidad · PCGE ──────────────────────────────────────
export type GastoCuentaMapRow = { tipoGasto: string; cuenta: string; esActivo: boolean; esGasto: boolean; clase: 'CD' | 'GG_OBRA' | 'GG_CORP' };
export type EEFFGrupo = { grupo: string; descripcion: string; monto: number };
export type EstadosFinancieros = {
  anio: string; uit: number;
  balanceComprobacion: {
    filas: { cuenta: string; descripcion: string; debe: number; haber: number; saldoDeudor: number; saldoAcreedor: number }[];
    totales: { debe: number; haber: number; saldoDeudor: number; saldoAcreedor: number };
  };
  esf: { activo: EEFFGrupo[]; pasivo: EEFFGrupo[]; patrimonio: EEFFGrupo[]; totalActivo: number; totalPasivo: number; totalPatrimonioBase: number; resultadoEjercicio: number; totalPatrimonio: number; check: number };
  er: { ingresos: EEFFGrupo[]; gastos: EEFFGrupo[]; totalIngresos: number; totalGastos: number; utilidadAntesIR: number; ir: number; regimen: string; utilidadNeta: number };
};
export type CuentaPlan = {
  codigo: string;
  descripcion: string;
  tipo: string;
  parentCodigo: string | null;
  nivel: number;
  debe: number;
  haber: number;
  saldo: number;
};
export type AsientoCab = {
  id: string;
  correlativo: string;
  fecha: string;
  periodo: string | null;
  glosa: string;
  origen: string;
  origenId: string | null;
  moneda: string;
  tipoCambio: string | null;
  proyectoId: string | null;
  docOrigen: string | null;
  tipoDoc: string | null;
  contraparteRuc: string | null;
  contraparteRazon: string | null;
  status: 'borrador' | 'registrado' | 'cerrado' | 'anulado';
};
export type AsientoLineaT = { id: string; asientoId: string; correlativo: number; cuenta: string; descripcion: string | null; debe: string; haber: string };
export type AsientoFull = AsientoCab & { lineas: AsientoLineaT[]; totalDebe: number; totalHaber: number };
export type MayorMov = { fecha: string; correlativo: string; glosa: string; origen: string; cuenta: string; descripcion: string | null; debe: number; haber: number; saldo: number };
export type BalanceFila = { codigo: string; descripcion: string; debe: number; haber: number; saldoDeudor: number; saldoAcreedor: number };
export type FiscalResumen = {
  periodo: string;
  igv: { debito: number; credito: number; neto: number; aPagar: number; saldoFavor: number };
  renta: { ingresosNetos: number; tasa: number; pagoCuenta: number; regimen: string };
};
export type CoberturaResumen = { periodo: string; total: number; gastos: number; pagosOc: number; valorizaciones: number; cobros: number; planillas: number };
export type MayorResumenFila = { cuenta: string; descripcion: string; tipo: string; inicial: number; debe: number; haber: number; final: number; movs: number };
export type SombraDiff = { tipo: string; docId: string; doc: string; legacyMonto: number; movMonto: number; detalle: string };
export type PeriodoContable = { periodo: string; estado: string; estadoRaw: string; cerradoEn: string | null; cerradoPor: string | null; reabiertoPor: string | null; motivoReapertura: string | null; fechaReapertura: string | null; cierreMeta: Record<string, unknown> | null };
export type PrecloseCheck = { periodo: string; ok: boolean; bloqueos: { tipo: string; count: number; detalle: string }[]; resumen: ReporteSombra['resumen']; parallel?: boolean; cutover?: string | null; conciliacion?: { pendiente: number; diferencia: number; total: number } };
// F4.1 · estado de la transición de ownership 104x (config editable · reversible)
export type TransicionConfig = { cutover: string | null; parallel: boolean; meta: { cutover: { valor: string | null; comentario: string | null; actualizadoPor: string | null; actualizadoEn: string } | null; parallel: { valor: string | null; comentario: string | null; actualizadoPor: string | null; actualizadoEn: string } | null } };
// F4.2 · snapshot de estabilidad pre-cutover (tendencia)
export type CutoverSnapshot = { id: string; periodo: string; fechaSnapshot: string; diff: string; realDiffsCount: number; ownershipAmbiguo: number; movimientosSinCuenta: number; cuentasSin104x: number; conciliacionPendiente: number; listoParaFlip: boolean; meta: { cutover: string | null; parallel: boolean; fuente: string } | null; hash: string | null; createdAt: string };
// F4.3 · resultado de simulación de cutover (read-only)
export type CutoverSimulacion = {
  periodo: string; cutoverSimulado: string; cutoverActual: string | null;
  recomendacion: { nivel: 'seguro' | 'riesgoso' | 'imposible'; motivo: string };
  resumen: ReporteSombra['resumen']; diff: number;
  docsAfectados: { huerfanos: SombraDiff[]; conflictos: SombraDiff[]; esperados: SombraDiff[] };
};
// F4.4 · resultado del smoke de invariantes
export type InvariantesResult = { periodo: string; ok: boolean; checks: { check: string; ok: boolean; detalle: string }[]; contexto: { cutover: string | null; parallel: boolean } };
// F4.6 · watchdog consolidado (semáforo) + rollback plan
export type Watchdog = {
  periodo: string; estadoGlobal: 'verde' | 'amarillo' | 'rojo'; razones: string[]; recomendaciones: string[];
  riesgoFlip: { nivel: 'seguro' | 'riesgoso' | 'imposible'; motivo: string };
  tendenciaDiff: string; tendenciaOwnership: string; tendenciaMovSinCuenta: string;
  gapsActivos: { movimientosSinCuenta: number; cuentasSin104x: number; docLinkFaltante: number; conciliacionPendiente: number };
  snapshotsFaltantes: boolean; cerradoConCambios: boolean;
  invariantes: { ok: boolean; rotos: string[] }; preclose: { ok: boolean; bloqueos: { tipo: string; count: number; detalle: string }[] };
  config: { cutover: string | null; parallel: boolean }; resumen: ReporteSombra['resumen']; diff: number; snapshotsCount: number;
};
export type RollbackPlan = {
  estadoActual: { cutover: string | null; parallel: boolean; flipeado: boolean };
  escenarios: { titulo: string; cuando: string; reversible: boolean; auditado: string; pasos: string[] }[];
  noRevertir: string[]; riesgos: string[]; invariantesNoTocar: string[];
};
// F4.5-PREP · readiness / dry-run / playbook del flip
export type CutoverReadiness = {
  periodo: string; resultado: 'GO' | 'CONDITIONAL' | 'NO_GO'; razones: string[];
  criterios: { criterio: string; hard: boolean; ok: boolean; detalle: string }[];
  contexto: { cutover: string | null; parallel: boolean };
};
export type CutoverDryRun = {
  periodo: string; cutover: string; recomendacion: { nivel: 'seguro' | 'riesgoso' | 'imposible'; razones: string[] };
  resumenOwnership: { antesDelFlip: string; despuesDelFlip: { hastaCutover: string; desdeCutover: string }; legacyCajaAsientosAAnular: number; movimientosQueTomanOwnership: number; movimientosConCuenta104x: number; movimientosSinCuenta104x: number; docsHuerfanos: number; conflictos: number; impactoNetoDiff: number };
  riesgoOperacional: 'bajo' | 'medio' | 'alto';
  postFlipSmoke: { check: string; ok: boolean; detalle: string }[];
  legacyCajaAAnular: { id: string; correlativo: string | null; fecha: string }[];
  rollbackPreview: { titulo: string; pasos: string[]; reversible: boolean };
};
export type CutoverPlaybook = {
  periodo: string; cutover: string | null; estadoActual: { cutover: string | null; parallel: boolean };
  readiness: { resultado: string; razones: string[] };
  ejecutor: string; duracionEstimada: string; ventanaRecomendada: string;
  procedimiento: { fase: string; pasos: string[] }[];
  monitoreoMinutoAMinuto: string[];
  abortConditions: { hardStops: string[]; ventanasTolerancia: { amarillo: string; rojo: string }; metricasHardStop: string[] };
  rollback: { titulo: string; pasos: string[]; reversible: boolean }; nota: string;
};
export type AuditEvento = { id: string; action: string; entityType: string | null; entityId: string | null; changes: { before?: unknown; after?: unknown; motivo?: string | null } | null; ip?: string | null; createdAt: string; userId: string | null; userEmail: string | null; userNombres: string | null };
export type ExtractoBancario = { id: string; cuentaId: string | null; banco: string | null; moneda: string; nombreArchivo: string | null; totalFilas: number; importadoEn: string };
export type ExtractoLineaUI = { id: string; extractoId: string; fecha: string; descripcion: string | null; referencia: string | null; monto: string; moneda: string; estado: string; movimientoId: string | null; score: string | null; confianza: string | null; movimiento: Movimiento | null };
export type ConciliacionMetricas = { periodo: string | null; total: number; conciliado: number; pendiente: number; diferencia: number; ignorado: number; pctConciliado: number; diferenciaNeta: number; agingMaxDias: number };
export type PartidaConcil = { id: string; fecha: string; desc: string | null; monto: number; clase: string; aging: number };
export type ConciliacionResumen = {
  cuenta: { id: string; codigo: string; descripcion: string | null; banco: string | null; cuentaContable: string | null };
  periodo: string;
  kpis: { saldoBanco: number; saldoLibro: number; diferencia: number; estado: 'cuadrado' | 'descuadrado'; partidasLibroPendientes: number; movimientosBancoPendientes: number };
  saldoExtracto: { viaColumna: number | null; viaMovimientos: number | null; usado: number; estimado: boolean; inconsistente: boolean };
  partidas: { libroNoBanco: PartidaConcil[]; bancoNoLibro: PartidaConcil[] };
  calidad: { total: number; conciliados: number; pendientes: number; pctConciliado: number };
};
export type ReporteSombra = {
  periodo: string;
  oficial: { legacyNeto: number; movimientosNeto: number; diff: number };
  porCuenta104x: { cuenta: string; ingresos: number; egresos: number; neto: number }[];
  realDiffs: SombraDiff[];
  temporales: SombraDiff[];
  config: { cuentasSin104x: string[]; movimientosSinCuenta: string[]; naturalezaSinCuenta: string[]; docLinkFaltante: string[] };
  meta: { cutover: string | null; evalCutover: string; parallelRun: boolean; eventosEvaluados: number; legacyCount: number; movimientosCount: number; movimientosAnulados: number; movimientosNetoTotal: number };
  resumen: { realDiffsCount: number; ownershipAmbiguo: number; cuentasSin104x: number; movimientosSinCuenta: number; listoParaFlip: boolean };
};

export type FinanzasFlujo = {
  barras: { mes: string; ingresos: number; egresos: number; saldoAcum: number }[];
  mesUlt: string | null;
  composicion: { categoria: string; monto: number; pct: number }[];
  mesComp: string | null;
  sankeyEgresos: { nodes: { name: string }[]; links: { source: string; target: string; value: number }[] };
  sankeyIngresos: { nodes: { name: string }[]; links: { source: string; target: string; value: number }[] };
  ingresosSinCliente: number;
};

export type CashflowEntry = { tipo?: string; categoria?: string; concepto: string; proyecto: string; contraparte: string; comprobante: string; fecha: string; monto: number };
export type CashflowMes = { ym: string; label: string; year: number; ingresos: number; egresos: number; acumulado: number };

export type Valuacion = { facturaTotal: number; inventariable: number; diferencia: number };

// ─── Finanzas FIN-3 · inventario ──────────────────────────────
export type InventarioItem = {
  id: string;
  codigo: string | null;
  fecha: string;
  proyectoId: string | null;
  proveedorRuc: string | null;
  proveedorRazon: string | null;
  tipoComprobante: string | null;
  serie: string | null;
  numero: string | null;
  cantidad: string;
  descripcionItem: string | null;
  valorUnitario: string;
  categoria: string | null;
  estado: string | null;
  responsable: string | null;
  observacion: string | null;
  gastoId: string | null;
  activoId: string | null;
  createdAt: string;
};
export type InventarioInput = {
  fecha: string;
  proveedorRuc?: string | null;
  proveedorRazon?: string | null;
  tipoComprobante?: string | null;
  serie?: string | null;
  numero?: string | null;
  cantidad?: number;
  descripcionItem?: string | null;
  valorUnitario?: number;
  categoria?: string | null;
  estado?: string | null;
  responsable?: string | null;
  observacion?: string | null;
};

// ─── Planilla FIN-4 · tipos ───────────────────────────────────
export type Empleado = {
  id: string; nombre: string; tipoDoc: string | null; numDoc: string | null;
  fechaNacimiento: string | null; sistemaPension: string | null; cuspp: string | null;
  fechaIngreso: string | null; categoria: string | null; tieneHijos: boolean; numHijos: number;
  aplicaMovilidad: boolean; bonifAltura: boolean; bonifAgua: boolean; proyectoId: string | null;
  sctrVigencia: string | null; banco: string | null; numCuenta: string | null; tipoPlanilla: string; activo: boolean;
};
export type EmpleadoInput = {
  nombre: string; tipoDoc?: string; numDoc?: string | null; sistemaPension?: string | null;
  cuspp?: string | null; fechaIngreso?: string | null; categoria?: string | null;
  tieneHijos?: boolean; numHijos?: number; aplicaMovilidad?: boolean; bonifAltura?: boolean; bonifAgua?: boolean;
  proyectoId?: string | null; sctrVigencia?: string | null; banco?: string | null;
  numCuenta?: string | null; tipoPlanilla?: 'obrero' | 'admin';
};
export type ParamPlanilla = { id: string; categoria: string; jornalBase: string; movilidad: string | null; pctBuc: string | null; pctDominical: string | null; pctCompVac: string | null; pctCts: string | null; pctGratif: string | null; pctHe60: string | null; pctHe100: string | null };
export type PlanillaDashboard = {
  trabajadoresActivos: number;
  porCategoria: { categoria: string; count: number; jornal: number }[];
  porObra: { codigo: string; nombre: string; count: number }[];
  nominaSemana: number;
  costoTotal: number;
  faltasInjustificadas: number;
  dmActivos: number;
  semana: { mes: string | null; fechaInicio: string; fechaFin: string } | null;
};
export type AfpTasa = { id: string; afp: string; pctAporte: string; pctComision: string; pctSeguro: string };
export type ConfigPlanilla = { id: string; uit: string; pctEsSalud: string; pctOnp: string; pctSencico: string; pctConafovicer: string; pctSctrSalud: string; pctSctrPension: string; pctBonifAltura: string; pctBonifAgua: string; asignEscolarJornales: string };
export type Asistencia = { id: string; empleadoId: string; semanaId: string | null; proyectoId: string | null; fecha: string; tipo: string };
export type PlanillaSemana = { id: string; proyectoId: string | null; fechaInicio: string; fechaFin: string; mes: string | null; estado: string };
export type PlanillaDetalle = {
  id: string; empleadoId: string | null; nombre: string | null; categoria: string | null; sistemaPension: string | null;
  jornalUsado: string | null; diasTrabajados: number; jornadaDominical: boolean; horasExtra60: string; horasExtra100: string;
  montoJornada: string; montoDominical: string; montoBuc: string; montoCompVac: string; montoGratif: string; montoBonifExtra: string; montoCts: string;
  montoMovilidad: string; montoHorasExtra: string; montoBonifAltura: string; montoBonifAgua: string; montoEscolaridad: string; totalIngreso: string; totalAfecto: string;
  montoAfpAporte: string; montoAfpComision: string; montoAfpSeguro: string; montoOnp: string; montoConafovicer: string;
  montoRenta5ta: string; montoAdelanto: string; montoSindical: string; totalDescuentos: string; netoPago: string; montoEsSalud: string;
  montoSctrSalud: string; montoSctrPension: string; montoSencico: string; montoCostoTotal: string;
};
export type PlanillaTotales = { obreros: number; totalIngreso: number; totalDescuentos: number; netoPago: number; esSalud: number; sctr: number; sencico: number; costoTotal: number; afecto: number };
export type PlanillaLinea = { empleadoId: string; dias: number; jornadaDominical: boolean; horasExtra60: number; horasExtra100: number; escolaridad: number; renta5ta: number; adelanto: number; sindical: number; cuentaContable?: string | null };

// ─── Oficina · rendiciones (FIN-5) ───────────────────────────
export type Rendicion = {
  id: string; codigo: string | null; solicitanteUserId: string | null; solicitanteNombre: string | null;
  proyectoId: string | null; proyectoCodigo?: string | null; cuentaId: string | null; cuentaNombre?: string | null;
  modo: 'reembolso' | 'anticipo'; tipo: string; concepto: string | null; fecha: string;
  montoAnticipo: string; montoRendido: string; estado: 'borrador' | 'pendiente' | 'aprobado' | 'rendido' | 'cerrado' | 'rechazado';
  aprobadoPorUserId: string | null; aprobadoEn: string | null; motivoRechazo: string | null; gastoId: string | null; createdAt: string;
};
export type RendicionItem = {
  id: string; rendicionId: string; tipoComprobante: 'factura' | 'boleta' | 'rh' | 'recibo'; serie: string | null; numero: string | null;
  ruc: string | null; razon: string | null; fecha: string | null; categoria: string | null;
  subtotal: string; igv: string; total: string; deducible: boolean; archivo: string | null;
};
export type SaldoRendir = { userId: string | null; nombre: string; saldo: number; count: number };
export type SaldosRendirResponse = { saldos: SaldoRendir[]; total: number; miSaldo: number; miCount: number };
export type RendicionInput = { modo: 'reembolso' | 'anticipo'; tipo: string; concepto?: string | null; fecha: string; proyectoId?: string | null; cuentaId?: string | null; montoAnticipo?: number };
export type RendicionItemInput = { tipoComprobante: 'factura' | 'boleta' | 'rh' | 'recibo'; serie?: string | null; numero?: string | null; ruc?: string | null; razon?: string | null; fecha?: string | null; categoria?: string | null; subtotal: number; igv: number; total: number; deducible: boolean; archivo?: string | null };

// ─── Oficina · planilla administrativa ───────────────────────────
export type PlanillaOficinaMes = {
  id: string; empresaId: number; mes: string;
  estado: 'borrador' | 'calculada' | 'cerrada' | 'pagada';
  asientoId: string | null; cerradoEn: string | null;
};
export type PlanillaOficinaDetalle = {
  id: string; planillaMesId: string; empleadoId: string; boletaCorrelativo: string | null;
  nombre: string | null; cargo: string | null; dni: string | null; afp: string | null; cuspp: string | null; cuentaBancaria: string | null;
  fechaIngreso: string | null; fechaCese: string | null;
  diasTrab: number | null; horasTrab: number | null;
  sueldoMensual: string; valorHora: string; cantHe25: string; montoHe25: string; cantHe35: string; montoHe35: string; totalHe: string;
  diasDominical: number | null; montoDominical: string; diasFeriado: number | null; montoFeriado: string;
  asigFamiliar: string; gratificacion: string; vacaciones: string; comisiones: string; bonificacion: string; totalBruto: string;
  onp: string; afpAporte: string; afpSeguro: string; afpComision: string; imptoRenta5ta: string; retencionJudicial: string;
  adelantoCuota: string; otrosDescuentos: string; totalDescuento: string;
  essalud: string; essaludVida: string; totalAporte: string; netoPago: string; costoTotal: string;
  cuentaContable: string | null; cuentaContableOrigen: string | null;
};
export type AdelantoOficina = {
  id: string; empleadoId: string; fecha: string; montoTotal: string; numCuotas: number;
  motivo: string | null; estado: 'vigente' | 'cancelado'; montoCuota: number; saldoPendiente: number;
};
export type ConfigOficina = {
  pctEssalud: number; pctOnp: number; pctAfpAporte: number; rmv: number; uit: number; topeSeguroAfp: number; horasMesBase: number;
};
