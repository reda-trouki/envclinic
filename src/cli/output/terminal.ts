import { createColors } from "picocolors";
import type { AuditIssue, AuditResult, Severity } from "../../types";

export interface TerminalOptions {
  color: boolean;
  /** Only show errors and the summary line. */
  quiet: boolean;
}

interface Section {
  title: string;
  match: (code: string) => boolean;
  security?: boolean;
}

const oneOf =
  (...codes: string[]) =>
  (code: string) =>
    codes.includes(code);

const SECTIONS: Section[] = [
  {
    title: "Files",
    match: oneOf(
      "no-env-files",
      "source-file-missing",
      "example-file-missing",
      "unsafe-path",
      "file-too-large",
      "file-unreadable",
      "non-utf8-file",
    ),
  },
  { title: "Missing variables", match: oneOf("missing-variable") },
  { title: "Undocumented variables", match: oneOf("undocumented-variable") },
  { title: "Empty variables", match: oneOf("empty-variable") },
  { title: "Duplicate declarations", match: oneOf("duplicate-variable") },
  {
    title: "Invalid names and syntax",
    match: oneOf(
      "invalid-variable-name",
      "malformed-line",
      "unterminated-quote",
    ),
  },
  {
    title: "Potentially unused variables",
    match: oneOf("unused-variable", "dynamic-env-access"),
  },
  { title: "Undeclared variables", match: oneOf("undeclared-variable") },
  {
    title: "Security audit",
    security: true,
    match: oneOf(
      "exposed-credential",
      "weak-secret",
      "public-secret",
      "env-file-not-ignored",
      "secret-in-example",
    ),
  },
  {
    title: "Schema validation",
    match: (code) =>
      code.startsWith("schema-") || code === "validation-skipped",
  },
  {
    title: "TypeScript declarations",
    match: oneOf("types-missing", "types-outdated", "types-unreadable"),
  },
];

const BOX_WIDTH = 38;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function center(text: string, width: number): string {
  const total = Math.max(0, width - text.length);
  const left = Math.floor(total / 2);
  return " ".repeat(left) + text + " ".repeat(total - left);
}

function header(): string[] {
  return [
    `╭${"─".repeat(BOX_WIDTH)}╮`,
    `│${center("ENV DOCTOR", BOX_WIDTH)}│`,
    `│${center("Environment Configuration", BOX_WIDTH)}│`,
    `╰${"─".repeat(BOX_WIDTH)}╯`,
  ];
}

/** Render an audit result for a terminal. Never includes variable values. */
export function formatTerminal(
  result: AuditResult,
  options: TerminalOptions,
): string {
  const pc = createColors(options.color);
  const icon: Record<Severity, string> = {
    error: pc.red("✘"),
    warning: pc.yellow("⚠"),
    info: pc.cyan("ℹ"),
  };
  const label: Record<Severity, string> = {
    error: pc.red(pc.bold("[CRITICAL]")),
    warning: pc.yellow(pc.bold("[WARNING]")),
    info: pc.cyan(pc.bold("[INFO]")),
  };

  const { summary } = result;
  const lines: string[] = [];

  const summaryLine =
    summary.errors === 0 && summary.warnings === 0
      ? `${pc.green("✔")} No problems found`
      : [
          plural(summary.errors, "error"),
          plural(summary.warnings, "warning"),
        ].join(", ");

  if (options.quiet) {
    for (const issue of result.issues.filter((i) => i.severity === "error")) {
      lines.push(`${icon.error} ${issue.message}`);
    }
    lines.push(summaryLine);
    return lines.join("\n") + "\n";
  }

  lines.push(...header(), "");

  if (result.framework) {
    lines.push(`${pc.green("✔")} Framework detected: ${result.framework.name}`);
    lines.push("");
  }

  if (result.files.length > 0) {
    lines.push(pc.bold("Files analyzed"));
    for (const file of result.files) {
      lines.push(
        `  ${pc.green("✔")} ${file.path} ${pc.dim(`(${file.role}, ${plural(file.variables, "variable")})`)}`,
      );
    }
    lines.push("");
  }

  const claimed = new Set<AuditIssue>();
  const sections: Array<{
    title: string;
    issues: AuditIssue[];
    security: boolean;
  }> = [];
  for (const section of SECTIONS) {
    const issues = result.issues.filter((issue) => section.match(issue.code));
    issues.forEach((issue) => claimed.add(issue));
    if (issues.length > 0)
      sections.push({
        title: section.title,
        issues,
        security: section.security === true,
      });
  }
  const other = result.issues.filter((issue) => !claimed.has(issue));
  if (other.length > 0)
    sections.push({ title: "Other", issues: other, security: false });

  for (const section of sections) {
    lines.push(pc.bold(`${section.title} (${section.issues.length})`));
    for (const issue of section.issues) {
      if (section.security) {
        lines.push(`  ${label[issue.severity]} ${issue.message}`);
        if (issue.file)
          lines.push(
            `    File: ${issue.file}${issue.line !== undefined ? `:${issue.line}` : ""}`,
          );
        if (issue.variable) lines.push(`    Variable: ${issue.variable}`);
        if (issue.variable && issue.code !== "env-file-not-ignored")
          lines.push("    Value: ********");
      } else {
        lines.push(`  ${icon[issue.severity]} ${issue.message}`);
      }
      if (issue.recommendation)
        lines.push(`    ${pc.dim(`→ ${issue.recommendation}`)}`);
    }
    lines.push("");
  }

  lines.push(pc.bold("Summary"));
  const scanned =
    summary.sourceFilesScanned > 0
      ? `, ${plural(summary.sourceFilesScanned, "source file")} scanned`
      : "";
  lines.push(
    `  ${plural(summary.filesScanned, "env file")} analyzed, ${plural(summary.variablesFound, "variable")} found${scanned}`,
  );
  lines.push(`  ${summaryLine}`);
  lines.push("", pc.dim("Run envclinic audit --help for options."));

  return lines.join("\n") + "\n";
}
