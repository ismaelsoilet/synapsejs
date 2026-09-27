import { useCallback, useEffect, useRef, useState } from 'react';
import type { Result } from '../core/machine-types';

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

/**
 * Hook for executing server actions from client UI with reactive state management.
 */
export function useAction<TPayload = unknown, TData = unknown, TError = string>(
  actionFn?: (payload: TPayload) => Promise<Result<TData, TError>>
): UseActionResult<TPayload, TData, TError> {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [data, setData] = useState<TData | null>(null);
  const [error, setError] = useState<TError | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  const reset = useCallback(() => {
    setIsSubmitting(false);
    setData(null);
    setError(null);
    setIsSuccess(false);
  }, []);

  const execute = useCallback(
    async (payload: TPayload): Promise<Result<TData, TError>> => {
      if (!actionFn) {
        const errVal = 'NO_ACTION_FUNCTION' as unknown as TError;
        setError(errVal);
        return { ok: false, error: errVal };
      }

      setIsSubmitting(true);
      setError(null);
      setIsSuccess(false);

      try {
        const result = await actionFn(payload);
        if (result.ok) {
          setData(result.value);
          setIsSuccess(true);
          setError(null);
        } else {
          setError(result.error);
          setIsSuccess(false);
        }
        return result;
      } catch (err: unknown) {
        const failure = (err instanceof Error ? err.message : String(err)) as unknown as TError;
        setError(failure);
        setIsSuccess(false);
        return { ok: false, error: failure };
      } finally {
        setIsSubmitting(false);
      }
    },
    [actionFn]
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
