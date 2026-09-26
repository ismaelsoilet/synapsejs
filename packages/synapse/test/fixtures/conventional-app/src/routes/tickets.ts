import { createTicket } from '../services/ticket-service';

export function handleCreateTicket(request: Request): Response {
  const subject = new URL(request.url).searchParams.get('subject') ?? 'sem assunto';
  return Response.json(createTicket(subject));
}
