/**
 * SynapseJS - Client Entry (browser)
 *
 * What a slice's UI is allowed to import. The package root is the server surface:
 * it reaches SQLite, PostgreSQL and `process.env`, so a browser bundle that pulls it
 * in cannot even be built. This entry exposes exactly the values that are valid in
 * a browser — the RPC transport and the session cookie — and nothing else.
 *
 * The splitter's leak gate enforces this: a value imported from the bare package
 * inside a client artifact fails the build and says so.
 */

// Declarative UI Components
export {
  Badge,
  type BadgeProps,
  Button,
  type ButtonProps,
  Card,
  type CardProps,
  type Column,
  DataForm,
  type DataFormProps,
  DataTable,
  type DataTableProps,
  expandNestedObject,
  type FormField,
  getNestedProperty,
  Pagination,
  type PaginationProps,
  setNestedProperty
} from './client/components';
// Context & SSR data isolation
export {
  type SynapseContextValue,
  SynapseProvider,
  type SynapseProviderProps,
  useLoaderData,
  useSession,
  useSynapseContext
} from './client/context';
// Reactive Action & Realtime Subscription Hooks
export {
  type UseActionResult,
  type UseSubscriptionOptions,
  type UseSubscriptionResult,
  useAction,
  useSubscription
} from './client/hooks';
export {
  createTranslator,
  type TranslateFn,
  type TranslationDictionary
} from './client/i18n';
export type { Result } from './core/machine-types';
export { type RpcTransportError, rpcCall, rpcTransportFailure } from './core/rpc-client';
export type { SessionContext } from './core/session-context';
export {
  clearSession,
  currentRoles,
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  ROLES_COOKIE,
  SESSION_COOKIE,
  sessionCookie,
  storeSession
} from './core/session-cookie';
