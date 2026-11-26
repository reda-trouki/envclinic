import type { EnvEntry } from "../core/parser";
import type { RawIssue } from "../types";

/** Report variables declared more than once in the same file. */
export function findDuplicates(file: string, entries: EnvEntry[]): RawIssue[] {
  const lines = new Map<string, number[]>();
  for (const entry of entries) {
    const existing = lines.get(entry.key);
    if (existing) existing.push(entry.line);
    else lines.set(entry.key, [entry.line]);
  }

  const issues: RawIssue[] = [];
  for (const [variable, where] of [...lines].sort(([a], [b]) => a.localeCompare(b))) {
    if (where.length < 2) continue;
    issues.push({
      code: "duplicate-variable",
      rule: "duplicates",
      file,
      variable,
      line: where[0],
      message: `${variable} is declared ${where.length} times in ${file} (lines ${where.join(", ")})`,
      recommendation: `Keep a single declaration of ${variable}. Environment loaders disagree about which duplicate wins.`,
    });
  }
  return issues;
}
