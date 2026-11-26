import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_RULES } from "../../config/defaults";
import { loadProject } from "../../core/project";
import {
  readExisting,
  resolveWriteTarget,
  writeProjectFile,
} from "../../core/writer";
import type { EnvDoctorConfig, RuleLevel, RuleName } from "../../types";
import type { IO } from "../io";
import { note, toAuditOptions, UsageError, type CliOptions } from "./common";

type Preset = "recommended" | "strict" | "minimal";

const SOURCE_DIRECTORIES = [
  "src",
  "app",
  "pages",
  "lib",
  "server",
  "components",
];

const PRESETS: Record<Preset, Partial<Record<RuleName, RuleLevel>>> = {
  recommended: {},
  strict: {
    undocumented: "error",
    empty: "error",
    unused: "error",
    undeclared: "error",
    weak: "error",
  },
  minimal: {
    undocumented: "off",
    empty: "off",
    unused: "off",
    undeclared: "off",
    weak: "off",
    names: "off",
    syntax: "off",
  },
};

async function existingEnvFiles(cwd: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(cwd, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^\.env(\.|$)/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function existingDirectories(cwd: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of SOURCE_DIRECTORIES) {
    try {
      if ((await fs.stat(path.join(cwd, name))).isDirectory()) found.push(name);
    } catch {
      // not there
    }
  }
  return found;
}

const csv = (text: string): string[] =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

function renderConfig(config: EnvDoctorConfig, format: "json" | "mjs"): string {
  const body = JSON.stringify(config, null, 2);
  if (format === "json") return body + "\n";
  // A JSDoc type instead of `import { defineConfig }`: editors still autocomplete, but the file
  // loads even when envclinic is not installed locally (for example when run through npx).
  return `/** @type {import("envclinic").EnvDoctorConfig} */\nexport default ${body};\n`;
}

/** Interactive setup that writes an envclinic config file. */
export async function initCommand(
  options: CliOptions,
  io: IO,
): Promise<number> {
  const format = options.configFormat ?? "json";
  if (format !== "json" && format !== "mjs")
    throw new UsageError(`Unknown config format "${format}". Use json or mjs.`);
  if (!options.yes && !io.prompter.interactive) {
    throw new UsageError(
      "init asks questions, but there is no terminal. Re-run with --yes to accept the defaults.",
    );
  }

  const project = await loadProject(toAuditOptions(options, []));
  const envFiles = await existingEnvFiles(project.cwd);
  const directories = await existingDirectories(project.cwd);
  const sourceDefault = envFiles.filter(
    (name) => !/(example|sample|template)/i.test(name),
  );
  const exampleDefault =
    project.example?.path ??
    envFiles.find((name) => /example|sample/i.test(name)) ??
    ".env.example";

  let sources =
    sourceDefault.length > 0
      ? sourceDefault.filter((name) => name === ".env" || name === ".env.local")
      : [".env"];
  if (sources.length === 0) sources = [".env"];
  let example = exampleDefault;
  let scanDirectories = directories.length > 0 ? directories : ["."];
  let preset: Preset = "recommended";
  let typesEnabled = false;

  if (!options.yes) {
    const ask = io.prompter;
    note(
      io,
      options,
      `Detected framework: ${project.framework.name}. Env files found: ${envFiles.length > 0 ? envFiles.join(", ") : "none"}.`,
    );
    sources = csv(
      await ask.input(
        "Env files to audit (comma separated)",
        sources.join(", "),
      ),
    );
    if (sources.length === 0) sources = [".env"];
    example = await ask.input(
      "Example file that documents your variables",
      example,
    );
    scanDirectories = csv(
      await ask.input(
        "Directories with source code to scan (comma separated)",
        scanDirectories.join(", "),
      ),
    );
    if (scanDirectories.length === 0) scanDirectories = ["."];
    preset = await ask.select<Preset>(
      "How strict should the audit be?",
      [
        {
          value: "recommended",
          label:
            "Recommended: missing and duplicate variables fail, the rest warn",
        },
        {
          value: "strict",
          label: "Strict: unused, undeclared, empty and weak secrets fail too",
        },
        {
          value: "minimal",
          label: "Minimal: only missing variables, duplicates and secrets",
        },
      ],
      "recommended",
    );
    typesEnabled = await ask.confirm(
      "Report when the generated TypeScript declarations (env.d.ts) are out of date?",
      false,
    );
  }

  const config: EnvDoctorConfig = {
    files: { source: sources, example },
    scan: { directories: scanDirectories },
    rules: { ...DEFAULT_RULES, ...PRESETS[preset] },
    ignore: { variables: [] },
  };
  if (typesEnabled) config.types = { enabled: true, output: "env.d.ts" };

  const file = `envclinic.config.${format}`;
  const target = await resolveWriteTarget(project.cwd, file);
  if (!target.ok)
    throw new UsageError(`Cannot write ${file}: ${target.reason}.`);

  let overwrite = false;
  if ((await readExisting(target.absolute)) !== undefined) {
    if (options.force) overwrite = true;
    else if (
      !options.yes &&
      io.prompter.interactive &&
      (await io.prompter.confirm(`${file} already exists. Replace it?`, false))
    )
      overwrite = true;
    else
      throw new UsageError(
        `${file} already exists. Use --force to replace it.`,
      );
  }

  const written = await writeProjectFile(
    project.cwd,
    file,
    renderConfig(config, format),
    { overwrite },
  );
  if (written.status === "refused")
    throw new UsageError(`Could not write ${file}: ${written.reason}.`);
  note(
    io,
    options,
    `Created ${file}.\nNext: run \`npx envclinic\` to audit your project.`,
  );
  return 0;
}
