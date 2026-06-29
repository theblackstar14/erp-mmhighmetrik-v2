import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, HardHat, Plus, Star, Trash2, UserCog } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';
import { EquipoListaPreview } from './EquipoListaPreview.js';

const ROLES = ['Residente', 'Supervisor', 'Jefe de obra', 'Control de costos', 'Administrador', 'SSOMA', 'Asistente', 'Almacenero'];
const AVATAR = ['#3B5BDB', '#2F7D5C', '#7C3AED', '#D1453B', '#B45309', '#0891B2', '#7048E8'];
const ini = (n: string) => n.split(' ').slice(0, 2).map((s) => s[0]).join('').toUpperCase();

export function EquipoTab({ proyectoId }: { proyectoId: string }) {
  const qc = useQueryClient();
  const proyQ = useQuery({ queryKey: ['proyecto', proyectoId], queryFn: () => api.proyectos.get(proyectoId) });
  const equipoQ = useQuery({ queryKey: ['equipo', proyectoId], queryFn: () => api.proyectos.getEquipo(proyectoId) });
  const usersQ = useQuery({ queryKey: ['usuarios'], queryFn: () => api.usuarios.list() });
  const profesionalesQ = useQuery({ queryKey: ['profesionales'], queryFn: () => api.profesionales.list() });
  const cuadrillaQ = useQuery({ queryKey: ['empleados', 'obrero', proyectoId], queryFn: () => api.planilla.listEmpleados('obrero', proyectoId) });

  const [addProf, setAddProf] = useState('');
  const [addRol, setAddRol] = useState('Residente');
  const [showLista, setShowLista] = useState(false);
  const inv = () => { qc.invalidateQueries({ queryKey: ['equipo', proyectoId] }); qc.invalidateQueries({ queryKey: ['proyecto', proyectoId] }); };

  const responsableId = proyQ.data?.proyecto?.responsableUserId ?? '';
  const setResp = useMutation({ mutationFn: (uid: string) => api.proyectos.asignarResponsable(proyectoId, uid || null), onSuccess: inv });
  const add = useMutation({ mutationFn: () => api.proyectos.addEquipo(proyectoId, addProf, addRol), onSuccess: () => { setAddProf(''); inv(); } });
  const remove = useMutation({ mutationFn: (pid: string) => api.proyectos.removeEquipo(proyectoId, pid), onSuccess: inv });

  const usuarios = usersQ.data?.usuarios ?? [];
  const profesionales = profesionalesQ.data?.profesionales ?? [];
  const equipo = equipoQ.data?.equipo ?? [];
  const cuadrilla = cuadrillaQ.data?.empleados ?? [];

  const responsableUser = usuarios.find((u) => u.id === responsableId);
  const proyecto = proyQ.data?.proyecto;

  return (
    <div className="space-y-4">
      {/* Encabezado · descargar lista imprimible */}
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold">Equipo del proyecto</h2>
        <button
          onClick={() => setShowLista(true)}
          disabled={!proyecto}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line bg-bg-elev text-[12px] font-medium text-ink-2 hover:bg-bg-sunken disabled:opacity-50"
          title="Generar lista de equipo en PDF"
        >
          <FileText className="h-3.5 w-3.5" /> Descargar lista
        </button>
      </div>

      {showLista && proyecto && (
        <EquipoListaPreview
          onClose={() => setShowLista(false)}
          data={{
            proyecto: { codigo: proyecto.codigo, nombre: proyecto.nombre, ubicacion: proyecto.ubicacion ?? null },
            responsable: responsableUser ? { nombre: responsableUser.nombre, rol: responsableUser.role } : null,
            equipo: equipo.map((m) => ({ nombre: m.nombre, rol: m.rol })),
            cuadrilla: cuadrilla.map((e) => ({ nombre: e.nombre, categoria: e.categoria })),
          }}
        />
      )}

      {/* Responsable de obra */}
      <div className="rounded-md border border-line bg-bg-elev p-4">
        <div className="flex items-center gap-2 mb-2"><Star className="h-4 w-4 text-amber-500" /><h3 className="text-[13px] font-semibold">Responsable de obra</h3></div>
        <div className="flex items-center gap-2">
          <select value={responsableId} onChange={(e) => setResp.mutate(e.target.value)} className="h-9 px-2 rounded-md border border-line bg-bg-elev text-[12.5px] min-w-[240px]">
            <option value="">— sin asignar —</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.role}</option>)}
          </select>
          {setResp.isPending && <span className="text-[11px] text-ink-4">guardando…</span>}
        </div>
      </div>

      {/* Equipo profesional */}
      <div className="rounded-md border border-line bg-bg-elev">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2"><UserCog className="h-4 w-4 text-ink-3" /><h3 className="text-[13px] font-semibold">Equipo profesional</h3><span className="text-[11px] text-ink-4">{equipo.length}</span></div>
        </div>
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-line bg-bg-sunken/30">
          <select value={addProf} onChange={(e) => { setAddProf(e.target.value); const p = profesionales.find((x) => x.id === e.target.value); if (p?.cargoDefault) setAddRol(p.cargoDefault); }} className="h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] flex-1 min-w-[180px]">
            <option value="">— elegir profesional —</option>
            {profesionales.filter((p) => !equipo.some((m) => m.profesionalId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.profesion ? ` · ${p.profesion}` : ''}</option>)}
          </select>
          <select value={addRol} onChange={(e) => setAddRol(e.target.value)} className="h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px]">{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          <button disabled={!addProf || add.isPending} onClick={() => add.mutate()} className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Asignar</button>
          <a href="/oficina" className="text-[11px] text-primary hover:underline ml-auto">Gestionar padrón en Oficina →</a>
        </div>
        {equipo.length === 0 ? (
          <p className="p-6 text-center text-[12px] text-ink-3">{profesionales.length === 0 ? 'Sin profesionales en el padrón · agrégalos en Oficina → Profesionales' : 'Sin equipo asignado'}</p>
        ) : (
          <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {equipo.map((m, i) => (
              <div key={m.profesionalId} className="flex items-center gap-2.5 rounded-md border border-line p-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: AVATAR[i % AVATAR.length] }}>{ini(m.nombre || '?')}</div>
                <div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-medium">{m.nombre}</div><div className="text-[11px] text-ink-3">{m.rol}{m.profesion ? ` · ${m.profesion}` : ''}</div></div>
                <button onClick={() => remove.mutate(m.profesionalId)} className="text-ink-4 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cuadrilla de obra */}
      <div className="rounded-md border border-line bg-bg-elev">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2"><HardHat className="h-4 w-4 text-ink-3" /><h3 className="text-[13px] font-semibold">Cuadrilla de obra</h3><span className="text-[11px] text-ink-4">{cuadrilla.length} obreros</span></div>
          <a href="/personal" className="text-[11px] text-primary hover:underline">Gestionar en Personal →</a>
        </div>
        {cuadrilla.length === 0 ? (
          <p className="p-6 text-center text-[12px] text-ink-3">Sin obreros asignados a esta obra · agrégalos en Personal</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 p-3">
            {cuadrilla.map((e) => (
              <span key={e.id} className={cn('inline-flex items-center gap-1.5 rounded-full border border-line bg-bg-sunken px-2.5 py-1 text-[11px]')}>
                <span className="font-medium">{e.nombre}</span>
                <span className="text-ink-4">· {e.categoria}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
