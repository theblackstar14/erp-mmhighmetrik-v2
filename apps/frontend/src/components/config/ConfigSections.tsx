import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Pencil, Plus, Shield, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { api, type AdminRole, type AdminUser, type EmpresaRow, type Nivel } from '@/lib/api.js';
import { useAuthStore } from '@/lib/auth-store.js';
import { cn } from '@/lib/utils.js';
import { ChangePasswordModal } from '@/components/layout/ChangePasswordModal.js';

const input = 'h-9 w-full rounded-md border border-line bg-bg px-3 text-[13px] outline-none focus:border-ink-2';
const btnPrimary = 'inline-flex items-center gap-1.5 rounded-md bg-ink-1 px-3 py-2 text-[12.5px] font-medium text-white disabled:opacity-60';
const btnGhost = 'inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-[12.5px] hover:bg-bg-sunken';

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4 backdrop-blur-sm animate-fadeIn" onMouseDown={onClose}>
      <div className={cn('w-full rounded-2xl border border-line bg-bg-elev shadow-2xl', wide ? 'max-w-[620px]' : 'max-w-[460px]')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[14px] font-semibold">{title}</div>
          <button type="button" onClick={onClose} className="text-ink-4 hover:text-ink-1"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">{label}</span>
      {children}
    </label>
  );
}

// Banner de clave temporal (se muestra 1 sola vez tras crear/resetear).
function TempPasswordBanner({ pw, onClose }: { pw: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <div className="text-[12.5px] text-ink-2">
        Clave temporal (no se vuelve a mostrar): <span className="font-mono font-semibold text-ink-1">{pw}</span>
      </div>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => navigator.clipboard?.writeText(pw)} className={btnGhost}><Copy className="h-3.5 w-3.5" /> Copiar</button>
        <button type="button" onClick={onClose} className={btnGhost}>Cerrar</button>
      </div>
    </div>
  );
}

const chip = 'rounded bg-bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-ink-3';

// ════════════════════════════ USUARIOS Y ROLES ════════════════════════════
export function UsuariosRolesSection() {
  const [vista, setVista] = useState<'usuarios' | 'roles'>('usuarios');
  return (
    <div className="space-y-4">
      <div className="flex overflow-hidden rounded-md border border-line text-[12.5px]">
        {(['usuarios', 'roles'] as const).map((v) => (
          <button key={v} type="button" onClick={() => setVista(v)} className={cn('px-4 py-1.5 capitalize', vista === v ? 'bg-primary text-primary-foreground' : 'hover:bg-bg-sunken', v === 'roles' && 'border-l border-line')}>
            {v === 'roles' ? 'Roles y permisos' : 'Usuarios'}
          </button>
        ))}
      </div>
      {vista === 'usuarios' ? <UsuariosPanel /> : <RolesPanel />}
    </div>
  );
}

function UsuariosPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-usuarios'], queryFn: () => api.admin.usuarios.list(true) });
  const { data: rolesData } = useQuery({ queryKey: ['admin-roles'], queryFn: () => api.admin.roles.list() });
  const { data: empData } = useQuery({ queryKey: ['admin-empresas'], queryFn: () => api.admin.empresas.list() });
  const [modal, setModal] = useState<{ mode: 'crear' } | { mode: 'editar'; user: AdminUser } | null>(null);
  const [tempPw, setTempPw] = useState('');

  const usuarios = data?.usuarios ?? [];
  const roles = rolesData?.roles ?? [];
  const empresas = empData?.empresas ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-usuarios'] });

  const reset = useMutation({
    mutationFn: (id: string) => api.admin.usuarios.resetPassword(id),
    onSuccess: (r) => setTempPw(r.tempPassword),
  });
  const toggleActivo = useMutation({
    mutationFn: (u: AdminUser) => api.admin.usuarios.update(u.id, { activo: !u.activo }),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-3">
      {tempPw && <TempPasswordBanner pw={tempPw} onClose={() => setTempPw('')} />}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-4">{usuarios.length} usuarios</span>
        <button type="button" onClick={() => setModal({ mode: 'crear' })} className={btnPrimary}><Plus className="h-3.5 w-3.5" /> Nuevo usuario</button>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-bg-elev">
        <table className="w-full text-[12px]">
          <thead className="border-b border-line bg-bg-sunken text-left font-mono text-[10px] uppercase tracking-wider text-ink-4">
            <tr><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Empresas · rol</th><th className="px-3 py-2 w-20">Estado</th><th className="px-3 py-2 w-28 text-right">Acciones</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {usuarios.map((u) => (
              <tr key={u.id} className={cn('hover:bg-bg-sunken/30', !u.activo && 'opacity-55')}>
                <td className="px-3 py-2">{u.nombre}{u.telefono && <span className="ml-1.5 text-[10.5px] text-ink-4">· {u.telefono}</span>}</td>
                <td className="px-3 py-2 text-ink-3">{u.email}</td>
                <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{u.empresas.length ? u.empresas.map((e) => <span key={e.empresaId} className={chip}>{e.empresaNombre ?? e.empresaId}·{e.rol}</span>) : <span className="text-ink-4">—</span>}</div></td>
                <td className="px-3 py-2">{u.activo ? <span className="text-emerald-600">activo</span> : <span className="text-ink-4">inactivo</span>}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <button title="Editar" onClick={() => setModal({ mode: 'editar', user: u })} className="rounded p-1.5 hover:bg-bg-sunken"><Pencil className="h-3.5 w-3.5" /></button>
                    <button title="Resetear clave" onClick={() => confirm(`¿Resetear la clave de ${u.nombre}?`) && reset.mutate(u.id)} className="rounded p-1.5 hover:bg-bg-sunken"><KeyRound className="h-3.5 w-3.5" /></button>
                    <button title={u.activo ? 'Desactivar' : 'Activar'} onClick={() => toggleActivo.mutate(u)} className="rounded p-1.5 hover:bg-bg-sunken"><Trash2 className={cn('h-3.5 w-3.5', u.activo ? 'text-destructive' : 'text-ink-4')} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-ink-3">Sin usuarios.</td></tr>}
          </tbody>
        </table>
      </div>
      {modal && <UsuarioModal modal={modal} roles={roles} empresas={empresas} onClose={() => setModal(null)} onTempPw={setTempPw} onSaved={() => { setModal(null); invalidate(); }} />}
    </div>
  );
}

function UsuarioModal({ modal, roles, empresas, onClose, onTempPw, onSaved }: {
  modal: { mode: 'crear' } | { mode: 'editar'; user: AdminUser };
  roles: AdminRole[]; empresas: EmpresaRow[]; onClose: () => void; onTempPw: (pw: string) => void; onSaved: () => void;
}) {
  const editar = modal.mode === 'editar';
  const u = editar ? modal.user : null;
  const [email, setEmail] = useState(u?.email ?? '');
  const [nombres, setNombres] = useState(u?.nombre.split(' ')[0] ?? '');
  const [apellidos, setApellidos] = useState(u ? u.nombre.split(' ').slice(1).join(' ') : '');
  const [telefono, setTelefono] = useState(u?.telefono ?? '');
  const [membresias, setMembresias] = useState<{ empresaId: number; roleId: string }[]>(
    u?.empresas.map((e) => ({ empresaId: e.empresaId, roleId: e.roleId })) ?? [{ empresaId: empresas[0]?.id ?? 1, roleId: roles[0]?.id ?? '' }],
  );
  const [err, setErr] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      const emp = membresias.filter((m) => m.empresaId && m.roleId);
      if (!emp.length) throw new Error('Asigna al menos una empresa con rol');
      if (!editar && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email inválido');
      if (editar) {
        await api.admin.usuarios.update(u!.id, { nombres, apellidos, telefono: telefono || undefined, empresas: emp });
        return { tempPassword: undefined as string | undefined };
      }
      const r = await api.admin.usuarios.create({ email, nombres, apellidos, telefono: telefono || undefined, empresas: emp });
      return { tempPassword: r.tempPassword };
    },
    onSuccess: (r) => { if (r.tempPassword) onTempPw(r.tempPassword); onSaved(); },
    onError: (e) => setErr((e as Error).message),
  });

  return (
    <Modal title={editar ? 'Editar usuario' : 'Nuevo usuario'} onClose={onClose} wide>
      <div className="space-y-3">
        <Field label="Email"><input type="email" className={cn(input, editar && 'opacity-60')} value={email} disabled={editar} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@empresa.com" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombres"><input className={input} value={nombres} onChange={(e) => setNombres(e.target.value)} /></Field>
          <Field label="Apellidos"><input className={input} value={apellidos} onChange={(e) => setApellidos(e.target.value)} /></Field>
        </div>
        <Field label="Teléfono"><input className={input} value={telefono} onChange={(e) => setTelefono(e.target.value)} /></Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">Empresas y rol</span>
            <button type="button" onClick={() => setMembresias((m) => [...m, { empresaId: empresas[0]?.id ?? 1, roleId: roles[0]?.id ?? '' }])} className="text-[11.5px] text-primary hover:underline">+ agregar</button>
          </div>
          <div className="space-y-2">
            {membresias.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={m.empresaId} onChange={(e) => setMembresias((arr) => arr.map((x, j) => j === i ? { ...x, empresaId: Number(e.target.value) } : x))} className={cn(input, 'flex-1')}>
                  {empresas.map((emp) => <option key={emp.id} value={emp.id}>{emp.nombreCorto ?? emp.razonSocial}</option>)}
                </select>
                <select value={m.roleId} onChange={(e) => setMembresias((arr) => arr.map((x, j) => j === i ? { ...x, roleId: e.target.value } : x))} className={cn(input, 'flex-1')}>
                  <option value="">— rol —</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
                {membresias.length > 1 && <button type="button" onClick={() => setMembresias((arr) => arr.filter((_, j) => j !== i))} className="text-ink-4 hover:text-destructive"><X className="h-4 w-4" /></button>}
              </div>
            ))}
          </div>
        </div>

        {!editar && <p className="text-[11px] text-ink-4">Se generará una clave temporal (el usuario deberá cambiarla al primer ingreso).</p>}
        {err && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnGhost}>Cancelar</button>
          <button type="button" disabled={save.isPending} onClick={() => { setErr(''); save.mutate(); }} className={btnPrimary}>{editar ? 'Guardar' : 'Crear usuario'}</button>
        </div>
      </div>
    </Modal>
  );
}

function RolesPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-roles'], queryFn: () => api.admin.roles.list() });
  const { data: mods } = useQuery({ queryKey: ['admin-modulos'], queryFn: () => api.admin.modulos() });
  const [modal, setModal] = useState<{ mode: 'crear' } | { mode: 'editar'; role: AdminRole } | null>(null);
  const roles = data?.roles ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-roles'] });
  const del = useMutation({
    mutationFn: (id: string) => api.admin.roles.delete(id),
    onSuccess: invalidate,
    onError: (e) => alert((e as Error).message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-4">{roles.length} roles</span>
        <button type="button" onClick={() => setModal({ mode: 'crear' })} className={btnPrimary}><Plus className="h-3.5 w-3.5" /> Nuevo rol</button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {roles.map((r) => (
          <div key={r.id} className="rounded-lg border border-line bg-bg-elev p-3.5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] font-medium"><Shield className="h-3.5 w-3.5 text-ink-3" />{r.nombre}{r.esSistema && <span className={chip}>sistema</span>}</div>
                {r.descripcion && <div className="mt-0.5 text-[11.5px] text-ink-3">{r.descripcion}</div>}
              </div>
              <div className="flex gap-1">
                <button title="Editar" onClick={() => setModal({ mode: 'editar', role: r })} className="rounded p-1.5 hover:bg-bg-sunken"><Pencil className="h-3.5 w-3.5" /></button>
                {!r.esSistema && <button title="Borrar" onClick={() => confirm(`¿Borrar el rol ${r.nombre}?`) && del.mutate(r.id)} className="rounded p-1.5 hover:bg-bg-sunken"><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(r.permisos).filter(([, n]) => n !== 'ninguno').map(([m, n]) => <span key={m} className={chip}>{m}:{n === 'edicion' ? 'E' : 'L'}</span>)}
            </div>
          </div>
        ))}
      </div>
      {modal && mods && <RolModal modal={modal} modulos={mods.modulos} niveles={mods.niveles} onClose={() => setModal(null)} onSaved={() => { setModal(null); invalidate(); }} />}
    </div>
  );
}

function RolModal({ modal, modulos, niveles, onClose, onSaved }: {
  modal: { mode: 'crear' } | { mode: 'editar'; role: AdminRole };
  modulos: string[]; niveles: Nivel[]; onClose: () => void; onSaved: () => void;
}) {
  const editar = modal.mode === 'editar';
  const r = editar ? modal.role : null;
  const [nombre, setNombre] = useState(r?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(r?.descripcion ?? '');
  const [permisos, setPermisos] = useState<Record<string, Nivel>>(() => Object.fromEntries(modulos.map((m) => [m, r?.permisos[m] ?? 'ninguno'])) as Record<string, Nivel>);
  const [err, setErr] = useState('');

  const save = useMutation({
    mutationFn: () => editar ? api.admin.roles.update(r!.id, { nombre, descripcion, permisos }) : api.admin.roles.create({ nombre, descripcion, permisos }),
    onSuccess: onSaved,
    onError: (e) => setErr((e as Error).message),
  });

  return (
    <Modal title={editar ? 'Editar rol' : 'Nuevo rol'} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre"><input className={cn(input, r?.esSistema && 'opacity-60')} value={nombre} disabled={r?.esSistema} onChange={(e) => setNombre(e.target.value)} /></Field>
          <Field label="Descripción"><input className={input} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></Field>
        </div>
        <div>
          <span className="mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">Permisos por módulo</span>
          <div className="divide-y divide-line rounded-lg border border-line">
            {modulos.map((m) => (
              <div key={m} className="flex items-center justify-between px-3 py-1.5">
                <span className="text-[12.5px] capitalize">{m}</span>
                <div className="flex overflow-hidden rounded-md border border-line text-[11px]">
                  {niveles.map((n) => (
                    <button key={n} type="button" onClick={() => setPermisos((p) => ({ ...p, [m]: n }))} className={cn('px-2.5 py-1 capitalize', permisos[m] === n ? (n === 'edicion' ? 'bg-emerald-600 text-white' : n === 'lectura' ? 'bg-primary text-primary-foreground' : 'bg-bg-sunken') : 'hover:bg-bg-sunken', n !== 'ninguno' && 'border-l border-line')}>{n === 'ninguno' ? '—' : n}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        {err && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnGhost}>Cancelar</button>
          <button type="button" disabled={save.isPending || !nombre} onClick={() => { setErr(''); save.mutate(); }} className={btnPrimary}>{editar ? 'Guardar' : 'Crear rol'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════ EMPRESAS ════════════════════════════
export function EmpresasSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-empresas'], queryFn: () => api.admin.empresas.list() });
  const empresaActiva = useAuthStore((s) => s.empresaActiva);
  const [modal, setModal] = useState<{ mode: 'crear' } | { mode: 'editar'; empresa: EmpresaRow } | null>(null);
  const empresas = data?.empresas ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-empresas'] });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-4">{empresas.length} empresas</span>
        <button type="button" onClick={() => setModal({ mode: 'crear' })} className={btnPrimary}><Plus className="h-3.5 w-3.5" /> Nueva empresa</button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {empresas.map((e) => (
          <div key={e.id} className={cn('rounded-lg border bg-bg-elev p-4', empresaActiva?.id === e.id ? 'border-primary' : 'border-line')}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13.5px] font-semibold">{e.nombreCorto ?? '—'}{empresaActiva?.id === e.id && <span className={chip}>activa</span>}{!e.activo && <span className={chip}>inactiva</span>}</div>
                <div className="mt-0.5 text-[12px] text-ink-2">{e.razonSocial}</div>
                <div className="mt-1 font-mono text-[11px] text-ink-4">RUC {e.ruc}{e.tieneProyectos && ' · con Proyectos'}</div>
              </div>
              <button title="Editar" onClick={() => setModal({ mode: 'editar', empresa: e })} className="rounded p-1.5 hover:bg-bg-sunken"><Pencil className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
      {modal && <EmpresaModal modal={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); invalidate(); }} />}
    </div>
  );
}

function EmpresaModal({ modal, onClose, onSaved }: { modal: { mode: 'crear' } | { mode: 'editar'; empresa: EmpresaRow }; onClose: () => void; onSaved: () => void }) {
  const editar = modal.mode === 'editar';
  const e = editar ? modal.empresa : null;
  const [f, setF] = useState({
    ruc: e?.ruc ?? '', razonSocial: e?.razonSocial ?? '', nombreCorto: e?.nombreCorto ?? '',
    direccion: e?.direccion ?? '', email: e?.email ?? '', telefono: e?.telefono ?? '', tieneProyectos: e?.tieneProyectos ?? false,
  });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, direccion: f.direccion || undefined, email: f.email || undefined, telefono: f.telefono || undefined, nombreCorto: f.nombreCorto || undefined };
      return editar ? api.admin.empresas.update(e!.id, body) : api.admin.empresas.create(body);
    },
    onSuccess: onSaved,
    onError: (x) => setErr((x as Error).message),
  });

  return (
    <Modal title={editar ? 'Editar empresa' : 'Nueva empresa'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="RUC"><input inputMode="numeric" className={cn(input, f.ruc && f.ruc.length !== 11 && 'border-rose-500')} value={f.ruc} maxLength={11} onChange={(x) => set('ruc', x.target.value.replace(/\D/g, '').slice(0, 11))} /></Field>
          <Field label="Nombre corto"><input className={input} value={f.nombreCorto} onChange={(x) => set('nombreCorto', x.target.value)} placeholder="MM" /></Field>
        </div>
        <Field label="Razón social"><input className={input} value={f.razonSocial} onChange={(x) => set('razonSocial', x.target.value)} /></Field>
        <Field label="Dirección"><input className={input} value={f.direccion} onChange={(x) => set('direccion', x.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><input className={input} value={f.email} onChange={(x) => set('email', x.target.value)} /></Field>
          <Field label="Teléfono"><input className={input} value={f.telefono} onChange={(x) => set('telefono', x.target.value)} /></Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={f.tieneProyectos} onChange={(x) => set('tieneProyectos', x.target.checked)} />
          Habilitar módulo Proyectos para esta empresa
        </label>
        {err && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnGhost}>Cancelar</button>
          <button type="button" disabled={save.isPending || f.ruc.length !== 11 || !f.razonSocial} onClick={() => { setErr(''); save.mutate(); }} className={btnPrimary}>{editar ? 'Guardar' : 'Crear'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════ MI PERFIL ════════════════════════════
export function PerfilSection() {
  const { user, empresas, reload } = useAuthStore();
  const [nombres, setNombres] = useState(user?.nombres ?? '');
  const [apellidos, setApellidos] = useState(user?.apellidos ?? '');
  const [telefono, setTelefono] = useState(user?.telefono ?? '');
  const [pwOpen, setPwOpen] = useState(false);
  const [ok, setOk] = useState(false);

  const save = useMutation({
    mutationFn: () => api.updatePerfil({ nombres, apellidos, telefono: telefono || null }),
    onSuccess: async () => { await reload(); setOk(true); setTimeout(() => setOk(false), 2000); },
  });

  return (
    <div className="max-w-[520px] space-y-4">
      <div className="rounded-lg border border-line bg-bg-elev p-4">
        <div className="mb-3 text-[13px] font-semibold">Datos personales</div>
        <div className="space-y-3">
          <Field label="Email"><input className={cn(input, 'opacity-60')} value={user?.email ?? ''} disabled /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombres"><input className={input} value={nombres} onChange={(e) => setNombres(e.target.value)} /></Field>
            <Field label="Apellidos"><input className={input} value={apellidos} onChange={(e) => setApellidos(e.target.value)} /></Field>
          </div>
          <Field label="Teléfono"><input className={input} value={telefono} onChange={(e) => setTelefono(e.target.value)} /></Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className={btnPrimary}>Guardar cambios</button>
          {ok && <span className="text-[12px] text-emerald-600">Guardado ✓</span>}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-bg-elev p-4">
        <div className="mb-2 text-[13px] font-semibold">Empresas y rol</div>
        <div className="flex flex-wrap gap-1.5">
          {empresas.map((e) => <span key={e.id} className={chip}>{e.nombre ?? e.razonSocial} · {e.rol}</span>)}
          {empresas.length === 0 && <span className="text-ink-4 text-[12px]">Sin empresas asignadas.</span>}
        </div>
      </div>

      <button type="button" onClick={() => setPwOpen(true)} className={btnGhost}><KeyRound className="h-3.5 w-3.5" /> Cambiar contraseña</button>
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
    </div>
  );
}
