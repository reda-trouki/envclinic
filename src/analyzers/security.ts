import type { EnvFileData } from "../core/project";
import {
  findValueMatch,
  isPlaceholder,
  isReferenceOrFlag,
  isSecretName,
  scanTextForSecrets,
  weakSecretReason,
  type SecretPattern,
} from "../core/secrets-detector";
import type { GitStatus } from "../core/gitignore";
import type { RawIssue } from "../types";

export interface SecurityOptions {
  patterns: SecretPattern[];
  /** Variables exempt from secret checks. */
  isAllowed: (name: string) => boolean;
  /** Variables exempt from all checks (ignore.variables). */
  isIgnored: (name: string) => boolean;
  publicPrefixes: string[];
}

const PUBLIC_SECRET_NAME = /SECRET|PASSWORD|PASSWD|PRIVATE/i;
const ROTATE =
  "Remove it, store the value outside version control, and rotate it if it may ever have been committed or shared.";

/**
 * Check one env file for exposed or weak credentials.
 *
 * Findings carry only the variable name, file and line. The value is read to
 * classify it but is never copied into an issue.
 */
export function analyzeEnvFileSecrets(
  file: EnvFileData,
  git: GitStatus,
  options: SecurityOptions,
): RawIssue[] {
  const issues: RawIssue[] = [];
  const example = file.role === "example";
  const reportedPublic = new Set<string>();

  for (const entry of file.entries) {
    const name = entry.key;
    if (options.isIgnored(name) || options.isAllowed(name)) continue;

    const prefix = options.publicPrefixes.find((candidate) =>
      name.startsWith(candidate),
    );
    const match =
      entry.value === ""
        ? undefined
        : findValueMatch(entry.value, name, options.patterns);

    if (prefix !== undefined && !reportedPublic.has(name)) {
      const nameLooksSecret = PUBLIC_SECRET_NAME.test(
        name.slice(prefix.length),
      );
      if (match !== undefined || nameLooksSecret) {
        reportedPublic.add(name);
        issues.push({
          code: "public-secret",
          rule: "secrets",
          severity: match !== undefined ? "error" : "warning",
          file: file.path,
          line: entry.line,
          variable: name,
          message: `${name} looks like a secret but its ${prefix} prefix exposes it to the browser bundle`,
          recommendation: `Rename it without the ${prefix} prefix and read it only on the server, or confirm that it is meant to be public.`,
        });
      }
    }

    if (entry.value === "") continue;

    if (match !== undefined) {
      const severity: "error" | "warning" | "info" =
        example || git === "not-ignored"
          ? match.severity
          : git === "ignored"
            ? "info"
            : match.severity === "error"
              ? "warning"
              : "info";
      const where = example
        ? "in a template file that is normally committed"
        : git === "ignored"
          ? "in a git-ignored local file"
          : git === "not-ignored"
            ? "in a file that is not git-ignored"
            : "in an environment file";
      issues.push({
        code: "exposed-credential",
        rule: "secrets",
        severity,
        file: file.path,
        line: entry.line,
        variable: name,
        message: `Potential exposed credential (${match.description}) ${where}`,
        recommendation: example
          ? `Replace it with an empty value. ${ROTATE}`
          : git === "ignored"
            ? "Expected for local development. Make sure this file is never committed."
            : ROTATE,
      });
      continue;
    }

    if (example) {
      if (
        isSecretName(name) &&
        !isPlaceholder(entry.value) &&
        !isReferenceOrFlag(entry.value) &&
        entry.value.length >= 8
      ) {
        issues.push({
          code: "secret-in-example",
          rule: "secrets",
          severity: "warning",
          file: file.path,
          line: entry.line,
          variable: name,
          message: `${name} has a value in a template file that is normally committed`,
          recommendation:
            "Template files should list names only. Replace the value with an empty one or an obvious placeholder.",
        });
      }
      continue;
    }

    if (isSecretName(name)) {
      const reason = weakSecretReason(entry.value);
      if (reason !== undefined) {
        issues.push({
          code: "weak-secret",
          rule: "weak",
          severity: "warning",
          file: file.path,
          line: entry.line,
          variable: name,
          message: `Weak secret (${reason})`,
          recommendation: `Use a long random value, for example from \`openssl rand -base64 32\`.`,
        });
      }
    }
  }

  const hasValues = file.entries.some(
    (entry) => entry.value !== "" && !options.isIgnored(entry.key),
  );
  if (!example && git === "not-ignored" && hasValues) {
    issues.push({
      code: "env-file-not-ignored",
      rule: "secrets",
      severity: "error",
      file: file.path,
      message: `${file.path} contains values but is not listed in .gitignore, so it may be committed`,
      recommendation: `Add ${file.path} to .gitignore. If it was already committed, rotate its secrets and remove it from history.`,
    });
  }
  return issues;
}

/** Check one source file's text for hardcoded credentials. */
export function analyzeCodeSecrets(
  file: string,
  content: string,
  patterns: SecretPattern[],
): RawIssue[] {
  const seen = new Set<string>();
  const issues: RawIssue[] = [];
  for (const match of scanTextForSecrets(content, patterns)) {
    const key = `${match.line}:${match.pattern.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      code: "exposed-credential",
      rule: "secrets",
      severity: match.pattern.severity,
      file,
      line: match.line,
      message: `Potential exposed credential (${match.pattern.description}) in source code`,
      recommendation:
        "Load it from an environment variable instead, and rotate it if it was ever committed. If this is a false positive, add `envclinic-ignore` to the line or the file to secrets.ignoreFiles.",
    });
  }
  return issues;
}
