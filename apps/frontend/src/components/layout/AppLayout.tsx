import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { CopilotoPanel } from '@/components/copiloto/CopilotoPanel.js';
import { Sidebar } from './Sidebar.js';
import { Topbar } from './Topbar.js';

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onResize = () => {
      const m = window.innerWidth < 768;
      setIsMobile(m);
      if (window.innerWidth < 1280 && !m) setCollapsed(true);
      else if (window.innerWidth >= 1920) setCollapsed(false);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleSidebar = () => {
    if (isMobile) setMobileOpen(true);
    else setCollapsed(!collapsed);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden animate-appEnter">
      {/* Sidebar desktop */}
      {!isMobile && (
        <div className="shrink-0">
          <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        </div>
      )}

      {/* Sidebar mobile drawer */}
      {isMobile && mobileOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed left-0 top-0 z-50 h-screen">
            <Sidebar
              collapsed={false}
              onToggle={() => setMobileOpen(false)}
              onClose={() => setMobileOpen(false)}
              isMobile
            />
          </div>
        </>
      )}

      {/* Main */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <Topbar onToggleSidebar={toggleSidebar} isMobile={isMobile} />

        {/* Content */}
        <div className="flex-1 overflow-auto">
          <div
            key={location.pathname}
            className="mx-auto max-w-[1800px] p-5 sm:p-6 lg:p-8 4xl:max-w-[2200px] 4xl:p-10 animate-pageEnter"
          >
            <Outlet />
          </div>
        </div>
      </main>

      {/* Copiloto IA · global · over everything */}
      <CopilotoPanel />
    </div>
  );
}
