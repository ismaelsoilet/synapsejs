import { useCallback, useRef, useState } from 'react';
import type { Result } from '../core/machine-types';

export interface UseUploadOptions {
  /** Target upload URL (default: /_synapse/files/general) */
  url?: string;
  /** Maximum allowed file size in bytes (default: 50MB) */
  maxBytes?: number;
  /** Allowed MIME types (e.g. ['image/png', 'image/jpeg', 'application/pdf']) */
  allowedTypes?: string[];
  /** Callback fired as upload progress increments */
  onProgress?: (percent: number, loaded: number, total: number) => void;
  /** Callback fired on successful upload completion */
  onSuccess?: (response: unknown) => void;
  /** Callback fired on upload failure */
  onError?: (error: Error) => void;
}

export interface UseUploadResult {
  upload: (file: File) => Promise<Result<unknown, string>>;
  progress: number;
  loaded: number;
  total: number;
  isUploading: boolean;
  abort: () => void;
  reset: () => void;
}

/**
 * Universal browser hook for client-side file uploads with granular progress events and abort controls.
 */
export function useUpload(options: UseUploadOptions = {}): UseUploadResult {
  const [progress, setProgress] = useState<number>(0);
  const [loaded, setLoaded] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const reset = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setProgress(0);
    setLoaded(0);
    setTotal(0);
    setIsUploading(false);
  }, []);

  const abort = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
      setIsUploading(false);
    }
  }, []);

  const upload = useCallback(
    async (file: File): Promise<Result<unknown, string>> => {
      // 1. Client-Side Pre-Flight Validations
      if (options.maxBytes && file.size > options.maxBytes) {
        const err = `Arquivo excede o tamanho máximo permitido (${options.maxBytes} bytes)`;
        options.onError?.(new Error(err));
        return { ok: false, error: 'FILE_TOO_LARGE' };
      }

      if (options.allowedTypes && options.allowedTypes.length > 0) {
        if (!options.allowedTypes.includes(file.type)) {
          const err = `Tipo de arquivo "${file.type}" não permitido. Aceitos: ${options.allowedTypes.join(', ')}`;
          options.onError?.(new Error(err));
          return { ok: false, error: 'FILE_TYPE_NOT_ALLOWED' };
        }
      }

      setIsUploading(true);
      setProgress(0);
      setLoaded(0);
      setTotal(file.size);

      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        const targetUrl = options.url || '/_synapse/files/general';
        xhr.open('POST', targetUrl, true);
        xhr.setRequestHeader('Accept', 'application/json');

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setProgress(pct);
            setLoaded(e.loaded);
            setTotal(e.total);
            options.onProgress?.(pct, e.loaded, e.total);
          }
        };

        xhr.onload = () => {
          setIsUploading(false);
          xhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            setProgress(100);
            try {
              const res = JSON.parse(xhr.responseText);
              options.onSuccess?.(res);
              resolve({ ok: true, value: res });
            } catch {
              options.onSuccess?.(xhr.responseText);
              resolve({ ok: true, value: xhr.responseText });
            }
          } else {
            let errorMsg = `Upload falhou com status HTTP ${xhr.status}`;
            try {
              const parsed = JSON.parse(xhr.responseText);
              if (parsed.error) errorMsg = parsed.error;
            } catch {}
            options.onError?.(new Error(errorMsg));
            resolve({ ok: false, error: errorMsg });
          }
        };

        xhr.onerror = () => {
          setIsUploading(false);
          xhrRef.current = null;
          const err = new Error('Erro de rede ao enviar arquivo.');
          options.onError?.(err);
          resolve({ ok: false, error: 'NETWORK_ERROR' });
        };

        xhr.onabort = () => {
          setIsUploading(false);
          xhrRef.current = null;
          resolve({ ok: false, error: 'UPLOAD_ABORTED' });
        };

        const formData = new FormData();
        formData.append('file', file, file.name);
        xhr.send(formData);
      });
    },
    [options]
  );

  return {
    upload,
    progress,
    loaded,
    total,
    isUploading,
    abort,
    reset
  };
}
