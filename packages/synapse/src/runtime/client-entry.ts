/**
 * SynapseJS - Client Entry Generator
 *
 * Produces the browser entry for one slice. It hydrates the same React component
 * the server rendered and wires `onSubmitAction` to the slice's RPC endpoint, so
 * the call site a slice author writes is valid on both sides: a direct call on the
 * server, a transparent RPC in the browser.
 *
 * The entry imports the splitter's client artifact, never the slice itself — that
 * is what keeps database code out of the browser bundle.
 */

export interface ClientEntryOptions {
  componentName: string;
  /** Relative path (from the entry file) to the splitter's client artifact. */
  clientModulePath: string;
  rpcPath: string;
  rootId?: string;
  actionPropNames?: string[];
}

export const CLIENT_ROOT_ID = 'synapse-root';
export const CLIENT_PROPS_GLOBAL = '__SYNAPSE_PROPS__';

export function clientEntrySource(options: ClientEntryOptions): string {
  const rootId = options.rootId ?? CLIENT_ROOT_ID;
  const propNames = options.actionPropNames ?? ['onSubmitAction', 'action'];
  const actionWires = propNames
    .map((name) => `      ${name}: (payload: unknown) => rpcCall(${JSON.stringify(options.rpcPath)}, payload)`)
    .join(',\n');

  return [
    `// [SYNAPSE-JS GENERATED CLIENT ENTRY] hydrates the slice in the browser`,
    `import React from 'react';`,
    `import { hydrateRoot } from 'react-dom/client';`,
    `import { rpcCall } from 'synapsejs/client';`,
    `import { ${options.componentName} } from ${JSON.stringify(options.clientModulePath)};`,
    ``,
    `const scope = globalThis as unknown as Record<string, unknown>;`,
    `const props = (scope[${JSON.stringify(CLIENT_PROPS_GLOBAL)}] ?? {}) as Record<string, unknown>;`,
    `const root = document.getElementById(${JSON.stringify(rootId)});`,
    ``,
    `if (root) {`,
    `  hydrateRoot(`,
    `    root,`,
    `    React.createElement(${options.componentName}, {`,
    `      ...props,`,
    `${actionWires}`,
    `    })`,
    `  );`,
    `}`,
    ``
  ].join('\n');
}

/**
 * Props travel to the browser as JSON inside a script tag, so `<` must be escaped
 * or a value containing `</script>` would end the tag early.
 */
export function serializeClientProps(props: Record<string, unknown>): string {
  return JSON.stringify(props).replace(/</g, '\\u003c');
}
