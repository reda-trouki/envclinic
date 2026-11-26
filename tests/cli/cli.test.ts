import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { run } from "../../src/cli/run";
import { captureIO, makeProject } from "../helpers";

const ANSI = /\u001b\[/;

const broken = {
  ".env": "A=1\nSTRAY=1\n",
  ".env.example": "A=\nREDIS_URL=\n",
};

const clean = {
  ".env": "A=1\n",
  ".env.example": "A=\n",
};

describe("cli", () => {
  it("exits 0 and says so for a healthy project", async () => {
    const cwd = makeProject(clean);
    const io = captureIO();
    expect(await run(["--cwd", cwd, "--no-color"], io)).toBe(0);
    expect(io.stdout()).toContain("ENV DOCTOR");
    expect(io.stdout()).toContain("No problems found");
  });

  it("runs audit by default and exits 1 when errors are found", async () => {
    const cwd = makeProject(broken);
    const io = captureIO();
    expect(await run(["--cwd", cwd], io)).toBe(1);
    expect(io.stdout()).toContain("Missing variables (1)");
    expect(io.stdout()).toContain("REDIS_URL");
    expect(io.stdout()).toContain("Undocumented variables (1)");
  });

  it("accepts the audit subcommand with options after it", async () => {
    const cwd = makeProject(broken);
    const io = captureIO();
    expect(await run(["audit", "--cwd", cwd, "--json"], io)).toBe(1);
    expect(JSON.parse(io.stdout()).summary.errors).toBe(1);
  });

  it("prints parseable JSON with --json", async () => {
    const cwd = makeProject(broken);
    const io = captureIO(true);
    await run(["--cwd", cwd, "--json"], io);
    const parsed = JSON.parse(io.stdout());
    expect(parsed.success).toBe(false);
    expect(parsed.issues.map((i: { code: string }) => i.code)).toEqual([
      "missing-variable",
      "undocumented-variable",
    ]);
    expect(io.stdout()).not.toMatch(ANSI);
  });

  it("uses colors on a color-capable terminal but not with --no-color or --ci", async () => {
    const cwd = makeProject(broken);

    const colored = captureIO(true);
    await run(["--cwd", cwd], colored);
    expect(colored.stdout()).toMatch(ANSI);

    const noColor = captureIO(true);
    await run(["--cwd", cwd, "--no-color"], noColor);
    expect(noColor.stdout()).not.toMatch(ANSI);

    const ci = captureIO(true);
    expect(await run(["audit", "--ci", "--cwd", cwd], ci)).toBe(1);
    expect(ci.stdout()).not.toMatch(ANSI);
  });

  it("--strict turns warnings into a failing exit code", async () => {
    const cwd = makeProject({ ".env": "A=\n", ".env.example": "A=\n" });
    expect(await run(["--cwd", cwd], captureIO())).toBe(0);
    expect(await run(["audit", "--strict", "--cwd", cwd], captureIO())).toBe(1);
  });

  it("--quiet prints only errors and the summary", async () => {
    const cwd = makeProject(broken);
    const io = captureIO();
    await run(["--cwd", cwd, "--quiet"], io);
    expect(io.stdout()).toContain("REDIS_URL");
    expect(io.stdout()).not.toContain("STRAY");
    expect(io.stdout()).not.toContain("ENV DOCTOR");
    expect(io.stdout()).toContain("1 error, 1 warning");
  });

  it("--verbose prints resolved settings to stderr only", async () => {
    const cwd = makeProject(clean);
    const io = captureIO();
    await run(["--cwd", cwd, "--verbose"], io);
    expect(io.stderr()).toContain(`cwd: ${cwd}`);
    expect(io.stderr()).toContain("config: none");
  });

  it("supports --file, --example and --ignore", async () => {
    const cwd = makeProject({
      "prod.env": "A=1\nSTRAY=1\nOTHER=1\n",
      "template.env": "A=\nREDIS_URL=\n",
    });
    const io = captureIO();
    const code = await run(
      [
        "--cwd",
        cwd,
        "--json",
        "--file",
        "prod.env",
        "--example",
        "template.env",
        "--ignore",
        "REDIS_URL,STRAY",
        "--ignore",
        "OTHER",
      ],
      io,
    );
    expect(code).toBe(0);
    expect(JSON.parse(io.stdout()).issues).toEqual([]);
  });

  it("loads a config file with --config", async () => {
    const cwd = makeProject({
      ...broken,
      "custom.json": '{"ignore":{"variables":["REDIS_URL","STRAY"]}}',
    });
    const io = captureIO();
    expect(await run(["--cwd", cwd, "--config", "custom.json"], io)).toBe(0);
  });

  it("exits 2 with a clear message when the config file is missing", async () => {
    const cwd = makeProject(clean);
    const io = captureIO();
    expect(await run(["--cwd", cwd, "--config", "nope.json"], io)).toBe(2);
    expect(io.stderr()).toContain("Config file not found: nope.json");
    expect(io.stdout()).toBe("");
  });

  it("emits a JSON error object when --json is set and the run fails", async () => {
    const cwd = makeProject({
      ...clean,
      "envclinic.config.json": '{"bogus":1}',
    });
    const io = captureIO();
    expect(await run(["--cwd", cwd, "--json"], io)).toBe(2);
    expect(JSON.parse(io.stdout())).toMatchObject({ success: false });
    expect(JSON.parse(io.stdout()).error).toContain("bogus");
  });

  it("exits 1 for an empty directory because there is nothing to audit", async () => {
    const io = captureIO();
    expect(await run(["--cwd", makeProject(), "--no-color"], io)).toBe(1);
    expect(io.stdout()).toContain("No environment files were found");
  });

  it("prints help and version with exit code 0", async () => {
    const help = captureIO();
    expect(await run(["--help"], help)).toBe(0);
    expect(help.stdout()).toContain("envclinic");
    expect(help.stdout()).toContain("audit");

    const version = captureIO();
    expect(await run(["--version"], version)).toBe(0);
    expect(version.stdout().trim()).toBe(pkg.version);
  });

  it("exits 2 on usage errors", async () => {
    const unknownOption = captureIO();
    expect(await run(["--definitely-not-an-option"], unknownOption)).toBe(2);
    expect(unknownOption.stderr()).toContain("unknown option");

    const unknownCommand = captureIO();
    expect(await run(["frobnicate"], unknownCommand)).toBe(2);
  });
});
