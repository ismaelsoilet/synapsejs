import type React from 'react';
import { useState } from 'react';
import type { Ticket } from '../schemas/ticket';

async function post(path: string, payload: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

export function TicketForm() {
  const [feedback, setFeedback] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const result = (await post('/tickets', {
      subject: formData.get('subject'),
      priority: Number(formData.get('priority')),
      requesterEmail: formData.get('requesterEmail')
    })) as { ok: boolean; value?: { ticketId: string }; error?: string };

    setFeedback(result.ok ? `Chamado aberto: ${result.value?.ticketId}` : `Erro: ${result.error}`);
  };

  return (
    <form onSubmit={submit}>
      <input name="subject" placeholder="Assunto" required />
      <input name="priority" type="number" min={1} max={5} defaultValue={3} required />
      <input name="requesterEmail" type="email" placeholder="solicitante@empresa.com" required />
      <button type="submit">Abrir chamado</button>
      {feedback && <p>{feedback}</p>}
    </form>
  );
}

export function TicketList({ tickets }: { tickets: Ticket[] }) {
  return (
    <ul>
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          {ticket.subject} — {ticket.status} {ticket.assignee ? `(${ticket.assignee})` : ''}
        </li>
      ))}
    </ul>
  );
}
