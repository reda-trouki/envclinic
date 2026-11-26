import type { AuditCheck, AuditOptions, AuditResult } from "../../types";
import type { IO } from "../io";
import { formatGithub } from "../output/github";
import { formatTerminal } from "../output/terminal";

/** A mistake in how the CLI was invoked (exit code 2). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** Every option any command accepts, merged from the global and command level. */
export interface CliOptions {
  cwd?: string;
  config?: string;
  json?: boolean;
  format?: string;
  quiet?: boolean;
  verbose?: boolean;
  /** Commander sets this to false for --no-color. */
  color?: boolean;
  strict?: boolean;
  ci?: boolean;
  file?: string[];
  example?: string;
  ignore?: string[];
  /** Commander sets this to false for --no-scan. */
  scan?: boolean;
  envOnly?: boolean;
  dir?: string[];
  processEnv?: boolean;
  fix?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  force?: boolean;
  merge?: boolean;
  output?: string;
  exclude?: string[];
  check?: boolean;
  configFormat?: string;
}

export type OutputFormat = "terminal" | "json" | "github";

export function resolveFormat(options: CliOptions): OutputFormat {
  if (options.json) return "json";
  const format = options.format ?? "terminal";
  if (format !== "terminal" && format !== "json" && format !== "github") {
    throw new UsageError(`Unknown format "${format}". Use terminal, json or github.`);
  }
  return format;
}

export function toAuditOptions(options: CliOptions, checks?: AuditCheck[]): AuditOptions {
  const result: AuditOptions = { strict: options.strict ?? false };
  if (checks !== undefined) result.checks = checks;
  if (options.cwd !== undefined) result.cwd = options.cwd;
  if (options.config !== undefined) result.configPath = options.config;
  if (options.file !== undefined && options.file.length > 0) result.files = options.file;
  if (options.example !== undefined) result.example = options.example;
  if (options.ignore !== undefined && options.ignore.length > 0) result.ignore = options.ignore;
  if (options.scan === false) result.scan = false;
  if (options.envOnly) result.codeSecrets = false;
  if (options.dir !== undefined && options.dir.length > 0) result.scanDirectories = options.dir;
  if (options.processEnv) result.processEnv = true;
  return result;
}

/** Print a status message without polluting machine-readable output. */
export function note(io: IO, options: CliOptions, text: string): void {
  if (resolveFormat(options) === "terminal") io.out(text + "\n");
  else io.err(text + "\n");
}

export function printAudit(result: AuditResult, options: CliOptions, io: IO): void {
  const format = resolveFormat(options);
  if (format === "json") {
    io.out(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (format === "github") {
    io.out(formatGithub(result));
    return;
  }
  const color = options.color !== false && !options.ci && io.color;
  io.out(formatTerminal(result, { color, quiet: Boolean(options.quiet) }));
  // In GitHub Actions, also surface the issues as annotations on the pull request.
  if (options.ci && io.env.GITHUB_ACTIONS === "true") io.out(formatGithub(result));
}

export function exitCodeFor(result: AuditResult): number {
  return result.success ? 0 : 1;
}
