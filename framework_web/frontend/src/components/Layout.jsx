import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';

export function Layout({ children }) {
  // Visibilidad del sidebar. En md+ vive fijo en el flow (siempre visible);
  // en mobile se anima off-canvas. El state se mantiene aquí porque el botón
  // hamburguesa del Topbar es quien dispara la apertura.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Cerrar el drawer al cambiar de ruta — comportamiento esperado en mobile:
  // si el usuario tap en un item del menú, la vista nueva no debería tener
  // el drawer flotando encima.
  useEffect(() => {
    const close = () => setSidebarOpen(false);
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, []);

  // Bloquear scroll del body cuando el drawer está abierto en mobile, si no
  // el usuario puede hacer scroll del contenido por detrás del overlay.
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [sidebarOpen]);

  return (
    <div className="min-h-[100dvh]">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {/* Backdrop mobile — solo se renderiza cuando el drawer está abierto;
       *  click cierra. En md+ no hay backdrop porque el sidebar es persistente. */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-[1150] bg-black/45 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <div className="md:ml-80 min-h-[100dvh] flex flex-col bg-bg-base">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main
          id="main-content"
          className="px-3 py-3 sm:px-5 sm:py-4 max-w-[1480px] mx-auto w-full pattern-animated min-h-[calc(100dvh-3.5rem)]"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
