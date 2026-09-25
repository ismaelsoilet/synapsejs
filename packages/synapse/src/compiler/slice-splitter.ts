/**
 * SynapseJS - Isomorphic AST Slice Splitter
 * 
 * Takes a contiguous fullstack .slice.tsx file and partitions it in-memory / build-time into:
 * 1. Server Bundle (.server.ts): Database queries, server actions, schema validations, internal RPC endpoints.
 * 2. Client Bundle (.client.tsx): Pure React UI component with transparent RPC client stubs.
 * 
 * Ensures database queries, secrets, and server runtime code NEVER leak to the browser,
 * while allowing the AI agent to edit 100% of the feature in a single, contiguous file (N = 1).
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

export interface SplitResult {
  sliceName: string;
  serverCode: string;
  clientCode: string;
}

export function splitSlice(sliceFilePath: string, baseDir: string = process.cwd()): SplitResult {
  const fileContent = fs.readFileSync(sliceFilePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    sliceFilePath,
    fileContent,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const sliceFileName = path.basename(sliceFilePath, '.slice.tsx');
  const relPath = path.relative(baseDir, sliceFilePath);
  const rpcEndpoint = `/_synapse/rpc/${sliceFileName}`;

  let serverParts: string[] = [
    `// [SYNAPSE-JS SERVER TARGET] AUTO-SPLIT FROM ${relPath}`,
    `// CONTAINS DB LOGIC, PERSISTENCE AND SCHEMA CONTRACTS`,
    `import { Type, type Static, Value, Ok, Err, Result, type DatabaseClient, type SessionContext, requireAuth, hasRole } from 'synapsejs';`,
    ``
  ];

  let clientParts: string[] = [
    `// [SYNAPSE-JS CLIENT TARGET] AUTO-SPLIT FROM ${relPath}`,
    `// CONTAINS ONLY REACT UI AND TRANSPARENT RPC STUBS (ZERO DB/SECRET LEAKS)`,
    `import React, { useState } from 'react';`,
    `import type { Result } from 'synapsejs';`,
    ``
  ];

  // Extract AST Nodes
  ts.forEachChild(sourceFile, (node) => {
    const text = node.getText(sourceFile);
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isExported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

    // Schemas & Types: Shared across server and client
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      serverParts.push(text);
      clientParts.push(text);
    } else if (ts.isVariableStatement(node) && isExported) {
      const decls = node.declarationList.declarations;
      for (const d of decls) {
        const name = d.name.getText(sourceFile);
        if (name.endsWith('Schema')) {
          serverParts.push(text);
          clientParts.push(`// Schema reference preserved for client-side forms`);
          clientParts.push(`export const ${name} = null as any;`);
        }
      }
    }

    // Server Actions: Functions ending with Action or containing DB queries
    if (ts.isFunctionDeclaration(node) && isExported && node.name) {
      const fnName = node.name.text;
      if (fnName.endsWith('Action')) {
        serverParts.push(text);

        // In client bundle, replace with transparent RPC caller
        clientParts.push(`
export async function ${fnName}(payload: unknown): Promise<any> {
  const response = await fetch('${rpcEndpoint}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}
        `);
      } else if (fnName.endsWith('Trigger') || fnName.endsWith('View') || fnName.endsWith('Form') || fnName.endsWith('Component')) {
        // UI Component: strictly client bundle
        clientParts.push(text);
      }
    }
  });

  return {
    sliceName: sliceFileName,
    serverCode: serverParts.join('\n'),
    clientCode: clientParts.join('\n')
  };
}

if (import.meta.main) {
  const root = process.cwd();
  const sampleSlice = path.join(root, 'src/slices/billing/generate-invoice.slice.tsx');
  const distDir = path.join(root, '.synapse/dist');

  console.log('⚡ [Slice Splitter] Analisando AST e particionando fatias...');
  const result = splitSlice(sampleSlice, root);

  const serverOut = path.join(distDir, 'server', `${result.sliceName}.server.ts`);
  const clientOut = path.join(distDir, 'client', `${result.sliceName}.client.tsx`);

  fs.mkdirSync(path.dirname(serverOut), { recursive: true });
  fs.mkdirSync(path.dirname(clientOut), { recursive: true });

  fs.writeFileSync(serverOut, result.serverCode, 'utf-8');
  fs.writeFileSync(clientOut, result.clientCode, 'utf-8');

  console.log(`✅ [Slice Splitter PASS] Fatia particionada com sucesso!`);
  console.log(`   - Servidor: .synapse/dist/server/${result.sliceName}.server.ts`);
  console.log(`   - Cliente: .synapse/dist/client/${result.sliceName}.client.tsx`);
  console.log(`   - RPC Endpoint automático: /_synapse/rpc/${result.sliceName}`);
}
