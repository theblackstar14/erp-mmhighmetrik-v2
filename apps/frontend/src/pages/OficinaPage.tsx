import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Fingerprint, Pencil, Plus, Receipt, Trash2, UserCog, Users, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog.js';
import { EmittingOverlay } from '@/components/ui/EmittingOverlay.js';
import { TabFade } from '@/components/ui/Skeleton.js';
import { type EmpleadoInput, type Profesional, type ProfesionalInput, type Rendicion, type RendicionItemInput, api } from '@/lib/api.js';
import { useAuthStore } from '@/lib/auth-store.js';
import { cn, fmtDate, fmtPEN } from '@/lib/utils.js';

const TIPOS = [
  { v: 'viatico', l: 'Viático' }, { v: 'movilidad', l: 'Movilidad' }, { v: 'utiles', l: 'Útiles' },
  { v: 'servicio', l: 'Servicio' }, { v: 'compra_menor', l: 'Compra menor' }, { v: 'otro', l: 'Otro' },
];
const COMPROB = [
  { v: 'factura', l: 'Factura' }, { v: 'boleta', l: 'Boleta' }, { v: 'rh', l: 'RH (4ta)' }, { v: 'recibo', l: 'Recibo interno' },
] as const;
const CAT_ITEM = ['alimentacion', 'movilidad', 'hospedaje', 'utiles', 'otro'];
const ESTADO: Record<string, { l: string; cls: string }> = {
  borrador: { l: 'Borrador', cls: 'bg-bg-sunken text-ink-3' },
  pendiente: { l: 'Pendiente', cls: 'bg-amber-500/15 text-amber-600' },
  aprobado: { l: 'Aprobado (anticipo)', cls: 'bg-blue-500/15 text-blue-600' },
  rendido: { l: 'Rendido', cls: 'bg-indigo-500/15 text-indigo-600' },
  cerrado: { l: 'Cerrado', cls: 'bg-emerald-500/15 text-emerald-600' },
  rechazado: { l: 'Rechazado', cls: 'bg-rose-500/15 text-rose-600' },
};
const inputCls = 'h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] min-w-0';
const TABS = [
  { id: 'rendiciones', lbl: 'Rendiciones', icon: Receipt },
  { id: 'profesionales', lbl: 'Profesionales', icon: UserCog },
  { id: 'personal', lbl: 'Personal admin', icon: Users },
  { id: 'asistencia', lbl: 'Asistencia', icon: Fingerprint },
] as const;

export function OficinaPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('rendiciones');
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Oficina</h1>
        <p className="text-[13px] text-ink-3 mt-0.5">Rendiciones y viáticos · personal administrativo · asistencia</p>
      </header>
      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium border-b-2 -mb-px transition-colors', tab === t.id ? 'border-primary text-primary' : 'border-transparent text-ink-3 hover:text-ink-2')}>
            <t.icon className="h-3.5 w-3.5" /> {t.lbl}
          </button>
        ))}
      </div>
      <TabFade tabKey={tab}>
        {tab === 'rendiciones' && <RendicionesTab />}
        {tab === 'profesionales' && <ProfesionalesTab />}
        {tab === 'personal' && <PersonalAdminTab />}
        {tab === 'asistencia' && <AsistenciaHuella />}
      </TabFade>
    </div>
  );
}

// ─── Rendiciones ─────────────────────────────────────────────
function RendicionesTab() {
  const user = useAuthStore((s) => s.user);
  const puedeAprobar = useAuthStore((s) => s.can)('oficina', 'edicion');
  const [scope, setScope] = useState<'mias' | 'aprobar' | 'todas'>('todas');
  const [nueva, setNueva] = useState(false);
  const [detId, setDetId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['rendiciones', scope], queryFn: () => api.oficina.listRendiciones(scope) });
  const rends = q.data?.rendiciones ?? [];

  const monto = (r: Rendicion) => (r.modo === 'anticipo' && r.estado !== 'cerrado' ? Number(r.montoAnticipo) : Number(r.montoRendido));
  const scopes = [{ v: 'todas', l: 'Todas' }, { v: 'mias', l: 'Mías' }, ...(puedeAprobar ? [{ v: 'aprobar', l: 'Por aprobar' }] : [])] as const;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {scopes.map((s) => <button key={s.v} onClick={() => setScope(s.v as typeof scope)} className={cn('h-8 px-3 rounded-md text-[11.5px] border', scope === s.v ? 'bg-primary text-primary-foreground border-primary' : 'border-line text-ink-2')}>{s.l}</button>)}
        </div>
        {scope === 'aprobar' && <span className="text-[11px] text-ink-4">{rends.length} esperando acción</span>}
        <button onClick={() => setNueva(true)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium ml-auto"><Plus className="h-3.5 w-3.5" /> Nueva rendición</button>
      </div>

      <div className="rounded-md border border-line bg-bg-elev overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-line bg-bg-sunken">{['Código', 'Solicitante', 'Tipo', 'Modo', 'Fecha', 'Obra', 'Monto', 'Estado'].map((h, i) => <th key={i} className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4', i === 6 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
          <tbody>
            {rends.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[12px] text-ink-3">Sin rendiciones</td></tr>
            ) : rends.map((r) => (
              <tr key={r.id} onClick={() => setDetId(r.id)} className="border-b border-line cursor-pointer hover:bg-bg-sunken/40">
                <td className="px-3 py-2 font-mono text-[11px]">{r.codigo}</td>
                <td className="px-3 py-2 text-[12px]">{r.solicitanteNombre}</td>
                <td className="px-3 py-2 text-[11.5px] text-ink-2">{TIPOS.find((t) => t.v === r.tipo)?.l ?? r.tipo}</td>
                <td className="px-3 py-2 text-[11px] text-ink-3">{r.modo === 'anticipo' ? 'Anticipo' : 'Reembolso'}</td>
                <td className="px-3 py-2 text-[11px] text-ink-3">{fmtDate(r.fecha)}</td>
                <td className="px-3 py-2 text-[11px] text-ink-3">{r.proyectoCodigo ?? '— oficina'}</td>
                <td className="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums">{fmtPEN(monto(r))}</td>
                <td className="px-3 py-2"><span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', ESTADO[r.estado]?.cls)}>{ESTADO[r.estado]?.l}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nueva && <NuevaRendicion onClose={() => setNueva(false)} onCreated={(id) => { q.refetch(); setNueva(false); setDetId(id); }} />}
      {detId && <RendicionDetalle id={detId} puedeAprobar={puedeAprobar} esMio={(r) => r.solicitanteUserId === user?.id} onClose={() => setDetId(null)} onChanged={() => q.refetch()} />}
    </div>
  );
}

function NuevaRendicion({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const proyQ = useQuery({ queryKey: ['proyectos-list'], queryFn: () => api.proyectos.list() });
  const cuentasQ = useQuery({ queryKey: ['cuentas'], queryFn: () => api.finanzas.listCuentas() });
  const hoy = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ modo: 'reembolso' as 'reembolso' | 'anticipo', tipo: 'viatico', concepto: '', fecha: hoy, proyectoId: '', cuentaId: '', montoAnticipo: 0 });
  const create = useMutation({
    mutationFn: () => api.oficina.crearRendicion({ ...f, proyectoId: f.proyectoId || null, cuentaId: f.cuentaId || null }),
    onSuccess: (r) => onCreated(r.rendicion.id),
  });
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn" onClick={onClose}>
      <div className="w-[460px] rounded-xl border border-line bg-bg-elev shadow-2xl animate-modalPop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3"><h3 className="text-[14px] font-semibold">Nueva rendición</h3><button onClick={onClose} className="text-ink-4 hover:text-ink-2"><X className="h-4 w-4" /></button></div>
        <div className="p-4 space-y-3">
          <div className="flex gap-1.5">
            {(['reembolso', 'anticipo'] as const).map((m) => <button key={m} onClick={() => set({ modo: m })} className={cn('flex-1 h-9 rounded-md text-[12px] font-medium border', f.modo === m ? 'bg-primary text-primary-foreground border-primary' : 'border-line text-ink-2')}>{m === 'reembolso' ? 'Reembolso' : 'Anticipo'}</button>)}
          </div>
          <p className="text-[11px] text-ink-4">{f.modo === 'reembolso' ? 'Ya gastaste · subes comprobantes y te reembolsan al aprobar.' : 'Se entrega el dinero por adelantado · luego rindes con comprobantes.'}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <Lbl t="Tipo"><select className={cn(inputCls, 'w-full')} value={f.tipo} onChange={(e) => set({ tipo: e.target.value })}>{TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select></Lbl>
            <Lbl t="Fecha"><input type="date" className={cn(inputCls, 'w-full')} value={f.fecha} onChange={(e) => set({ fecha: e.target.value })} /></Lbl>
            <Lbl t="Obra (opcional)"><select className={cn(inputCls, 'w-full')} value={f.proyectoId} onChange={(e) => set({ proyectoId: e.target.value })}><option value="">— oficina —</option>{(proyQ.data?.proyectos ?? []).map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}</select></Lbl>
            <Lbl t="Cuenta/caja"><select className={cn(inputCls, 'w-full')} value={f.cuentaId} onChange={(e) => set({ cuentaId: e.target.value })}><option value="">— elegir —</option>{(cuentasQ.data?.cuentas ?? []).map((c) => <option key={c.id} value={c.id}>{c.descripcion ?? c.codigo}</option>)}</select></Lbl>
            {f.modo === 'anticipo' && <Lbl t="Monto anticipo S/"><input type="number" step="0.01" className={cn(inputCls, 'w-full')} value={f.montoAnticipo || ''} onChange={(e) => set({ montoAnticipo: Number(e.target.value) })} /></Lbl>}
            <Lbl t="Concepto" span2={f.modo === 'reembolso'}><input className={cn(inputCls, 'w-full')} placeholder="ej. Viaje a obra San Martín" value={f.concepto} onChange={(e) => set({ concepto: e.target.value })} /></Lbl>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] text-ink-2">Cancelar</button>
          <button disabled={create.isPending || (f.modo === 'anticipo' && f.montoAnticipo <= 0)} onClick={() => create.mutate()} className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50">Crear</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RendicionDetalle({ id, puedeAprobar, esMio, onClose, onChanged }: { id: string; puedeAprobar: boolean; esMio: (r: Rendicion) => boolean; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rendicion', id], queryFn: () => api.oficina.getRendicion(id) });
  const [emit, setEmit] = useState<null | { done: boolean; titulo: string }>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['rendicion', id] }); onChanged(); };
  const accion = useMutation({
    mutationFn: (a: { accion: 'enviar' | 'aprobar' | 'rechazar' | 'rendir' | 'cerrar'; body?: Record<string, unknown> }) => api.oficina.accion(id, a.accion, a.body),
    onSuccess: refresh,
  });
  const doEmit = (accionName: 'aprobar' | 'cerrar', titulo: string) => {
    setEmit({ done: false, titulo });
    accion.mutateAsync({ accion: accionName }).then(() => { setEmit({ done: true, titulo: 'Listo' }); setTimeout(() => setEmit(null), 1200); }).catch(() => setEmit(null));
  };

  if (!q.data) return null;
  const { rendicion: r, items } = q.data;
  const mio = esMio(r);
  // ítems editables antes de reconocer el gasto
  const itemsEditables = (r.modo === 'reembolso' && r.estado === 'borrador') || (r.modo === 'anticipo' && r.estado === 'aprobado');
  const saldo = Number(r.montoAnticipo) - Number(r.montoRendido);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn" onClick={onClose}>
      <div className="w-[640px] max-h-[92vh] overflow-auto rounded-xl border border-line bg-bg-elev shadow-2xl animate-modalPop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <div className="flex items-center gap-2"><h3 className="text-[14px] font-semibold font-mono">{r.codigo}</h3><span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', ESTADO[r.estado]?.cls)}>{ESTADO[r.estado]?.l}</span></div>
            <div className="text-[11px] text-ink-3">{r.solicitanteNombre} · {r.modo === 'anticipo' ? 'Anticipo' : 'Reembolso'} · {TIPOS.find((t) => t.v === r.tipo)?.l}</div>
          </div>
          <button onClick={onClose} className="text-ink-4 hover:text-ink-2"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-3 gap-2.5 text-[11.5px]">
            <Info t="Fecha" v={fmtDate(r.fecha)} />
            <Info t="Obra" v={r.proyectoCodigo ?? 'Oficina'} />
            <Info t="Cuenta" v={r.cuentaNombre ?? '—'} />
            {r.modo === 'anticipo' && <Info t="Anticipo" v={fmtPEN(Number(r.montoAnticipo))} />}
            <Info t="Rendido" v={fmtPEN(Number(r.montoRendido))} />
            {r.modo === 'anticipo' && r.estado !== 'borrador' && <Info t="Saldo" v={`${saldo >= 0 ? 'Devuelve ' : 'Reembolso '}${fmtPEN(Math.abs(saldo))}`} accent={saldo < 0} />}
          </div>
          {r.concepto && <p className="text-[12px] text-ink-2">{r.concepto}</p>}
          {r.motivoRechazo && <p className="rounded bg-rose-500/10 px-2.5 py-1.5 text-[11.5px] text-rose-600">Rechazado: {r.motivoRechazo}</p>}

          {/* Comprobantes */}
          <div className="rounded-md border border-line">
            <div className="flex items-center justify-between border-b border-line px-3 py-2"><span className="text-[12px] font-semibold">Comprobantes</span><span className="text-[11px] text-ink-4">{items.length}</span></div>
            <table className="w-full">
              <tbody>
                {items.length === 0 ? <tr><td className="px-3 py-3 text-center text-[11px] text-ink-4">Sin comprobantes</td></tr> : items.map((it) => (
                  <tr key={it.id} className="border-b border-line last:border-0 text-[11px]">
                    <td className="px-3 py-1.5"><span className="font-medium">{COMPROB.find((c) => c.v === it.tipoComprobante)?.l}</span> <span className="text-ink-4 font-mono">{it.serie}-{it.numero}</span></td>
                    <td className="px-2 py-1.5 text-ink-3">{it.razon ?? it.ruc ?? ''}</td>
                    <td className="px-2 py-1.5 text-ink-3">{it.categoria}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtPEN(Number(it.total))}</td>
                    <td className="px-2 py-1.5">{it.deducible ? <span className="text-[9px] text-emerald-600">deduc.</span> : <span className="text-[9px] text-ink-4">no deduc.</span>}</td>
                    {itemsEditables && <td className="px-2 py-1.5"><button onClick={() => api.oficina.deleteItem(it.id).then(refresh)} className="text-ink-4 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {itemsEditables && <ItemForm rendId={id} onAdded={refresh} />}
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {mio && r.estado === 'borrador' && <>
              <button onClick={() => api.oficina.deleteRendicion(id).then(() => { onChanged(); onClose(); })} className="h-8 px-3 rounded-md border border-line text-[12px] text-rose-500">Eliminar</button>
              <button onClick={() => accion.mutate({ accion: 'enviar' })} className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium">Enviar a aprobación</button>
            </>}
            {puedeAprobar && r.estado === 'pendiente' && <>
              <button onClick={() => { const m = prompt('Motivo del rechazo:'); if (m != null) accion.mutate({ accion: 'rechazar', body: { motivo: m } }); }} className="h-8 px-3 rounded-md border border-line text-[12px] text-rose-500">Rechazar</button>
              <button onClick={() => doEmit('aprobar', r.modo === 'reembolso' ? 'Aprobando reembolso…' : 'Entregando anticipo…')} className="h-8 px-4 rounded-md bg-emerald-600 text-white text-[12px] font-medium inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5" /> Aprobar</button>
            </>}
            {mio && r.modo === 'anticipo' && r.estado === 'aprobado' && <button onClick={() => accion.mutate({ accion: 'rendir' })} disabled={items.length === 0} className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50">Enviar rendición</button>}
            {puedeAprobar && r.estado === 'rendido' && <button onClick={() => doEmit('cerrar', 'Cerrando rendición…')} className="h-8 px-4 rounded-md bg-emerald-600 text-white text-[12px] font-medium inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5" /> Cerrar y cuadrar</button>}
          </div>
        </div>
      </div>
      {emit && <EmittingOverlay done={emit.done} titulo={emit.done ? 'Listo' : emit.titulo} refLabel={r.codigo ?? undefined} />}
    </div>,
    document.body,
  );
}

function ItemForm({ rendId, onAdded }: { rendId: string; onAdded: () => void }) {
  const empty: RendicionItemInput = { tipoComprobante: 'boleta', serie: '', numero: '', ruc: '', razon: '', categoria: 'alimentacion', subtotal: 0, igv: 0, total: 0, deducible: true };
  const [f, setF] = useState<RendicionItemInput>(empty);
  const add = useMutation({ mutationFn: () => api.oficina.addItem(rendId, f), onSuccess: () => { setF(empty); onAdded(); } });
  // calc IGV/deducible según comprobante
  const onTotal = (total: number, tipo = f.tipoComprobante) => {
    if (tipo === 'factura') { const sub = +(total / 1.18).toFixed(2); setF((s) => ({ ...s, total, subtotal: sub, igv: +(total - sub).toFixed(2), deducible: true })); }
    else setF((s) => ({ ...s, total, subtotal: total, igv: 0, deducible: tipo !== 'recibo' }));
  };
  const onTipo = (tipo: RendicionItemInput['tipoComprobante']) => { setF((s) => ({ ...s, tipoComprobante: tipo })); onTotal(f.total, tipo); };
  return (
    <div className="border-t border-line bg-bg-sunken/30 p-2.5 flex flex-wrap items-end gap-1.5">
      <select className={cn(inputCls, 'w-24')} value={f.tipoComprobante} onChange={(e) => onTipo(e.target.value as RendicionItemInput['tipoComprobante'])}>{COMPROB.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}</select>
      <input className={cn(inputCls, 'w-16')} placeholder="serie" value={f.serie ?? ''} onChange={(e) => setF({ ...f, serie: e.target.value })} />
      <input className={cn(inputCls, 'w-20')} placeholder="número" value={f.numero ?? ''} onChange={(e) => setF({ ...f, numero: e.target.value })} />
      <input className={cn(inputCls, 'w-24')} placeholder="RUC" value={f.ruc ?? ''} onChange={(e) => setF({ ...f, ruc: e.target.value })} />
      <input className={cn(inputCls, 'flex-1 min-w-[100px]')} placeholder="razón / detalle" value={f.razon ?? ''} onChange={(e) => setF({ ...f, razon: e.target.value })} />
      <select className={cn(inputCls, 'w-28')} value={f.categoria ?? ''} onChange={(e) => setF({ ...f, categoria: e.target.value })}>{CAT_ITEM.map((c) => <option key={c} value={c}>{c}</option>)}</select>
      <input className={cn(inputCls, 'w-24 text-right')} type="number" step="0.01" placeholder="total S/" value={f.total || ''} onChange={(e) => onTotal(Number(e.target.value))} />
      <label className="flex items-center gap-1 text-[10.5px] text-ink-3"><input type="checkbox" checked={f.deducible} onChange={(e) => setF({ ...f, deducible: e.target.checked })} /> deducible</label>
      <button disabled={!f.total || add.isPending} onClick={() => add.mutate()} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium disabled:opacity-50">+ Comprobante</button>
    </div>
  );
}

// ─── Profesionales · padrón de staff técnico (pool del equipo de obra) ──
function ProfesionalesTab() {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Profesional | 'new' | null>(null);
  const [delP, setDelP] = useState<Profesional | null>(null);
  const q = useQuery({ queryKey: ['profesionales'], queryFn: () => api.profesionales.list() });
  const list = q.data?.profesionales ?? [];
  const inval = () => qc.invalidateQueries({ queryKey: ['profesionales'] });
  const del = useMutation({ mutationFn: (id: string) => api.profesionales.remove(id), onSuccess: () => { inval(); setDelP(null); } });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-ink-3">Padrón de profesionales (sin login). Se asignan al <b>Equipo profesional</b> de cada obra.</p>
        <button onClick={() => setEdit('new')} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 shrink-0"><Plus className="h-3.5 w-3.5" /> Nuevo</button>
      </div>
      {list.length === 0 ? (
        <div className="rounded-md border border-line bg-bg-elev p-8 text-center text-[12px] text-ink-3">Sin profesionales · agrega el primero</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-bg-elev">
          <table className="w-full">
            <thead><tr className="border-b border-line bg-bg-sunken">{['Nombre', 'Profesión', 'Colegiatura', 'DNI', 'Teléfono', 'Cargo sugerido', '', ''].map((h, i) => <th key={i} className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-ink-4">{h}</th>)}</tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-b border-line/60 hover:bg-bg-sunken/40">
                  <td className="px-3 py-1.5 text-[12px] font-medium">{p.nombre}</td>
                  <td className="px-3 py-1.5 text-[11.5px] text-ink-3">{p.profesion ?? '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-ink-3">{p.colegiatura ?? '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-ink-3">{p.dni ?? '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-ink-3">{p.telefono ?? '—'}</td>
                  <td className="px-3 py-1.5 text-[11.5px] text-ink-3">{p.cargoDefault ?? '—'}</td>
                  <td className="px-3 py-1.5"><button onClick={() => setEdit(p)} className="text-ink-4 hover:text-primary" title="Editar"><Pencil className="h-3.5 w-3.5" /></button></td>
                  <td className="px-3 py-1.5"><button onClick={() => setDelP(p)} className="text-ink-4 hover:text-rose-500" title="Quitar del padrón"><Trash2 className="h-3.5 w-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <ProfesionalForm prof={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { inval(); setEdit(null); }} />}
      <ConfirmDialog open={!!delP} title={`¿Quitar a ${delP?.nombre ?? ''} del padrón?`} message="Se desactiva del padrón. Las obras donde ya esté asignado lo conservan." tone="danger" confirmLabel="Quitar" loading={del.isPending} onCancel={() => setDelP(null)} onConfirm={() => delP && del.mutate(delP.id)} />
    </div>
  );
}

function ProfesionalForm({ prof, onClose, onSaved }: { prof: Profesional | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<ProfesionalInput>({ nombre: prof?.nombre ?? '', profesion: prof?.profesion ?? '', colegiatura: prof?.colegiatura ?? '', dni: prof?.dni ?? '', telefono: prof?.telefono ?? '', email: prof?.email ?? '', cargoDefault: prof?.cargoDefault ?? '' });
  const [err, setErr] = useState('');
  const save = useMutation({ mutationFn: () => (prof ? api.profesionales.update(prof.id, f) : api.profesionales.create(f)), onSuccess: onSaved, onError: (e: Error) => setErr(e.message) });
  const set = (k: keyof ProfesionalInput) => (v: string) => setF({ ...f, [k]: v });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-xl border border-line bg-bg-elev p-5 shadow-xl animate-modalPop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-[14px] font-semibold">{prof ? 'Editar profesional' : 'Nuevo profesional'}</h3><button onClick={onClose} className="text-ink-4 hover:text-ink-2"><X className="h-4 w-4" /></button></div>
        <div className="space-y-2.5">
          <PField label="Nombre *" v={f.nombre} on={set('nombre')} />
          <div className="grid grid-cols-2 gap-2.5">
            <PField label="Profesión" v={f.profesion ?? ''} on={set('profesion')} ph="Ingeniero Civil" />
            <PField label="Colegiatura (CIP)" v={f.colegiatura ?? ''} on={set('colegiatura')} />
            <PField label="DNI" v={f.dni ?? ''} on={set('dni')} />
            <PField label="Teléfono" v={f.telefono ?? ''} on={set('telefono')} />
          </div>
          <PField label="Email" v={f.email ?? ''} on={set('email')} />
          <PField label="Cargo sugerido" v={f.cargoDefault ?? ''} on={set('cargoDefault')} ph="Residente / Supervisor…" />
          {err && <div className="text-[11px] text-destructive">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={!f.nombre.trim() || save.isPending} onClick={() => save.mutate()} className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50">{save.isPending ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PField({ label, v, on, ph }: { label: string; v: string; on: (v: string) => void; ph?: string }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] font-mono uppercase tracking-wider text-ink-4 mb-1">{label}</span>
      <input value={v} onChange={(e) => on(e.target.value)} placeholder={ph} className="h-8 w-full px-2 rounded-md border border-line bg-bg-elev text-[12px]" />
    </label>
  );
}

// ─── Personal admin (roster ligero) ──────────────────────────
function PersonalAdminTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['empleados', 'admin'], queryFn: () => api.planilla.listEmpleados('admin') });
  const [add, setAdd] = useState(false);
  const empleados = q.data?.empleados ?? [];
  const del = useMutation({ mutationFn: (id: string) => api.planilla.deleteEmpleado(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['empleados', 'admin'] }) });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-ink-3">Administrativos (régimen general · sueldo mensual). Planilla mensual: próximamente.</p>
        <button onClick={() => setAdd(true)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium"><Plus className="h-3.5 w-3.5" /> Administrativo</button>
      </div>
      {empleados.length === 0 ? (
        <div className="rounded-md border border-line bg-bg-elev p-8 text-center text-[12px] text-ink-3">Sin administrativos</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {empleados.map((e) => (
            <div key={e.id} className="rounded-md border border-line bg-bg-elev p-3 border-l-[3px] border-l-primary">
              <div className="flex items-start justify-between">
                <div><div className="text-[13px] font-semibold">{e.nombre}</div><div className="font-mono text-[10.5px] text-ink-4">DNI {e.numDoc ?? '—'}</div></div>
                <button onClick={() => del.mutate(e.id)} className="text-ink-4 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary font-medium">{e.categoria ?? 'Empleado'}</span>
                <span className="rounded bg-bg-sunken px-1.5 py-0.5 text-ink-3">{e.sistemaPension ?? '—'}</span>
              </div>
              <div className="mt-2 text-[10.5px] text-ink-4">Ingreso {fmtDate(e.fechaIngreso)}</div>
            </div>
          ))}
        </div>
      )}
      {add && <AdminForm onClose={() => setAdd(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['empleados', 'admin'] }); setAdd(false); }} />}
    </div>
  );
}
function AdminForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<EmpleadoInput>({ nombre: '', numDoc: '', categoria: 'Administrador', sistemaPension: 'S.N.P.', fechaIngreso: '', tipoPlanilla: 'admin' });
  const save = useMutation({ mutationFn: () => api.planilla.createEmpleado(f), onSuccess: onSaved });
  const set = (p: Partial<EmpleadoInput>) => setF((s) => ({ ...s, ...p }));
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn" onClick={onClose}>
      <div className="w-[420px] rounded-xl border border-line bg-bg-elev shadow-2xl animate-modalPop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3"><h3 className="text-[14px] font-semibold">Nuevo administrativo</h3><button onClick={onClose} className="text-ink-4 hover:text-ink-2"><X className="h-4 w-4" /></button></div>
        <div className="p-4 grid grid-cols-2 gap-2.5">
          <Lbl t="Nombre" span2><input className={cn(inputCls, 'w-full')} value={f.nombre} onChange={(e) => set({ nombre: e.target.value })} /></Lbl>
          <Lbl t="DNI"><input className={cn(inputCls, 'w-full')} value={f.numDoc ?? ''} onChange={(e) => set({ numDoc: e.target.value })} /></Lbl>
          <Lbl t="Cargo"><input className={cn(inputCls, 'w-full')} value={f.categoria ?? ''} onChange={(e) => set({ categoria: e.target.value })} placeholder="Contador, Ingeniero…" /></Lbl>
          <Lbl t="Sistema pensión"><select className={cn(inputCls, 'w-full')} value={f.sistemaPension ?? ''} onChange={(e) => set({ sistemaPension: e.target.value })}>{['S.N.P.', 'AFP Habitat', 'AFP Integra', 'AFP Prima', 'AFP Profuturo'].map((a) => <option key={a}>{a}</option>)}</select></Lbl>
          <Lbl t="Fecha ingreso"><input type="date" className={cn(inputCls, 'w-full')} value={f.fechaIngreso ?? ''} onChange={(e) => set({ fechaIngreso: e.target.value })} /></Lbl>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] text-ink-2">Cancelar</button>
          <button disabled={!f.nombre || save.isPending} onClick={() => save.mutate()} className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50">Guardar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Asistencia por huella (en proceso) ──────────────────────
function AsistenciaHuella() {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-8 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10"><Fingerprint className="h-7 w-7 text-amber-600" /></div>
      <div className="flex items-center justify-center gap-2">
        <h3 className="text-[15px] font-semibold">Asistencia por lector de huellas</h3>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600">⏳ En proceso</span>
      </div>
      <p className="mx-auto mt-2 max-w-md text-[12px] text-ink-3">La marcación de oficina se integrará con el lector biométrico vía endpoint <code className="font-mono text-[11px]">POST /api/asistencia/huella</code>. Pendiente definir el modelo del lector (HTTP / serial). Mientras tanto, marcación manual.</p>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────
function Lbl({ t, span2, children }: { t: string; span2?: boolean; children: React.ReactNode }) {
  return <label className={cn('flex flex-col gap-1', span2 && 'col-span-2')}><span className="text-[10.5px] font-medium text-ink-3">{t}</span>{children}</label>;
}
function Info({ t, v, accent }: { t: string; v: string; accent?: boolean }) {
  return <div className="rounded-md bg-bg-sunken px-2.5 py-1.5"><div className="text-[9.5px] uppercase tracking-wider text-ink-4">{t}</div><div className={cn('font-mono text-[12px] font-medium', accent && 'text-rose-500')}>{v}</div></div>;
}
