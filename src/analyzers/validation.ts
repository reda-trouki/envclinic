import { mergedEnvironment, type ProjectContext } from "../core/project";
import { validateEnv } from "../core/validator";
import type { RawIssue } from "../types";

/**
 * Validate the merged environment against the configured schema.
 *
 * `skip` holds variables that other analyzers already reported as missing or
 * empty, so the same problem is not reported twice.
 */
export function findSchemaIssues(project: ProjectContext, skip: Set<string>): RawIssue[] {
  const schema = project.schema;
  if (schema === undefined) return [];

  const { values, origin } = mergedEnvironment(project);
  const hasInput = project.sourceFiles.length > 0 || Object.keys(project.env).length > 0;
  if (!hasInput) {
    return [
      {
        code: "validation-skipped",
        severity: "info",
        message: "Schema validation was skipped because no environment files were found",
        recommendation: "Create the env file, pass --file, or use --process-env to validate the process environment.",
      },
    ];
  }

  const issues: RawIssue[] = [];
  for (const error of validateEnv(schema, values).errors) {
    if (project.isIgnored(error.variable)) continue;
    if (error.code === "missing-required" && skip.has(error.variable)) continue;
    const where = origin.get(error.variable);
    const issue: RawIssue = {
      code: `schema-${error.code}`,
      rule: "validation",
      variable: error.variable,
      message: error.message,
      recommendation:
        error.code === "missing-required"
          ? `Set ${error.variable} in your environment, or mark it as required: false (or give it a default) in the schema.`
          : `Fix the value of ${error.variable} or update the schema if the rule is wrong.`,
    };
    if (where) {
      issue.file = where.file;
      issue.line = where.line;
    }
    issues.push(issue);
  }
  return issues;
}
