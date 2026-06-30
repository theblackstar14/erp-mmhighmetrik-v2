import { lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout.js';
import { ChangePasswordModal } from './components/layout/ChangePasswordModal.js';
import { EmpresaPicker } from './components/layout/EmpresaPicker.js';
import { api, getActiveEmpresa } from './lib/api.js';
import { useAuthStore } from './lib/auth-store.js';
import { EmptyModulePage } from './pages/EmptyModulePage.js';
import { LoginPage } from './pages/LoginPage.js';

// Lazy · cada página = su propio chunk (no se parsea hasta visitarla). El Suspense vive en AppLayout.
const ContabilidadPage = lazy(() => import('./pages/ContabilidadPage.js').then((m) => ({ default: m.ContabilidadPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage.js').then((m) => ({ default: m.DashboardPage })));
const DocumentosPage = lazy(() => import('./pages/DocumentosPage.js'));
const FinanzasPage = lazy(() => import('./pages/FinanzasPage.js').then((m) => ({ default: m.FinanzasPage })));
const InventarioPage = lazy(() => import('./pages/InventarioPage.js').then((m) => ({ default: m.InventarioPage })));
const InversionDetailPage = lazy(() => import('./pages/InversionDetailPage.js').then((m) => ({ default: m.InversionDetailPage })));
const InversionesListPage = lazy(() => import('./pages/InversionesListPage.js').then((m) => ({ default: m.InversionesListPage })));
const LogisticaPage = lazy(() => import('./pages/LogisticaPage.js').then((m) => ({ default: m.LogisticaPage })));
const OficinaPage = lazy(() => import('./pages/OficinaPage.js').then((m) => ({ default: m.OficinaPage })));
const PersonalPage = lazy(() => import('./pages/PersonalPage.js').then((m) => ({ default: m.PersonalPage })));
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage.js').then((m) => ({ default: m.ProjectDetailPage })));
const ProyectosListPage = lazy(() => import('./pages/ProyectosListPage.js').then((m) => ({ default: m.ProyectosListPage })));

// Splash de boot · se ve solo mientras corre api.me() (chequeo de sesión). Sin timer artificial:
// dura lo que dura la verificación. Reusa el mark/wordmark de marca del LoginPage.
function BootSplash() {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-5 bg-[#F7F7F5] animate-appEnter">
      <div className="flex items-center gap-3">
        <div
          className="relative grid place-items-center overflow-hidden font-mono font-bold text-white animate-pulse"
          style={{ width: 48, height: 48, borderRadius: 48 * 0.22, background: '#1C1C1C', fontSize: 48 * 0.42, letterSpacing: '-0.02em', boxShadow: '0 1px 0 rgba(255,255,255,.25) inset, 0 2px 8px rgba(59,91,219,.25)' }}
        >
          <svg viewBox="0 0 40 40" width={48} height={48} style={{ position: 'absolute', inset: 0 }}>
            <path d="M 8 28 L 14 14 L 20 24 L 26 12 L 32 28" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          <span style={{ position: 'relative' }}>MH</span>
        </div>
        <div className="leading-tight">
          <div className="font-bold text-[15px] tracking-[-0.01em] text-[#0F1115]">MMHIGHMETRIK</div>
          <div className="font-mono text-[10.5px] tracking-[0.12em] text-[#8A8F98] uppercase mt-0.5">Engineers ERP</div>
        </div>
      </div>
      <div className="h-[3px] w-32 overflow-hidden rounded-full bg-black/[0.06]">
        <div className="h-full w-1/3 rounded-full bg-[#3B5BDB] animate-bootbar" />
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, empresas, switchEmpresa } = useAuthStore();
  if (loading) return <BootSplash />;
  if (!user) return <Navigate to="/login" replace />;
  // 1) clave temporal → forzar cambio antes de todo
  if (user.mustChangePassword) {
    return (
      <div className="h-screen w-screen bg-[#F7F7F5]">
        <ChangePasswordModal forced />
      </div>
    );
  }
  // 2) 2+ empresas y ninguna elegida → selector (1 empresa entra directo)
  if (empresas.length > 1 && getActiveEmpresa() == null) {
    return <EmpresaPicker empresas={empresas} onPick={(id) => void switchEmpresa(id)} />;
  }
  return <>{children}</>;
}

export default function App() {
  const setSession = useAuthStore((s) => s.setSession);
  const clear = useAuthStore((s) => s.clear);

  useEffect(() => {
    api.me().then(setSession).catch(() => clear());
  }, [setSession, clear]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="proyectos" element={<ProyectosListPage />} />
        <Route path="proyectos/:id/*" element={<ProjectDetailPage />} />
        <Route path="inversiones" element={<InversionesListPage />} />
        <Route path="inversiones/:id" element={<InversionDetailPage />} />
        <Route path="licitaciones" element={<EmptyModulePage title="Licitaciones" description="Oportunidades pre-obra · seguimiento procesos" />} />
        <Route path="seace" element={<EmptyModulePage title="SEACE" description="Buscador licitaciones públicas Peru" />} />
        <Route path="finanzas" element={<FinanzasPage />} />
        <Route path="contabilidad" element={<ContabilidadPage />} />
        <Route path="logistica/*" element={<LogisticaPage />} />
        <Route path="inventario" element={<InventarioPage />} />
        <Route path="personal" element={<PersonalPage />} />
        <Route path="oficina" element={<OficinaPage />} />
        <Route path="documentos" element={<DocumentosPage />} />
        <Route path="config/*" element={<EmptyModulePage title="Configuración" description="Empresa · usuarios · roles · permisos" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
