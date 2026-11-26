import path from "node:path";
import {
  DEFAULT_RULES,
  DEFAULT_SOURCE_FILES,
  EXAMPLE_FILE_CANDIDATES,
} from "../config/defaults";
import { loadConfig } from "../config/loader";
import { validateConfig } from "../config/schema";
import { detectFramework, type FrameworkInfo } from "../frameworks/detector";
import type {
  AuditCheck,
  AuditOptions,
  EnvDoctorConfig,
  RawIssue,
  RuleLevel,
  RuleName,
  Schema,
} from "../types";
import { displayPath, readEnvFile, type ReadResult } from "./files";
import { createNameMatcher } from "./glob";
import { parseEnv, type EnvEntry, type ParsedEnv } from "./parser";
import { isValidName } from "../analyzers/syntax";
import { DEFAULT_EXTENSIONS, type ScanOptions } from "./scanner";

export const ALL_CHECKS: AuditCheck[] = [
  "files",
  "unused",
  "secrets",
  "validation",
  "types",
];

export interface EnvFileData {
  /** Display path relative to the project root. */
  path: string;
  absolute: string;
  role: "source" | "example";
  parsed: ParsedEnv;
  /** Declarations with valid variable names, in file order (duplicates included). */
  entries: EnvEntry[];
  keys: Set<string>;
}

export interface ProjectContext {
  cwd: string;
  config: EnvDoctorConfig;
  configFile?: string;
  rules: Record<RuleName, RuleLevel>;
  strict: boolean;
  checks: Set<AuditCheck>;
  isIgnored: (name: string) => boolean;
  framework: FrameworkInfo;
  sourceFiles: EnvFileData[];
  example?: EnvFileData;
  /** Problems found while locating and reading env files. */
  loadIssues: RawIssue[];
  schema?: Schema;
  scanOptions: ScanOptions;
  /** Extra values to validate (process environment or programmatic). */
  env: Record<string, string | undefined>;
}

interface LoadedFile {
  shown: string;
  absolute: string;
  result: ReadResult;
}

async function load(cwd: string, relative: string): Promise<LoadedFile> {
  const absolute = path.resolve(cwd, relative);
  return {
    shown: displayPath(cwd, absolute),
    absolute,
    result: await readEnvFile(cwd, relative),
  };
}

/** Report why a file could not be read. Returns true if it was readable. */
function reportUnreadable(file: LoadedFile, issues: RawIssue[]): boolean {
  const { result, shown } = file;
  switch (result.status) {
    case "ok":
      if (result.encoding !== "utf-8") {
        issues.push({
          code: "non-utf8-file",
          rule: "syntax",
          severity: "warning",
          file: shown,
          message: `${shown} is saved as ${result.encoding.toUpperCase()}, not UTF-8`,
          recommendation:
            "It was read correctly, but most dotenv loaders expect UTF-8. Re-save it as UTF-8 (in PowerShell: `Set-Content -Encoding utf8 .env`, or use `Out-File -Encoding utf8` instead of `>`).",
        });
      }
      return true;
    case "unsafe":
      issues.push({
        code: "unsafe-path",
        severity: "error",
        file: shown,
        message: `${shown} was skipped: ${result.reason}`,
        recommendation:
          "Only files inside the project directory can be audited.",
      });
      return false;
    case "too-large":
      issues.push({
        code: "file-too-large",
        severity: "error",
        file: shown,
        message: `${shown} was skipped because it is larger than 5 MB`,
        recommendation:
          "Environment files should be small. Check that this is really an env file.",
      });
      return false;
    case "unreadable":
      issues.push({
        code: "file-unreadable",
        severity: "error",
        file: shown,
        message: `${shown} could not be read`,
        recommendation: "Check the file permissions.",
      });
      return false;
    case "missing":
      return false;
  }
}

function toFileData(
  shown: string,
  absolute: string,
  role: "source" | "example",
  content: string,
): EnvFileData {
  const parsed = parseEnv(content);
  const entries = parsed.entries.filter((entry) => isValidName(entry.key));
  return {
    path: shown,
    absolute,
    role,
    parsed,
    entries,
    keys: new Set(entries.map((entry) => entry.key)),
  };
}

/**
 * Locate and read the project's env files, load the config and detect the
 * framework. Nothing is analyzed yet, so generators and analyzers can share
 * the same data.
 */
export async function loadProject(
  options: AuditOptions = {},
): Promise<ProjectContext> {
  const cwd = path.resolve(options.cwd ?? process.cwd());

  let config: EnvDoctorConfig;
  let configFile: string | undefined;
  if (options.config !== undefined) {
    config = validateConfig(options.config, "the config option");
  } else {
    const loaded = await loadConfig(cwd, options.configPath);
    config = loaded.config;
    configFile = loaded.file;
  }

  const rules = { ...DEFAULT_RULES, ...config.rules };
  const isIgnored = createNameMatcher([
    ...(config.ignore?.variables ?? []),
    ...(options.ignore ?? []),
  ]);

  const sourceExplicit = options.files !== undefined;
  const sourcePaths =
    options.files ?? config.files?.source ?? DEFAULT_SOURCE_FILES;
  const exampleExplicit = options.example !== undefined;
  const exampleCandidates =
    options.example !== undefined
      ? [options.example]
      : config.files?.example !== undefined
        ? [config.files.example]
        : EXAMPLE_FILE_CANDIDATES;

  const loadIssues: RawIssue[] = [];
  const sourceFiles: EnvFileData[] = [];

  // --- Example file -------------------------------------------------------
  let example: EnvFileData | undefined;
  let exampleLoaded: LoadedFile | undefined;
  for (const candidate of exampleCandidates) {
    const file = await load(cwd, candidate);
    if (file.result.status !== "missing") {
      exampleLoaded = file;
      break;
    }
  }

  if (exampleLoaded) {
    if (
      reportUnreadable(exampleLoaded, loadIssues) &&
      exampleLoaded.result.status === "ok"
    ) {
      example = toFileData(
        exampleLoaded.shown,
        exampleLoaded.absolute,
        "example",
        exampleLoaded.result.content,
      );
    }
  } else {
    const named = exampleExplicit || config.files?.example !== undefined;
    loadIssues.push({
      code: "example-file-missing",
      severity: exampleExplicit ? "error" : "warning",
      message: named
        ? `Example file ${displayPath(cwd, path.resolve(cwd, exampleCandidates[0] as string))} was not found`
        : "No .env.example or .env.sample file was found",
      recommendation:
        "Create one that lists every variable your project needs (names only, never real values) so new developers know what to configure. `envclinic generate` can create it.",
    });
  }

  // --- Source files -------------------------------------------------------
  const seen = new Set<string>(example ? [example.absolute] : []);
  for (const relative of sourcePaths) {
    const absolute = path.resolve(cwd, relative);
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    const file = await load(cwd, relative);
    if (file.result.status === "missing") {
      loadIssues.push({
        code: "source-file-missing",
        severity: sourceExplicit ? "error" : "info",
        file: file.shown,
        message: sourceExplicit
          ? `${file.shown} was not found`
          : `${file.shown} was not found, so no values were compared`,
        recommendation: `Create ${file.shown} (for example by copying ${example?.path ?? ".env.example"}), or pass --file to audit a different file.`,
      });
      continue;
    }
    if (!reportUnreadable(file, loadIssues) || file.result.status !== "ok")
      continue;
    sourceFiles.push(
      toFileData(file.shown, file.absolute, "source", file.result.content),
    );
  }

  if (
    sourceFiles.length === 0 &&
    example === undefined &&
    !loadIssues.some((issue) => issue.severity === "error")
  ) {
    loadIssues.push({
      code: "no-env-files",
      severity: "error",
      message: "No environment files were found to audit",
      recommendation:
        "Create a .env file and a .env.example that documents it, or point to a file with --file.",
    });
  }

  const framework = await detectFramework(cwd, config);

  const scanOptions: ScanOptions = {
    directories: options.scanDirectories ?? config.scan?.directories ?? ["."],
    ignore: config.scan?.ignore ?? [],
    extensions: config.scan?.extensions ?? DEFAULT_EXTENSIONS,
  };

  const env: Record<string, string | undefined> = {
    ...(options.processEnv ? process.env : {}),
    ...(options.env ?? {}),
  };

  const project: ProjectContext = {
    cwd,
    config,
    rules,
    strict: options.strict ?? false,
    checks: new Set(options.checks ?? ALL_CHECKS),
    isIgnored,
    framework,
    sourceFiles,
    loadIssues,
    scanOptions,
    env,
  };
  if (configFile !== undefined) project.configFile = configFile;
  if (example !== undefined) project.example = example;
  if (config.schema !== undefined) project.schema = config.schema;
  return project;
}

/** Every env file that was read: sources first, then the example. */
export function allFiles(project: ProjectContext): EnvFileData[] {
  return project.example
    ? [...project.sourceFiles, project.example]
    : [...project.sourceFiles];
}

/**
 * The effective environment from the source files (later files win, and the
 * last declaration within a file wins), overlaid with `project.env`.
 * Used only for validation; values are never printed.
 */
export function mergedEnvironment(project: ProjectContext): {
  values: Record<string, string | undefined>;
  /** The file and line that defined each variable (not set for process values). */
  origin: Map<string, { file: string; line: number }>;
} {
  const values: Record<string, string | undefined> = {};
  const origin = new Map<string, { file: string; line: number }>();
  for (const file of project.sourceFiles) {
    for (const entry of file.entries) {
      values[entry.key] = entry.value;
      origin.set(entry.key, { file: file.path, line: entry.line });
    }
  }
  for (const [name, value] of Object.entries(project.env)) {
    if (value !== undefined) {
      values[name] = value;
      origin.delete(name);
    }
  }
  return { values, origin };
}
