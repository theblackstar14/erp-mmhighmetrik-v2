import { create } from 'zustand';
import { api, setActiveEmpresa, type EmpresaMembresia, type MeResponse, type Nivel, type User } from './api.js';

const ORDEN: Record<Nivel, number> = { ninguno: 0, lectura: 1, edicion: 2 };

type AuthState = {
  user: User | null;
  empresas: EmpresaMembresia[];
  empresaActiva: { id: number; nombre: string | null; rol: string } | null;
  permisos: Record<string, Nivel>;
  loading: boolean;
  setUser: (user: User | null) => void; // back-compat
  setSession: (me: MeResponse) => void;
  reload: () => Promise<void>;
  switchEmpresa: (id: number) => Promise<void>;
  clear: () => void;
  setLoading: (loading: boolean) => void;
  /** ¿el rol en la empresa activa tiene al menos `nivel` en `modulo`? */
  can: (modulo: string, nivel?: Nivel) => boolean;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  empresas: [],
  empresaActiva: null,
  permisos: {},
  loading: true,
  setUser: (user) => set({ user, loading: false }),
  setSession: (me) =>
    set({ user: me.user, empresas: me.empresas, empresaActiva: me.empresaActiva, permisos: me.permisos, loading: false }),
  reload: async () => get().setSession(await api.me()),
  switchEmpresa: async (id) => {
    setActiveEmpresa(id);
    get().setSession(await api.me());
  },
  clear: () => {
    setActiveEmpresa(null);
    set({ user: null, empresas: [], empresaActiva: null, permisos: {}, loading: false });
  },
  setLoading: (loading) => set({ loading }),
  can: (modulo, nivel = 'lectura') => ORDEN[get().permisos[modulo] ?? 'ninguno'] >= ORDEN[nivel],
}));

export type { EmpresaMembresia };
