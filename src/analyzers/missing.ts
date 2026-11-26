import type { RawIssue } from "../types";

function sorted(keys: Iterable<string>): string[] {
  return [...keys].sort((a, b) => a.localeCompare(b));
}

/** Variables documented in the example file but absent from a source file. */
export function findMissing(
  exampleFile: string,
  exampleKeys: Set<string>,
  sourceFile: string,
  sourceKeys: Set<string>,
): RawIssue[] {
  return sorted(exampleKeys)
    .filter((key) => !sourceKeys.has(key))
    .map((variable) => ({
      code: "missing-variable",
      rule: "missing" as const,
      file: sourceFile,
      variable,
      message: `${variable} is declared in ${exampleFile} but missing from ${sourceFile}`,
      recommendation: `Add ${variable} to ${sourceFile}, or remove it from ${exampleFile} if it is no longer needed.`,
    }));
}

/** Variables set in a source file but not documented in the example file. */
export function findUndocumented(
  exampleFile: string,
  exampleKeys: Set<string>,
  sourceFile: string,
  sourceKeys: Set<string>,
): RawIssue[] {
  return sorted(sourceKeys)
    .filter((key) => !exampleKeys.has(key))
    .map((variable) => ({
      code: "undocumented-variable",
      rule: "undocumented" as const,
      file: sourceFile,
      variable,
      message: `${variable} is set in ${sourceFile} but not documented in ${exampleFile}`,
      recommendation: `Add ${variable}= (without a value) to ${exampleFile} so other developers know it exists.`,
    }));
}
