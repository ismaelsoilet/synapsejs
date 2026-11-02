import { useCallback, useEffect, useRef, useState } from 'react';
import type { Result } from '../core/machine-types';
import { useSynapseContext } from './context';
import { useToast } from './toast';

export interface UseSubscriptionOptions {
  enabled?: boolean;
  onOpen?: () => void;
  onError?: (error: Event) => void;
}

export interface UseSubscriptionResult {
  isConnected: boolean;
  error: Error | null;
}

/**
 * Hook for subscribing to Server-Sent Events (SSE) from client UI.
 * Handles automatic subscription, message parsing, and teardown on unmount.
 */
export function useSubscription<T = unknown>(
  topic: string,
  onMessage: (data: T) => void,
  options: UseSubscriptionOptions = {}
): UseSubscriptionResult {
  const { enabled = true, onOpen, onError } = options;
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (
      !enabled ||
      typeof window === 'undefined' ||
      !(window as unknown as { EventSource?: typeof EventSource }).EventSource
    ) {
      return;
    }

    const sseUrl = `/_synapse/sse/${encodeURIComponent(topic)}`;
    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
      onOpenRef.current?.();
    };

    eventSource.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as T;
        onMessageRef.current(parsed);
      } catch (err) {
        console.error(`[useSubscription] Falha ao parsear evento SSE do tópico "${topic}":`, err);
      }
    };

    eventSource.onerror = (e) => {
      setIsConnected(false);
      const err = new Error(`Conexão SSE perdida para o tópico "${topic}"`);
      setError(err);
      onErrorRef.current?.(e);
    };

    return () => {
      eventSource.close();
      setIsConnected(false);
    };
  }, [topic, enabled]);

  return { isConnected, error };
}

export interface UseActionResult<TPayload, TData, TError> {
  execute: (payload: TPayload) => Promise<Result<TData, TError>>;
  isSubmitting: boolean;
  isLoading: boolean;
  data: TData | null;
  error: TError | null;
  isSuccess: boolean;
  isError: boolean;
  reset: () => void;
}

export interface UseActionOptions<TData, TError> {
  onSuccess?: (data: TData) => void;
  onError?: (error: TError) => void;
  toast?: boolean | { success?: string; error?: string };
}

/**
 * Hook for executing server actions from client UI with reactive state management.
 * If actionFn is not provided, it automatically resolves the slice's action from SynapseContext.
 */
export function useAction<TPayload = unknown, TData = unknown, TError = string>(
  actionFn?: ((payload: TPayload) => Promise<Result<TData, TError>>) | null,
  options?: UseActionOptions<TData, TError>
): UseActionResult<TPayload, TData, TError> {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [data, setData] = useState<TData | null>(null);
  const [error, setError] = useState<TError | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const toast = useToast();

  const ctx = useSynapseContext();
  const resolvedAction =
    actionFn ??
    (ctx.props?.action as ((payload: TPayload) => Promise<Result<TData, TError>>) | undefined) ??
    (ctx.props?.onSubmitAction as ((payload: TPayload) => Promise<Result<TData, TError>>) | undefined);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const reset = useCallback(() => {
    setIsSubmitting(false);
    setData(null);
    setError(null);
    setIsSuccess(false);
  }, []);

  const execute = useCallback(
    async (payload: TPayload): Promise<Result<TData, TError>> => {
      if (!resolvedAction) {
        const errVal = 'NO_ACTION_FUNCTION' as unknown as TError;
        setError(errVal);
        optionsRef.current?.onError?.(errVal);
        return { ok: false, error: errVal };
      }

      setIsSubmitting(true);
      setError(null);
      setIsSuccess(false);

      try {
        const result = await resolvedAction(payload);
        if (result.ok) {
          setData(result.value);
          setIsSuccess(true);
          setError(null);
          optionsRef.current?.onSuccess?.(result.value);
          if (optionsRef.current?.toast) {
            const successMsg =
              typeof optionsRef.current.toast === 'object' && optionsRef.current.toast.success
                ? optionsRef.current.toast.success
                : 'Ação executada com sucesso!';
            toast.success(successMsg);
          }
        } else {
          setError(result.error);
          setIsSuccess(false);
          optionsRef.current?.onError?.(result.error);
          if (optionsRef.current?.toast) {
            const errorMsg =
              typeof optionsRef.current.toast === 'object' && optionsRef.current.toast.error
                ? optionsRef.current.toast.error
                : String(result.error);
            toast.error(errorMsg);
          }
        }
        return result;
      } catch (err: unknown) {
        const failure = (err instanceof Error ? err.message : String(err)) as unknown as TError;
        setError(failure);
        setIsSuccess(false);
        optionsRef.current?.onError?.(failure);
        if (optionsRef.current?.toast) {
          toast.error(String(failure));
        }
        return { ok: false, error: failure };
      } finally {
        setIsSubmitting(false);
      }
    },
    [resolvedAction, toast]
  );

  return {
    execute,
    isSubmitting,
    isLoading: isSubmitting,
    data,
    error,
    isSuccess,
    isError: error !== null,
    reset
  };
}

/**
 * Hook for reading dynamic URL route parameters (e.g. /:domain/:name/:id).
 * Resolves from window.location pathname segments or SSR injected route params.
 */
export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  const ctx = useSynapseContext();
  const [params] = useState<T>(() => {
    if (ctx.props?.__synapse_params) {
      return ctx.props.__synapse_params as T;
    }
    if (typeof window !== 'undefined') {
      const globalParams = (window as unknown as { __SYNAPSE_ROUTE_PARAMS__?: T }).__SYNAPSE_ROUTE_PARAMS__;
      if (globalParams) return globalParams;
      const segments = window.location.pathname.split('/').filter(Boolean);
      if (segments.length >= 3) {
        const remaining = segments.slice(2);
        const mapped: Record<string, string> = { id: remaining[0] };
        for (let i = 0; i < remaining.length; i++) {
          mapped[`param${i + 1}`] = remaining[i];
        }
        return mapped as T;
      }
    }
    return {} as T;
  });

  return params;
}

/**
 * Hook for reading and mutating query string search parameters seamlessly.
 */
export function useSearchParams(): [
  URLSearchParams,
  (updater: Record<string, string | null | undefined> | URLSearchParams) => void
] {
  const ctx = useSynapseContext();
  const [searchParams, setSearchParamsState] = useState<URLSearchParams>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search);
    }
    if (ctx.url) {
      try {
        const u = new URL(ctx.url, 'http://localhost');
        return u.searchParams;
      } catch {
        // fallback
      }
    }
    return new URLSearchParams();
  });

  const setSearchParams = useCallback((updater: Record<string, string | null | undefined> | URLSearchParams) => {
    if (typeof window === 'undefined') return;

    const next = new URLSearchParams(window.location.search);
    if (updater instanceof URLSearchParams) {
      for (const [k, v] of updater.entries()) {
        next.set(k, v);
      }
    } else {
      for (const [k, v] of Object.entries(updater)) {
        if (v === null || v === undefined) {
          next.delete(k);
        } else {
          next.set(k, v);
        }
      }
    }

    const queryStr = next.toString();
    const newUrl = queryStr ? `${window.location.pathname}?${queryStr}` : window.location.pathname;
    window.history.pushState({}, '', newUrl);
    setSearchParamsState(next);
  }, []);

  return [searchParams, setSearchParams];
}
