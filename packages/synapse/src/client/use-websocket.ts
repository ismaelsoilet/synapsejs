import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseWebSocketOptions<TServerMsg = unknown> {
  enabled?: boolean;
  reconnect?: boolean;
  reconnectIntervalMs?: number;
  onOpen?: () => void;
  onMessage?: (message: TServerMsg) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
}

export interface UseWebSocketResult<TServerMsg = unknown, TClientMsg = unknown> {
  isConnected: boolean;
  lastMessage: TServerMsg | null;
  send: (data: TClientMsg | string) => void;
  close: () => void;
  error: Error | null;
}

/**
 * Hook for bidirectional WebSocket communication with SynapseJS slices.
 */
export function useWebSocket<TServerMsg = unknown, TClientMsg = unknown>(
  pathOrSlice: string,
  options: UseWebSocketOptions<TServerMsg> = {}
): UseWebSocketResult<TServerMsg, TClientMsg> {
  const { enabled = true, reconnect = true, reconnectIntervalMs = 3000 } = options;

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [lastMessage, setLastMessage] = useState<TServerMsg | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const resolveUrl = useCallback((path: string): string => {
    if (typeof window === 'undefined') return '';
    if (path.startsWith('ws://') || path.startsWith('wss://')) return path;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;

    if (path.startsWith('/')) {
      return `${protocol}//${host}${path}`;
    }
    // Formato <domain>/<name>
    return `${protocol}//${host}/_synapse/ws/${path}`;
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let isMounted = true;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      try {
        const url = resolveUrl(pathOrSlice);
        if (!url) return;

        const ws = new WebSocket(url);
        socketRef.current = ws;

        ws.onopen = () => {
          if (!isMounted) return;
          setIsConnected(true);
          setError(null);
          optionsRef.current.onOpen?.();
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data) as TServerMsg;
            setLastMessage(data);
            optionsRef.current.onMessage?.(data);
          } catch {
            const raw = event.data as unknown as TServerMsg;
            setLastMessage(raw);
            optionsRef.current.onMessage?.(raw);
          }
        };

        ws.onerror = (e) => {
          if (!isMounted) return;
          const err = new Error(`Erro na conexão WebSocket para "${pathOrSlice}"`);
          setError(err);
          optionsRef.current.onError?.(e);
        };

        ws.onclose = (e) => {
          if (!isMounted) return;
          setIsConnected(false);
          optionsRef.current.onClose?.(e);

          if (reconnect && isMounted && !e.wasClean) {
            reconnectTimeout = setTimeout(connect, reconnectIntervalMs);
          }
        };
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      setIsConnected(false);
    };
  }, [pathOrSlice, enabled, reconnect, reconnectIntervalMs, resolveUrl]);

  const send = useCallback(
    (data: TClientMsg | string) => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        socketRef.current.send(payload);
      } else {
        console.warn(`[useWebSocket] Tentativa de envio em socket desconectado (${pathOrSlice})`);
      }
    },
    [pathOrSlice]
  );

  const close = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
    }
  }, []);

  return {
    isConnected,
    lastMessage,
    send,
    close,
    error
  };
}
