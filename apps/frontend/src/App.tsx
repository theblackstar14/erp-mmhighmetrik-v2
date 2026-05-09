import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout.js';
import { api } from './lib/api.js';
import { useAuthStore } from './lib/auth-store.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { EmptyModulePage } from './pages/EmptyModulePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { ProjectDetailPage } from './pages/ProjectDetailPage.js';
import { ProyectosListPage } from './pages/ProyectosListPage.js';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => setUser(null));
  }, [setUser]);

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
        <Route path="licitaciones" element={<EmptyModulePage title="Licitaciones" description="Oportunidades pre-obra · seguimiento procesos" />} />
        <Route path="seace" element={<EmptyModulePage title="SEACE" description="Buscador licitaciones públicas Peru" />} />
        <Route path="finanzas" element={<EmptyModulePage title="Finanzas" description="Cashflow consolidado · cuentas por cobrar/pagar" />} />
        <Route path="contabilidad" element={<EmptyModulePage title="Contabilidad" description="Plan contable PCGE 2020 · libros · PLE SUNAT" />} />
        <Route path="compras" element={<EmptyModulePage title="Compras" description="Órdenes de compra y servicio · proveedores" />} />
        <Route path="inventario" element={<EmptyModulePage title="Inventario" description="Stock de almacén · kardex · valorización" />} />
        <Route path="personal" element={<EmptyModulePage title="Personal" description="Base de datos trabajadores · planilla · SCTR" />} />
        <Route path="documentos" element={<EmptyModulePage title="Documentos" description="Conexión NAS Synology · archivos globales" />} />
        <Route path="config/*" element={<EmptyModulePage title="Configuración" description="Empresa · usuarios · roles · permisos" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
