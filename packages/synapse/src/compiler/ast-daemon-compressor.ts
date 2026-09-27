/**
 * SynapseJS - Native AST Daemon & Codebase Compressor
 *
 * Extracts exact structural topology and signatures from slices and core modules.
 * Suppresses implementation bodies to produce a compressed skeleton map (.codebase/repo-map.d.ts)
 * that fits well within a 3,000-token budget for LLM context injection.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { generateDatabaseSchemaCatalog } from './db-schema-generator';

/**
 * Resolves the runtime contract behind a TypeBox schema declaration.
 *
 * TypeBox carries the inferred shape on the `static` phantom property, which is
 * exactly what `Static<typeof Schema>` exposes — the contract the agent needs.
 */
function describeSchemaType(checker: ts.TypeChecker, name: ts.Node): string {
  const type = checker.getTypeAtLocation(name);
  const staticProperty = type.getProperty('static');

  if (staticProperty) {
    const staticType = checker.getTypeOfSymbolAtLocation(staticProperty, name);
    const printable = checker.typeToString(staticType, name, ts.TypeFormatFlags.NoTruncation);
    return printable.length > 400 ? checker.typeToString(staticType, name) : printable;
  }

  return checker.typeToString(type, name);
}

interface SliceMetadata {
  slicePath: string;
  exportedTypes: string[];
  exportedFunctions: string[];
  hasUI: boolean;
  hasPBT: boolean;
}

function isTestFile(fileName: string): boolean {
  return /\.(test|spec)\.[cm]?tsx?$/.test(fileName);
}

export function compressRepositoryAST(
  baseDir: string,
  outputFile: string,
  graphFile?: string
): {
  manifestTokensEstimate: number;
  totalModules: number;
  totalSlices: number;
} {
  const tsConfigPath = path.join(baseDir, 'tsconfig.json');
  const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, baseDir);

  // Every file the project compiles is mapped, not only `slices/` and `core/`:
  // the tooling must also work on a conventional app that adopts it.
  const sourceFiles = parsed.fileNames.filter((f) => !f.endsWith('.d.ts') && !isTestFile(f));

  const program = ts.createProgram(sourceFiles, parsed.options);
  const typeChecker = program.getTypeChecker();

  let manifest = `// [SYNAPSE-JS AUTO-GENERATED SKELETON MAP]\n`;
  manifest += `// STRICT CONTRACTS, ALGEBRAIC TYPES AND FUNCTION SIGNATURES ONLY.\n`;
  manifest += `// Regenerate with 'synapse skeleton' — output is deterministic and committed.\n`;
  manifest += `// NOT COMPILABLE: this is a signature digest for LLM context, not a .d.ts module.\n`;
  manifest += `// It carries no imports and names repeat across modules by design.\n\n`;

  const architectureGraph: SliceMetadata[] = [];

  for (const src of program.getSourceFiles()) {
    if (src.isDeclarationFile || !sourceFiles.includes(src.fileName)) {
      continue;
    }

    const relPath = path.relative(baseDir, src.fileName);
    manifest += `// ============================================================================\n`;
    manifest += `// MODULE: ${relPath}\n`;
    manifest += `// ============================================================================\n`;

    const sliceMeta: SliceMetadata = {
      slicePath: relPath,
      exportedTypes: [],
      exportedFunctions: [],
      hasUI: false,
      hasPBT: false
    };

    ts.forEachChild(src, (node) => {
      const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
      const isExported = modifiers?.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.ExportKeyword);

      // 1. Exported Type Aliases & Interfaces (e.g. TypeBox static types, Result types)
      if (isExported && (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node))) {
        manifest += `${node.getText(src)}\n\n`;
        sliceMeta.exportedTypes.push(node.name.text);
      }

      // 2. Exported Schemas & constants, resolved to their real inferred types
      if (isExported && ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          const varName = decl.name.getText(src);
          if (varName.endsWith('Schema')) {
            manifest += `export declare const ${varName}: ${describeSchemaType(typeChecker, decl.name)};\n`;
            sliceMeta.exportedTypes.push(varName);
          }
          if (varName === 'sliceTests') {
            sliceMeta.hasPBT = true;
          }
        }
      }

      // 3. Exported Functions (Skeletonized: signature only, body stripped)
      if (isExported && ts.isFunctionDeclaration(node) && node.name) {
        const fnName = node.name.text;
        const params = node.parameters
          .map((p) => {
            const pName = p.name.getText(src);
            const pType = p.type ? p.type.getText(src) : 'unknown';
            return `${pName}: ${pType}`;
          })
          .join(', ');

        let retType = 'void';
        if (node.type) {
          retType = node.type.getText(src);
        } else {
          const signature = typeChecker.getSignatureFromDeclaration(node);
          if (signature) {
            retType = typeChecker.typeToString(typeChecker.getReturnTypeOfSignature(signature));
          }
        }

        manifest += `export declare function ${fnName}(${params}): ${retType};\n`;
        sliceMeta.exportedFunctions.push(fnName);

        if (fnName.endsWith('Trigger') || fnName.endsWith('View') || fnName.endsWith('Component')) {
          sliceMeta.hasUI = true;
        }
      }
    });

    manifest += `\n`;
    architectureGraph.push(sliceMeta);
  }

  // Ensure output directory exists
  const outDir = path.dirname(outputFile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outputFile, manifest, 'utf-8');

  // Also generate the database schema catalog if outputting into .codebase
  try {
    const dbSchemaPath = path.join(outDir, 'db-schema.d.ts');
    generateDatabaseSchemaCatalog(baseDir, dbSchemaPath);
  } catch {
    // Non-fatal if project has no slices yet
  }

  if (graphFile) {
    fs.writeFileSync(graphFile, JSON.stringify(architectureGraph, null, 2), 'utf-8');
  }

  // Heuristic token estimation: ~4 chars per token
  const tokenEstimate = Math.round(manifest.length / 4);

  return {
    manifestTokensEstimate: tokenEstimate,
    totalModules: architectureGraph.length,
    totalSlices: architectureGraph.filter((entry) => entry.slicePath.endsWith('.slice.tsx')).length
  };
}

if (import.meta.main) {
  const root = process.cwd();
  const repoMapPath = path.join(root, '.codebase/repo-map.d.ts');
  const graphPath = path.join(root, '.codebase/architecture-graph.json');

  console.log('⚡ [AST Daemon] Extraindo esqueleto e comprimindo repositório...');
  const stats = compressRepositoryAST(root, repoMapPath, graphPath);
  console.log(`✅ [AST Daemon PASS] Manifesto gerado com sucesso!`);
  console.log(`   - Arquivo: .codebase/repo-map.d.ts`);
  console.log(`   - Fatias e módulos processados: ${stats.totalSlices}`);
  console.log(`   - Estimativa de tokens: ~${stats.manifestTokensEstimate} tokens (limite: 3.000 tokens)`);
}
