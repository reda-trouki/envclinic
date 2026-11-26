import { findDuplicates } from "../analyzers/duplicates";
import { findEmpty } from "../analyzers/empty";
import { findMissing, findUndocumented } from "../analyzers/missing";
import {
  analyzeCodeSecrets,
  analyzeEnvFileSecrets,
} from "../analyzers/security";
import { findSyntaxIssues } from "../analyzers/syntax";
import {
  findUndeclared,
  findUnused,
  type UsageData,
} from "../analyzers/unused";
import { findSchemaIssues } from "../analyzers/validation";
import type {
  AuditIssue,
  AuditOptions,
  AuditResult,
  RawIssue,
  Severity,
} from "../types";
import { createGitChecker } from "./gitignore";
import { createNameMatcher, matchesGlob } from "./glob";
import { buildTypesContent, typesOutputPath } from "./outputs";
import { allFiles, loadProject, type ProjectContext } from "./project";
import { readEnvFile } from "./files";
import { buildPatterns } from "./secrets-detector";
import { extractReferences, scanSources, type SourceLocation } from "./scanner";

const SEVERITY_RANK: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** Issues that only matter when the "files" check is selected. */
const FILE_PRESENCE_CODES = new Set([
  "source-file-missing",
  "example-file-missing",
  "no-env-files",
  "non-utf8-file",
]);

export interface ScanOutcome {
  usage: UsageData;
  /** Credentials found in source code. */
  secrets: RawIssue[];
}

/**
 * Read the project's source files once, collecting environment variable
 * references and (optionally) hardcoded credentials.
 */
export async function scanProject(
  project: ProjectContext,
  options: { secrets: boolean },
): Promise<ScanOutcome> {
  const patterns = buildPatterns(project.config.secrets?.patterns);
  const ignoreFiles = project.config.secrets?.ignoreFiles ?? [];
  const references = new Map<string, SourceLocation[]>();
  const dynamic: SourceLocation[] = [];
  const secrets: RawIssue[] = [];

  const summary = await scanSources(
    project.cwd,
    project.scanOptions,
    (file) => {
      const extracted = extractReferences(file.content);
      for (const { name, line } of extracted.names) {
        const list = references.get(name);
        const location = { file: file.path, line };
        if (list) list.push(location);
        else references.set(name, [location]);
      }
      for (const { line } of extracted.dynamic)
        dynamic.push({ file: file.path, line });

      if (
        options.secrets &&
        !ignoreFiles.some((glob) => matchesGlob(glob, file.path))
      ) {
        secrets.push(...analyzeCodeSecrets(file.path, file.content, patterns));
      }
    },
  );

  return {
    usage: { filesScanned: summary.filesScanned, references, dynamic },
    secrets,
  };
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

async function checkTypesFile(
  project: ProjectContext,
  usage: UsageData | undefined,
): Promise<RawIssue[]> {
  const output = typesOutputPath(project);
  const expected = buildTypesContent(project, usage);
  const current = await readEnvFile(project.cwd, output);

  if (current.status === "missing") {
    return [
      {
        code: "types-missing",
        rule: "types",
        severity: "warning",
        file: output,
        message: `types.enabled is set but ${output} does not exist`,
        recommendation: "Run `npx envclinic types` to generate it.",
      },
    ];
  }
  if (current.status !== "ok") {
    return [
      {
        code: "types-unreadable",
        rule: "types",
        severity: "warning",
        file: output,
        message: `${output} could not be checked (${current.status === "unsafe" ? current.reason : current.status})`,
      },
    ];
  }
  if (normalize(current.content) !== expected) {
    return [
      {
        code: "types-outdated",
        rule: "types",
        severity: "warning",
        file: output,
        message: `${output} is out of date with your environment variables`,
        recommendation: "Run `npx envclinic types` to regenerate it.",
      },
    ];
  }
  return [];
}

/** Run the selected checks against a loaded project and collect raw issues. */
export async function collectIssues(
  project: ProjectContext,
  options: Pick<AuditOptions, "scan" | "codeSecrets"> = {},
): Promise<{ raw: RawIssue[]; usage?: UsageData }> {
  const { checks } = project;
  const raw: RawIssue[] = project.loadIssues.filter(
    (issue) => checks.has("files") || !FILE_PRESENCE_CODES.has(issue.code),
  );
  const files = allFiles(project);

  if (checks.has("files")) {
    for (const file of files) {
      raw.push(
        ...findSyntaxIssues(file.path, file.parsed),
        ...findDuplicates(file.path, file.entries),
      );
    }
    for (const file of project.sourceFiles) {
      raw.push(...findEmpty(file.path, file.entries));
      if (project.example) {
        raw.push(
          ...findMissing(
            project.example.path,
            project.example.keys,
            file.path,
            file.keys,
          ),
          ...findUndocumented(
            project.example.path,
            project.example.keys,
            file.path,
            file.keys,
          ),
        );
      }
    }
  }

  const scanEnabled = options.scan !== false;
  const codeSecrets =
    scanEnabled && options.codeSecrets !== false && checks.has("secrets");
  const needsUsage =
    scanEnabled &&
    (checks.has("unused") ||
      (checks.has("types") && project.config.types?.enabled === true));
  let usage: UsageData | undefined;
  let codeSecretIssues: RawIssue[] = [];
  if (needsUsage || codeSecrets) {
    const outcome = await scanProject(project, { secrets: codeSecrets });
    usage = outcome.usage;
    codeSecretIssues = outcome.secrets;
  }

  if (checks.has("unused") && usage) {
    raw.push(...findUnused(project, usage), ...findUndeclared(project, usage));
  }

  if (checks.has("secrets")) {
    const git = createGitChecker(project.cwd);
    const securityOptions = {
      patterns: buildPatterns(project.config.secrets?.patterns),
      isAllowed: createNameMatcher(project.config.secrets?.allow ?? []),
      isIgnored: project.isIgnored,
      publicPrefixes: project.framework.publicPrefixes,
    };
    // A variable that is both in .env and the example is exposed once, not twice.
    const reportedPublic = new Set<string>();
    for (const file of files) {
      for (const issue of analyzeEnvFileSecrets(
        file,
        await git.status(file.absolute),
        securityOptions,
      )) {
        if (issue.code === "public-secret" && issue.variable !== undefined) {
          if (reportedPublic.has(issue.variable)) continue;
          reportedPublic.add(issue.variable);
        }
        raw.push(issue);
      }
    }
    raw.push(...codeSecretIssues);
  }

  if (checks.has("validation")) {
    const already = new Set(
      raw
        .filter(
          (issue) =>
            issue.code === "missing-variable" ||
            issue.code === "empty-variable",
        )
        .map((issue) => issue.variable as string),
    );
    raw.push(...findSchemaIssues(project, already));
  }

  if (
    checks.has("types") &&
    project.config.types?.enabled === true &&
    scanEnabled
  ) {
    raw.push(...(await checkTypesFile(project, usage)));
  }

  return usage === undefined ? { raw } : { raw, usage };
}

/** Apply rule levels, ignores and strict mode to raw issues. */
export function resolveIssues(
  project: ProjectContext,
  raw: RawIssue[],
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const item of raw) {
    if (item.variable !== undefined && project.isIgnored(item.variable))
      continue;

    let severity: Severity;
    if (item.rule !== undefined) {
      const level = project.rules[item.rule];
      if (level === "off") continue;
      // The rule level can lower an issue's natural severity but never raise it.
      const natural = item.severity ?? "error";
      severity =
        SEVERITY_RANK[level] > SEVERITY_RANK[natural] ? level : natural;
    } else {
      severity = item.severity ?? "info";
    }
    if (project.strict && severity === "warning") severity = "error";

    const { rule: _rule, severity: _severity, ...rest } = item;
    issues.push({ ...rest, severity });
  }
  return issues.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

/**
 * Audit the environment of a project.
 *
 * Runs all checks by default: env file comparison (missing, undocumented,
 * empty, duplicate, invalid names), potentially unused and undeclared
 * variables, secret detection, schema validation and types freshness.
 * Use `checks` to run a subset.
 */
export async function audit(options: AuditOptions = {}): Promise<AuditResult> {
  return auditProject(await loadProject(options), options);
}

/** Run the selected checks against an already loaded project. */
export async function auditProject(
  project: ProjectContext,
  options: Pick<AuditOptions, "scan" | "codeSecrets"> = {},
): Promise<AuditResult> {
  const { raw, usage } = await collectIssues(project, options);
  const issues = resolveIssues(project, raw);

  const files = allFiles(project)
    .map((file) => ({
      path: file.path,
      role: file.role,
      variables: file.keys.size,
    }))
    .sort(
      (a, b) => Number(a.role === "example") - Number(b.role === "example"),
    );
  const variables = new Set(
    allFiles(project).flatMap((file) => [...file.keys]),
  );

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter(
    (issue) => issue.severity === "warning",
  ).length;

  const result: AuditResult = {
    success: errors === 0,
    summary: {
      filesScanned: files.length,
      sourceFilesScanned: usage?.filesScanned ?? 0,
      variablesFound: variables.size,
      errors,
      warnings,
      infos: issues.length - errors - warnings,
    },
    files,
    issues,
    framework: {
      id: project.framework.id,
      name: project.framework.name,
      evidence: project.framework.evidence,
    },
  };
  if (project.configFile !== undefined) result.configFile = project.configFile;
  return result;
}
