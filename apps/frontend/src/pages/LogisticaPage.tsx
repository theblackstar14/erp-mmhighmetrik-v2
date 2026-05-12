import { Boxes, FileText, Receipt, ShoppingCart, Tags, Truck } from 'lucide-react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { LogisticaIusPage } from '@/components/logistica/LogisticaIusPage.js';
import { LogisticaRecursosPage } from '@/components/logistica/LogisticaRecursosPage.js';
import { EmptyModulePage } from './EmptyModulePage.js';
import { cn } from '@/lib/utils.js';

const TABS = [
  { key: 'recursos', label: 'Recursos', icon: Boxes },
  { key: 'ius', label: 'IUs INEI', icon: Tags },
  { key: 'proveedores', label: 'Proveedores', icon: Truck },
  { key: 'ordenes', label: 'Órdenes Compra', icon: ShoppingCart },
  { key: 'comprobantes', label: 'Comprobantes', icon: Receipt },
];

export function LogisticaPage() {
  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2 mb-1">
          <FileText className="h-4 w-4 text-ink-3" />
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3 font-bold">
            Administración · Logística
          </span>
        </div>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] leading-tight">Logística</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          Catálogo recursos · IUs INEI · proveedores · órdenes de compra · comprobantes recibidos
        </p>
      </header>

      {/* Tabs nav */}
      <div className="border-b border-line">
        <nav className="flex gap-1 overflow-x-auto -mb-px">
          {TABS.map((t) => (
            <NavLink
              key={t.key}
              to={`/logistica/${t.key}`}
              end
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[12.5px] font-medium border-b-2 transition-colors',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-ink-3 hover:text-foreground hover:border-line-strong',
                )
              }
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Sub-routes */}
      <Routes>
        <Route index element={<Navigate to="recursos" replace />} />
        <Route path="recursos" element={<LogisticaRecursosPage />} />
        <Route path="ius" element={<LogisticaIusPage />} />
        <Route
          path="proveedores"
          element={<EmptyModulePage title="Proveedores" description="RUC · razón social · contactos · histórico OC" />}
        />
        <Route
          path="ordenes"
          element={<EmptyModulePage title="Órdenes de Compra" description="OC/OS · proveedor · líneas vinculadas a partidas" />}
        />
        <Route
          path="comprobantes"
          element={<EmptyModulePage title="Comprobantes Recibidos" description="Facturas XML SUNAT · boletas · RH · NC/ND" />}
        />
        <Route path="*" element={<Navigate to="recursos" replace />} />
      </Routes>
    </div>
  );
}
