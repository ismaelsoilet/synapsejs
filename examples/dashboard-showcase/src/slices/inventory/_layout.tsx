import React, { type ReactNode } from 'react';

export default function InventoryDomainLayout({
  children,
  url = ''
}: {
  children: ReactNode;
  url?: string;
  session?: any;
}) {
  return (
    <div className="flex flex-col flex-1 w-full min-h-full">
      <header className="border-b border-slate-800/60 bg-slate-900/40 backdrop-blur px-8 py-4 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-cyan-400 font-semibold font-mono">
            Módulo de Domínio
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">Gestão de Inventário & Produtos</h2>
        </div>
        <nav className="flex gap-2 text-sm font-medium">
          <a
            href="/inventory/list-items"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              url.endsWith('list-items') ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            📋 Todos os Itens
          </a>
          <a
            href="/inventory/create-item"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              url.endsWith('create-item') ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            ➕ Cadastrar Item
          </a>
        </nav>
      </header>
      <div className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto">
        {children}
      </div>
    </div>
  );
}
