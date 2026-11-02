import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        {eyebrow ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 animate-pulse" />
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-2xl font-black tracking-tight text-white md:text-4xl">{title}</h1>
        {description ? <p className="max-w-3xl text-sm leading-relaxed text-slate-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'cyan',
  delay = 0
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: 'cyan' | 'emerald' | 'amber' | 'violet' | 'rose';
  delay?: number;
}) {
  const tones = {
    cyan: 'from-cyan-500/20 to-blue-500/5 text-cyan-300 border-cyan-400/20',
    emerald: 'from-emerald-500/20 to-teal-500/5 text-emerald-300 border-emerald-400/20',
    amber: 'from-amber-500/20 to-orange-500/5 text-amber-300 border-amber-400/20',
    violet: 'from-violet-500/20 to-fuchsia-500/5 text-violet-300 border-violet-400/20',
    rose: 'from-rose-500/20 to-pink-500/5 text-rose-300 border-rose-400/20'
  } as const;

  return (
    <div
      className={`animate-fade-up group relative overflow-hidden rounded-2xl border bg-slate-900/70 p-5 shadow-xl backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:shadow-2xl ${tones[tone]}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`absolute inset-0 -z-10 bg-gradient-to-br opacity-60 ${tones[tone]}`} />
      <div className="flex items-start justify-between gap-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</span>
        {icon ? <span className="text-lg">{icon}</span> : null}
      </div>
      <div className="mt-3 font-mono text-3xl font-black tracking-tight text-white">{value}</div>
      {hint ? <div className="mt-2 text-[11px] text-slate-400">{hint}</div> : null}
      <div className="pointer-events-none absolute -bottom-8 -right-8 h-24 w-24 rounded-full bg-white/5 blur-2xl transition group-hover:bg-white/10" />
    </div>
  );
}

export function FeatureCard({
  href,
  icon,
  title,
  description,
  tag
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
  tag?: string;
}) {
  return (
    <a
      href={href}
      className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-5 transition duration-300 hover:-translate-y-1 hover:border-cyan-400/40 hover:bg-slate-900"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/15 to-violet-500/10 text-xl ring-1 ring-white/5">
          {icon}
        </span>
        {tag ? (
          <span className="rounded-full border border-slate-700 bg-slate-950/50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-slate-400">
            {tag}
          </span>
        ) : null}
      </div>
      <h3 className="mt-4 text-sm font-bold text-white transition group-hover:text-cyan-300">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p>
      <div className="mt-4 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-cyan-400 opacity-0 transition group-hover:opacity-100">
        Abrir demo <span className="transition group-hover:translate-x-1">→</span>
      </div>
    </a>
  );
}

export function EmptyState({
  icon = '◇',
  title,
  description,
  action
}: {
  icon?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/30 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-xl text-cyan-300 ring-1 ring-slate-800">
        {icon}
      </div>
      <h3 className="mt-4 text-sm font-bold text-white">{title}</h3>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-400">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function LinkButton({
  href,
  children,
  variant = 'primary',
  className = ''
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  className?: string;
}) {
  const styles = {
    primary: 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20 hover:bg-cyan-400',
    secondary: 'border border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'
  } as const;

  return (
    <a
      href={href}
      className={`inline-flex items-center justify-center rounded-md px-3.5 py-2 text-sm font-semibold transition-colors ${styles[variant]} ${className}`}
    >
      {children}
    </a>
  );
}

export function Sparkline({ values, color = '#22d3ee' }: { values: number[]; color?: string }) {
  const safe = values.length > 1 ? values : [0, 0];
  const max = Math.max(...safe, 1);
  const min = Math.min(...safe, 0);
  const range = Math.max(max - min, 1);
  const points = safe
    .map((value, index) => {
      const x = (index / (safe.length - 1)) * 120;
      const y = 34 - ((value - min) / range) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 120 38" className="h-10 w-full overflow-visible" role="img" aria-label="Tendência">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,38 ${points} 120,38`} fill="url(#spark-fill)" stroke="none" />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/** Stable across SSR and hydration (no Date.now() in the rendered text). */
export function formatDate(value?: string | number | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '—';
}

export function timeAgo(value?: string | number | null): string {
  if (!value) return 'agora';
  const timestamp = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'agora';
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s atrás`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min atrás`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h atrás`;
  return `${Math.floor(seconds / 86400)}d atrás`;
}
