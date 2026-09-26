import { openDatabase } from './db/tickets';
import { handleAssignTicket } from './routes/assign-ticket';
import { handleCreateTicket } from './routes/create-ticket';
import { listTickets } from './services/ticket-service';

const db = openDatabase(process.env.DATABASE_FILE ?? '.synapse/tickets.sqlite');

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3001),
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/tickets') {
      return handleCreateTicket(request, db);
    }
    if (request.method === 'POST' && url.pathname === '/tickets/assign') {
      return handleAssignTicket(request, db);
    }
    if (request.method === 'GET' && url.pathname === '/tickets') {
      return Response.json({ tickets: listTickets(db) });
    }

    return new Response('Not Found', { status: 404 });
  }
});

console.log(`helpdesk-conventional ouvindo em http://localhost:${server.port}`);
