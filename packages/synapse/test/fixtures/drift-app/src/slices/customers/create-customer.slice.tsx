export const DriftCustomerInputSchema = {};

// Fixture for the schema-drift suite: a framework-owned app whose declared tables
// never change, so adding slices to an example cannot break these expectations.
export const sliceSchema = `
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    tax_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;
