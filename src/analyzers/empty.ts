import type { EnvEntry } from "../core/parser";
import type { RawIssue } from "../types";

/** Variables declared with an empty value. Duplicated keys are reported once. */
export function findEmpty(file: string, entries: EnvEntry[]): RawIssue[] {
  const seen = new Set<string>();
  const issues: RawIssue[] = [];

  for (const entry of entries) {
    if (entry.value !== "" || seen.has(entry.key)) continue;
    seen.add(entry.key);
    issues.push({
      code: "empty-variable",
      rule: "empty",
      file,
      variable: entry.key,
      line: entry.line,
      message: `${entry.key} has an empty value in ${file}`,
      recommendation: `Set a value for ${entry.key}, or remove it if it is not needed.`,
    });
  }
  return issues;
}
