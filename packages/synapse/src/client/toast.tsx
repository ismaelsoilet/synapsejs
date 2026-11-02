import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ============================================================================
// TOAST NOTIFICATION TYPES
// ============================================================================
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  durationMs?: number;
}

export interface ToastContextValue {
  toast: (options: Omit<ToastItem, 'id'>) => string;
  success: (message: string, title?: string) => string;
  error: (message: string, title?: string) => string;
  warning: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let globalToastEmitter: ((item: Omit<ToastItem, 'id'>) => string) | null = null;

// ============================================================================
// TOAST PROVIDER & FLOATING STACK
// ============================================================================
export interface ToastProviderProps {
  children?: ReactNode;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  maxToasts?: number;
}

export function ToastProvider({ children, position = 'bottom-right', maxToasts = 5 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clear = useCallback(() => {
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const toast = useCallback(
    (options: Omit<ToastItem, 'id'>): string => {
      const id = `toast_${Math.random().toString(36).substring(2, 9)}`;
      const duration = options.durationMs ?? 4000;
      const newItem: ToastItem = { ...options, id };

      setToasts((prev) => {
        const next = [...prev, newItem];
        if (next.length > maxToasts) {
          const evicted = next.shift();
          if (evicted) {
            const timer = timersRef.current.get(evicted.id);
            if (timer) clearTimeout(timer);
            timersRef.current.delete(evicted.id);
          }
        }
        return next;
      });

      if (duration > 0) {
        const timer = setTimeout(() => {
          dismiss(id);
        }, duration);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [dismiss, maxToasts]
  );

  const success = useCallback((message: string, title?: string) => toast({ type: 'success', message, title }), [toast]);
  const error = useCallback((message: string, title?: string) => toast({ type: 'error', message, title }), [toast]);
  const warning = useCallback((message: string, title?: string) => toast({ type: 'warning', message, title }), [toast]);
  const info = useCallback((message: string, title?: string) => toast({ type: 'info', message, title }), [toast]);

  useEffect(() => {
    globalToastEmitter = toast;
    return () => {
      globalToastEmitter = null;
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
      timersRef.current.clear();
    };
  }, [toast]);

  const positionStyles = {
    'top-right': 'top-4 right-4 items-end',
    'top-left': 'top-4 left-4 items-start',
    'bottom-right': 'bottom-4 right-4 items-end',
    'bottom-left': 'bottom-4 left-4 items-start'
  };

  const typeConfig: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
    success: {
      bg: 'bg-emerald-950/90',
      border: 'border-emerald-800',
      text: 'text-emerald-300',
      icon: '✓'
    },
    error: {
      bg: 'bg-rose-950/90',
      border: 'border-rose-800',
      text: 'text-rose-300',
      icon: '✕'
    },
    warning: {
      bg: 'bg-amber-950/90',
      border: 'border-amber-800',
      text: 'text-amber-300',
      icon: '⚠'
    },
    info: {
      bg: 'bg-sky-950/90',
      border: 'border-sky-800',
      text: 'text-sky-300',
      icon: 'ℹ'
    }
  };

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info, dismiss, clear }}>
      {children}
      <div
        aria-live="polite"
        className={`fixed z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none p-4 ${positionStyles[position]}`}
      >
        {toasts.map((item) => {
          const conf = typeConfig[item.type] || typeConfig.info;
          return (
            <div
              key={item.id}
              role="alert"
              className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border backdrop-blur-md shadow-2xl transition-all duration-200 transform translate-y-0 text-xs w-full ${conf.bg} ${conf.border}`}
            >
              <span
                className={`h-5 w-5 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${conf.text} bg-slate-900/60 border ${conf.border}`}
              >
                {conf.icon}
              </span>
              <div className="flex-1 min-w-0">
                {item.title && <h5 className={`font-bold mb-0.5 ${conf.text}`}>{item.title}</h5>}
                <p className="text-slate-200 leading-relaxed break-words">{item.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Fechar notificação"
                className="text-slate-400 hover:text-white transition-colors text-sm font-mono shrink-0 ml-1 p-0.5"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// ============================================================================
// HOOK & IMPERATIVE API
// ============================================================================
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback gracioso caso chamado fora do provider ou no server
    return {
      toast: (opts) => {
        if (globalToastEmitter) return globalToastEmitter(opts);
        if (typeof console !== 'undefined') console.log(`[Toast ${opts.type}] ${opts.message}`);
        return 'noop';
      },
      success: (msg, title) => {
        if (globalToastEmitter) return globalToastEmitter({ type: 'success', message: msg, title });
        if (typeof console !== 'undefined') console.log(`[Toast success] ${msg}`);
        return 'noop';
      },
      error: (msg, title) => {
        if (globalToastEmitter) return globalToastEmitter({ type: 'error', message: msg, title });
        if (typeof console !== 'undefined') console.error(`[Toast error] ${msg}`);
        return 'noop';
      },
      warning: (msg, title) => {
        if (globalToastEmitter) return globalToastEmitter({ type: 'warning', message: msg, title });
        if (typeof console !== 'undefined') console.warn(`[Toast warning] ${msg}`);
        return 'noop';
      },
      info: (msg, title) => {
        if (globalToastEmitter) return globalToastEmitter({ type: 'info', message: msg, title });
        if (typeof console !== 'undefined') console.info(`[Toast info] ${msg}`);
        return 'noop';
      },
      dismiss: () => {},
      clear: () => {}
    };
  }
  return ctx;
}
