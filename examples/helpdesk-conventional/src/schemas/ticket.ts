import { FormatRegistry, Type, type Static } from '@sinclair/typebox';

// TypeBox only validates `format: 'email'` when the format is registered; the
// slice-based app gets this from the framework, here it is glue we own.
if (!FormatRegistry.Has('email')) {
  FormatRegistry.Set('email', (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

export const CreateTicketSchema = Type.Object({
  subject: Type.String({ minLength: 3, maxLength: 120 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 }),
  requesterEmail: Type.String({ format: 'email' })
});
export type CreateTicketInput = Static<typeof CreateTicketSchema>;

export const AssignTicketSchema = Type.Object({
  ticketId: Type.String({ minLength: 10 }),
  assignee: Type.String({ minLength: 3, maxLength: 60 })
});
export type AssignTicketInput = Static<typeof AssignTicketSchema>;

export type Ticket = {
  id: string;
  subject: string;
  priority: number;
  requesterEmail: string;
  assignee: string | null;
  status: 'OPEN' | 'ASSIGNED';
};
