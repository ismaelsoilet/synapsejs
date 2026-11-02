import { useEffect, useState } from 'react';
import { Modal } from 'synapsejs/client';
import { Icon } from './icons';

export type ThemeMode = 'dark' | 'light' | 'system';
export type Accent = 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose';

export const THEME_STORAGE_KEY = 'showcase.theme';
export const ACCENT_STORAGE_KEY = 'showcase.accent';
export const MOTION_STORAGE_KEY = 'showcase.motion';

export const ACCENTS: Array<{ id: Accent; label: string; color: string; dark: string }> = [
  { id: 'cyan', label: 'Ciano', color: '#22d3ee', dark: '#0e7490' },
  { id: 'violet', label: 'Violeta', color: '#a78bfa', dark: '#6d28d9' },
  { id: 'emerald', label: 'Esmeralda', color: '#34d399', dark: '#047857' },
  { id: 'amber', label: 'Âmbar', color: '#fbbf24', dark: '#b45309' },
  { id: 'rose', label: 'Rosa', color: '#fb7185', dark: '#be123c' }
];

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function readStored<T extends string>(key: string, fallback: T): T {
  try {
    return (globalThis.localStorage?.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

export function applyTheme(mode: ThemeMode, accent: Accent, motion: boolean, animate = false) {
  const root = document.documentElement;
  const resolved = resolve(mode);
  root.dataset.theme = resolved;
  root.dataset.themeMode = mode;
  root.dataset.accent = accent;
  root.dataset.motion = motion ? 'on' : 'off';
  root.style.colorScheme = resolved;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
    localStorage.setItem(MOTION_STORAGE_KEY, motion ? 'on' : 'off');
  } catch {
    // Private mode/storage disabled: the in-page preference still applies.
  }

  if (animate && motion) {
    root.classList.add('theme-changing');
    window.setTimeout(() => root.classList.remove('theme-changing'), 360);
  }
}

export function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>('system');
  const [accent, setAccent] = useState<Accent>('cyan');
  const [motion, setMotion] = useState(true);

  useEffect(() => {
    const storedMode = readStored<ThemeMode>(THEME_STORAGE_KEY, 'system');
    const storedAccent = readStored<Accent>(ACCENT_STORAGE_KEY, 'cyan');
    const storedMotion = readStored<string>(MOTION_STORAGE_KEY, 'on') !== 'off';
    setMode(storedMode);
    setAccent(storedAccent);
    setMotion(storedMotion);
  }, []);

  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyTheme('system', accent, motion, true);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, [mode, accent, motion]);

  const chooseMode = (next: ThemeMode) => {
    setMode(next);
    applyTheme(next, accent, motion, true);
  };

  const chooseAccent = (next: Accent) => {
    setAccent(next);
    applyTheme(mode, next, motion, true);
  };

  const toggleMotion = () => {
    const next = !motion;
    setMotion(next);
    applyTheme(mode, accent, next, false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/60 text-slate-400 transition hover:border-slate-700 hover:text-slate-100"
        aria-label="Aparência: tema, cor e movimento"
        title="Aparência"
      >
        <Icon name="palette" className="h-4 w-4" />
      </button>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Aparência"
        description="Tema, cor de destaque e movimento do showcase."
        size="md"
      >
        <div className="space-y-6">
          <section>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Tema</div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'light', label: 'Claro', icon: 'sun' },
                  { id: 'dark', label: 'Escuro', icon: 'moon' },
                  { id: 'system', label: 'Sistema', icon: 'monitor' }
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => chooseMode(option.id)}
                  aria-pressed={mode === option.id}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-[11px] font-semibold transition ${
                    mode === option.id
                      ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200'
                      : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <Icon name={option.icon} className="h-4 w-4" />
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Cor de destaque</div>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => chooseAccent(option.id)}
                  aria-label={`Usar cor ${option.label}`}
                  aria-pressed={accent === option.id}
                  title={option.label}
                  className={`h-9 w-9 rounded-full border-2 transition hover:scale-110 ${
                    accent === option.id ? 'border-white/80 ring-2 ring-white/20' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: option.color }}
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              A cor muda links, botões, destaques e o brilho dos gráficos.
            </p>
          </section>

          <section className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3">
            <div>
              <div className="text-xs font-semibold text-slate-200">Animações</div>
              <div className="mt-0.5 text-[10px] text-slate-500">
                Ripple, transições, entrada de cartões e contadores.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={motion}
              onClick={toggleMotion}
              className={`relative h-6 w-11 rounded-full border transition ${
                motion ? 'border-cyan-400/40 bg-cyan-400/20' : 'border-slate-700 bg-slate-800'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                  motion ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </section>

          <div className="flex items-center justify-between border-t border-slate-800 pt-3">
            <button
              type="button"
              onClick={() => {
                setMode('system');
                setAccent('cyan');
                setMotion(true);
                applyTheme('system', 'cyan', true, true);
              }}
              className="text-[11px] font-semibold text-slate-500 transition hover:text-slate-200"
            >
              Restaurar padrão
            </button>
            <span className="text-[10px] text-slate-600">salvo neste navegador</span>
          </div>
        </div>
      </Modal>
    </>
  );
}
