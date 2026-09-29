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
  rootLayoutPath?: string;
  domainLayoutPath?: string;
}

export const CLIENT_ROOT_ID = 'synapse-root';
export const CLIENT_PROPS_GLOBAL = '__SYNAPSE_PROPS__';

export function clientEntrySource(options: ClientEntryOptions): string {
  const rootId = options.rootId ?? CLIENT_ROOT_ID;
  const propNames = options.actionPropNames ?? ['onSubmitAction', 'action'];
  const actionWires = propNames
    .map((name) => `        ${name}: (payload: unknown) => rpcCall(${JSON.stringify(options.rpcPath)}, payload)`)
    .join(',\n');

  const layoutImports: string[] = [];
  if (options.rootLayoutPath) {
    layoutImports.push(`import * as RootLayoutModule from ${JSON.stringify(options.rootLayoutPath)};`);
  }
  if (options.domainLayoutPath) {
    layoutImports.push(`import * as DomainLayoutModule from ${JSON.stringify(options.domainLayoutPath)};`);
  }

  const hasLayouts = Boolean(options.rootLayoutPath || options.domainLayoutPath);

  const lines = [
    `// [SYNAPSE-JS GENERATED CLIENT ENTRY] hydrates the slice in the browser`,
    `import React from 'react';`,
    `import { hydrateRoot } from 'react-dom/client';`,
    `import { rpcCall, SynapseProvider } from 'synapsejs/client';`,
    ...layoutImports,
    `import { ${options.componentName} } from ${JSON.stringify(options.clientModulePath)};`,
    ``,
    `export function hydrate() {`,
    `  const scope = globalThis as unknown as Record<string, unknown>;`,
    `  const props = (scope[${JSON.stringify(CLIENT_PROPS_GLOBAL)}] ?? {}) as Record<string, unknown>;`,
    `  const root = document.getElementById(${JSON.stringify(rootId)});`,
    `  if (root) {`,
    `    const sliceElement = React.createElement(${options.componentName}, {`,
    `      ...props,`,
    `${actionWires}`,
    `    });`
  ];

  if (hasLayouts) {
    if (options.domainLayoutPath) {
      lines.push(
        `    const DomainLayout = (DomainLayoutModule as any).default || (DomainLayoutModule as any).Layout || null;`
      );
    }
    if (options.rootLayoutPath) {
      lines.push(
        `    const RootLayout = (RootLayoutModule as any).default || (RootLayoutModule as any).Layout || null;`
      );
    }
    let treeExpr = 'sliceElement';
    if (options.domainLayoutPath) {
      treeExpr = `(typeof DomainLayout === 'function' ? React.createElement(DomainLayout, { ...props }, ${treeExpr}) : ${treeExpr})`;
    }
    if (options.rootLayoutPath) {
      treeExpr = `(typeof RootLayout === 'function' ? React.createElement(RootLayout, { ...props }, ${treeExpr}) : ${treeExpr})`;
    }
    lines.push(`    const treeWithLayout = ${treeExpr};`);
    lines.push(`    hydrateRoot(`);
    lines.push(`      root,`);
    lines.push(`      React.createElement(SynapseProvider, { props, session: props.session as any }, treeWithLayout)`);
    lines.push(`    );`);
  } else {
    lines.push(`    hydrateRoot(`);
    lines.push(`      root,`);
    lines.push(`      React.createElement(SynapseProvider, { props, session: props.session as any }, sliceElement)`);
    lines.push(`    );`);
  }

  lines.push(`  }`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`hydrate();`);
  lines.push(``);

  return lines.join('\n');
}

/**
 * Props travel to the browser as JSON inside a script tag, so `<` must be escaped
 * or a value containing `</script>` would end the tag early.
 */
export function serializeClientProps(props: Record<string, unknown>): string {
  return JSON.stringify(props).replace(/</g, '\\u003c');
}
