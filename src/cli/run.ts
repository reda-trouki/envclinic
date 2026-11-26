import { Command, CommanderError } from "commander";
import pkg from "../../package.json";
import { auditCommand } from "./commands/audit";
import type { CliOptions } from "./commands/common";
import { frameworkCommand } from "./commands/framework";
import { generateCommand } from "./commands/generate";
import { initCommand } from "./commands/init";
import {
  checkCommand,
  secretsCommand,
  unusedCommand,
  validateCommand,
} from "./commands/subsets";
import { typesCommand } from "./commands/types";
import { processIO, type IO } from "./io";

/** Exit codes: 0 = ok, 1 = problems found (or action cancelled), 2 = usage or runtime error. */
export const EXIT_OK = 0;
export const EXIT_ISSUES = 1;
export const EXIT_FAILURE = 2;

function collect(value: string, previous: string[]): string[] {
  return [
    ...previous,
    ...value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  ];
}

type Handler = (options: CliOptions, io: IO) => Promise<number> | number;

/** Run the CLI with the given arguments (without `node` and the script path). */
export async function run(argv: string[], io: IO = processIO): Promise<number> {
  let exitCode = EXIT_OK;
  let wantsJson =
    argv.includes("--json") ||
    argv.some((arg, i) => arg === "json" && argv[i - 1] === "--format");

  const program = new Command();
  program
    .name("envclinic")
    .description("Audit, validate and secure environment configurations")
    .version(pkg.version)
    .option("--cwd <dir>", "project directory (default: current directory)")
    .option("--config <path>", "path to an envclinic config file")
    .option("--json", "print machine-readable JSON")
    .option("--format <format>", "output format: terminal, json or github")
    .option("--quiet", "only print errors and a summary")
    .option("--verbose", "print the resolved settings")
    .option("--no-color", "disable colored output")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.out(text),
      writeErr: (text) => io.err(text),
    });

  const register = (command: Command, handler: Handler): Command =>
    command
      .allowExcessArguments(false)
      .action(async (_options: unknown, self: Command) => {
        const all = self.optsWithGlobals<CliOptions>();
        wantsJson = Boolean(all.json) || all.format === "json";
        exitCode = await handler(all, io);
      });

  const strict = (c: Command) =>
    c.option("--strict", "treat warnings as errors");
  const ci = (c: Command) =>
    c.option(
      "--ci",
      "non-interactive mode: no colors, GitHub annotations when running in Actions",
    );
  const files = (c: Command) =>
    c.option(
      "-f, --file <path>",
      "env file to audit; repeatable (default: .env)",
      collect,
      [] as string[],
    );
  const ignore = (c: Command) =>
    c.option(
      "--ignore <names>",
      "variable names to ignore, comma-separated; repeatable",
      collect,
      [] as string[],
    );
  const processEnv = (c: Command) =>
    c.option(
      "--process-env",
      "also validate the real process environment (it wins over env files)",
    );

  register(
    processEnv(
      ignore(
        files(
          ci(
            strict(
              program
                .command("audit", { isDefault: true })
                .description("Run the complete environment audit")
                .option(
                  "--example <path>",
                  "example file to compare against (default: .env.example or .env.sample)",
                )
                .option(
                  "--no-scan",
                  "do not scan source code (skips unused variables and hardcoded credentials)",
                )
                .option(
                  "--fix",
                  "add undocumented variables to the example file (asks for confirmation)",
                )
                .option(
                  "--dry-run",
                  "with --fix: show what would change without writing",
                )
                .option("--yes", "with --fix: apply without asking"),
            ),
          ),
        ),
      ),
    ),
    auditCommand,
  );

  register(
    processEnv(
      ignore(
        files(
          ci(
            strict(
              program
                .command("check")
                .description(
                  "Check for missing, empty, duplicate and invalid variables, and validate the schema",
                )
                .option("--example <path>", "example file to compare against"),
            ),
          ),
        ),
      ),
    ),
    checkCommand,
  );

  register(
    ignore(
      ci(
        strict(
          program
            .command("secrets")
            .description("Detect potentially exposed secrets and weak secrets")
            .option("--env-only", "only check env files, not source code"),
        ),
      ),
    ),
    secretsCommand,
  );

  register(
    ignore(
      ci(
        strict(
          program
            .command("unused")
            .description("Detect potentially unused and undeclared variables")
            .option(
              "--dir <path>",
              "directory to scan; repeatable (default: project root)",
              collect,
              [] as string[],
            ),
        ),
      ),
    ),
    unusedCommand,
  );

  register(
    processEnv(
      files(
        ci(
          strict(
            program
              .command("validate")
              .description(
                "Validate environment values against the schema in your config",
              ),
          ),
        ),
      ),
    ),
    validateCommand,
  );

  register(
    program
      .command("generate")
      .description("Generate or update .env.example (names only, never values)")
      .option("-o, --output <path>", "file to write (default: .env.example)")
      .option("--dry-run", "print the result without writing")
      .option("--force", "replace the file if it exists")
      .option("--merge", "add missing variables to the file if it exists")
      .option(
        "--exclude <names>",
        "variables to leave out, comma-separated; repeatable",
        collect,
        [] as string[],
      )
      .option("--no-scan", "do not detect variables from source code"),
    generateCommand,
  );

  register(
    program
      .command("types")
      .description("Generate TypeScript declarations for environment variables")
      .option("-o, --output <path>", "file to write (default: env.d.ts)")
      .option("--dry-run", "print the result without writing")
      .option("--force", "overwrite a file that was not generated by envclinic")
      .option(
        "--check",
        "exit with code 1 if the file is missing or out of date, without writing",
      )
      .option("--no-scan", "do not detect variables from source code"),
    typesCommand,
  );

  register(
    program
      .command("framework")
      .description("Detect the framework and its environment conventions"),
    frameworkCommand,
  );

  register(
    program
      .command("init")
      .description("Create an envclinic config file")
      .option("--yes", "accept the defaults without asking questions")
      .option("--force", "replace an existing config file")
      .option(
        "--config-format <format>",
        "config file format: json or mjs",
        "json",
      ),
    initCommand,
  );

  try {
    await program.parseAsync(argv, { from: "user" });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      const informational =
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version" ||
        error.code === "commander.help";
      return informational ? EXIT_OK : EXIT_FAILURE;
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (wantsJson) {
      io.out(
        JSON.stringify({ success: false, error: message }, null, 2) + "\n",
      );
    } else {
      io.err(`envclinic: ${message}\n`);
    }
    return EXIT_FAILURE;
  }
}
