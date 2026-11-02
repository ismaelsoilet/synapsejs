import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { useRef, useState } from 'react';
import {
  type ActionContext,
  type DatabaseClient,
  Err,
  MockDatabaseClient,
  Ok,
  type Result,
  type SessionContext,
  type SliceLoaderContext
} from 'synapsejs';
import { Button, useUpload } from 'synapsejs/client';
import { Icon } from '../../shared/icons';
import { toUploadKey } from '../../shared/showcase';
import { EmptyState, formatBytes, formatDate, PageHeader } from '../../shared/ui';

export const FilesInputSchema = Type.Object(
  {
    operation: Type.Union([Type.Literal('register'), Type.Literal('delete')]),
    id: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    path: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    bytes: Type.Optional(Type.Number({ minimum: 0 })),
    mime: Type.Optional(Type.String({ maxLength: 120 }))
  },
  { additionalProperties: true }
);
export type FilesInput = Static<typeof FilesInputSchema>;

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS showcase_files (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    bytes INTEGER NOT NULL,
    mime TEXT,
    uploaded_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

export interface FileRow {
  id: string;
  name: string;
  path: string;
  bytes: number;
  mime: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export type FilesOutput = Result<
  { file?: FileRow; deleted?: boolean },
  'INVALID_SCHEMA' | 'NO_DATABASE' | 'UNAUTHORIZED' | 'INVALID_PATH' | 'NOT_FOUND' | 'STORAGE_FAILED'
>;

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'text/markdown'
];

export async function filesAction(
  payload: unknown,
  db?: DatabaseClient,
  session?: SessionContext,
  ctx?: ActionContext
): Promise<FilesOutput> {
  if (!db) return Err('NO_DATABASE');
  if (!session?.isAuthenticated) return Err('UNAUTHORIZED');
  if (!Value.Check(FilesInputSchema, payload)) return Err('INVALID_SCHEMA');

  const input = payload as FilesInput;

  if (input.operation === 'register') {
    if (!input.name || !input.path || typeof input.bytes !== 'number') return Err('INVALID_SCHEMA');
    const key = toUploadKey(input.path);
    if (!key) return Err('INVALID_PATH');

    try {
      const file = await db.insert<FileRow>('showcase_files', {
        id: crypto.randomUUID(),
        name: input.name,
        path: input.path,
        bytes: input.bytes,
        mime: input.mime || null,
        uploaded_by: session.userId ?? 'anon'
      });
      return Ok({ file });
    } catch {
      return Err('STORAGE_FAILED');
    }
  }

  if (!input.id) return Err('INVALID_SCHEMA');
  const rows = await db.query<FileRow>('SELECT * FROM showcase_files WHERE id = $1', [input.id]);
  const file = rows[0];
  if (!file) return Err('NOT_FOUND');

  const key = toUploadKey(file.path);
  if (key) {
    try {
      await ctx?.storage.delete(key);
    } catch {
      // The metadata is still removable even if the local object already vanished.
    }
  }

  await db.query('DELETE FROM showcase_files WHERE id = $1', [file.id]);
  return Ok({ deleted: true });
}

export interface FilesLoaderData {
  files: FileRow[];
  requiresAuth: boolean;
  maxBytes: number;
}

export async function FilesLoader(context: SliceLoaderContext): Promise<FilesLoaderData> {
  if (!context.session.isAuthenticated) {
    return { files: [], requiresAuth: true, maxBytes: MAX_BYTES };
  }

  try {
    const files = await context.db.query<FileRow>('SELECT * FROM showcase_files ORDER BY created_at DESC LIMIT 100');
    return { files, requiresAuth: false, maxBytes: MAX_BYTES };
  } catch {
    return { files: [], requiresAuth: false, maxBytes: MAX_BYTES };
  }
}

export interface FilesTriggerProps extends FilesLoaderData {
  onSubmitAction?: (payload: unknown) => Promise<FilesOutput>;
}

function keyFromPath(filePath: string): string {
  return filePath.replace(/^\.synapse\/uploads\//, '');
}

function downloadUrl(file: FileRow): string {
  return `/_showcase/download?key=${encodeURIComponent(keyFromPath(file.path))}&download=1`;
}

function previewUrl(file: FileRow): string {
  return `/_showcase/download?key=${encodeURIComponent(keyFromPath(file.path))}`;
}

export function FilesTrigger({
  files = [],
  requiresAuth = false,
  maxBytes = MAX_BYTES,
  onSubmitAction
}: FilesTriggerProps) {
  const [items, setItems] = useState<FileRow[]>(files);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUpload({
    url: '/_synapse/files/showcase/files',
    maxBytes,
    allowedTypes: ALLOWED_MIME
  });

  const handleFiles = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    setMessage(null);

    const result = await upload.upload(file);
    if (!result.ok) {
      setMessage(`Upload recusado: ${String(result.error)}`);
      return;
    }

    const uploaded = result.value as { path?: string; bytes?: number } | null;
    if (!uploaded?.path) {
      setMessage('O endpoint não devolveu o caminho do arquivo.');
      return;
    }

    const registered = await onSubmitAction?.({
      operation: 'register',
      name: file.name,
      path: uploaded.path,
      bytes: file.size,
      mime: file.type
    });

    if (!registered?.ok) {
      setMessage(`Arquivo salvo, mas o registro falhou: ${registered ? registered.error : 'sem ação'}`);
      return;
    }

    if (registered.value.file) {
      setItems((current) => [registered.value.file as FileRow, ...current]);
    }
    setMessage('Upload concluído e registrado no banco.');
  };

  const remove = async (file: FileRow) => {
    const result = await onSubmitAction?.({ operation: 'delete', id: file.id });
    if (result?.ok) {
      setItems((current) => current.filter((item) => item.id !== file.id));
      setMessage(`"${file.name}" removido.`);
    } else {
      setMessage(`Não foi possível remover: ${result?.error ?? 'sem ação'}`);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Uploads & downloads"
        title="Central de arquivos"
        description="Upload real com progresso e abort, validação de tipo/tamanho, metadados no SQLite, preview de imagens e download autenticado."
        actions={
          <a href="/showcase/platform" className="text-xs font-semibold text-slate-400 hover:text-cyan-300">
            Ver feature no catálogo →
          </a>
        }
      />

      {requiresAuth ? (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5">
          <div className="text-sm font-bold text-amber-200">Faça login para enviar e baixar arquivos</div>
          <p className="mt-1 text-xs text-amber-100/80">
            O endpoint <code>POST /_synapse/files/showcase/files</code> exige sessão autenticada. O download também
            valida o cookie assinado.
          </p>
          <a
            href="/auth/login?redirectTo=/showcase/files"
            className="mt-4 inline-flex rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-amber-950"
          >
            Entrar com conta demo
          </a>
        </div>
      ) : (
        <section
          aria-label="Área de upload de arquivos"
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void handleFiles(event.dataTransfer.files);
          }}
          className={`relative overflow-hidden rounded-2xl border-2 border-dashed p-8 text-center transition ${
            dragging ? 'border-cyan-400 bg-cyan-400/10' : 'border-slate-700 bg-slate-900/40 hover:border-slate-600'
          }`}
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/10 text-cyan-300">
            <Icon name="upload" className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-sm font-bold text-white">Arraste um arquivo ou escolha do disco</h2>
          <p className="mt-1 text-xs text-slate-400">
            Até <span className="font-mono text-slate-300">{formatBytes(maxBytes)}</span> · PNG, JPG, GIF, WEBP, PDF,
            TXT, CSV, JSON, MD
          </p>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.json,.md"
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={upload.isUploading}>
              {upload.isUploading ? 'Enviando…' : 'Selecionar arquivo'}
            </Button>
            {upload.isUploading ? (
              <Button variant="secondary" onClick={upload.abort}>
                Cancelar
              </Button>
            ) : null}
          </div>

          {upload.isUploading || upload.progress > 0 ? (
            <div className="mx-auto mt-5 max-w-md">
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-200"
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
                <span>{upload.progress}%</span>
                <span>
                  {formatBytes(upload.loaded)} / {formatBytes(upload.total)}
                </span>
              </div>
            </div>
          ) : null}
        </section>
      )}

      {message ? (
        <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-xs text-slate-300">
          {message}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Arquivos armazenados</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {items.length} registro{items.length === 1 ? '' : 's'} · storage local em <code>.synapse/uploads</code>
            </p>
          </div>
          <span className="rounded-full border border-slate-700 px-2.5 py-1 font-mono text-[9px] text-slate-400">
            auth + path guard
          </span>
        </div>

        {items.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<Icon name="folder" className="h-5 w-5" />}
              title="Nenhum arquivo ainda"
              description="Envie o primeiro arquivo para ver o fluxo completo de upload, registro e download."
            />
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((file) => {
              const isImage = (file.mime ?? '').startsWith('image/');
              return (
                <div
                  key={file.id}
                  className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40 transition hover:border-slate-700"
                >
                  {isImage ? (
                    <a href={previewUrl(file)} target="_blank" rel="noreferrer">
                      <img
                        src={previewUrl(file)}
                        alt={file.name}
                        className="h-36 w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                    </a>
                  ) : (
                    <div className="flex h-36 items-center justify-center bg-gradient-to-br from-slate-900 to-slate-950 text-4xl">
                      <Icon
                        name={file.mime === 'application/pdf' ? 'file' : file.mime?.includes('json') ? 'code' : 'file'}
                        className="h-7 w-7 text-slate-500"
                      />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="truncate text-xs font-bold text-white" title={file.name}>
                      {file.name}
                    </div>
                    <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-500">
                      <span>{formatBytes(file.bytes)}</span>
                      <span>{formatDate(file.created_at)}</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <a
                        href={downloadUrl(file)}
                        className="flex-1 rounded-lg border border-slate-700 px-2 py-1.5 text-center text-[10px] font-bold text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-300"
                      >
                        Baixar
                      </a>
                      {!requiresAuth ? (
                        <button
                          type="button"
                          onClick={() => void remove(file)}
                          className="rounded-lg border border-rose-500/20 px-2 py-1.5 text-[10px] font-bold text-rose-300 transition hover:bg-rose-500/10"
                        >
                          Remover
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 font-mono text-[10px] leading-relaxed text-slate-500">
        Fluxo: useUpload → POST /_synapse/files/showcase/files (sessão + tipo real dos bytes) → filesAction registra
        metadados → GET /_showcase/download?key=... (cookie assinado) → Content-Disposition.
      </div>
    </div>
  );
}

export function sliceMeta() {
  return {
    title: 'Arquivos | Synapse Showcase',
    description: 'Upload com progresso e abort, download autenticado e storage local no SynapseJS.'
  };
}

export const sliceTests = {
  description: 'Invariantes da central de arquivos',
  cases: [
    {
      name: 'sem sessão o upload/registro retorna UNAUTHORIZED',
      run: async () => {
        const result = await filesAction(
          { operation: 'register', name: 'x.txt', path: '.synapse/uploads/showcase/x.txt', bytes: 1 },
          new MockDatabaseClient()
        );
        if (result.ok || result.error !== 'UNAUTHORIZED') throw new Error('esperava UNAUTHORIZED');
      }
    },
    {
      name: 'path fora de .synapse/uploads/showcase é recusado',
      run: async () => {
        const result = await filesAction(
          { operation: 'register', name: 'x.txt', path: '../../etc/passwd', bytes: 1 },
          new MockDatabaseClient(),
          { isAuthenticated: true, roles: ['admin'], userId: 'u1' }
        );
        if (result.ok || result.error !== 'INVALID_PATH') throw new Error('esperava INVALID_PATH');
      }
    },
    {
      name: 'delete de arquivo inexistente retorna NOT_FOUND',
      run: async () => {
        const db = new MockDatabaseClient().onQuery(/SELECT \* FROM showcase_files/, () => []);
        const result = await filesAction({ operation: 'delete', id: 'missing' }, db, {
          isAuthenticated: true,
          roles: ['admin'],
          userId: 'u1'
        });
        if (result.ok || result.error !== 'NOT_FOUND') throw new Error('esperava NOT_FOUND');
      }
    }
  ]
};
