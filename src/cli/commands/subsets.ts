import { auditProject } from "../../core/auditor";
import { loadProject } from "../../core/project";
import type { AuditCheck } from "../../types";
import type { IO } from "../io";
import {
  exitCodeFor,
  printAudit,
  toAuditOptions,
  UsageError,
  type CliOptions,
} from "./common";

async function runSubset(
  options: CliOptions,
  io: IO,
  checks: AuditCheck[],
): Promise<number> {
  const auditOptions = toAuditOptions(options, checks);
  const result = await auditProject(
    await loadProject(auditOptions),
    auditOptions,
  );
  printAudit(result, options, io);
  return exitCodeFor(result);
}

/** Missing, empty, duplicate and invalid variables, plus schema validation. */
export function checkCommand(options: CliOptions, io: IO): Promise<number> {
  return runSubset(options, io, ["files", "validation"]);
}

/** Potentially exposed credentials and weak secrets. */
export function secretsCommand(options: CliOptions, io: IO): Promise<number> {
  return runSubset(options, io, ["secrets"]);
}

/** Potentially unused and undeclared variables. */
export function unusedCommand(options: CliOptions, io: IO): Promise<number> {
  if (options.scan === false)
    throw new UsageError(
      "`unused` needs to scan source code, so --no-scan cannot be used with it.",
    );
  return runSubset(options, io, ["unused"]);
}

/** Validate environment values against the schema from the config file. */
export async function validateCommand(
  options: CliOptions,
  io: IO,
): Promise<number> {
  const auditOptions = toAuditOptions(options, ["validation"]);
  const project = await loadProject(auditOptions);

  if (project.schema === undefined) {
    throw new UsageError(
      "No schema found. Add a `schema` to your envclinic config file (see docs/configuration.md).",
    );
  }
  if (
    project.sourceFiles.length === 0 &&
    Object.keys(project.env).length === 0
  ) {
    throw new UsageError(
      "Nothing to validate: no environment file was found. Pass --file, or use --process-env to validate the process environment.",
    );
  }

  const result = await auditProject(project, auditOptions);
  printAudit(result, options, io);
  return exitCodeFor(result);
}
