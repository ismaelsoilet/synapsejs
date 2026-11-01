import React, { type ReactNode } from 'react';

export default function RootLayout({
  children,
  url = '/',
  session
}: {
  children: ReactNode;
  url?: string;
  session?: any;
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased">
      {/* Top Global Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <a href="/dashboard/overview" className="flex items-center gap-2.5 group">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-cyan-500/20 group-hover:scale-105 transition-transform">
              ⚡
            </div>
            <div>
              <span className="font-extrabold text-white tracking-tight group-hover:text-cyan-400 transition-colors">
                Synapse<span className="text-cyan-400">Dash</span>
              </span>
              <span className="text-[10px] text-slate-400 ml-2 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono">
                v1.10.0
              </span>
            </div>
          </a>

          <nav className="flex items-center gap-1 text-sm font-medium">
            <a
              href="/dashboard/overview"
              className={`px-3 py-1.5 rounded-md transition-colors ${
                url.includes('/dashboard') ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              📊 Visão Geral
            </a>
            <a
              href="/inventory/list-items"
              className={`px-3 py-1.5 rounded-md transition-colors ${
                url.includes('/inventory/list-items') ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              📦 Inventário
            </a>
            <a
              href="/inventory/create-item"
              className={`px-3 py-1.5 rounded-md transition-colors ${
                url.includes('/inventory/create-item') ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              ➕ Novo Item
            </a>
          </nav>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700/80">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-300">WAL Concurrency: Active</span>
          </div>
          <a
            href="/_synapse/api/repo-map"
            target="_blank"
            className="hover:text-cyan-400 transition-colors hidden md:inline"
            title="Mapa de repositório gerado por AST"
          >
            repo-map.d.ts
          </a>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 flex flex-col w-full">
        {children}
      </main>

      {/* Global Minimalist Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 px-6 py-4 text-center text-xs text-slate-500 flex flex-col md:flex-row justify-between items-center gap-2">
        <div>
          SynapseJS v1.10.0 • Machine-Centric Vertical Slices (N = 1) • Turbo Morphing SPA
        </div>
        <div className="font-mono text-slate-600">
          Zero-Wiring Fullstack Engine
        </div>
      </footer>
    </div>
  );
}
