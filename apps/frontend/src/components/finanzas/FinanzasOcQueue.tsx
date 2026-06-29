import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, Loader2, ThumbsUp, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api.js';
import { useAuthStore } from '@/lib/auth-store.js';
import { cn, fmtPEN } from '@/lib/utils.js';
import { invalidateResumen } from '@/lib/invalidate.js';
import { OcPdfPreview } from '@/components/logistica/OcPdfPreview.js';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog.js';

type OcRow = Awaited<ReturnType<typeof api.logistica.listOcs>>['ordenes'][number];

export function FinanzasOcQueue({ proyectoId }: { proyectoId: string }) {
  const qc = useQueryClient();
  const [verId, setVerId] = useState<string | null>(null);
  const [pagarOc, setPagarOc] = useState<OcRow | null>(null);
  const [aprobarOc, setAprobarOc] = useState<OcRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['fin-oc-queue', proyectoId],
    queryFn: () => api.logistica.listOcs(proyectoId && proyectoId !== 'todos' ? { proyectoId } : undefined),
  });
  const ordenes = data?.ordenes ?? [];

  const porAprobar = useMemo(() => ordenes.filter((o) => o.estado === 'pendiente_aprobacion'), [ordenes]);
  const porPagar = useMemo(
    () => ordenes.filter((o) => ['aprobada', 'emitida', 'en_transito', 'entregada'].includes(o.estado) && o.estadoPago !== 'pagada'),
    [ordenes],
  );
  const pagadas = useMemo(() => ordenes.filter((o) => o.estadoPago === 'pagada'), [ordenes]);

  const aprobar = useMutation({
    mutationFn: (id: string) => api.logistica.aprobarOc(id, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fin-oc-queue'] }); qc.invalidateQueries({ queryKey: ['logistica-ocs'] }); invalidateResumen(qc); },
  });

  if (isLoading) return <div className="text-center py-10 text-[12px] text-ink-3">Cargando órdenes...</div>;

  return (
    <div className="space-y-5">
      <p className="text-[11.5px] text-ink-4">Finanzas aprueba la OC (genera el PDF oficial) y registra el pago (sube comprobante → caja). Hoy sin rol: cualquiera puede; se gateará al definir roles.</p>

      {/* Por aprobar */}
      <Section title="Por aprobar" count={porAprobar.length} tone="amber">
        {porAprobar.length === 0 ? <Empty msg="Sin OC pendientes de aprobación" /> : (
          <Tabla rows={porAprobar} onVer={setVerId} accion={(o) => (
            <button onClick={() => setAprobarOc(o)} disabled={aprobar.isPending}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-emerald-600 text-white text-[11px] font-medium hover:opacity-90 disabled:opacity-50">
              {aprobar.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3" />} Aprobar
            </button>
          )} />
        )}
      </Section>

      {/* Por pagar */}
      <Section title="Por pagar" count={porPagar.length} tone="info">
        {porPagar.length === 0 ? <Empty msg="Sin OC aprobadas pendientes de pago" /> : (
          <Tabla rows={porPagar} onVer={setVerId} accion={(o) => (
            <button onClick={() => setPagarOc(o)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90">
              <Wallet className="h-3 w-3" /> Pagar
            </button>
          )} />
        )}
      </Section>

      {/* Pagadas (compacto) */}
      {pagadas.length > 0 && (
        <Section title="Pagadas" count={pagadas.length} tone="ok">
          <Tabla rows={pagadas} onVer={setVerId} accion={() => (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> pagada</span>
          )} />
        </Section>
      )}

      <ConfirmDialog
        open={!!aprobarOc}
        title={`Aprobar ${aprobarOc?.numero ?? ''}?`}
        message="Se generará el PDF oficial y se guardará en el NAS (carpeta de la obra)."
        confirmLabel="Aprobar"
        loading={aprobar.isPending}
        onCancel={() => setAprobarOc(null)}
        onConfirm={() => aprobarOc && aprobar.mutate(aprobarOc.id, { onSuccess: () => setAprobarOc(null) })}
      />

      {verId && <OcPdfPreview ocId={verId} onClose={() => setVerId(null)} />}
      {pagarOc && <PagarModal oc={pagarOc} onClose={() => setPagarOc(null)} onDone={() => { setPagarOc(null); qc.invalidateQueries({ queryKey: ['fin-oc-queue'] }); invalidateResumen(qc); qc.invalidateQueries({ queryKey: ['gas-global'] }); }} />}
    </div>
  );
}

function Tabla({ rows, onVer, accion }: { rows: OcRow[]; onVer: (id: string) => void; accion: (o: OcRow) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead><tr className="border-b border-line bg-bg-sunken">{['Nº OC', 'Proveedor', 'Obra', 'Total', 'Cotiz.', ''].map((h, i) => <th key={i} className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4', i === 3 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="border-b border-line hover:bg-bg-sunken/30">
              <td className="px-3 py-1.5 font-mono text-[11px] text-primary font-semibold">{o.numero}{o.concepto === 'SERVICIO' && <span className="ml-1 text-[9px] text-ink-4">OS</span>}</td>
              <td className="px-3 py-1.5 text-[11.5px] max-w-[180px] truncate">{o.proveedor?.razonSocial ?? '—'}</td>
              <td className="px-3 py-1.5 font-mono text-[10.5px] text-ink-3">{o.proyecto?.codigo ?? 'Oficina'}</td>
              <td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums font-semibold">{fmtPEN(Number(o.total))}</td>
              <td className="px-3 py-1.5">{o.cotizacionNasPath ? <span className="text-[10px] text-emerald-600">✓</span> : <span className="text-[10px] text-ink-4">—</span>}</td>
              <td className="px-3 py-1.5">
                <div className="flex items-center justify-end gap-1.5">
                  <button onClick={() => onVer(o.id)} className="h-7 w-7 rounded inline-flex items-center justify-center text-ink-3 hover:text-primary hover:bg-bg-sunken" title="Ver OC + docs"><Eye className="h-3.5 w-3.5" /></button>
                  {accion(o)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PagarModal({ oc, onClose, onDone }: { oc: OcRow; onClose: () => void; onDone: () => void }) {
  const email = useAuthStore((s) => s.user?.email ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [cuentaId, setCuentaId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cuentasQ = useQuery({ queryKey: ['cuentas'], queryFn: () => api.finanzas.listCuentas(), staleTime: 5 * 60 * 1000 });
  const cuentas = cuentasQ.data?.cuentas ?? [];
  const pagar = useMutation({
    mutationFn: () => api.logistica.pagarOc(oc.id, file!, { pagadoPorEmail: email, fechaPago: fecha, cuentaId }),
    onSuccess: onDone,
    onError: (e: Error) => setErr(e.message),
  });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-6" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl border border-line bg-bg-elev p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-semibold mb-1">Registrar pago · {oc.numero}</h3>
        <p className="text-[11.5px] text-ink-3 mb-3">{oc.proveedor?.razonSocial} · {fmtPEN(Number(oc.montoNetoPagar ?? oc.total))}</p>
        <div className="space-y-3">
          <label className="block">
            <span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">Comprobante de pago (captura/PDF) *</span>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-[11.5px] text-ink-3 file:mr-3 file:h-8 file:rounded-md file:border-0 file:bg-primary file:px-3 file:text-[11.5px] file:font-medium file:text-primary-foreground hover:file:opacity-90" />
          </label>
          <label className="block">
            <span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">Fecha de pago</span>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full" />
          </label>
          <label className="block">
            <span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">Cuenta de origen *</span>
            <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full">
              <option value="">— elegir cuenta —</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.descripcion ?? c.codigo}{c.banco ? ` · ${c.banco}` : ''}</option>)}
            </select>
          </label>
          <p className="text-[10.5px] text-ink-4">Al guardar: comprobante → NAS · OC pagada · gasto en Fact de Compras · y <span className="text-ink-3 font-medium">movimiento de caja (Egreso) en la cuenta elegida</span>.</p>
          {err && <div className="text-[11px] text-destructive">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={!file || !cuentaId || pagar.isPending} onClick={() => pagar.mutate()} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
              {pagar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />} Registrar pago
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Section({ title, count, tone, children }: { title: string; count: number; tone: 'amber' | 'info' | 'ok'; children: React.ReactNode }) {
  const dot = tone === 'amber' ? 'bg-amber-500' : tone === 'ok' ? 'bg-emerald-500' : 'bg-primary';
  return (
    <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className={cn('h-2 w-2 rounded-full', dot)} />
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <span className="text-[11px] text-ink-4">{count}</span>
      </div>
      <div className="p-1">{children}</div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="text-center py-6 text-[11.5px] text-ink-3">{msg}</div>;
}
