import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';
import { getLang, setLang, onLangChange } from '../lib/i18n.js';

export function Layout({ children }) {
  return (
    <div className="min-h-[100dvh]">
      <Sidebar />
      <div className="ml-80 min-h-[100dvh] flex flex-col bg-bg-base">
        <Topbar />
        <main id="main-content" className="px-5 py-4 max-w-[1480px] mx-auto w-full pattern-animated min-h-[calc(100dvh-3.5rem)]">
          {children}
        </main>
      </div>
    </div>
  );
}