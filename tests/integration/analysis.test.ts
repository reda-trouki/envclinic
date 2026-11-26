import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { audit, ConfigError } from "../../src";
import { makeProject } from "../helpers";

const issuesOf = async (cwd: string, extra: Parameters<typeof audit>[0] = {}) =>
  (await audit({ cwd, ...extra })).issues;
const codes = async (cwd: string, extra: Parameters<typeof audit>[0] = {}) =>
  (await issuesOf(cwd, extra)).map((i) => i.code);

// Credentials are assembled at runtime so this file contains no scannable secrets.
const GITHUB = "ghp_" + "a".repeat(36);
const STRIPE = "sk_live_" + "a1B2c3D4e5F6g7H8i9J0";

describe("unused and undeclared variables", () => {
  const project = (extra: Record<string, string> = {}) =>
    makeProject({
      ".env":
        "USED=1\nUNUSED=1\nINTERPOLATED=1\nCOMPOSED=${INTERPOLATED}/x\nIGNORED_ONE=1\n",
      ".env.example":
        "USED=\nUNUSED=\nINTERPOLATED=\nCOMPOSED=\nIGNORED_ONE=\n",
      "src/app.ts":
        "export const x = process.env.USED + process.env.COMPOSED;\n",
      ...extra,
    });

  it("reports declared variables that no source file reads, and counts ${} interpolation as use", async () => {
    const found = (
      await issuesOf(project(), {
        config: { ignore: { variables: ["IGNORED_*"] } },
      })
    ).filter((i) => i.code === "unused-variable");
    expect(found.map((i) => i.variable)).toEqual(["UNUSED"]);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain("potentially unused");
  });

  it("reports variables used in code but not declared anywhere", async () => {
    const cwd = project({
      "src/b.ts":
        "export const y = process.env.BRAND_NEW;\nexport const z = process.env.NODE_ENV;\n",
    });
    const found = (await issuesOf(cwd)).filter(
      (i) => i.code === "undeclared-variable",
    );
    expect(found).toMatchObject([
      { variable: "BRAND_NEW", file: "src/b.ts", line: 1 },
    ]);
  });

  it("does not report a variable that is set in .env but only missing from the example twice", async () => {
    const cwd = makeProject({
      ".env": "A=1\n",
      ".env.example": "",
      "src/a.ts": "process.env.A;",
    });
    expect(await codes(cwd)).toEqual(["undocumented-variable"]);
  });

  it("adds an info note about dynamic access only when something is reported unused", async () => {
    const dynamic = project({ "src/dyn.ts": "const v = process.env[name];\n" });
    const list = await issuesOf(dynamic, {
      config: { ignore: { variables: ["IGNORED_*"] } },
    });
    expect(list.find((i) => i.code === "dynamic-env-access")).toMatchObject({
      severity: "info",
    });

    const clean = makeProject({
      ".env": "A=1\n",
      ".env.example": "A=\n",
      "src/a.ts": "process.env.A; const v = process.env[name];",
    });
    expect(await codes(clean)).toEqual([]);
  });

  it("concludes nothing when there is no source code", async () => {
    const cwd = makeProject({ ".env": "A=1\n", ".env.example": "A=\n" });
    expect(await codes(cwd)).toEqual([]);
  });

  it("honors scan options, ignore, and the scan switch", async () => {
    const cwd = project({ "other/c.ts": "process.env.UNUSED;" });
    const base = { config: { ignore: { variables: ["IGNORED_*"] } } };
    expect(await codes(cwd, base)).toEqual([]); // UNUSED is read in other/c.ts
    expect(
      await codes(cwd, {
        config: { ...base.config, scan: { directories: ["src"] } },
      }),
    ).toContain("unused-variable");
    expect(
      await codes(cwd, {
        config: { ...base.config, scan: { ignore: ["other"] } },
      }),
    ).toContain("unused-variable");
    expect(await codes(cwd, { scan: false })).toEqual([]);
    expect((await audit({ cwd, scan: false })).summary.sourceFilesScanned).toBe(
      0,
    );
  });

  it("applies rule levels", async () => {
    const cwd = project();
    const base = { ignore: { variables: ["IGNORED_*"] } };
    expect(
      (await audit({ cwd, config: { ...base, rules: { unused: "error" } } }))
        .success,
    ).toBe(false);
    expect(
      await codes(cwd, { config: { ...base, rules: { unused: "off" } } }),
    ).toEqual([]);
  });

  it("rejects scan directories outside the project", async () => {
    await expect(
      audit({ cwd: project(), config: { scan: { directories: ["../x"] } } }),
    ).rejects.toThrow(ConfigError);
  });

  it("does not read symlinked source files", async () => {
    const outside = makeProject({ "x.ts": "process.env.FROM_OUTSIDE;" });
    const cwd = makeProject({
      ".env": "A=1\n",
      ".env.example": "A=\n",
      "src/a.ts": "process.env.A;",
    });
    try {
      symlinkSync(path.join(outside, "x.ts"), path.join(cwd, "src", "link.ts"));
    } catch {
      return;
    }
    const result = await audit({ cwd });
    expect(result.summary.sourceFilesScanned).toBe(1);
    expect(result.issues).toEqual([]);
  });
});

describe("secret detection", () => {
  const gitProject = (files: Record<string, string>) => {
    const cwd = makeProject(files);
    mkdirSync(path.join(cwd, ".git"));
    return cwd;
  };

  it("makes a credential in a git-ignored local file informational", async () => {
    const cwd = gitProject({
      ".gitignore": ".env\n",
      ".env": `STRIPE_KEY=${STRIPE}\n`,
      ".env.example": "STRIPE_KEY=\n",
    });
    expect(await issuesOf(cwd, { checks: ["secrets"] })).toMatchObject([
      {
        code: "exposed-credential",
        severity: "info",
        variable: "STRIPE_KEY",
        file: ".env",
        line: 1,
      },
    ]);
  });

  it("makes a credential in a file that is not git-ignored critical, and flags the file", async () => {
    const cwd = gitProject({
      ".env": `STRIPE_KEY=${STRIPE}\n`,
      ".env.example": "STRIPE_KEY=\n",
    });
    const found = await issuesOf(cwd, { checks: ["secrets"] });
    expect(found.map((i) => [i.code, i.severity])).toEqual([
      ["exposed-credential", "error"],
      ["env-file-not-ignored", "error"],
    ]);
    expect((await audit({ cwd, checks: ["secrets"] })).success).toBe(false);
  });

  it("is a warning outside of a git repository, where ignore status is unknown", async () => {
    const cwd = makeProject({ ".env": `STRIPE_KEY=${STRIPE}\n` });
    expect(await issuesOf(cwd, { checks: ["secrets"] })).toMatchObject([
      { code: "exposed-credential", severity: "warning" },
    ]);
  });

  it("treats real-looking values in the example file as critical and placeholders as fine", async () => {
    const cwd = makeProject({
      ".env.example": `STRIPE_KEY=${STRIPE}\nJWT_SECRET=changeme\nDB_PASSWORD=Xk29vLpQ7zT\nAPI_KEY=\n`,
    });
    expect(
      (await issuesOf(cwd, { checks: ["secrets"] })).map((i) => [
        i.code,
        i.variable,
        i.severity,
      ]),
    ).toEqual([
      ["exposed-credential", "STRIPE_KEY", "error"],
      ["secret-in-example", "DB_PASSWORD", "warning"],
    ]);
  });

  it("reports weak secrets in source env files only", async () => {
    const cwd = makeProject({
      ".env":
        "JWT_SECRET=my-secret\nAPI_KEY=123456\nSTRONG_SECRET=k8Jd92Lm4Qx7Vb1Zp3Nt6Rw0Ys5Fh2Gc\nPORT=1\n",
      ".env.example": "JWT_SECRET=changeme\n",
    });
    const found = await issuesOf(cwd, { checks: ["secrets"] });
    expect(found.map((i) => [i.code, i.variable])).toEqual([
      ["weak-secret", "JWT_SECRET"],
      ["weak-secret", "API_KEY"],
    ]);
    expect(found[0]?.message).toMatch(/shorter than 12/);
    expect(found.every((i) => i.severity === "warning")).toBe(true);
  });

  it("flags secrets that a framework prefix exposes to the browser", async () => {
    const cwd = makeProject({
      "package.json": '{"dependencies":{"next":"14"}}',
      ".env": `NEXT_PUBLIC_STRIPE=${STRIPE}\nNEXT_PUBLIC_DB_PASSWORD=abc\nNEXT_PUBLIC_API_URL=https://x.test\n`,
    });
    const found = (await issuesOf(cwd, { checks: ["secrets"] })).filter(
      (i) => i.code === "public-secret",
    );
    expect(found.map((i) => [i.variable, i.severity])).toEqual([
      ["NEXT_PUBLIC_STRIPE", "error"],
      ["NEXT_PUBLIC_DB_PASSWORD", "warning"],
    ]);
  });

  it("finds hardcoded credentials in source code by line, without the value", async () => {
    const cwd = makeProject({
      "src/a.ts": `const ok = 1;\nconst t = "${GITHUB}";\n`,
      "src/b.ts": `const t = "${GITHUB}"; // envclinic-ignore\n`,
    });
    const result = await audit({ cwd, checks: ["secrets"] });
    expect(result.issues).toMatchObject([
      {
        code: "exposed-credential",
        severity: "error",
        file: "src/a.ts",
        line: 2,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(GITHUB);
  });

  it("supports env-only mode and file exclusions", async () => {
    const cwd = makeProject({
      "src/a.ts": `const t = "${GITHUB}";\n`,
      "fixtures/b.ts": `const t = "${GITHUB}";\n`,
    });
    expect(
      await codes(cwd, { checks: ["secrets"], codeSecrets: false }),
    ).toEqual([]);
    const result = await audit({
      cwd,
      checks: ["secrets"],
      config: { secrets: { ignoreFiles: ["fixtures/**"] } },
    });
    expect(result.issues.map((i) => i.file)).toEqual(["src/a.ts"]);
  });

  it("supports allow-lists and custom patterns", async () => {
    const cwd = makeProject({
      ".env": "JWT_SECRET=short\nINTERNAL=corp-123456\n",
    });
    expect(
      await codes(cwd, {
        checks: ["secrets"],
        config: { secrets: { allow: ["JWT_*"] } },
      }),
    ).toEqual([]);
    const withPattern = await issuesOf(cwd, {
      checks: ["secrets"],
      config: {
        secrets: {
          allow: ["JWT_*"],
          patterns: [
            {
              id: "corp",
              description: "internal token",
              pattern: "^corp-\\d{6}$",
            },
          ],
        },
      },
    });
    expect(withPattern).toMatchObject([
      { code: "exposed-credential", variable: "INTERNAL" },
    ]);
    expect(withPattern[0]?.message).toContain("internal token");
  });

  it("lets rules lower severities and turn checks off", async () => {
    const cwd = gitProject({ ".env": `STRIPE_KEY=${STRIPE}\n` });
    const lowered = await issuesOf(cwd, {
      checks: ["secrets"],
      config: { rules: { secrets: "warning" } },
    });
    expect(lowered.map((i) => i.severity)).toEqual(["warning", "warning"]);
    expect(
      await codes(cwd, {
        checks: ["secrets"],
        config: { rules: { secrets: "off" } },
      }),
    ).toEqual([]);
  });

  it("does not flag variables listed in ignore.variables", async () => {
    const cwd = makeProject({ ".env": "JWT_SECRET=short\n" });
    expect(
      await codes(cwd, { checks: ["secrets"], ignore: ["JWT_SECRET"] }),
    ).toEqual([]);
  });
});

describe("schema validation", () => {
  const schema = {
    DATABASE_URL: { type: "url", required: true },
    PORT: { type: "number", required: false, default: 3000 },
    NODE_ENV: {
      type: "enum",
      values: ["development", "production", "test"],
      required: true,
    },
    JWT_SECRET: { type: "string", required: true, minLength: 32, secret: true },
  } as const;

  it("reports problems with file and line, and no values", async () => {
    const cwd = makeProject({
      ".env":
        "DATABASE_URL=not-a-url\nNODE_ENV=staging\nJWT_SECRET=SECRET_MARKER_short\n",
    });
    const result = await audit({
      cwd,
      checks: ["validation"],
      config: { schema },
    });
    expect(
      result.issues.map((i) => [i.code, i.variable, i.file, i.line]),
    ).toEqual([
      ["schema-invalid-type", "DATABASE_URL", ".env", 1],
      ["schema-invalid-enum", "NODE_ENV", ".env", 2],
      ["schema-too-short", "JWT_SECRET", ".env", 3],
    ]);
    expect(JSON.stringify(result)).not.toContain("SECRET_MARKER");
  });

  it("reports missing required variables and applies defaults", async () => {
    const cwd = makeProject({
      ".env": "DATABASE_URL=postgresql://x\nNODE_ENV=test\n",
    });
    const found = await issuesOf(cwd, {
      checks: ["validation"],
      config: { schema },
    });
    expect(found).toMatchObject([
      { code: "schema-missing-required", variable: "JWT_SECRET" },
    ]);
    expect(found[0]?.file).toBeUndefined();
  });

  it("does not duplicate problems already reported as missing or empty", async () => {
    const cwd = makeProject({
      ".env": "A=\nDATABASE_URL=postgresql://x\n",
      ".env.example": "A=\nB=\nDATABASE_URL=\n",
    });
    const found = await codes(cwd, {
      config: {
        schema: {
          A: { type: "string" },
          B: { type: "string" },
          DATABASE_URL: { type: "url" },
        },
      },
      scan: false,
    });
    expect(found.filter((c) => c.startsWith("schema-"))).toEqual([]);
    expect(found).toEqual(
      expect.arrayContaining(["empty-variable", "missing-variable"]),
    );
  });

  it("validates the process environment when asked, and lets it win over env files", async () => {
    const cwd = makeProject({ ".env": "PORT=abc\n" });
    const cfg = { schema: { PORT: { type: "number" } } } as const;
    expect(await codes(cwd, { checks: ["validation"], config: cfg })).toEqual([
      "schema-invalid-type",
    ]);
    expect(
      await codes(cwd, {
        checks: ["validation"],
        config: cfg,
        env: { PORT: "8080" },
      }),
    ).toEqual([]);
    expect(
      await codes(makeProject(), {
        checks: ["validation"],
        config: cfg,
        env: { PORT: "8080" },
      }),
    ).toEqual([]);
  });

  it("skips validation with an info message when there is nothing to validate", async () => {
    const cwd = makeProject({ ".env.example": "A=\n" });
    expect(
      await issuesOf(cwd, {
        checks: ["validation"],
        config: { schema: { A: { type: "string" } } },
      }),
    ).toMatchObject([{ code: "validation-skipped", severity: "info" }]);
  });

  it("is not run when no schema is configured", async () => {
    expect(
      await codes(makeProject({ ".env": "A=1\n" }), { checks: ["validation"] }),
    ).toEqual([]);
  });

  it("supports custom validators from config objects", async () => {
    const cwd = makeProject({ ".env": "EVEN=3\n" });
    const found = await issuesOf(cwd, {
      checks: ["validation"],
      config: {
        schema: {
          EVEN: {
            type: "custom",
            validate: (v) => Number(v) % 2 === 0 || "EVEN must be even",
          },
        },
      },
    });
    expect(found).toMatchObject([
      { code: "schema-custom-failed", message: "EVEN must be even" },
    ]);
  });

  it("rejects invalid schemas with clear messages", async () => {
    const cwd = makeProject({ ".env": "A=1\n" });
    const bad = (schema: unknown) =>
      audit({ cwd, config: { schema } as never });
    await expect(bad({ A: { type: "wat" } })).rejects.toThrow(
      /schema\.A\.type/,
    );
    await expect(bad({ A: { type: "enum" } })).rejects.toThrow(
      /schema\.A\.values/,
    );
    await expect(bad({ A: { type: "custom" } })).rejects.toThrow(
      /schema\.A\.validate/,
    );
    await expect(bad({ A: { type: "number", default: "x" } })).rejects.toThrow(
      /schema\.A\.default/,
    );
    await expect(
      bad({ A: { type: "number", min: 5, max: 1 } }),
    ).rejects.toThrow(/schema\.A\.min/);
    await expect(bad({ A: { type: "string", pattern: "(" } })).rejects.toThrow(
      /valid regular expression/,
    );
    await expect(bad({ "bad-name": { type: "string" } })).rejects.toThrow(
      /valid variable name/,
    );
    await expect(bad({ A: { type: "string", nope: 1 } })).rejects.toThrow(
      /unknown option/,
    );
  });
});

describe("generated types freshness (types.enabled)", () => {
  const base = {
    ".env": "A=1\n",
    ".env.example": "A=\n",
    "src/a.ts": "process.env.A;",
  };
  const config = { types: { enabled: true } };

  it("reports a missing and an outdated declaration file", async () => {
    const cwd = makeProject(base);
    expect(await issuesOf(cwd, { config })).toMatchObject([
      { code: "types-missing", file: "env.d.ts" },
    ]);

    writeFileSync(
      path.join(cwd, "env.d.ts"),
      "// Generated by envclinic. old\n",
    );
    expect(await issuesOf(cwd, { config })).toMatchObject([
      { code: "types-outdated" },
    ]);
  });

  it("is quiet when the file is current, and when the feature is off", async () => {
    const { buildTypesContent } = await import("../../src/core/outputs");
    const { loadProject } = await import("../../src/core/project");
    const { scanProject } = await import("../../src/core/auditor");
    const cwd = makeProject(base);
    const project = await loadProject({ cwd, config });
    const content = buildTypesContent(
      project,
      (await scanProject(project, { secrets: false })).usage,
    );
    writeFileSync(path.join(cwd, "env.d.ts"), content);
    expect(await issuesOf(cwd, { config })).toEqual([]);
    expect(await issuesOf(makeProject(base))).toEqual([]);
  });

  it("honors a custom output path", async () => {
    expect(
      await issuesOf(makeProject(base), {
        config: { types: { enabled: true, output: "types/env.d.ts" } },
      }),
    ).toMatchObject([{ file: "types/env.d.ts" }]);
  });
});
