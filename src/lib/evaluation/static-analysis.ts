import ts from "typescript";

/**
 * Static analysis of untrusted generated code. Nothing here executes the code:
 * TypeScript/JavaScript are parsed with the TypeScript compiler API; Python is
 * scanned with conservative line-based heuristics (no Python parser runs in-process;
 * Python syntax is checked inside the sandbox with py_compile).
 *
 * Static checks flag obvious risks. They are NOT proof that code is secure.
 */
export type Severity = "info" | "low" | "medium" | "high";

export interface Finding {
  ruleId: string;
  category: "quality" | "security" | "structure";
  severity: Severity;
  message: string;
  line?: number;
}

export interface StaticReport {
  analyzer: "typescript-ast" | "python-heuristic";
  findings: Finding[];
  syntaxErrors: string[];
  exportsEntryFunction: boolean;
  metrics: { lines: number; maxFunctionLines: number; branchCount: number };
}

const PENALTY: Record<Severity, number> = { info: 0.02, low: 0.05, medium: 0.15, high: 0.3 };

/** 1.0 = no findings in the category; each finding subtracts a severity-based penalty. */
export function categoryScore(findings: Finding[], category: Finding["category"]): number {
  const total = findings.filter((f) => f.category === category).reduce((s, f) => s + PENALTY[f.severity], 0);
  return Math.max(0, Math.round((1 - total) * 1000) / 1000);
}

export function analyzeSource(code: string, language: string, entryFunction: string): StaticReport {
  return language === "PYTHON" ? analyzePython(code, entryFunction) : analyzeTypeScript(code, language, entryFunction);
}

function analyzeTypeScript(code: string, language: string, entryFunction: string): StaticReport {
  const isTs = language === "TYPESCRIPT";
  const file = ts.createSourceFile(isTs ? "solution.ts" : "solution.js", code, ts.ScriptTarget.ES2022, true, isTs ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const findings: Finding[] = [];
  const lineOf = (n: ts.Node) => file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1;

  const transpiled = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: isTs ? "solution.ts" : "solution.js",
  });
  const syntaxErrors = (transpiled.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));

  let exportsEntryFunction = false;
  let branchCount = 0;
  let maxFunctionLines = 0;

  const visit = (node: ts.Node) => {
    // Exported entry function: `export function f` or `export const f = ...`
    if (ts.isFunctionDeclaration(node) && node.name?.text === entryFunction && hasExportModifier(node)) exportsEntryFunction = true;
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === entryFunction) exportsEntryFunction = true;
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      if (node.exportClause.elements.some((e) => e.name.text === entryFunction)) exportsEntryFunction = true;
    }

    if (ts.isFunctionLike(node) && "body" in node && node.body) {
      const start = file.getLineAndCharacterOfPosition(node.getStart(file)).line;
      const end = file.getLineAndCharacterOfPosition(node.getEnd()).line;
      maxFunctionLines = Math.max(maxFunctionLines, end - start + 1);
    }
    if (
      ts.isIfStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isCaseClause(node) ||
      ts.isCatchClause(node)
    ) {
      branchCount++;
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(file);
      if (callee === "eval") findings.push({ ruleId: "no-eval", category: "security", severity: "high", message: "eval() executes arbitrary strings as code", line: lineOf(node) });
      if (callee === "require") {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) checkModule(arg.text, lineOf(node), findings);
      }
      if (/^console\.(log|debug|info)$/.test(callee)) {
        const argsText = node.arguments.map((a) => a.getText(file)).join(" ");
        const sensitive = /token|password|secret|credential|session/i.test(argsText);
        findings.push(
          sensitive
            ? { ruleId: "no-sensitive-logging", category: "security", severity: "medium", message: "Logs a value that looks sensitive", line: lineOf(node) }
            : { ruleId: "no-console", category: "quality", severity: "low", message: "Leftover console output", line: lineOf(node) },
        );
      }
      if (/^(setTimeout|setInterval)$/.test(callee) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        findings.push({ ruleId: "no-implied-eval", category: "security", severity: "high", message: "String passed to a timer is evaluated as code", line: lineOf(node) });
      }
    }
    if (ts.isNewExpression(node) && node.expression.getText(file) === "Function") {
      findings.push({ ruleId: "no-new-function", category: "security", severity: "high", message: "new Function() executes arbitrary strings as code", line: lineOf(node) });
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) checkModule(node.moduleSpecifier.text, lineOf(node), findings);
    if (ts.isPropertyAccessExpression(node) && node.getText(file) === "process.env") {
      findings.push({ ruleId: "no-env-access", category: "security", severity: "medium", message: "Reads process environment variables", line: lineOf(node) });
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      findings.push({ ruleId: "no-explicit-any", category: "quality", severity: "low", message: "Explicit `any` weakens type safety", line: lineOf(node) });
    }
    if (node.kind === ts.SyntaxKind.DebuggerStatement) {
      findings.push({ ruleId: "no-debugger", category: "quality", severity: "medium", message: "debugger statement", line: lineOf(node) });
    }
    if (ts.isVariableDeclarationList(node) && !(node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
      findings.push({ ruleId: "no-var", category: "quality", severity: "info", message: "Use let/const instead of var", line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  if (!exportsEntryFunction) {
    findings.push({ ruleId: "missing-export", category: "structure", severity: "high", message: `Does not export \`${entryFunction}\`` });
  }
  for (const err of syntaxErrors) findings.push({ ruleId: "syntax-error", category: "structure", severity: "high", message: err.slice(0, 200) });
  if (maxFunctionLines > 60) findings.push({ ruleId: "long-function", category: "quality", severity: "low", message: `Longest function spans ${maxFunctionLines} lines` });
  if (branchCount > 15) findings.push({ ruleId: "high-branching", category: "quality", severity: "low", message: `${branchCount} branch points (complexity heuristic)` });

  return {
    analyzer: "typescript-ast",
    findings,
    syntaxErrors,
    exportsEntryFunction,
    metrics: { lines: code.split("\n").length, maxFunctionLines, branchCount },
  };
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

const RISKY_MODULES: Record<string, [Severity, string]> = {
  child_process: ["high", "Spawns processes"],
  "node:child_process": ["high", "Spawns processes"],
  fs: ["medium", "File-system access"],
  "node:fs": ["medium", "File-system access"],
  "fs/promises": ["medium", "File-system access"],
  "node:fs/promises": ["medium", "File-system access"],
  net: ["medium", "Raw network access"],
  "node:net": ["medium", "Raw network access"],
  http: ["medium", "Network access"],
  "node:http": ["medium", "Network access"],
  https: ["medium", "Network access"],
  "node:https": ["medium", "Network access"],
  vm: ["high", "Dynamic code execution"],
  "node:vm": ["high", "Dynamic code execution"],
};

function checkModule(name: string, line: number, findings: Finding[]) {
  const risk = RISKY_MODULES[name];
  if (risk) findings.push({ ruleId: "risky-import", category: "security", severity: risk[0], message: `${risk[1]} (imports ${name})`, line });
}

const PY_RULES: Array<{ re: RegExp; finding: Omit<Finding, "line"> }> = [
  { re: /(^|[^\w.])eval\s*\(/, finding: { ruleId: "py-no-eval", category: "security", severity: "high", message: "eval() executes arbitrary strings" } },
  { re: /(^|[^\w.])exec\s*\(/, finding: { ruleId: "py-no-exec", category: "security", severity: "high", message: "exec() executes arbitrary strings" } },
  { re: /^\s*(import|from)\s+(subprocess|os)\b/, finding: { ruleId: "py-process", category: "security", severity: "medium", message: "Imports a process / OS module" } },
  { re: /\bos\.system\s*\(/, finding: { ruleId: "py-os-system", category: "security", severity: "high", message: "os.system() runs shell commands" } },
  { re: /^\s*(import|from)\s+(pickle|marshal)\b/, finding: { ruleId: "py-unsafe-deserialization", category: "security", severity: "medium", message: "Unsafe deserialization module" } },
  { re: /^\s*(import|from)\s+(socket|urllib|requests|http)\b/, finding: { ruleId: "py-network", category: "security", severity: "medium", message: "Network access" } },
  { re: /^\s*except\s*:/, finding: { ruleId: "py-bare-except", category: "quality", severity: "low", message: "Bare except hides errors (including KeyboardInterrupt)" } },
  { re: /^\s*print\s*\(/, finding: { ruleId: "py-print", category: "quality", severity: "info", message: "Leftover print output" } },
  { re: /^\s*from\s+\S+\s+import\s+\*/, finding: { ruleId: "py-wildcard-import", category: "quality", severity: "low", message: "Wildcard import" } },
];

function analyzePython(code: string, entryFunction: string): StaticReport {
  const lines = code.split("\n");
  const findings: Finding[] = [];
  let branchCount = 0;
  let maxFunctionLines = 0;
  let currentFnStart = -1;
  let currentFnIndent = 0;

  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "");
    for (const rule of PY_RULES) if (rule.re.test(line)) findings.push({ ...rule.finding, line: i + 1 });
    if (/^\s*(if|elif|for|while|except|case)\b/.test(line) || /\bif\b.+\belse\b/.test(line)) branchCount++;
    const def = /^(\s*)def\s+\w+/.exec(line);
    if (def) {
      if (currentFnStart >= 0) maxFunctionLines = Math.max(maxFunctionLines, i - currentFnStart);
      currentFnStart = i;
      currentFnIndent = def[1]?.length ?? 0;
    } else if (currentFnStart >= 0 && line.trim() && (line.length - line.trimStart().length) <= currentFnIndent && !/^\s*[)\]}]/.test(line)) {
      maxFunctionLines = Math.max(maxFunctionLines, i - currentFnStart);
      currentFnStart = -1;
    }
    if (raw.length > 120) findings.push({ ruleId: "py-line-length", category: "quality", severity: "info", message: "Line longer than 120 characters", line: i + 1 });
  });
  if (currentFnStart >= 0) maxFunctionLines = Math.max(maxFunctionLines, lines.length - currentFnStart);

  const exportsEntryFunction = new RegExp(`^def\\s+${entryFunction}\\s*\\(`, "m").test(code);
  if (!exportsEntryFunction) findings.push({ ruleId: "missing-export", category: "structure", severity: "high", message: `Does not define top-level \`${entryFunction}\`` });
  if (maxFunctionLines > 60) findings.push({ ruleId: "long-function", category: "quality", severity: "low", message: `Longest function spans ${maxFunctionLines} lines` });

  return {
    analyzer: "python-heuristic",
    findings,
    syntaxErrors: [],
    exportsEntryFunction,
    metrics: { lines: lines.length, maxFunctionLines, branchCount },
  };
}

/** Transpiles TS → ESM JS for sandbox execution. A pure source transform; nothing is executed. */
export function transpileForSandbox(code: string, language: string): string {
  if (language !== "TYPESCRIPT") return code;
  return ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: false },
    fileName: "solution.ts",
  }).outputText;
}
