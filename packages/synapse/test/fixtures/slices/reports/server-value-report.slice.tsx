import { defineCache } from 'synapsejs';

// Fixture for the splitter's server-value diagnostic: a component referencing a
// server-owned value (not an action) has no wire form, so the split must fail with a
// code instead of crashing while rendering a stub.
export const ReportInputSchema = { type: 'object' };

export const reportCache = defineCache({ ttlSeconds: 30 });

export interface ServerValueReportViewProps {
  label?: string;
}

export function ServerValueReportView({ label = 'relatório' }: ServerValueReportViewProps) {
  return <p data-ttl={String(reportCache.ttlSeconds)}>{label}</p>;
}

export const sliceTests = {
  description: 'fixture',
  cases: [{ name: 'noop', run: async () => {} }]
};
