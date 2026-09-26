import type { Database } from 'bun:sqlite';
import { assignTicket, type Session } from '../services/ticket-service';

export async function handleAssignTicket(request: Request, db: Database): Promise<Response> {
  const session = readSession(request);
  const payload = await request.json().catch(() => null);
  const result = assignTicket(payload, db, session);

  return Response.json(result, { status: result.ok ? 200 : 400 });
}

function readSession(request: Request): Session | undefined {
  const roles = request.headers.get('x-user-roles');
  if (!roles) {
    return undefined;
  }
  return { userId: request.headers.get('x-user-id') ?? 'anonymous', roles: roles.split(',').map((r) => r.trim()) };
}
