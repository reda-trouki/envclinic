import { auditProject, collectIssues, resolveIssues } from "../../core/auditor";
import { renderMerge } from "../../core/generator";
import { loadProject, type ProjectContext } from "../../core/project";
import {
  readExisting,
  resolveWriteTarget,
  writeProjectFile,
} from "../../core/writer";
import { collectVariables } from "../../core/variables";
import type { AuditCheck } from "../../types";
import type { IO } from "../io";
import {
  exitCodeFor,
  note,
  printAudit,
  toAuditOptions,
  UsageError,
  type CliOptions,
} from "./common";

const ALL: AuditCheck[] | undefined = undefined;

/**
 * The only automatic fix: add variables that are used or set but missing
 * from the example file. Names are appended with empty values, existing
 * content is untouched, and real env files are never modified.
 */
async function applyFix(
  project: ProjectContext,
  options: CliOptions,
  io: IO,
): Promise<number | undefined> {
  const { raw, usage } = await collectIssues(
    project,
    options.scan === false ? { scan: false } : {},
  );
  const issues = resolveIssues(project, raw);
  const names = [
    ...new Set(
      issues
        .filter(
          (issue) =>
            issue.code === "undocumented-variable" ||
            issue.code === "undeclared-variable",
        )
        .map((issue) => issue.variable as string),
    ),
  ].sort();

  if (names.length === 0) {
    note(io, options, "Nothing to fix automatically.");
    return undefined;
  }
  if (project.example === undefined) {
    note(
      io,
      options,
      "--fix needs an existing example file. Run `envclinic generate` to create one.",
    );
    return undefined;
  }

  const example = project.example;
  const variables = collectVariables(project, usage).filter((info) =>
    names.includes(info.name),
  );
  const target = await resolveWriteTarget(project.cwd, example.path);
  if (!target.ok)
    throw new UsageError(`Cannot modify ${example.path}: ${target.reason}.`);
  const existing = await readExisting(target.absolute);
  if (existing === undefined)
    throw new UsageError(`Cannot read ${example.path}.`);
  const merged = renderMerge(existing, variables);

  note(
    io,
    options,
    `Fix: add ${names.length} variable${names.length === 1 ? "" : "s"} to ${example.path} (names only, empty values): ${names.join(", ")}`,
  );
  if (options.dryRun) {
    note(io, options, "Dry run: no files were changed.");
    return undefined;
  }

  if (!options.yes) {
    if (!io.prompter.interactive) {
      throw new UsageError(
        "--fix modifies files. Re-run with --yes to apply it without a prompt, or use --dry-run to preview.",
      );
    }
    if (
      !(await io.prompter.confirm(
        `Apply this change to ${example.path}?`,
        false,
      ))
    ) {
      note(io, options, "Cancelled. No files were changed.");
      return 1;
    }
  }

  const written = await writeProjectFile(
    project.cwd,
    example.path,
    merged.content,
    { overwrite: true },
  );
  if (written.status === "refused")
    throw new UsageError(
      `Could not update ${example.path}: ${written.reason}.`,
    );
  note(io, options, `Updated ${example.path}.`);
  return undefined;
}

/** Run the audit command. Returns the process exit code. */
export async function auditCommand(
  options: CliOptions,
  io: IO,
): Promise<number> {
  const auditOptions = toAuditOptions(options, ALL);
  let project = await loadProject(auditOptions);

  if (options.fix || options.dryRun) {
    if (options.fix) {
      const early = await applyFix(project, options, io);
      if (early !== undefined) return early;
      if (!options.dryRun) project = await loadProject(auditOptions); // re-read what changed
    }
  }

  const result = await auditProject(project, auditOptions);

  if (options.verbose && !options.json) {
    io.err(`cwd: ${project.cwd}\n`);
    io.err(`config: ${project.configFile ?? "none (using defaults)"}\n`);
    io.err(`framework: ${project.framework.name}\n`);
    io.err(`strict: ${options.strict ? "yes" : "no"}\n`);
  }

  printAudit(result, options, io);
  return exitCodeFor(result);
}
