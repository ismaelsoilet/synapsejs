import React, { type ComponentType, type ReactElement, useMemo } from 'react';
import { rpcCall } from '../core/rpc-client';
import { SynapseProvider } from './context';

export interface SubSliceProps<TProps extends Record<string, unknown> = Record<string, unknown>> {
  domain: string;
  name: string;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic component props boundary
  component?: ComponentType<any>;
  props?: TProps;
  actionPropNames?: string[];
  children?: (injectedProps: Record<string, unknown>) => ReactElement;
}

/**
 * <SubSlice /> dynamically embeds a sub-slice component into any layout or parent view,
 * automatically wiring its transparent RPC action endpoint without violating Locality of Behavior (N = 1).
 */
export function SubSlice<TProps extends Record<string, unknown> = Record<string, unknown>>({
  domain,
  name,
  component: Component,
  props = {} as TProps,
  actionPropNames = ['action', 'onSubmitAction'],
  children
}: SubSliceProps<TProps>): ReactElement {
  const rpcPath = `/_synapse/rpc/${domain}/${name}`;

  const boundActions = useMemo(() => {
    const actions: Record<string, (payload: unknown) => Promise<unknown>> = {};
    for (const actionName of actionPropNames) {
      actions[actionName] = (payload: unknown) => rpcCall(rpcPath, payload);
    }
    return actions;
  }, [rpcPath, actionPropNames]);

  const mergedProps = {
    ...props,
    ...boundActions
  };

  const content = children ? children(mergedProps) : Component ? React.createElement(Component, mergedProps) : null;

  return <SynapseProvider props={mergedProps}>{content}</SynapseProvider>;
}
