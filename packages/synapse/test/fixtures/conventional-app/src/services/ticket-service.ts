export type Ticket = {
  id: string;
  subject: string;
};

export function createTicket(subject: string): Ticket {
  return { id: 'ticket-1', subject };
}
