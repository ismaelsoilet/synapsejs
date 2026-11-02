import * as fs from 'node:fs';
import * as path from 'node:path';
import { createActionContext, createSession, defineConfig } from 'synapsejs';
import { sessionFromRequest } from './src/shared/showcase';

const STREAM_TOKENS = [
  '⚡ ',
  'SynapseJS ',
  'está ',
  'transmitindo ',
  'esta ',
  'resposta ',
  'em ',
  'chunks ',
  'HTTP ',
  'reais, ',
  'gerados ',
  'pelo ',
  'ctx.stream(). ',
  'Cada ',
  'token ',
  'chega ',
  'ao ',
  'navegador ',
  'sem ',
  'buffer ',
  'intermediário. '
];

export default defineConfig({
  plugins: [
    {
      name: 'showcase-routes',
      onRequest(request) {
        const url = new URL(request.url);

        if (url.pathname === '/_showcase/stream') {
          if (request.method !== 'GET') {
            return Response.json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
          }

          const ctx = createActionContext({
            db: {} as never,
            session: createSession({ userId: 'showcase-stream', roles: ['viewer'] }),
            sliceOwner: 'showcase/stream'
          });

          return ctx.stream(
            async function* () {
              for (const token of STREAM_TOKENS) {
                yield token;
                await Bun.sleep(95);
              }
            },
            {
              contentType: 'text/plain; charset=utf-8',
              headers: {
                'Cache-Control': 'no-store, no-transform',
                'X-Accel-Buffering': 'no'
              }
            }
          );
        }

        if (url.pathname === '/_showcase/download') {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            return Response.json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
          }

          const session = sessionFromRequest(request);
          if (!session) {
            return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
          }

          const key = url.searchParams.get('key');
          if (!key) {
            return Response.json({ ok: false, error: 'MISSING_KEY' }, { status: 400 });
          }

          const uploadsRoot = path.resolve(process.cwd(), '.synapse', 'uploads');
          const target = path.resolve(uploadsRoot, key);
          if (!target.startsWith(`${uploadsRoot}${path.sep}`)) {
            return Response.json({ ok: false, error: 'FORBIDDEN_PATH' }, { status: 403 });
          }
          if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
            return Response.json({ ok: false, error: 'FILE_NOT_FOUND' }, { status: 404 });
          }

          const file = Bun.file(target);
          const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
          const fileName = path.basename(target).replace(/["\\\r\n]/g, '');

          return new Response(file, {
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
              'Content-Disposition': `${disposition}; filename="${fileName}"`,
              'Cache-Control': 'private, max-age=60',
              'X-Content-Type-Options': 'nosniff'
            }
          });
        }

        return undefined;
      }
    }
  ]
});
