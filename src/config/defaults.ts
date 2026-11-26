import type { RuleLevel, RuleName } from "../types";

export const DEFAULT_SOURCE_FILES = [".env"];

export const EXAMPLE_FILE_CANDIDATES = [".env.example", ".env.sample"];

export const DEFAULT_RULES: Record<RuleName, RuleLevel> = {
  missing: "error",
  undocumented: "warning",
  empty: "warning",
  duplicates: "error",
  names: "warning",
  syntax: "warning",
  unused: "warning",
  undeclared: "warning",
  secrets: "error",
  weak: "warning",
  validation: "error",
  types: "warning",
};

export const DEFAULT_TYPES_OUTPUT = "env.d.ts";
export const DEFAULT_EXAMPLE_OUTPUT = ".env.example";

/**
 * Variables provided by the platform or tooling rather than the project.
 * They are never reported as undeclared and are not generated from code
 * references alone.
 */
export const BUILTIN_VARIABLES = new Set([
  "NODE_ENV", "CI", "HOME", "PATH", "PWD", "USER", "SHELL", "TERM", "TZ", "LANG", "TMPDIR",
  "NEXT_RUNTIME", "MODE", "BASE_URL", "PROD", "DEV", "SSR",
]);

export function isBuiltinVariable(name: string): boolean {
  return BUILTIN_VARIABLES.has(name) || name.startsWith("npm_") || name.startsWith("VERCEL_");
}
