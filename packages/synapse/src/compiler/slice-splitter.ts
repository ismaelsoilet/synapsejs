/**
 * SynapseJS - Isomorphic Slice Splitter
 *
 * Partitions one contiguous `.slice.tsx` (N = 1) into three verifiable modules:
 *
 *   <slice>/shared.tsx  type contracts (erased at runtime, safe for both sides)
 *   <slice>/server.ts   database access, schema DDL, server actions
 *   <slice>/client.tsx  React UI plus transparent RPC stubs
 *
 * The partition is computed by reachability over the module's own dependency
 * graph, resolved through the TypeScript type checker. Imports are passed
 * through from the source — never synthesized — so an emitted module resolves
 * exactly where the original did.
 *
 * Two gates make the isolation claim verifiable instead of declarative:
 *   1. the emitted modules must typecheck;
 *   2. the client module must not reference any server-only symbol.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { Err, Ok, type Result } from '../core/machine-types';

export type ArtifactKind = 'shared' | 'server' | 'client';

export interface SplitArtifact {
  kind: ArtifactKind;
  fileName: string;
  code: string;
}

export interface SplitResult {
  sliceName: string;
  artifacts: SplitArtifact[];
}

export type SplitErrorCode = 'SLICE_NOT_FOUND' | 'NO_ROOTS' | 'UNPARSED';

export interface SplitError {
  code: SplitErrorCode;
  message: string;
  candidates: string[];
}

export interface SplitDiagnostic {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

export interface SplitVerification {
  status: 'PASS' | 'FAIL';
  diagnostics: SplitDiagnostic[];
  leaks: string[];
}

const SERVER_ROOT_SUFFIXES = ['Action'];
const CLIENT_ROOT_SUFFIXES = ['Trigger', 'View', 'Form', 'Component'];
const SERVER_ROOT_NAMES = ['sliceSchema'];
const TEST_ONLY_NAMES = ['sliceTests'];

const SERVER_ONLY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  // `SELECT ... FROM` e não `SELECT` seguido de qualquer palavra: sem o FROM, a
  // tag HTML `<select id="x">` de um formulário casava como vazamento de SQL.
  { label: 'SELECT statement', pattern: /\bSELECT\s+[\w*"`][\w*"`.,\s]*\bFROM\b/i },
  { label: 'INSERT statement', pattern: /\bINSERT\s+INTO\b/i },
  { label: 'UPDATE statement', pattern: /\bUPDATE\s+\w+\s+SET\b/i },
  { label: 'DELETE statement', pattern: /\bDELETE\s+FROM\b/i },
  { label: 'CREATE TABLE statement', pattern: /\bCREATE\s+TABLE\b/i },
  { label: 'database call', pattern: /\bdb\s*\.\s*query\b/ },
  { label: 'sliceSchema symbol', pattern: /\bsliceSchema\b/ },
  { label: 'test runner import', pattern: /from\s+['"]bun:test['"]/ },
  { label: 'process.env access', pattern: /\bprocess\.env\b/ },
  { label: 'Bun global', pattern: /\bBun\./ }
];

interface DeclEntry {
  key: string;
  node: ts.Node;
  statement: ts.Node;
  isExported: boolean;
  isTypeOnly: boolean;
  position: number;
  dependencies: Set<string>;
  imports: Set<string>;
}

function compilerOptions(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    types: []
  };
}

/**
 * Uses the project's own tsconfig so the emitted modules are checked under the
 * same options the slice is authored with. A gate that relaxes strictness would
 * report PASS on code the project itself rejects.
 */
function projectOptions(startDir: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(startDir, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    return compilerOptions();
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    return compilerOptions();
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));

  return {
    ...compilerOptions(),
    ...parsed.options,
    noEmit: true,
    declaration: false,
    composite: false,
    incremental: false
  };
}

function hasExportModifier(node: ts.Node, _sourceFile: ts.SourceFile): boolean {
  const statement = ts.isVariableDeclaration(node) ? node.parent.parent : node;
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  return Boolean(modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function declarationKey(node: ts.Node): string | null {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name?.text ?? null;
  }

  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }

  return null;
}

function owningTopLevelKey(node: ts.Node, sourceFile: ts.SourceFile): string | null {
  let current: ts.Node = node;

  while (current.parent && current.parent !== sourceFile) {
    current = current.parent;
  }

  if (ts.isVariableStatement(current)) {
    let cursor: ts.Node = node;
    while (cursor !== current) {
      const key = declarationKey(cursor);
      if (key) {
        return key;
      }
      if (!cursor.parent) {
        return null;
      }
      cursor = cursor.parent;
    }
    return null;
  }

  return declarationKey(current);
}

function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) {
    return false;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    return true;
  }
  if (ts.isPropertyAssignment(parent) && parent.name === node) {
    return true;
  }
  if (ts.isPropertySignature(parent) && parent.name === node) {
    return true;
  }
  if (ts.isBindingElement(parent) && parent.propertyName === node) {
    return true;
  }
  return false;
}

function isTopLevelDeclarationOf(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let current: ts.Node = node;
  while (current.parent && current.parent !== sourceFile) {
    current = current.parent;
  }
  return current.parent === sourceFile;
}

function collectDeclarations(sourceFile: ts.SourceFile, checker: ts.TypeChecker): Map<string, DeclEntry> {
  const entries = new Map<string, DeclEntry>();

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const key = declarationKey(declaration);
        if (!key || !ts.isIdentifier(declaration.name)) {
          continue;
        }
        entries.set(key, {
          key,
          node: declaration,
          statement,
          isExported: hasExportModifier(declaration, sourceFile),
          isTypeOnly: false,
          position: statement.getStart(sourceFile),
          dependencies: new Set(),
          imports: new Set()
        });
      }
      continue;
    }

    const key = declarationKey(statement);
    if (!key) {
      continue;
    }

    entries.set(key, {
      key,
      node: statement,
      statement,
      isExported: hasExportModifier(statement, sourceFile),
      isTypeOnly: ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement),
      position: statement.getStart(sourceFile),
      dependencies: new Set(),
      imports: new Set()
    });
  }

  for (const entry of entries.values()) {
    collectReferences(entry.node, entry, sourceFile, checker, entry);
  }

  return entries;
}

function collectReferences(
  node: ts.Node,
  entry: DeclEntry,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  target: { dependencies: Set<string>; imports: Set<string> }
): void {
  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current) && !isPropertyName(current)) {
      const symbol = checker.getSymbolAtLocation(current);

      if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
        // Imported binding: remember it by its local name for passthrough.
        target.imports.add(symbol.getName());
      } else if (symbol) {
        const declaration = symbol.declarations?.find((d) => d.getSourceFile() === sourceFile);

        if (declaration && isTopLevelDeclarationOf(declaration, sourceFile)) {
          const dependencyKey = owningTopLevelKey(declaration, sourceFile);
          if (dependencyKey && dependencyKey !== entry.key) {
            target.dependencies.add(dependencyKey);
          }
        }
      }
    }
    ts.forEachChild(current, visit);
  };

  visit(node);
}

/**
 * A server root that becomes an RPC stub contributes only its wire signature to
 * the client: the payload parameter and the return type. The remaining
 * parameters (database, session) and the body stay on the server.
 */
function signatureReferences(
  entry: DeclEntry,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): { dependencies: Set<string>; imports: Set<string> } {
  const collected = { dependencies: new Set<string>(), imports: new Set<string>() };

  if (ts.isFunctionDeclaration(entry.node)) {
    const payload = entry.node.parameters[0];
    if (payload) {
      collectReferences(payload, entry, sourceFile, checker, collected);
    }
    if (entry.node.type) {
      collectReferences(entry.node.type, entry, sourceFile, checker, collected);
    }
  } else {
    collectReferences(entry.node, entry, sourceFile, checker, collected);
  }

  return collected;
}

function reachableFrom(
  roots: string[],
  entries: Map<string, DeclEntry>,
  overrideDependencies?: Map<string, Set<string>>
): Set<string> {
  const visited = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const key = queue.pop() as string;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    const entry = entries.get(key);
    if (!entry) {
      continue;
    }

    const dependencies = overrideDependencies?.get(key) ?? entry.dependencies;
    for (const dependency of dependencies) {
      if (!visited.has(dependency)) {
        queue.push(dependency);
      }
    }
  }

  return visited;
}

function rootsFor(entries: Map<string, DeclEntry>, suffixes: string[], names: string[]): string[] {
  const roots: string[] = [];
  for (const entry of entries.values()) {
    if (!entry.isExported || TEST_ONLY_NAMES.includes(entry.key)) {
      continue;
    }
    if (names.includes(entry.key) || suffixes.some((suffix) => entry.key.endsWith(suffix))) {
      roots.push(entry.key);
    }
  }
  return roots;
}

/**
 * Relative specifiers point at files sitting next to the original slice, so they
 * must be re-anchored to the artifact directory. Package specifiers pass through
 * untouched.
 */
function rewriteModuleSpecifier(specifier: string, sourceDir: string, outDir: string): string {
  if (!specifier.startsWith('.')) {
    return specifier;
  }

  const absolute = path.resolve(sourceDir, specifier);
  const relative = path.relative(outDir, absolute).split(path.sep).join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function emitImportDeclaration(
  declaration: ts.ImportDeclaration,
  usedNames: Set<string>,
  sourceDir: string,
  outDir: string
): string | null {
  const clause = declaration.importClause;
  const source = declaration.moduleSpecifier as ts.StringLiteral;
  const moduleSpecifier = `'${rewriteModuleSpecifier(source.text, sourceDir, outDir)}'`;

  if (!clause) {
    return `import ${moduleSpecifier};`;
  }

  const parts: string[] = [];
  if (clause.name && usedNames.has(clause.name.text)) {
    parts.push(clause.name.text);
  }

  const namedParts: string[] = [];
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    if (usedNames.has(clause.namedBindings.name.text)) {
      namedParts.push(`* as ${clause.namedBindings.name.text}`);
    }
  } else if (clause.namedBindings) {
    for (const specifier of clause.namedBindings.elements) {
      if (!usedNames.has(specifier.name.text)) {
        continue;
      }
      const prefix = specifier.isTypeOnly ? 'type ' : '';
      const imported = specifier.propertyName ? `${specifier.propertyName.text} as ` : '';
      namedParts.push(`${prefix}${imported}${specifier.name.text}`);
    }
  }

  if (namedParts.length > 0) {
    parts.push(`{ ${namedParts.join(', ')} }`);
  }

  if (parts.length === 0) {
    return null;
  }

  const typePrefix = clause.isTypeOnly ? 'type ' : '';
  return `import ${typePrefix}${parts.join(', ')} from ${moduleSpecifier};`;
}

function importsFor(
  sourceFile: ts.SourceFile,
  entries: DeclEntry[],
  sourceDir: string,
  outDir: string,
  importOverrides?: Map<string, Set<string>>
): string {
  const usedNames = new Set<string>();
  for (const entry of entries) {
    for (const name of importOverrides?.get(entry.key) ?? entry.imports) {
      usedNames.add(name);
    }
  }

  const lines: string[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    const emitted = emitImportDeclaration(statement, usedNames, sourceDir, outDir);
    if (emitted) {
      lines.push(emitted);
    }
  }

  return lines.join('\n');
}

function renderDeclaration(entry: DeclEntry, sourceFile: ts.SourceFile): string {
  if (ts.isVariableDeclaration(entry.node)) {
    const list = (entry.statement as ts.VariableStatement).declarationList;
    const flags = ts.getCombinedNodeFlags(list);
    const keyword = flags & ts.NodeFlags.Const ? 'const' : flags & ts.NodeFlags.Let ? 'let' : 'var';
    const exportPrefix = entry.isExported ? 'export ' : '';
    return `${exportPrefix}${keyword} ${entry.node.getText(sourceFile)};`;
  }

  return entry.node.getText(sourceFile);
}

function composeArtifact(banners: string[], importLines: string[], body: string): string {
  const header = [...banners, ...importLines.filter((line) => line.length > 0)].join('\n');
  return `${header}\n\n${body}\n`;
}

function unwrapPromiseType(typeText: string): string {
  const match = typeText.match(/^Promise<([\s\S]+)>$/);
  return match ? match[1].trim() : `Awaited<${typeText}>`;
}

function renderRpcStub(entry: DeclEntry, endpoint: string, sourceFile: ts.SourceFile): string {
  const fn = entry.node as ts.FunctionDeclaration;
  const payload = fn.parameters[0];
  const payloadType = payload?.type ? payload.type.getText(sourceFile) : 'unknown';
  const rawReturn = fn.type ? fn.type.getText(sourceFile) : 'Promise<unknown>';
  const awaited = unwrapPromiseType(rawReturn);

  return [
    `export async function ${entry.key}(payload: ${payloadType}): ${rawReturn} {`,
    `  return rpcCall<${awaited}>(${JSON.stringify(endpoint)}, payload);`,
    `}`
  ].join('\n');
}

function artifactFileName(kind: ArtifactKind): string {
  if (kind === 'shared') {
    return 'shared.tsx';
  }
  return kind === 'server' ? 'server.ts' : 'client.tsx';
}

export function artifactDirectory(baseDir: string, sliceName: string): string {
  return path.join(baseDir, '.synapse', 'dist', sliceName);
}

export function splitSlice(sliceFilePath: string, baseDir: string = process.cwd()): Result<SplitResult, SplitError> {
  if (!fs.existsSync(sliceFilePath)) {
    return Err({
      code: 'SLICE_NOT_FOUND',
      message: `Fatia não encontrada: ${sliceFilePath}`,
      candidates: [sliceFilePath]
    });
  }

  const options = projectOptions(path.dirname(sliceFilePath));
  const host = ts.createCompilerHost(options);
  const program = ts.createProgram([sliceFilePath], options, host);
  const sourceFile = program.getSourceFile(sliceFilePath);

  if (!sourceFile) {
    return Err({
      code: 'UNPARSED',
      message: `Não foi possível ler a AST de ${sliceFilePath}`,
      candidates: [sliceFilePath]
    });
  }

  const checker = program.getTypeChecker();
  const entries = collectDeclarations(sourceFile, checker);

  const serverRoots = rootsFor(entries, SERVER_ROOT_SUFFIXES, SERVER_ROOT_NAMES);
  const clientRoots = rootsFor(entries, CLIENT_ROOT_SUFFIXES, []);

  if (serverRoots.length === 0 && clientRoots.length === 0) {
    return Err({
      code: 'NO_ROOTS',
      message:
        `Nenhuma Server Action (*Action) ou componente (*Trigger|View|Form|Component) exportado em ` +
        `${path.basename(sliceFilePath)}.`,
      candidates: [...entries.keys()]
    });
  }

  const serverSet = reachableFrom(serverRoots, entries);

  const stubSignatures = new Map<string, { dependencies: Set<string>; imports: Set<string> }>();
  for (const key of serverRoots) {
    const entry = entries.get(key);
    if (entry) {
      stubSignatures.set(key, signatureReferences(entry, sourceFile, checker));
    }
  }

  const stubSignatureDependencies = new Map<string, Set<string>>();
  const stubSignatureImports = new Map<string, Set<string>>();
  for (const [key, signature] of stubSignatures) {
    stubSignatureDependencies.set(key, signature.dependencies);
    stubSignatureImports.set(key, signature.imports);
  }

  const clientSet = reachableFrom(clientRoots, entries, stubSignatureDependencies);

  // Type contracts are erased at runtime and therefore safe on both sides.
  // Values referenced by those types (e.g. TypeBox schemas behind `typeof X`)
  // are promoted alongside them so the shared module stays self-contained.
  const shared = new Set<string>();
  const promotionQueue: string[] = [];
  for (const key of serverSet) {
    if (clientSet.has(key) && entries.get(key)?.isTypeOnly) {
      shared.add(key);
      promotionQueue.push(key);
    }
  }

  while (promotionQueue.length > 0) {
    const key = promotionQueue.pop() as string;
    const entry = entries.get(key);
    if (!entry) {
      continue;
    }
    for (const dependency of entry.dependencies) {
      const dependencyEntry = entries.get(dependency);
      if (!dependencyEntry || shared.has(dependency)) {
        continue;
      }
      shared.add(dependency);
      promotionQueue.push(dependency);
    }
  }

  const sharedEntries: DeclEntry[] = [];
  const serverEntries: DeclEntry[] = [];
  const clientEntries: DeclEntry[] = [];
  const stubbedKeys = serverRoots.filter((key) => clientSet.has(key));

  for (const entry of [...entries.values()].sort((a, b) => a.position - b.position)) {
    if (TEST_ONLY_NAMES.includes(entry.key)) {
      continue;
    }

    if (shared.has(entry.key)) {
      sharedEntries.push(entry);
      continue;
    }

    if (serverSet.has(entry.key)) {
      serverEntries.push(entry);
      if (clientSet.has(entry.key)) {
        clientEntries.push(entry);
      }
    } else if (clientSet.has(entry.key)) {
      clientEntries.push(entry);
    }
  }

  const sliceName = path.basename(sliceFilePath, '.slice.tsx');
  const relativePath = path.relative(baseDir, sliceFilePath);
  const endpoint = `/_synapse/rpc/${sliceName}`;
  const artifacts: SplitArtifact[] = [];
  const outDir = artifactDirectory(baseDir, sliceName);
  const sourceDir = path.dirname(sliceFilePath);

  if (sharedEntries.length > 0) {
    artifacts.push({
      kind: 'shared',
      fileName: artifactFileName('shared'),
      code: composeArtifact(
        [
          `// [SYNAPSE-JS SHARED TARGET] AUTO-SPLIT FROM ${relativePath}`,
          `// TYPE CONTRACTS AND PURE DECLARATIONS SHARED BY SERVER AND CLIENT`
        ],
        [importsFor(sourceFile, sharedEntries, sourceDir, outDir)],
        sharedEntries.map((entry) => renderDeclaration(entry, sourceFile)).join('\n\n')
      )
    });
  }

  const serverSharedImport =
    sharedEntries.length > 0 ? `import { ${sharedEntries.map((e) => e.key).join(', ')} } from './shared';` : '';

  artifacts.push({
    kind: 'server',
    fileName: artifactFileName('server'),
    code: composeArtifact(
      [
        `// [SYNAPSE-JS SERVER TARGET] AUTO-SPLIT FROM ${relativePath}`,
        `// DATABASE ACCESS, SCHEMA DDL AND SERVER ACTIONS`
      ],
      [importsFor(sourceFile, serverEntries, sourceDir, outDir), serverSharedImport],
      serverEntries.map((entry) => renderDeclaration(entry, sourceFile)).join('\n\n')
    )
  });

  const clientSharedImport =
    sharedEntries.length > 0 ? `import { ${sharedEntries.map((e) => e.key).join(', ')} } from './shared';` : '';
  const clientRpcImport = stubbedKeys.length > 0 ? `import { rpcCall } from 'synapsejs';` : '';

  artifacts.push({
    kind: 'client',
    fileName: artifactFileName('client'),
    code: composeArtifact(
      [
        `// [SYNAPSE-JS CLIENT TARGET] AUTO-SPLIT FROM ${relativePath}`,
        `// REACT UI AND TRANSPARENT RPC STUBS (NO DATABASE ACCESS)`
      ],
      [
        importsFor(sourceFile, clientEntries, sourceDir, outDir, stubSignatureImports),
        clientSharedImport,
        clientRpcImport
      ],
      clientEntries
        .map((entry) =>
          stubbedKeys.includes(entry.key)
            ? renderRpcStub(entry, endpoint, sourceFile)
            : renderDeclaration(entry, sourceFile)
        )
        .join('\n\n')
    )
  });

  return Ok({ sliceName, artifacts });
}

export function writeSplitArtifacts(result: SplitResult, outDir: string): string[] {
  fs.mkdirSync(outDir, { recursive: true });

  return result.artifacts.map((artifact) => {
    const target = path.join(outDir, artifact.fileName);
    fs.writeFileSync(target, artifact.code, 'utf-8');
    return target;
  });
}

/**
 * Gate 1: the emitted modules must typecheck as a unit.
 * Gate 2: the client module must not reference server-only symbols.
 */
export function verifySplit(result: SplitResult, outDir: string): SplitVerification {
  const diagnostics: SplitDiagnostic[] = [];
  const leaks: string[] = [];

  const virtualFiles = new Map<string, string>();
  for (const artifact of result.artifacts) {
    virtualFiles.set(path.normalize(path.join(outDir, artifact.fileName)), artifact.code);
  }

  const options = projectOptions(outDir);
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const virtual = virtualFiles.get(path.normalize(fileName));
    if (virtual !== undefined) {
      return ts.createSourceFile(fileName, virtual, languageVersion, true);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.fileExists = (fileName) => virtualFiles.has(path.normalize(fileName)) || originalFileExists(fileName);
  host.readFile = (fileName) => virtualFiles.get(path.normalize(fileName)) ?? originalReadFile(fileName);

  const program = ts.createProgram([...virtualFiles.keys()], options, host);
  const virtualPaths = new Set([...virtualFiles.keys()]);

  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (!diagnostic.file || !virtualPaths.has(path.normalize(diagnostic.file.fileName))) {
      continue;
    }

    const position =
      diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : null;

    diagnostics.push({
      file: path.relative(outDir, diagnostic.file.fileName),
      line: position ? position.line + 1 : 0,
      column: position ? position.character + 1 : 0,
      code: `TS${diagnostic.code}`,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    });
  }

  const clientArtifact = result.artifacts.find((artifact) => artifact.kind === 'client');
  if (clientArtifact) {
    for (const { label, pattern } of SERVER_ONLY_PATTERNS) {
      if (pattern.test(clientArtifact.code)) {
        leaks.push(label);
      }
    }
  }

  return {
    status: diagnostics.length === 0 && leaks.length === 0 ? 'PASS' : 'FAIL',
    diagnostics,
    leaks
  };
}
