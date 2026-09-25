/**
 * SynapseJS - Agent Diagnostic JSON Engine
 * 
 * Machine-only compiler diagnostic interceptor.
 * Replaces human-targeted ANSI text output with structured JSON coordinates:
 * { status, errorCount, issues: [{ file, line, column, errorCode, message }] }
 * Enables closed-loop deterministic auto-correction by AI agents.
 */

import * as ts from 'typescript';
import * as path from 'path';

export interface DiagnosticIssue {
  file: string;
  line: number;
  column: number;
  errorCode: number;
  message: string;
}

export interface DiagnosticReport {
  status: 'PASS' | 'FAIL';
  errorCount: number;
  timestamp: string;
  durationMs: number;
  issues: DiagnosticIssue[];
  code?: string;
  message?: string;
}

export function runMachineVerifications(projectRoot: string, targetFile?: string): DiagnosticReport {
  const startTime = Date.now();
  const tsConfigPath = path.join(projectRoot, 'tsconfig.json');
  const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot);

  const fileNames = targetFile
    ? parsed.fileNames.filter((f) => f.endsWith(targetFile) || f.includes(targetFile))
    : parsed.fileNames;

  // A target that matched nothing is not a pass: nothing was verified.
  if (targetFile && fileNames.length === 0) {
    return {
      status: 'FAIL',
      errorCount: 1,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      issues: [],
      code: 'TARGET_FILE_NOT_FOUND',
      message: `Nenhum arquivo do projeto corresponde a '${targetFile}'.`
    };
  }

  const program = ts.createProgram(fileNames, parsed.options);
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const durationMs = Date.now() - startTime;

  if (diagnostics.length === 0) {
    return {
      status: 'PASS',
      errorCount: 0,
      timestamp: new Date().toISOString(),
      durationMs,
      issues: []
    };
  }

  const structuredErrors: DiagnosticIssue[] = diagnostics.map((d) => {
    let file = 'unknown';
    let line = 0;
    let column = 0;

    if (d.file && d.start !== undefined) {
      const position = d.file.getLineAndCharacterOfPosition(d.start);
      file = path.relative(projectRoot, d.file.fileName);
      line = position.line + 1;
      column = position.character + 1;
    }

    return {
      file,
      line,
      column,
      errorCode: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n')
    };
  });

  return {
    status: 'FAIL',
    errorCount: structuredErrors.length,
    timestamp: new Date().toISOString(),
    durationMs,
    issues: structuredErrors
  };
}

if (import.meta.main) {
  const target = process.argv[2];
  const report = runMachineVerifications(process.cwd(), target);

  // Write pure, unadulterated JSON to stdout for agent consumption
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');

  if (report.status === 'FAIL') {
    process.exit(1);
  } else {
    process.exit(0);
  }
}
