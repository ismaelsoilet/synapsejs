export const DriftInvoiceInputSchema = {};

export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    base_cents INTEGER NOT NULL,
    tax_rate REAL NOT NULL,
    total_cents INTEGER NOT NULL,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;
