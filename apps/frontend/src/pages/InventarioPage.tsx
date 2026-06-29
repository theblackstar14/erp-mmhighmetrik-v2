import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Boxes, Building2, Camera, Loader2, Map as MapIcon, MapPin, Plus, Printer, Radio, ScanLine, Search, Tag, Trash2, Wrench, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import Barcode from 'react-barcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Tooltip as LTooltip } from 'react-leaflet';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import 'leaflet/dist/leaflet.css';
import { InventarioTab } from '@/components/proyectos/tabs/InventarioTab.js';
import { type ActivoFull, type ActivoInput, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';
import { SkelRows, TabFade } from '@/components/ui/Skeleton.js';

type Tab = 'catalogo' | 'movimientos' | 'consumibles' | 'trazabilidad' | 'reportes';

// QR codifica deep-link a la ficha · al escanear con el móvil abre la app en este activo
const activoUrl = (codigo: string) => `${window.location.origin}/inventario?codigo=${encodeURIComponent(codigo)}`;

// Almacén / Oficina · punto fijo en el mapa (Av. Republica de Colombia 625, San Isidro)
const OFICINA = { lat: -12.098005643605848, lng: -77.028225595669 };

// Categorías + % depreciación anual SUNAT por defecto
const CATEGORIAS: { nombre: string; pct: number }[] = [
  { nombre: 'Herramienta manual', pct: 10 },
  { nombre: 'Herramienta eléctrica', pct: 10 },
  { nombre: 'Andamios y encofrado', pct: 10 },
  { nombre: 'Medición', pct: 10 },
  { nombre: 'Equipo eléctrico', pct: 10 },
  { nombre: 'Maquinaria', pct: 10 },
  { nombre: 'Mobiliario', pct: 10 },
  { nombre: 'Cómputo', pct: 25 },
  { nombre: 'Vehículo', pct: 20 },
  { nombre: 'Otro', pct: 10 },
];

const ESTADO_CHIP: Record<string, string> = {
  operativo: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  baja: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  perdido: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

export function InventarioPage() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const deepCodigo = sp.get('codigo') ?? '';
  const [tab, setTab] = useState<Tab>('catalogo');
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [etiquetasOpen, setEtiquetasOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['activos'], queryFn: () => api.activos.list() });
  const stats = data?.stats;
  const pctDepr = stats && stats.valorAdquisicion > 0 ? Math.round((1 - stats.valorNeto / stats.valorAdquisicion) * 100) : 0;

  // si llega ?codigo (escaneo QR o deep-link) asegura el tab Catálogo
  useEffect(() => { if (deepCodigo) setTab('catalogo'); }, [deepCodigo]);

  return (
    <div className="space-y-5">
      {/* Header · estilo mockup */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Inventario de herramientas y equipos</h1>
          <p className="text-[13px] text-ink-3 mt-0.5">Trazabilidad por obra · escaneo QR · cálculo depreciación SUNAT</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setScanOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-line bg-bg-elev text-[12px] text-ink-2 hover:bg-bg-sunken" title="Escanear QR/barcode con cámara, pistola o RFID">
            <ScanLine className="h-3.5 w-3.5" /> Escanear
          </button>
          <button onClick={() => setEtiquetasOpen(true)} disabled={!(stats?.total)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-line bg-bg-elev text-[12px] text-ink-2 hover:bg-bg-sunken disabled:opacity-50" title="Hoja de etiquetas QR para imprimir">
            <Tag className="h-3.5 w-3.5" /> Imprimir etiquetas
          </button>
          <button onClick={() => setNuevoOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90">
            <Plus className="h-3.5 w-3.5" /> Nuevo ítem
          </button>
        </div>
      </header>

      {/* KPIs · banda mockup */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Ítems totales" value={String(stats?.total ?? 0)} tone="info" />
        <Kpi label="Valor adquisición" value={fmtPEN(stats?.valorAdquisicion ?? 0)} tone="ok" />
        <Kpi label="Valor neto depr." value={fmtPEN(stats?.valorNeto ?? 0)} tone="warn2" sub={stats?.total ? `−${pctDepr}% depreciación` : undefined} />
        <Kpi label="En obra" value={`${stats?.enObra ?? 0}/${stats?.operativos ?? 0}`} tone="violet" sub="operativos" />
      </div>

      {/* Tabs · mockup (sin Mantenimiento) */}
      <div className="border-b border-line">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {([
            ['catalogo', 'Catálogo', Wrench],
            ['movimientos', 'Movimientos', ArrowRightLeft],
            ['trazabilidad', 'Trazabilidad', MapIcon],
            ['consumibles', 'Consumibles', Boxes],
            ['reportes', 'Reportes', Tag],
          ] as const).map(([k, l, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn('flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[12.5px] font-medium border-b-2 transition-colors',
                tab === k ? 'border-primary text-primary' : 'border-transparent text-ink-3 hover:text-foreground hover:border-line-strong')}>
              <Icon className="h-3.5 w-3.5" /> {l}
              {k === 'reportes' && <span className="text-[9px] text-ink-4">próx</span>}
            </button>
          ))}
        </nav>
      </div>

      <TabFade tabKey={tab}>
      {tab === 'catalogo' && <ActivosView deepCodigo={deepCodigo} />}
      {tab === 'movimientos' && <MovimientosView />}
      {tab === 'trazabilidad' && <TrazabilidadView activos={data?.activos ?? []} onSelect={(c) => { setSp({ codigo: c }); setTab('catalogo'); }} />}
      {tab === 'consumibles' && <ConsumiblesView />}
      {tab === 'reportes' && (
        <div className="rounded-lg border border-dashed border-line-strong bg-bg-elev p-10 text-center">
          <div className="text-[14px] font-semibold">Reportes de inventario</div>
          <div className="text-[12px] text-ink-3 mt-1">Depreciación anual por categoría · activos por obra · export Excel</div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mt-2">Próximamente</div>
        </div>
      )}
      </TabFade>

      {nuevoOpen && <NuevoActivoModal onClose={() => setNuevoOpen(false)} onDone={() => { qc.invalidateQueries({ queryKey: ['activos'] }); setNuevoOpen(false); }} />}
      {etiquetasOpen && <LabelSheet activos={data?.activos ?? []} onClose={() => setEtiquetasOpen(false)} />}
      {scanOpen && <ScanModal onClose={() => setScanOpen(false)} onResolved={(codigo) => { setScanOpen(false); setSp({ codigo }); setTab('catalogo'); }} />}
    </div>
  );
}

// ─── Escáner · cámara (BarcodeDetector) + pistola HID + manual ──
// resolveScan en el server cubre QR(url) · barcode(código) · RFID(tag).
function ScanModal({ onClose, onResolved }: { onClose: () => void; onResolved: (codigo: string) => void }) {
  const [manual, setManual] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const resolver = async (payload: string) => {
    const p = payload.trim();
    if (!p || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { activo } = await api.activos.scan(p);
      onResolved(activo.codigo);
    } catch {
      setErr(`No encontrado: ${p}`);
      setBusy(false);
    }
  };

  // pistola lectora (HID) y manual escriben aquí + Enter
  useEffect(() => { inputRef.current?.focus(); }, []);

  // cámara · zxing decodifica QR + barcode por canvas (universal · no depende de BarcodeDetector)
  useEffect(() => {
    if (!camOn || !videoRef.current) return;
    let controls: IScannerControls | null = null;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    reader
      .decodeFromVideoDevice(undefined, videoRef.current, (result, _err, ctrl) => {
        controls = ctrl;
        if (cancelled) { ctrl.stop(); return; }
        if (result) { ctrl.stop(); resolver(result.getText()); }
      })
      .catch(() => { setErr('No se pudo abrir la cámara. Usa la pistola o el campo manual.'); setCamOn(false); });
    return () => { cancelled = true; controls?.stop(); };
  }, [camOn]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-xl border border-line bg-bg-elev p-5 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-semibold flex items-center gap-2"><ScanLine className="h-4 w-4" /> Escanear activo</h3>
          <button onClick={onClose} className="h-7 w-7 rounded-md border border-line inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-3.5 w-3.5" /></button>
        </div>

        {/* Cámara */}
        {camOn ? (
          <div className="relative rounded-lg overflow-hidden bg-black aspect-video mb-3">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            <div className="absolute inset-0 border-2 border-primary/60 m-8 rounded-lg pointer-events-none" />
          </div>
        ) : (
          <button onClick={() => setCamOn(true)}
            className="w-full mb-3 inline-flex items-center justify-center gap-2 h-10 rounded-lg border border-line text-[12.5px] text-ink-2 hover:bg-bg-sunken">
            <Camera className="h-4 w-4" /> Abrir cámara
          </button>
        )}

        {/* Pistola HID + manual · mismo input */}
        <label className="block">
          <span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4 flex items-center gap-1"><Radio className="h-3 w-3" /> Pistola lectora / código manual</span>
          <input
            ref={inputRef}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { resolver(manual); setManual(''); } }}
            placeholder="Apunta la pistola o escribe MM-A-0001 + Enter"
            className="mt-1 h-10 px-3 rounded-lg border border-line bg-bg-sunken/60 text-[12.5px] w-full font-mono"
          />
        </label>

        {err && <div className="mt-2 text-[11.5px] text-destructive">{err}</div>}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10.5px] text-ink-4">{busy ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> buscando…</span> : 'QR · barcode · RFID'}</span>
          <button onClick={() => { resolver(manual); setManual(''); }} disabled={!manual || busy} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50">Buscar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Trazabilidad · mapa Leaflet + master-detail (diseño v1) ──
type UbiGrupo = { key: string; nombre: string; tipo: 'almacen' | 'obra'; sub: string; color: string; lat: number | null; lng: number | null; items: ActivoFull[]; valor: number };
function TrazabilidadView({ activos, onSelect }: { activos: ActivoFull[]; onSelect: (codigo: string) => void }) {
  const [selKey, setSelKey] = useState<string | null>(null);

  // Agrupa activos operativos por ubicación física (obra con coords · almacén · obra sin coords)
  const grupos = useMemo(() => {
    const m = new Map<string, UbiGrupo>();
    // Almacén/Oficina · punto base · siempre visible en el mapa aunque tenga 0 ítems
    m.set('almacen', { key: 'almacen', nombre: 'Almacén / Oficina', tipo: 'almacen', sub: 'San Isidro · Lima', color: '#3B5BDB', lat: OFICINA.lat, lng: OFICINA.lng, items: [], valor: 0 });
    for (const a of activos) {
      if (a.estado !== 'operativo') continue;
      let g: UbiGrupo;
      if (a.proyecto) {
        const lat = a.proyecto.lat ? Number(a.proyecto.lat) : null;
        const lng = a.proyecto.lng ? Number(a.proyecto.lng) : null;
        g = m.get(a.proyecto.id) ?? { key: a.proyecto.id, nombre: `Obra ${a.proyecto.codigo}`, tipo: 'obra', sub: a.proyecto.nombre, color: '#F59F00', lat: Number.isFinite(lat as number) ? lat : null, lng: Number.isFinite(lng as number) ? lng : null, items: [], valor: 0 };
      } else {
        g = m.get('almacen') ?? { key: 'almacen', nombre: 'Almacén / Oficina', tipo: 'almacen', sub: 'San Isidro · Lima', color: '#3B5BDB', lat: OFICINA.lat, lng: OFICINA.lng, items: [], valor: 0 };
      }
      g.items.push(a); g.valor += a.valorNeto;
      m.set(g.key, g);
    }
    return [...m.values()].sort((a, b) => b.items.length - a.items.length);
  }, [activos]);

  const conMapa = grupos.filter((g) => g.lat != null && g.lng != null);
  const center: [number, number] = conMapa[0] ? [conMapa[0].lat as number, conMapa[0].lng as number] : [OFICINA.lat, OFICINA.lng];
  const sel = selKey ? grupos.find((g) => g.key === selKey) ?? null : null;

  if (grupos.length === 0) {
    return <div className="rounded-lg border border-dashed border-line-strong bg-bg-elev p-10 text-center text-[12px] text-ink-3">Sin activos operativos. Registra herramientas y asígnalas a una obra o al almacén.</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
      {/* Mapa */}
      <div className="rounded-lg border border-line overflow-hidden" style={{ height: 480 }}>
        <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {conMapa.map((g) => {
            const active = sel?.key === g.key;
            return (
              <CircleMarker key={g.key} center={[g.lat as number, g.lng as number]}
                radius={Math.min(30, 9 + Math.sqrt(g.items.length) * 4) + (active ? 4 : 0)}
                pathOptions={{ color: g.color, fillColor: g.color, fillOpacity: active ? 0.75 : 0.5, weight: active ? 3 : 2 }}
                eventHandlers={{ click: () => setSelKey(g.key) }}>
                <LTooltip><b>{g.nombre}</b> · {g.items.length} ítems</LTooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>

      {/* Panel master-detail (estilo v1) */}
      <div className="rounded-lg border border-line bg-bg-elev self-start overflow-hidden">
        {sel ? (
          // DETALLE · desglose de ítems en la ubicación seleccionada
          <div>
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <button onClick={() => setSelKey(null)} className="h-6 px-2 rounded border border-line text-[11px] text-ink-3 hover:bg-bg-sunken">‹ Todas</button>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold truncate">{sel.nombre}</div>
                <div className="text-[10.5px] text-ink-4 truncate">{sel.sub}</div>
              </div>
            </div>
            <div className="px-3 py-2.5 flex items-center justify-between" style={{ background: `${sel.color}18` }}>
              <span className="text-[11px] text-ink-3">{sel.items.length} ítems</span>
              <span className="text-[12.5px] font-mono font-bold" style={{ color: sel.color }}>{fmtPEN(sel.valor)}</span>
            </div>
            <div className="max-h-[330px] overflow-y-auto divide-y divide-line">
              {sel.items.map((it) => (
                <button key={it.id} onClick={() => onSelect(it.codigo)} className="w-full text-left px-3 py-2 hover:bg-bg-sunken/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10.5px] text-primary font-semibold">{it.codigo}</span>
                    <span className="font-mono text-[10.5px] text-ink-3 tabular-nums">{fmtPEN(it.valorNeto)}</span>
                  </div>
                  <div className="text-[11px] truncate">{it.nombre}</div>
                  <div className="text-[9.5px] text-ink-4">{it.categoria}{it.responsable ? ` · ${it.responsable}` : ''}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          // MASTER · lista de ubicaciones
          <div>
            <div className="border-b border-line px-3 py-2.5 text-[13px] font-semibold">Todas las ubicaciones <span className="text-ink-4 font-normal">({grupos.length})</span></div>
            <div className="max-h-[420px] overflow-y-auto divide-y divide-line">
              {grupos.map((g) => (
                <button key={g.key} onClick={() => setSelKey(g.key)} className="w-full text-left px-3 py-2.5 hover:bg-bg-sunken/40">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: g.color }} />
                      <span className="text-[12.5px] font-semibold truncate">{g.nombre}</span>
                    </div>
                    <span className="text-[11px] font-mono text-ink-3 shrink-0">{g.items.length}</span>
                  </div>
                  <div className="flex items-center justify-between pl-4 mt-0.5">
                    <span className="text-[10.5px] text-ink-4 truncate">{g.sub}{g.lat == null ? ' · sin mapa' : ''}</span>
                    <span className="text-[10.5px] font-mono text-ink-4">{fmtPEN(g.valor)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FX-6 · hoja de etiquetas imprimible · QR / barcode / card ─
type LabelMode = 'qr' | 'barcode' | 'card';
const LABEL_PRINT_CSS = `
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 10mm; }
  .print-hide { display: none !important; }
  .label-overlay { position: static !important; background: white !important; padding: 0 !important; }
  .label-sheet { box-shadow: none !important; margin: 0 !important; max-width: none !important; }
}
.label-cell { break-inside: avoid; page-break-inside: avoid; }
`;
function LabelSheet({ activos, onClose }: { activos: ActivoFull[]; onClose: () => void }) {
  const [mode, setMode] = useState<LabelMode>('qr');
  const cols = mode === 'barcode' ? 2 : 3;
  const title = { qr: 'QR · 9 por hoja', barcode: 'Barcode · 12 por hoja', card: 'Card detallada · 9 por hoja' }[mode];

  return createPortal(
    <div className="label-overlay fixed inset-0 z-50 overflow-y-auto bg-black/40 print:bg-white" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <style>{LABEL_PRINT_CSS}</style>
      <div className="print-hide sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-bg-elev px-4 py-2.5">
        <div className="text-[13px] font-semibold whitespace-nowrap">Etiquetas · {activos.length} activos <span className="text-ink-4 font-normal">· {title}</span></div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-line overflow-hidden text-[11.5px]">
            {(['qr', 'barcode', 'card'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={cn('px-3 h-8 capitalize', mode === m ? 'bg-primary text-primary-foreground' : 'text-ink-2 hover:bg-bg-sunken')}>{m}</button>
            ))}
          </div>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90"><Printer className="h-3.5 w-3.5" /> Imprimir</button>
          <button onClick={onClose} className="h-8 w-8 rounded-md border border-line inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="label-sheet mx-auto my-4 max-w-[820px] bg-white p-4 text-black">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
          {activos.map((a) => (
            <div key={a.id} className="label-cell flex items-center gap-2 rounded border border-zinc-300 p-2">
              {mode === 'qr' && (
                <>
                  <QRCodeSVG value={activoUrl(a.codigo)} size={72} level="M" />
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] font-bold">{a.codigo}</div>
                    <div className="text-[10px] leading-tight line-clamp-2">{a.nombre}</div>
                    <div className="text-[9px] text-zinc-500">{a.categoria}</div>
                  </div>
                </>
              )}
              {mode === 'barcode' && (
                <div className="w-full text-center">
                  <Barcode value={a.codigo} format="CODE128" width={1.5} height={42} fontSize={11} margin={2} />
                  <div className="text-[9px] text-zinc-600 truncate">{a.nombre}</div>
                </div>
              )}
              {mode === 'card' && (
                <div className="w-full">
                  <div className="flex items-start gap-2">
                    <QRCodeSVG value={activoUrl(a.codigo)} size={56} level="M" />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] font-bold">{a.codigo}</div>
                      <div className="text-[10px] leading-tight line-clamp-2 font-medium">{a.nombre}</div>
                      <div className="text-[9px] text-zinc-500">{a.categoria}{a.marca ? ` · ${a.marca}` : ''}</div>
                    </div>
                  </div>
                  <div className="mt-1.5 border-t border-zinc-200 pt-1">
                    <Barcode value={a.codigo} format="CODE128" width={1} height={24} fontSize={0} displayValue={false} margin={0} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Movimientos · log global de traslados ───────────────────
function MovimientosView() {
  const { data, isLoading } = useQuery({ queryKey: ['activos-movs'], queryFn: () => api.activos.listMovimientos() });
  const movs = data?.movimientos ?? [];
  return (
    <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
      {isLoading ? <SkelRows rows={6} />
        : movs.length === 0 ? <div className="text-center py-12 text-[12px] text-ink-3">Sin traslados registrados · usa "Trasladar" desde el detalle de un ítem</div>
        : (
        <table className="w-full text-[12px]">
          <thead className="bg-bg-sunken border-b border-line">
            <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
              <th className="px-3 py-2 w-24">Fecha</th><th className="px-3 py-2 w-28">Código</th><th className="px-3 py-2">Ítem</th>
              <th className="px-3 py-2">Desde → Hacia</th><th className="px-3 py-2 w-36">Responsable</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {movs.map((m) => (
              <tr key={m.id} className="hover:bg-bg-sunken/30">
                <td className="px-3 py-2 font-mono text-[10.5px] tabular-nums">{m.fecha}</td>
                <td className="px-3 py-2 font-mono text-[10.5px] text-primary font-semibold">{m.activoCodigo}</td>
                <td className="px-3 py-2"><div className="text-[11.5px] truncate max-w-[220px]">{m.activoNombre}</div><div className="text-[10px] text-ink-4">{m.categoria}</div></td>
                <td className="px-3 py-2 text-[11.5px]"><span className="text-ink-3">{m.desde ?? '—'}</span> <span className="text-ink-4">→</span> <span className="font-medium">{m.hacia}</span></td>
                <td className="px-3 py-2 text-[11px] text-ink-3 truncate max-w-[140px]">{m.responsable ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Consumibles · módulo FIN-3 existente con selector de obra ───
function ConsumiblesView() {
  const { data } = useQuery({ queryKey: ['proyectos-list'], queryFn: () => api.proyectos.list() });
  const proyectos = data?.proyectos ?? [];
  const [sel, setSel] = useState('');
  const pid = sel || proyectos[0]?.id || '';
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-ink-3" />
        <select className="h-9 px-3 rounded-md border border-line bg-bg-elev text-[12.5px] min-w-[220px]" value={pid} onChange={(e) => setSel(e.target.value)}>
          {proyectos.length === 0 && <option value="">Sin proyectos</option>}
          {proyectos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
        </select>
        <span className="text-[11px] text-ink-4">materiales · EPPs · entran y se consumen por obra</span>
      </div>
      {pid ? <InventarioTab proyectoId={pid} /> : <div className="rounded-md border border-line bg-bg-elev p-8 text-center text-[12px] text-ink-3">Crea un proyecto primero</div>}
    </div>
  );
}

// ─── Activos · catálogo (tabla densa + panel detalle) ────────
const PAGE = 15;
function ActivosView({ deepCodigo = '' }: { deepCodigo?: string }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState(deepCodigo);
  const [cat, setCat] = useState('');
  const [estado, setEstado] = useState('');
  const [ubicacion, setUbicacion] = useState(''); // '' todas · 'almacen' · proyectoId
  const [page, setPage] = useState(0);
  const [selId, setSelId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['activos'], queryFn: () => api.activos.list() });
  const proysQ = useQuery({ queryKey: ['proyectos-list'], queryFn: () => api.proyectos.list() });
  const activos = data?.activos ?? [];
  const stats = data?.stats;

  // deep-link / escaneo: busca el código y abre su ficha al llegar la data
  useEffect(() => {
    if (!deepCodigo) return;
    setBusca(deepCodigo);
    const hit = activos.find((a) => a.codigo.toUpperCase() === deepCodigo.toUpperCase());
    if (hit) setSelId(hit.id);
  }, [deepCodigo, activos]);

  const q = busca.trim().toLowerCase();
  const filtrados = useMemo(() => activos.filter((a) => {
    if (cat && a.categoria !== cat) return false;
    if (estado && a.estado !== estado) return false;
    if (ubicacion === 'almacen' && a.proyectoId) return false;
    if (ubicacion && ubicacion !== 'almacen' && a.proyectoId !== ubicacion) return false;
    if (!q) return true;
    return [a.codigo, a.nombre, a.marca, a.serie, a.responsable, a.proyecto?.nombre, a.proyecto?.codigo].some((x) => String(x ?? '').toLowerCase().includes(q));
  }), [activos, q, cat, estado, ubicacion]);

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE));
  const pageSafe = Math.min(page, totalPages - 1);
  const rows = filtrados.slice(pageSafe * PAGE, pageSafe * PAGE + PAGE);
  const sel = selId ? activos.find((a) => a.id === selId) ?? null : null;
  const inval = () => qc.invalidateQueries({ queryKey: ['activos'] });

  // categorías presentes (con conteo) · estilo chips mockup
  const cats = CATEGORIAS.filter((c) => (stats?.porCategoria[c.nombre] ?? 0) > 0);

  return (
    <div className="space-y-3">
      {/* Card búsqueda + filtros · estilo mockup */}
      <div className="rounded-lg border border-line bg-bg-elev p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="h-4 w-4 text-ink-4 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={busca} onChange={(e) => { setBusca(e.target.value); setPage(0); }} placeholder="Buscar por nombre, código, marca..." className="h-10 w-full pl-9 pr-3 rounded-lg border border-line bg-bg-sunken/60 text-[12.5px]" />
          </div>
          <select value={estado} onChange={(e) => { setEstado(e.target.value); setPage(0); }} className="h-10 px-3 rounded-lg border border-line bg-bg-elev text-[12.5px]">
            <option value="">Todos estados</option>
            <option value="operativo">Operativo</option>
            <option value="baja">De baja</option>
            <option value="perdido">Perdido</option>
          </select>
          <select value={ubicacion} onChange={(e) => { setUbicacion(e.target.value); setPage(0); }} className="h-10 px-3 rounded-lg border border-line bg-bg-elev text-[12.5px] max-w-[220px]">
            <option value="">Todas ubicaciones</option>
            <option value="almacen">Almacén / Oficina</option>
            {(proysQ.data?.proyectos ?? []).map((p) => <option key={p.id} value={p.id}>Obra {p.codigo}</option>)}
          </select>
        </div>
        {/* Chips categorías con conteo */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => { setCat(''); setPage(0); }}
            className={cn('inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[11.5px] font-medium border transition-colors',
              !cat ? 'bg-foreground text-bg-elev border-foreground' : 'border-line text-ink-3 hover:bg-bg-sunken')}>
            Todas <span className={cn('text-[10px]', !cat ? 'opacity-80' : 'text-ink-4')}>{stats?.total ?? 0}</span>
          </button>
          {cats.map((c) => (
            <button key={c.nombre} onClick={() => { setCat(cat === c.nombre ? '' : c.nombre); setPage(0); }}
              className={cn('inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[11.5px] font-medium border transition-colors',
                cat === c.nombre ? 'bg-foreground text-bg-elev border-foreground' : 'border-line text-ink-3 hover:bg-bg-sunken')}>
              {c.nombre} <span className={cn('text-[10px]', cat === c.nombre ? 'opacity-80' : 'text-ink-4')}>{stats?.porCategoria[c.nombre]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tabla + panel */}
      <div className={cn('grid gap-4', sel ? 'grid-cols-1 lg:grid-cols-[1fr_380px]' : 'grid-cols-1')}>
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden self-start">
          {isLoading ? <SkelRows rows={6} />
            : filtrados.length === 0 ? (
              <div className="text-center py-12">
                <Wrench className="mx-auto mb-2 h-7 w-7 text-ink-4" />
                <div className="text-[13px] font-semibold">{activos.length === 0 ? 'Sin herramientas registradas' : 'Sin resultados'}</div>
                <div className="text-[11px] text-ink-3 mt-0.5">{activos.length === 0 ? 'Registra la primera con "Nuevo ítem"' : 'Ajusta filtros'}</div>
              </div>
            ) : (
            <>
              <table className="w-full text-[12px]">
                <thead className="bg-bg-sunken border-b border-line">
                  <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
                    <th className="px-3 py-2 w-24">Código</th>
                    <th className="px-3 py-2">Ítem</th>
                    <th className="px-3 py-2 w-24">Estado</th>
                    <th className="px-3 py-2 w-40">Ubicación</th>
                    <th className="px-3 py-2 w-28 text-right">V. neto</th>
                    <th className="px-3 py-2 w-20 text-right">Depr.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((a) => (
                    <tr key={a.id} onClick={() => setSelId(selId === a.id ? null : a.id)} className={cn('cursor-pointer', selId === a.id ? 'bg-primary/10' : 'hover:bg-bg-sunken/30')}>
                      <td className="px-3 py-2 font-mono text-[10.5px] text-primary font-semibold">{a.codigo}</td>
                      <td className="px-3 py-2">
                        <div className="text-[11.5px] font-medium truncate max-w-[260px]">{a.nombre}</div>
                        <div className="text-[10px] text-ink-4">{a.categoria}{a.marca ? ` · ${a.marca}` : ''}</div>
                      </td>
                      <td className="px-3 py-2"><span className={cn('text-[9.5px] font-mono uppercase px-1.5 py-0.5 rounded', ESTADO_CHIP[a.estado])}>{a.estado}</span></td>
                      <td className="px-3 py-2 text-[11px] text-ink-3 truncate max-w-[150px]">{a.proyecto ? `${a.proyecto.codigo}` : (a.ubicacion || 'Almacén')}{a.responsable && <div className="text-[10px] text-ink-4 truncate">{a.responsable}</div>}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">{fmtPEN(a.valorNeto)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-3">{Math.round(a.pctDepreciado * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-line px-3 py-2 bg-bg-sunken/30 flex items-center justify-between text-[11px] text-ink-3">
                <span>{pageSafe * PAGE + 1}-{Math.min(filtrados.length, (pageSafe + 1) * PAGE)} de {filtrados.length}</span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button disabled={pageSafe === 0} onClick={() => setPage(pageSafe - 1)} className="h-6 px-2 rounded border border-line disabled:opacity-40 hover:bg-bg-sunken">‹</button>
                    <span className="px-1.5 font-mono">{pageSafe + 1}/{totalPages}</span>
                    <button disabled={pageSafe >= totalPages - 1} onClick={() => setPage(pageSafe + 1)} className="h-6 px-2 rounded border border-line disabled:opacity-40 hover:bg-bg-sunken">›</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        {sel && <ActivoPanel a={sel} onClose={() => setSelId(null)} onChanged={inval} />}
      </div>
    </div>
  );
}

// ─── Panel detalle (la "card" rica vive aquí) ────────────────
function ActivoPanel({ a, onClose, onChanged }: { a: ActivoFull; onClose: () => void; onChanged: () => void }) {
  const [trasladoOpen, setTrasladoOpen] = useState(false);
  const histQ = useQuery({ queryKey: ['activo-hist', a.id], queryFn: () => api.activos.historial(a.id) });
  const setEstado = useMutation({
    mutationFn: (estado: 'operativo' | 'baja' | 'perdido') => api.activos.update(a.id, { estado }),
    onSuccess: onChanged,
  });
  const del = useMutation({ mutationFn: () => api.activos.remove(a.id), onSuccess: () => { onClose(); onChanged(); } });
  const aniosTxt = a.aniosUso < 1 ? `${Math.round(a.aniosUso * 12)}m` : `${Math.floor(a.aniosUso)}a ${Math.round((a.aniosUso % 1) * 12)}m`;

  return (
    <div className="rounded-lg border border-line bg-bg-elev p-4 self-start lg:sticky lg:top-4">
      <div className="flex items-start justify-between mb-1">
        <span className="font-mono text-[10.5px] text-primary font-bold">{a.codigo}</span>
        <button onClick={onClose} className="h-7 w-7 rounded-md border border-line inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-3.5 w-3.5" /></button>
      </div>
      <h3 className="text-[14px] font-semibold leading-tight">{a.nombre}</h3>
      <div className="text-[11px] text-ink-4 mt-0.5">{a.categoria}{a.marca ? ` · ${a.marca}` : ''}{a.serie ? ` · S/N ${a.serie}` : ''}</div>

      <div className="flex items-center gap-1.5 mt-2.5">
        {(['operativo', 'baja', 'perdido'] as const).map((e) => (
          <button key={e} onClick={() => e !== a.estado && setEstado.mutate(e)}
            className={cn('text-[9.5px] font-mono uppercase px-2 py-1 rounded transition-colors', a.estado === e ? ESTADO_CHIP[e] : 'text-ink-4 border border-line hover:bg-bg-sunken')}>
            {e}
          </button>
        ))}
      </div>

      {/* Ubicación */}
      <div className="mt-3 rounded-md bg-bg-sunken px-3 py-2.5 space-y-1">
        <div className="flex items-center gap-1.5 text-[11.5px]"><MapPin className="h-3 w-3 text-ink-4" /> {a.proyecto ? `Obra ${a.proyecto.codigo} · ${a.proyecto.nombre}` : (a.ubicacion || 'Almacén / Oficina')}</div>
        {a.responsable && <div className="text-[10.5px] text-ink-4 pl-[18px]">Responsable: {a.responsable}</div>}
      </div>

      {/* Depreciación */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-ink-3">V. adquisición <span className="font-mono font-semibold text-foreground">{fmtPEN(Number(a.valorAdquisicion))}</span></span>
          <span className="text-ink-3">V. neto <span className="font-mono font-semibold text-emerald-600">{fmtPEN(a.valorNeto)}</span></span>
        </div>
        <div className="h-1.5 rounded-full bg-bg-sunken overflow-hidden">
          <div className={cn('h-full rounded-full', a.pctDepreciado >= 0.8 ? 'bg-red-500' : 'bg-amber-500')} style={{ width: `${a.pctDepreciado * 100}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10px] text-ink-4 mt-1">
          <span>Depreciado {Math.round(a.pctDepreciado * 100)}% · {Number(a.pctDepreciacionAnual)}%/año</span>
          <span>{aniosTxt} de uso</span>
        </div>
      </div>

      {/* QR · codifica deep-link a esta ficha */}
      <div className="mt-3 flex items-center gap-3 rounded-md border border-line bg-bg-sunken/50 p-2.5">
        <div className="rounded bg-white p-1.5"><QRCodeSVG value={activoUrl(a.codigo)} size={64} level="M" /></div>
        <div className="text-[10.5px] text-ink-3 leading-snug">
          <div className="font-mono font-semibold text-foreground">{a.codigo}</div>
          Escanea para abrir esta ficha. Imprime la etiqueta desde <span className="font-medium">"Imprimir etiquetas"</span>.
        </div>
      </div>

      {/* Tag RFID/UHF · vincula el tag físico al activo */}
      <RfidRow a={a} onChanged={onChanged} />

      <button onClick={() => setTrasladoOpen(true)} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90">
        <ArrowRightLeft className="h-3.5 w-3.5" /> Trasladar
      </button>

      {/* Historial */}
      <div className="mt-3">
        <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4 mb-1.5">Trazabilidad ({histQ.data?.movimientos.length ?? 0})</div>
        {(histQ.data?.movimientos.length ?? 0) === 0 ? <div className="text-[11px] text-ink-4">Sin traslados registrados</div> : (
          <div className="max-h-[200px] overflow-y-auto space-y-2">
            {histQ.data!.movimientos.map((m) => (
              <div key={m.id} className="text-[11px] border-l-2 border-line pl-2.5">
                <div className="font-mono text-[9.5px] text-ink-4">{m.fecha}</div>
                <div className="text-ink-2">{m.desde ?? '—'} → <span className="font-medium text-foreground">{m.hacia}</span></div>
                {m.responsable && <div className="text-[10px] text-ink-4">{m.responsable}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {a.estado !== 'operativo' && (
        <button onClick={() => { if (confirm(`¿Eliminar ${a.codigo}? Se pierde su historial.`)) del.mutate(); }}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-line text-[11px] text-ink-4 hover:text-destructive hover:border-destructive/40">
          <Trash2 className="h-3 w-3" /> Eliminar registro
        </button>
      )}

      {trasladoOpen && <TrasladoModal a={a} onClose={() => setTrasladoOpen(false)} onDone={() => { setTrasladoOpen(false); onChanged(); histQ.refetch(); }} />}
    </div>
  );
}

// Vincular tag RFID/UHF al activo · escribe con el lector (HID) o a mano
function RfidRow({ a, onChanged }: { a: ActivoFull; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(a.rfidTag ?? '');
  const save = useMutation({
    mutationFn: () => api.activos.update(a.id, { rfidTag: val.trim() || null }),
    onSuccess: () => { setEditing(false); onChanged(); },
  });
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-line bg-bg-sunken/50 px-2.5 py-2 text-[11px]">
      <Radio className="h-3.5 w-3.5 text-ink-4 shrink-0" />
      {editing ? (
        <>
          <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save.mutate()}
            placeholder="Apunta el lector UHF + Enter" className="flex-1 h-7 px-2 rounded border border-line bg-bg-elev font-mono text-[11px]" />
          <button onClick={() => save.mutate()} disabled={save.isPending} className="h-7 px-2 rounded bg-primary text-primary-foreground text-[11px] disabled:opacity-50">OK</button>
        </>
      ) : (
        <>
          <span className="flex-1 text-ink-3">Tag RFID: {a.rfidTag ? <span className="font-mono text-foreground">{a.rfidTag}</span> : <span className="text-ink-4">sin vincular</span>}</span>
          <button onClick={() => { setVal(a.rfidTag ?? ''); setEditing(true); }} className="text-primary hover:underline">{a.rfidTag ? 'Cambiar' : 'Vincular'}</button>
        </>
      )}
    </div>
  );
}

// ─── Modales ─────────────────────────────────────────────────
const inputCls = 'mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">{label}</span>{children}</label>;
}

function NuevoActivoModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const proysQ = useQuery({ queryKey: ['proyectos-list'], queryFn: () => api.proyectos.list() });
  const [f, setF] = useState<ActivoInput>({
    nombre: '', categoria: 'Herramienta eléctrica', marca: '', serie: '',
    fechaAdquisicion: new Date().toISOString().slice(0, 10), valorAdquisicion: 0,
    pctDepreciacionAnual: 10, proyectoId: null, ubicacion: '', responsable: '', rfidTag: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<ActivoInput>) => setF({ ...f, ...p });
  const onCat = (categoria: string) => set({ categoria, pctDepreciacionAnual: CATEGORIAS.find((c) => c.nombre === categoria)?.pct ?? 10 });
  const create = useMutation({ mutationFn: () => api.activos.create(f), onSuccess: onDone, onError: (e: Error) => setErr(e.message) });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-6" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-line bg-bg-elev p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold mb-3">Nuevo ítem · herramienta / equipo</h3>
        <div className="space-y-2.5">
          <Field label="Nombre *"><input className={inputCls} placeholder="Taladro rotopercutor Bosch GBH 2-26" value={f.nombre} onChange={(e) => set({ nombre: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Categoría"><select className={inputCls} value={f.categoria} onChange={(e) => onCat(e.target.value)}>{CATEGORIAS.map((c) => <option key={c.nombre}>{c.nombre}</option>)}</select></Field>
            <Field label="Marca"><input className={inputCls} placeholder="Bosch" value={f.marca ?? ''} onChange={(e) => set({ marca: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <Field label="Fecha adq. *"><input type="date" className={inputCls} value={f.fechaAdquisicion} onChange={(e) => set({ fechaAdquisicion: e.target.value })} /></Field>
            <Field label="Valor adq. S/ *"><input type="number" className={cn(inputCls, 'font-mono')} value={f.valorAdquisicion || ''} onChange={(e) => set({ valorAdquisicion: Number(e.target.value) })} /></Field>
            <Field label="% depr/año"><input type="number" className={cn(inputCls, 'font-mono')} value={f.pctDepreciacionAnual} onChange={(e) => set({ pctDepreciacionAnual: Number(e.target.value) })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="N° de serie"><input className={inputCls} value={f.serie ?? ''} onChange={(e) => set({ serie: e.target.value })} /></Field>
            <Field label="Tag RFID/UHF"><input className={cn(inputCls, 'font-mono')} placeholder="Apunta el lector o escribe" value={f.rfidTag ?? ''} onChange={(e) => set({ rfidTag: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Ubicación inicial">
              <select className={inputCls} value={f.proyectoId ?? ''} onChange={(e) => set({ proyectoId: e.target.value || null })}>
                <option value="">Almacén / Oficina</option>
                {(proysQ.data?.proyectos ?? []).map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
              </select>
            </Field>
            <Field label="Responsable"><input className={inputCls} value={f.responsable ?? ''} onChange={(e) => set({ responsable: e.target.value })} /></Field>
          </div>
          {err && <div className="text-[11px] text-destructive">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={!f.nombre || f.valorAdquisicion <= 0 || create.isPending} onClick={() => create.mutate()} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50">Registrar</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TrasladoModal({ a, onClose, onDone }: { a: ActivoFull; onClose: () => void; onDone: () => void }) {
  const proysQ = useQuery({ queryKey: ['proyectos-list'], queryFn: () => api.proyectos.list() });
  const [proyectoId, setProyectoId] = useState<string>('');
  const [ubicacion, setUbicacion] = useState('');
  const [responsable, setResponsable] = useState(a.responsable ?? '');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const mov = useMutation({
    mutationFn: () => api.activos.traslado(a.id, { proyectoId: proyectoId || null, ubicacion: ubicacion || null, responsable: responsable || null, fecha }),
    onSuccess: onDone,
  });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-xl border border-line bg-bg-elev p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold mb-1">Trasladar · {a.codigo}</h3>
        <p className="text-[11px] text-ink-3 mb-3">Desde: {a.proyecto ? `Obra ${a.proyecto.codigo}` : (a.ubicacion || 'Almacén')}</p>
        <div className="space-y-2.5">
          <Field label="Destino">
            <select className={inputCls} value={proyectoId} onChange={(e) => setProyectoId(e.target.value)}>
              <option value="">Almacén / Oficina</option>
              {(proysQ.data?.proyectos ?? []).map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
            </select>
          </Field>
          {!proyectoId && <Field label="Detalle ubicación"><input className={inputCls} placeholder="Almacén central · contenedor N1" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} /></Field>}
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Responsable"><input className={inputCls} value={responsable} onChange={(e) => setResponsable(e.target.value)} /></Field>
            <Field label="Fecha"><input type="date" className={inputCls} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={mov.isPending} onClick={() => mov.mutate()} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50 inline-flex items-center gap-1.5"><ArrowRightLeft className="h-3.5 w-3.5" /> Trasladar</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Kpi({ label, value, tone, sub }: { label: string; value: string; tone: 'info' | 'ok' | 'warn2' | 'violet'; sub?: string }) {
  const border = tone === 'ok' ? 'border-l-emerald-500' : tone === 'warn2' ? 'border-l-amber-500' : tone === 'violet' ? 'border-l-violet-500' : 'border-l-primary';
  return (
    <div className={cn('rounded-lg border border-line border-l-[3px] bg-bg-elev p-3.5', border)}>
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4">{label}</div>
      <div className="mt-1 text-[18px] font-bold font-mono tabular-nums tracking-[-0.02em]">{value}</div>
      {sub && <div className="text-[10px] text-ink-4 mt-0.5">{sub}</div>}
    </div>
  );
}
