import { isBuiltinVariable } from "../config/defaults";
import type { ProjectContext } from "../core/project";
import type { SourceLocation } from "../core/scanner";
import type { RawIssue } from "../types";

export interface UsageData {
  filesScanned: number;
  /** Variables read with a literal name, with where. */
  references: Map<string, SourceLocation[]>;
  /** Places where the variable name could not be determined statically. */
  dynamic: SourceLocation[];
}

const INTERPOLATION = /\$\{([A-Za-z_]\w*)\}/g;

/** Variables referenced by other variables' values (`${NAME}` interpolation). */
function interpolatedNames(project: ProjectContext): Set<string> {
  const used = new Set<string>();
  const files = project.example ? [...project.sourceFiles, project.example] : project.sourceFiles;
  for (const file of files) {
    for (const entry of file.entries) {
      if (entry.quote === "single") continue;
      for (const match of entry.value.matchAll(INTERPOLATION)) used.add(match[1] as string);
    }
  }
  return used;
}

/**
 * Variables declared in env files that no scanned source file reads.
 *
 * This is static analysis, so results are reported as "potentially unused":
 * dynamic access, aliases, framework conventions and tools outside the
 * scanned directories can all read variables this scan cannot see.
 * Nothing is ever deleted.
 */
export function findUnused(project: ProjectContext, usage: UsageData): RawIssue[] {
  if (usage.filesScanned === 0) return []; // nothing was scanned, so nothing can be concluded

  const used = interpolatedNames(project);
  const declared = new Map<string, string>(); // variable -> file it is declared in
  for (const file of [...project.sourceFiles, ...(project.example ? [project.example] : [])]) {
    for (const key of file.keys) if (!declared.has(key)) declared.set(key, file.path);
  }

  const issues: RawIssue[] = [];
  for (const [variable, file] of [...declared].sort(([a], [b]) => a.localeCompare(b))) {
    if (usage.references.has(variable) || used.has(variable) || project.isIgnored(variable)) continue;
    issues.push({
      code: "unused-variable",
      rule: "unused",
      file,
      variable,
      message: `${variable} is declared in ${file} but was not found in ${usage.filesScanned} scanned source file${usage.filesScanned === 1 ? "" : "s"} (potentially unused)`,
      recommendation: `Check whether ${variable} is still needed. It may be read dynamically or by a tool outside the scanned code. If it is, add it to ignore.variables.`,
    });
  }

  if (issues.length > 0 && usage.dynamic.length > 0) {
    const where = [...new Set(usage.dynamic.map((location) => location.file))];
    issues.push({
      code: "dynamic-env-access",
      severity: "info",
      message: `${usage.dynamic.length} dynamic environment access${usage.dynamic.length === 1 ? "" : "es"} found in ${where.length} file${where.length === 1 ? "" : "s"} (for example ${where[0]}), so some variables reported as unused may still be read`,
      recommendation: "Review the potentially unused variables before removing anything.",
    });
  }
  return issues;
}

/**
 * Variables read in source code that are neither set in an env file nor
 * documented in the example file.
 */
export function findUndeclared(project: ProjectContext, usage: UsageData): RawIssue[] {
  const known = new Set<string>();
  for (const file of [...project.sourceFiles, ...(project.example ? [project.example] : [])]) {
    for (const key of file.keys) known.add(key);
  }
  // Without any env file there is no baseline to compare against.
  if (project.sourceFiles.length === 0 && project.example === undefined) return [];

  const reference = project.example?.path ?? project.sourceFiles[0]?.path ?? ".env.example";
  const issues: RawIssue[] = [];
  for (const [variable, locations] of [...usage.references].sort(([a], [b]) => a.localeCompare(b))) {
    if (known.has(variable) || project.isIgnored(variable) || isBuiltinVariable(variable)) continue;
    const first = locations[0] as SourceLocation;
    issues.push({
      code: "undeclared-variable",
      rule: "undeclared",
      file: first.file,
      line: first.line,
      variable,
      message: `${variable} is used in ${first.file}${locations.length > 1 ? ` (and ${locations.length - 1} more place${locations.length === 2 ? "" : "s"})` : ""} but is not set in any env file or documented in ${reference}`,
      recommendation: `Add ${variable}= to ${reference} so other developers know it is required, or add it to ignore.variables if the platform provides it.`,
    });
  }
  return issues;
}
