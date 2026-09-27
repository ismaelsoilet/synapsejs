import { createContext, type ReactNode, useContext } from 'react';
import type { SessionContext } from '../core/session-context';

export interface SynapseContextValue {
  props: Record<string, unknown>;
  session?: SessionContext;
}

const SynapseContext = createContext<SynapseContextValue | null>(null);

export interface SynapseProviderProps {
  props?: Record<string, unknown>;
  session?: SessionContext;
  children?: ReactNode;
}

/**
 * SynapseProvider delivers per-request SSR data isolation and seamless client hydration.
 */
export function SynapseProvider({ props, session, children }: SynapseProviderProps) {
  // On client, if props not passed directly, hydrate from window.__SYNAPSE_PROPS__
  const clientProps =
    props ??
    (typeof window !== 'undefined'
      ? ((window as unknown as { __SYNAPSE_PROPS__?: Record<string, unknown> }).__SYNAPSE_PROPS__ ?? {})
      : {});

  const value: SynapseContextValue = {
    props: clientProps,
    session
  };

  return <SynapseContext.Provider value={value}>{children}</SynapseContext.Provider>;
}

export function useSynapseContext(): SynapseContextValue {
  const ctx = useContext(SynapseContext);
  if (!ctx) {
    const props =
      typeof window !== 'undefined'
        ? ((window as unknown as { __SYNAPSE_PROPS__?: Record<string, unknown> }).__SYNAPSE_PROPS__ ?? {})
        : {};
    return { props };
  }
  return ctx;
}

/**
 * Hook to retrieve loader data in SSR components with strict typing.
 */
export function useLoaderData<T = Record<string, unknown>>(): T {
  const ctx = useSynapseContext();
  return ctx.props as T;
}

/**
 * Hook to retrieve the active user session context.
 */
export function useSession(): SessionContext | undefined {
  const ctx = useSynapseContext();
  return ctx.session;
}
