import type { ParsedEnv } from "../core/parser";
import type { RawIssue } from "../types";

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidName(key: string): boolean {
  return VALID_NAME.test(key);
}

/**
 * Report syntax problems and invalid variable names.
 *
 * Neither the offending line nor the invalid name is included in the issue:
 * a pasted key body or certificate line can parse as a "variable name", so
 * only the line number is reported.
 */
export function findSyntaxIssues(file: string, parsed: ParsedEnv): RawIssue[] {
  const issues: RawIssue[] = [];

  for (const problem of parsed.problems) {
    if (problem.kind === "malformed-line") {
      issues.push({
        code: "malformed-line",
        rule: "syntax",
        file,
        line: problem.line,
        message: `Line ${problem.line} of ${file} is not a valid KEY=value declaration`,
        recommendation: "Use KEY=value, or start the line with # to make it a comment.",
      });
    } else {
      issues.push({
        code: "unterminated-quote",
        rule: "syntax",
        file,
        line: problem.line,
        message: `Line ${problem.line} of ${file} has a quoted value that is never closed`,
        recommendation: "Add the closing quote.",
      });
    }
  }

  for (const entry of parsed.entries) {
    if (!isValidName(entry.key)) {
      issues.push({
        code: "invalid-variable-name",
        rule: "names",
        file,
        line: entry.line,
        message: `Line ${entry.line} of ${file} has an invalid variable name`,
        recommendation:
          "Use only letters, digits and underscores, and do not start with a digit (for example MY_VARIABLE).",
      });
    }
  }

  return issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}
