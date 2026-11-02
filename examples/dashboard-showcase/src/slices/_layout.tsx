import { type ReactNode, useEffect, useState } from 'react';
import { Button, clearSession, currentRoles, Drawer, DropdownItem, DropdownMenu, Modal } from 'synapsejs/client';
import { ClickRipple, NavigationProgress } from '../shared/effects';
import { BrandMark, Icon } from '../shared/icons';
import { AppearanceMenu } from '../shared/theme';

const NAV_ITEMS = [
  { href: '/showcase/home', match: '/showcase/home', label: 'Visão geral', icon: <Icon name="home" />, hint: 'hub' },
  {
    href: '/inventory/list-items',
    match: '/inventory',
    label: 'Inventário',
    icon: <Icon name="inventory" />,
    hint: 'CRUD'
  },
  { href: '/showcase/files', match: '/showcase/files', label: 'Arquivos', icon: <Icon name="files" />, hint: 'upload' },
  {
    href: '/showcase/realtime',
    match: '/showcase/realtime',
    label: 'Tempo real',
    icon: <Icon name="realtime" />,
    hint: 'SSE/WS'
  },
  { href: '/showcase/jobs', match: '/showcase/jobs', label: 'Jobs', icon: <Icon name="jobs" />, hint: 'queue' },
  { href: '/showcase/cache', match: '/showcase/cache', label: 'Cache', icon: <Icon name="cache" />, hint: 'ISR' },
  {
    href: '/showcase/stream',
    match: '/showcase/stream',
    label: 'Streaming',
    icon: <Icon name="stream" />,
    hint: 'chunks'
  },
  {
    href: '/showcase/webhooks',
    match: '/showcase/webhooks',
    label: 'Webhooks',
    icon: <Icon name="webhooks" />,
    hint: 'HMAC'
  },
  {
    href: '/showcase/profile/demo-42',
    match: '/showcase/profile',
    label: 'Perfil',
    icon: <Icon name="profile" />,
    hint: 'params'
  },
  {
    href: '/showcase/platform',
    match: '/showcase/platform',
    label: 'Plataforma',
    icon: <Icon name="platform" />,
    hint: 'features'
  }
];

function isActive(url: string, match: string): boolean {
  try {
    return new URL(url, 'http://localhost').pathname.startsWith(match);
  } catch {
    return url.includes(match);
  }
}

function NavLink({
  item,
  url,
  onNavigate,
  compact = false
}: {
  item: (typeof NAV_ITEMS)[number];
  url: string;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const active = isActive(url, item.match);

  return (
    <a
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-all ${
        active
          ? 'border-cyan-400/25 bg-gradient-to-r from-cyan-400/15 to-transparent text-white shadow-lg shadow-cyan-950/30'
          : 'border-transparent text-slate-400 hover:border-slate-800 hover:bg-slate-900/80 hover:text-slate-100'
      } ${compact ? 'py-2' : ''}`}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-lg border transition ${
          active
            ? 'border-cyan-300/30 bg-cyan-400/15 text-cyan-200'
            : 'border-slate-800 bg-slate-950/40 text-slate-500 group-hover:text-cyan-300'
        }`}
      >
        {item.icon}
      </span>
      <span className="flex-1">{item.label}</span>
      <span className="font-mono text-[8px] uppercase tracking-wider text-slate-600 group-hover:text-slate-500">
        {item.hint}
      </span>
    </a>
  );
}

function SessionMenu() {
  const [roles, setRoles] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setRoles(currentRoles());
  }, []);

  const logout = () => {
    clearSession();
    (globalThis as { location?: { assign?: (url: string) => void } }).location?.assign?.('/showcase/home');
  };

  return (
    <div className="flex items-center">
      {!mounted || roles.length === 0 ? (
        <a
          href="/auth/login"
          className="inline-flex items-center justify-center rounded-md border border-slate-600 bg-slate-800 px-3.5 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700"
        >
          Entrar
        </a>
      ) : (
        <DropdownMenu
          trigger={
            <Button variant="secondary">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400" />
              {roles[0]}
            </Button>
          }
        >
          <DropdownItem
            onClick={() =>
              (globalThis as { location?: { assign?: (url: string) => void } }).location?.assign?.('/showcase/platform')
            }
          >
            <span className="flex items-center gap-2">
              <Icon name="platform" className="h-3.5 w-3.5" /> Plataforma
            </span>
          </DropdownItem>
          <DropdownItem
            onClick={() =>
              (globalThis as { location?: { assign?: (url: string) => void } }).location?.assign?.('/showcase/files')
            }
          >
            <span className="flex items-center gap-2">
              <Icon name="files" className="h-3.5 w-3.5" /> Meus arquivos
            </span>
          </DropdownItem>
          <DropdownItem onClick={logout}>
            <span className="flex items-center gap-2">
              <Icon name="arrowRight" className="h-3.5 w-3.5" /> Sair
            </span>
          </DropdownItem>
        </DropdownMenu>
      )}
    </div>
  );
}

export default function RootLayout({ children, url = '/' }: { children: ReactNode; url?: string }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [shortcut, setShortcut] = useState('Ctrl K');

  useEffect(() => {
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent;
    setShortcut(/mac|iphone|ipad/i.test(platform) ? '⌘ K' : 'Ctrl K');
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const filtered = NAV_ITEMS.filter((item) => {
    const term = query.trim().toLowerCase();
    return !term || item.label.toLowerCase().includes(term) || item.hint.includes(term) || item.href.includes(term);
  });

  const current = NAV_ITEMS.find((item) => isActive(url, item.match));

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100">
      <script src="/theme-boot.js?v=1" />
      <NavigationProgress />
      <ClickRipple />

      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 top-0 h-[28rem] w-[28rem] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute right-0 top-1/3 h-[26rem] w-[26rem] rounded-full bg-violet-500/8 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 h-[24rem] w-[24rem] rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.025)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]" />
      </div>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-slate-800/80 bg-slate-950/85 backdrop-blur-xl lg:flex">
        <a href="/showcase/home" className="flex items-center gap-3 border-b border-slate-800/80 px-5 py-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 text-slate-950 shadow-lg shadow-cyan-500/20">
            <BrandMark className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-black tracking-tight text-white">
              Synapse<span className="text-cyan-300">Showcase</span>
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">runtime 1.11.1</span>
          </span>
        </a>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <div className="px-3 pb-2 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">Navegação</div>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} url={url} />
          ))}
        </nav>

        <div className="border-t border-slate-800/80 p-3">
          <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-cyan-950/20 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">runtime</span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="mt-2 font-mono text-[10px] leading-relaxed text-slate-400">
              SQLite · SSE · WebSocket
              <br />
              jobs · cache · arquivos
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between px-1 text-[9px] text-slate-600">
            <span>{NAV_ITEMS.length} rotas</span>
            <a href="/_synapse/api/health" target="_blank" rel="noreferrer" className="hover:text-cyan-400">
              health
            </a>
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
          <div className="flex h-16 items-center justify-between gap-3 px-4 md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 text-slate-300 lg:hidden"
                aria-label="Abrir menu"
              >
                <Icon name="menu" />
              </button>
              <div className="min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Showcase / {current?.hint ?? 'workspace'}
                </div>
                <div className="truncate text-sm font-bold text-white">{current?.label ?? 'Visão geral'}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-keyshortcuts="Meta+K Control+K"
                className="hidden items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-[10px] text-slate-400 transition hover:border-slate-700 hover:text-slate-200 sm:flex"
              >
                <Icon name="search" className="h-3.5 w-3.5" />
                <span>Buscar</span>
                <kbd className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">
                  {shortcut}
                </kbd>
              </button>
              <a
                href="/showcase/platform"
                className="hidden rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 font-mono text-[9px] text-emerald-300 md:inline-flex"
              >
                ● online
              </a>
              <AppearanceMenu />
              <SessionMenu />
            </div>
          </div>
        </header>

        <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>

        <footer className="border-t border-slate-900 bg-slate-950/70 px-6 py-5">
          <div className="mx-auto flex max-w-[1500px] flex-col items-center justify-between gap-2 text-[10px] text-slate-600 sm:flex-row">
            <span>SynapseJS 1.11.1 · aplicação de demonstração</span>
            <a href="/showcase/platform" className="text-slate-500 transition hover:text-cyan-400">
              Catálogo de features
            </a>
          </div>
        </footer>
      </div>

      <Drawer isOpen={mobileOpen} onClose={() => setMobileOpen(false)} title="Synapse Showcase" position="left">
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} url={url} onNavigate={() => setMobileOpen(false)} compact />
          ))}
        </nav>
        <div className="mt-5 border-t border-slate-800 pt-4">
          <a
            href="/auth/login"
            className="block rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2.5 text-center text-xs font-bold text-cyan-300"
          >
            Entrar / trocar de conta
          </a>
        </div>
      </Drawer>

      <Modal isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} title="Comandos" size="lg">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ir para inventário, arquivos, realtime, jobs, cache…"
          className="mb-4 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setPaletteOpen(false)}
              className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5 transition hover:border-cyan-400/30 hover:bg-slate-900"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-cyan-300">
                {item.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-white">{item.label}</span>
                <span className="block truncate font-mono text-[9px] text-slate-500">{item.href}</span>
              </span>
            </a>
          ))}
          {filtered.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-xs text-slate-500">
              Nenhum comando encontrado.
            </div>
          ) : null}
        </div>
        <div className="mt-4 text-center font-mono text-[9px] text-slate-600">
          ESC fecha · {shortcut} abre · navegação instantânea
        </div>
      </Modal>
    </div>
  );
}
