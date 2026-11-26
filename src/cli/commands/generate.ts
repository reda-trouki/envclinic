import { renderExample, renderMerge } from "../../core/generator";
import { scanProject } from "../../core/auditor";
import { exampleOutputPath, exampleVariables } from "../../core/outputs";
import { loadProject } from "../../core/project";
import {
  readExisting,
  resolveWriteTarget,
  writeProjectFile,
} from "../../core/writer";
import type { IO } from "../io";
import { note, toAuditOptions, UsageError, type CliOptions } from "./common";

type Mode = "create" | "merge" | "overwrite";

/** Generate or update `.env.example`. Contains variable names only, never values. */
export async function generateCommand(
  options: CliOptions,
  io: IO,
): Promise<number> {
  const project = await loadProject(toAuditOptions(options, []));
  const usage =
    options.scan === false
      ? undefined
      : (await scanProject(project, { secrets: false })).usage;
  const variables = exampleVariables(project, usage, options.exclude ?? []);

  if (variables.length === 0) {
    note(
      io,
      options,
      "Nothing to generate: no environment variables were found in env files, the schema or source code.",
    );
    return 1;
  }

  const output = exampleOutputPath(project, options.output);
  const target = await resolveWriteTarget(project.cwd, output);
  if (!target.ok)
    throw new UsageError(`Cannot write ${output}: ${target.reason}.`);
  const existing = await readExisting(target.absolute);

  let mode: Mode = "create";
  if (existing !== undefined) {
    if (options.force) mode = "overwrite";
    else if (options.merge) mode = "merge";
    else if (options.dryRun) mode = "merge";
    else if (io.prompter.interactive) {
      const choice = await io.prompter.select(
        `${output} already exists. What should envclinic do?`,
        [
          {
            value: "merge" as const,
            label:
              "Add only the missing variables (keeps your comments and order)",
          },
          { value: "overwrite" as const, label: "Replace the file" },
          { value: "cancel" as const, label: "Cancel" },
        ],
        "merge",
      );
      if (choice === "cancel") {
        note(io, options, "Cancelled. No files were changed.");
        return 1;
      }
      mode = choice;
    } else {
      throw new UsageError(
        `${output} already exists. Use --merge to add missing variables, --force to replace it, or --dry-run to preview.`,
      );
    }
  }

  let content: string;
  let summary: string;
  if (mode === "merge" && existing !== undefined) {
    const merged = renderMerge(existing, variables);
    content = merged.content;
    summary =
      merged.added.length === 0
        ? `${output} already lists every variable.`
        : `Added ${merged.added.length} variable${merged.added.length === 1 ? "" : "s"} to ${output}: ${merged.added.join(", ")}`;
  } else {
    content = renderExample(variables, project.framework.publicPrefixes);
    summary = `${mode === "overwrite" ? "Replaced" : "Created"} ${output} with ${variables.length} variable${variables.length === 1 ? "" : "s"}.`;
  }

  if (options.dryRun) {
    io.out(content);
    io.err(`Dry run: ${output} was not written.\n`);
    return 0;
  }

  const written = await writeProjectFile(project.cwd, output, content, {
    overwrite: mode !== "create",
  });
  if (written.status === "refused")
    throw new UsageError(`Could not write ${output}: ${written.reason}.`);
  note(
    io,
    options,
    written.status === "unchanged"
      ? `${output} is already up to date.`
      : summary,
  );
  return 0;
}
