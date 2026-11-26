import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/run";
import {
  captureIO,
  copyFixture,
  makeProject,
  scriptedPrompter,
} from "../helpers";

const read = (cwd: string, file: string) =>
  readFileSync(path.join(cwd, file), "utf8");
const STRIPE = "sk_live_" + "a1B2c3D4e5F6g7H8i9J0";

describe("generate", () => {
  const project = () =>
    makeProject({
      ".env":
        "DATABASE_URL=postgresql://localhost:5432/app\nJWT_SECRET=SECRET_MARKER_value_1234567890\nPORT=3000\n",
      "src/a.ts": "process.env.STRIPE_SECRET_KEY;\nprocess.env.NODE_ENV;\n",
    });

  it("creates .env.example with names only, grouped, including variables found in code", async () => {
    const cwd = project();
    const io = captureIO();
    expect(await run(["--cwd", cwd, "generate"], io)).toBe(0);
    const content = read(cwd, ".env.example");
    expect(content).toBe(
      "# Database configuration\nDATABASE_URL=\n\n# Authentication\nJWT_SECRET=\n\n# External services\nSTRIPE_SECRET_KEY=\n\n# Application\nPORT=\n",
    );
    expect(content).not.toContain("SECRET_MARKER");
    expect(content).not.toContain("NODE_ENV");
    expect(io.stdout()).toContain("Created .env.example with 4 variables");
  });

  it("supports --no-scan and --exclude", async () => {
    const cwd = project();
    await run(
      ["--cwd", cwd, "generate", "--no-scan", "--exclude", "PORT,JWT_*"],
      captureIO(),
    );
    expect(read(cwd, ".env.example")).toBe(
      "# Database configuration\nDATABASE_URL=\n",
    );
  });

  it("--dry-run prints the file and writes nothing", async () => {
    const cwd = project();
    const io = captureIO();
    expect(await run(["--cwd", cwd, "generate", "--dry-run"], io)).toBe(0);
    expect(io.stdout()).toContain("DATABASE_URL=");
    expect(io.stderr()).toContain("was not written");
    expect(existsSync(path.join(cwd, ".env.example"))).toBe(false);
  });

  it("refuses to touch an existing file without --merge or --force when not interactive", async () => {
    const cwd = makeProject({
      ".env": "A=1\nB=1\n",
      ".env.example": "# mine\nA=\n",
    });
    const io = captureIO();
    expect(await run(["--cwd", cwd, "generate"], io)).toBe(2);
    expect(io.stderr()).toContain("already exists");
    expect(read(cwd, ".env.example")).toBe("# mine\nA=\n");
  });

  it("--merge appends only what is missing", async () => {
    const cwd = makeProject({
      ".env": "A=1\nB=1\n",
      ".env.example": "# mine\nA=\n",
    });
    expect(
      await run(
        ["--cwd", cwd, "generate", "--merge", "--no-scan"],
        captureIO(),
      ),
    ).toBe(0);
    expect(read(cwd, ".env.example")).toBe(
      "# mine\nA=\n\n# Added by envclinic\nB=\n",
    );
  });

  it("--force replaces the file but keeps every variable it already documented", async () => {
    const cwd = makeProject({
      ".env": "B=1\n",
      ".env.example": "# mine\nA=\n",
    });
    expect(
      await run(
        ["--cwd", cwd, "generate", "--force", "--no-scan"],
        captureIO(),
      ),
    ).toBe(0);
    expect(read(cwd, ".env.example")).toBe("# Other\nA=\nB=\n");
  });

  it("asks what to do when the file exists and a terminal is available", async () => {
    const cwd = makeProject({ ".env": "A=1\nB=1\n", ".env.example": "A=\n" });
    const prompter = scriptedPrompter(["merge"]);
    expect(
      await run(
        ["--cwd", cwd, "generate", "--no-scan"],
        captureIO({ prompter }),
      ),
    ).toBe(0);
    expect(prompter.asked[0]).toContain("already exists");
    expect(read(cwd, ".env.example")).toContain("B=");

    const cancelled = makeProject({ ".env": "A=1\n", ".env.example": "Z=\n" });
    expect(
      await run(
        ["--cwd", cancelled, "generate", "--no-scan"],
        captureIO({ prompter: scriptedPrompter(["cancel"]) }),
      ),
    ).toBe(1);
    expect(read(cancelled, ".env.example")).toBe("Z=\n");
  });

  it("never writes to real env files or outside the project", async () => {
    const cwd = project();
    for (const output of [".env", ".env.local", "../out.example"]) {
      const io = captureIO();
      expect(
        await run(
          ["--cwd", cwd, "generate", "--output", output, "--force"],
          io,
        ),
        output,
      ).toBe(2);
    }
    expect(read(cwd, ".env")).toContain("DATABASE_URL=postgresql");
  });

  it("reports when there is nothing to generate", async () => {
    expect(await run(["--cwd", makeProject(), "generate"], captureIO())).toBe(
      1,
    );
  });

  it("uses descriptions and types from the schema", async () => {
    const cwd = makeProject({
      ".env": "PORT=3000\n",
      "envclinic.config.json": JSON.stringify({
        schema: {
          PORT: { type: "number", default: 3000, description: "HTTP port" },
        },
      }),
    });
    await run(["--cwd", cwd, "generate", "--no-scan"], captureIO());
    expect(read(cwd, ".env.example")).toContain(
      "# HTTP port\n# number, optional, default: 3000\nPORT=",
    );
  });
});

describe("types", () => {
  const project = () =>
    makeProject({
      ".env": "A=1\nB=1\n",
      ".env.example": "A=\n",
      "src/a.ts": "process.env.C;",
    });

  it("writes declarations to env.d.ts by default", async () => {
    const cwd = project();
    const io = captureIO();
    expect(await run(["--cwd", cwd, "types"], io)).toBe(0);
    expect(read(cwd, "env.d.ts")).toContain(
      "interface ProcessEnv {\n    A: string;\n    B?: string;\n    C?: string;\n  }",
    );
    expect(io.stdout()).toContain("Wrote env.d.ts");
  });

  it("supports --output, creating directories", async () => {
    const cwd = project();
    expect(
      await run(
        ["--cwd", cwd, "types", "--output", "src/types/env.d.ts"],
        captureIO(),
      ),
    ).toBe(0);
    expect(existsSync(path.join(cwd, "src/types/env.d.ts"))).toBe(true);
  });

  it("regenerates its own files but protects hand-written ones", async () => {
    const cwd = project();
    expect(await run(["--cwd", cwd, "types"], captureIO())).toBe(0);
    expect(await run(["--cwd", cwd, "types"], captureIO())).toBe(0);

    writeFileSync(
      path.join(cwd, "mine.d.ts"),
      "declare const handWritten: string;\n",
    );
    const io = captureIO();
    expect(
      await run(["--cwd", cwd, "types", "--output", "mine.d.ts"], io),
    ).toBe(2);
    expect(io.stderr()).toContain("was not generated by envclinic");
    expect(read(cwd, "mine.d.ts")).toBe("declare const handWritten: string;\n");

    expect(
      await run(
        ["--cwd", cwd, "types", "--output", "mine.d.ts", "--force"],
        captureIO(),
      ),
    ).toBe(0);
    expect(read(cwd, "mine.d.ts")).toContain("Generated by envclinic");
  });

  it("--dry-run prints without writing", async () => {
    const cwd = project();
    const io = captureIO();
    expect(await run(["--cwd", cwd, "types", "--dry-run"], io)).toBe(0);
    expect(io.stdout()).toContain("declare namespace NodeJS");
    expect(existsSync(path.join(cwd, "env.d.ts"))).toBe(false);
  });

  it("--check passes only when the file is current", async () => {
    const cwd = project();
    expect(await run(["--cwd", cwd, "types", "--check"], captureIO())).toBe(1);
    await run(["--cwd", cwd, "types"], captureIO());
    expect(await run(["--cwd", cwd, "types", "--check"], captureIO())).toBe(0);
    writeFileSync(path.join(cwd, ".env"), "A=1\nB=1\nNEW=1\n");
    const io = captureIO();
    expect(await run(["--cwd", cwd, "types", "--check"], io)).toBe(1);
    expect(io.stdout()).toContain("out of date");
  });

  it("generates Vite declarations for import.meta.env", async () => {
    const cwd = copyFixture("vite");
    await run(["--cwd", cwd, "types"], captureIO());
    expect(read(cwd, "env.d.ts")).toContain(
      "interface ImportMetaEnv {\n  readonly VITE_API_URL: string;\n}",
    );
  });
});

describe("audit --fix", () => {
  const project = () =>
    makeProject({
      ".env": "A=1\nSTRAY=1\n",
      ".env.example": "# docs\nA=\n",
      "src/a.ts": "process.env.A;process.env.STRAY;process.env.CODE_ONLY;",
    });

  it("shows the plan with --dry-run and changes nothing", async () => {
    const cwd = project();
    const io = captureIO();
    await run(["--cwd", cwd, "audit", "--fix", "--dry-run"], io);
    expect(io.stdout()).toContain("Fix: add 2 variables to .env.example");
    expect(io.stdout()).toContain("Dry run: no files were changed.");
    expect(read(cwd, ".env.example")).toBe("# docs\nA=\n");
  });

  it("refuses to modify files without confirmation when not interactive", async () => {
    const cwd = project();
    const io = captureIO();
    expect(await run(["--cwd", cwd, "audit", "--fix"], io)).toBe(2);
    expect(io.stderr()).toContain("--yes");
    expect(read(cwd, ".env.example")).toBe("# docs\nA=\n");
  });

  it("applies the fix with --yes, only touches the example file, and then audits again", async () => {
    const cwd = project();
    const io = captureIO();
    // CODE_ONLY is now documented, but it still has no value in .env, which is for you to set.
    expect(await run(["--cwd", cwd, "audit", "--fix", "--yes"], io)).toBe(1);
    expect(read(cwd, ".env.example")).toBe(
      "# docs\nA=\n\n# Added by envclinic\nCODE_ONLY=\nSTRAY=\n",
    );
    expect(read(cwd, ".env")).toBe("A=1\nSTRAY=1\n");
    expect(io.stdout()).toContain("Updated .env.example.");
    expect(io.stdout()).toContain(
      "CODE_ONLY is declared in .env.example but missing from .env",
    );
    expect(io.stdout()).not.toContain(
      "STRAY is set in .env but not documented",
    );
  });

  it("asks for confirmation interactively", async () => {
    const declined = project();
    expect(
      await run(
        ["--cwd", declined, "audit", "--fix"],
        captureIO({ prompter: scriptedPrompter([false]) }),
      ),
    ).toBe(1);
    expect(read(declined, ".env.example")).toBe("# docs\nA=\n");

    const accepted = project();
    await run(
      ["--cwd", accepted, "audit", "--fix"],
      captureIO({ prompter: scriptedPrompter([true]) }),
    );
    expect(read(accepted, ".env.example")).toContain("STRAY=");
  });

  it("explains when there is nothing to fix or no example file", async () => {
    const clean = makeProject({ ".env": "A=1\n", ".env.example": "A=\n" });
    const io = captureIO();
    await run(["--cwd", clean, "audit", "--fix", "--yes"], io);
    expect(io.stdout()).toContain("Nothing to fix automatically.");

    const noExample = makeProject({ ".env": "A=1\n" });
    const second = captureIO();
    await run(["--cwd", noExample, "audit", "--fix", "--yes"], second);
    expect(second.stdout()).toContain("Nothing to fix automatically.");
  });
});

describe("init", () => {
  it("--yes writes a config with detected settings that audit accepts", async () => {
    const cwd = copyFixture("nextjs");
    const io = captureIO();
    expect(await run(["--cwd", cwd, "init", "--yes"], io)).toBe(0);
    const config = JSON.parse(read(cwd, "envclinic.config.json"));
    expect(config).toMatchObject({
      files: { source: [".env"], example: ".env.example" },
      scan: { directories: ["app", "lib"] },
      rules: { missing: "error", unused: "warning" },
    });
    expect(await run(["--cwd", cwd, "--json"], captureIO())).toBe(0);
  });

  it("asks questions interactively and applies the answers", async () => {
    const cwd = makeProject({
      ".env": "A=1\n",
      ".env.local": "B=1\n",
      ".env.example": "A=\n",
    });
    const prompter = scriptedPrompter([
      ".env, .env.local",
      ".env.example",
      "src, lib",
      "strict",
      true,
    ]);
    expect(await run(["--cwd", cwd, "init"], captureIO({ prompter }))).toBe(0);
    expect(JSON.parse(read(cwd, "envclinic.config.json"))).toMatchObject({
      files: { source: [".env", ".env.local"], example: ".env.example" },
      scan: { directories: ["src", "lib"] },
      rules: { unused: "error", weak: "error", missing: "error" },
      types: { enabled: true },
    });
    expect(prompter.asked.length).toBe(5);
  });

  it("can write a JavaScript config", async () => {
    const cwd = makeProject({ ".env": "A=1\n" });
    expect(
      await run(
        ["--cwd", cwd, "init", "--yes", "--config-format", "mjs"],
        captureIO(),
      ),
    ).toBe(0);
    const config = read(cwd, "envclinic.config.mjs");
    expect(config).toMatch(
      /^\/\*\* @type \{import\("envclinic"\)\.EnvDoctorConfig\} \*\/\nexport default \{/,
    );
    // It must load without envclinic being installed in the project (as with npx).
    expect(config).not.toMatch(/^import /m);
    const io = captureIO();
    expect(await run(["--cwd", cwd, "--json"], io)).toBe(0);
    expect(JSON.parse(io.stdout()).configFile).toBe("envclinic.config.mjs");
  });

  it("needs --yes or a terminal, and does not replace an existing config silently", async () => {
    const cwd = makeProject({ ".env": "A=1\n" });
    const io = captureIO();
    expect(await run(["--cwd", cwd, "init"], io)).toBe(2);
    expect(io.stderr()).toContain("--yes");

    await run(["--cwd", cwd, "init", "--yes"], captureIO());
    const again = captureIO();
    expect(await run(["--cwd", cwd, "init", "--yes"], again)).toBe(2);
    expect(again.stderr()).toContain("already exists");
    expect(
      await run(["--cwd", cwd, "init", "--yes", "--force"], captureIO()),
    ).toBe(0);
  });
});

describe("framework", () => {
  it("describes the detected framework", async () => {
    const io = captureIO();
    expect(await run(["--cwd", copyFixture("nextjs"), "framework"], io)).toBe(
      0,
    );
    expect(io.stdout()).toContain("Framework detected: Next.js");
    expect(io.stdout()).toContain("NEXT_PUBLIC_");
    expect(io.stdout()).toContain('dependency "next"');
  });

  it("prints JSON", async () => {
    const io = captureIO();
    await run(["--cwd", copyFixture("vite"), "framework", "--json"], io);
    expect(JSON.parse(io.stdout())).toMatchObject({
      id: "vite",
      publicPrefixes: ["VITE_"],
    });
  });
});

describe("check, secrets, unused and validate", () => {
  it("check runs file checks and schema validation but not scans", async () => {
    const cwd = makeProject({
      ".env": "A=1\nB=\n",
      ".env.example": "A=\nB=\nC=\n",
      "src/a.ts": "process.env.NOPE;",
    });
    const io = captureIO();
    expect(await run(["--cwd", cwd, "check", "--json"], io)).toBe(1);
    expect(
      JSON.parse(io.stdout()).issues.map((i: { code: string }) => i.code),
    ).toEqual(["missing-variable", "empty-variable"]);
  });

  it("secrets reports credentials and weak secrets, and --env-only skips source code", async () => {
    const cwd = makeProject({
      ".env": "JWT_SECRET=short\n",
      "src/a.ts": `const t = "${STRIPE}";`,
    });
    const io = captureIO();
    expect(await run(["--cwd", cwd, "secrets", "--no-color"], io)).toBe(1);
    expect(io.stdout()).toContain("Security audit (2)");
    expect(io.stdout()).toContain(
      "[CRITICAL] Potential exposed credential (Stripe secret key) in source code",
    );
    expect(io.stdout()).toContain("[WARNING] Weak secret");
    expect(io.stdout()).toContain("Value: ********");
    expect(io.stdout()).not.toContain(STRIPE);

    const envOnly = captureIO();
    expect(
      await run(["--cwd", cwd, "secrets", "--env-only", "--json"], envOnly),
    ).toBe(0);
    expect(JSON.parse(envOnly.stdout()).issues).toHaveLength(1);
  });

  it("unused reports potentially unused and undeclared variables", async () => {
    const cwd = makeProject({
      ".env": "A=1\nOLD=1\n",
      ".env.example": "A=\nOLD=\n",
      "src/a.ts": "process.env.A; process.env.NEW_ONE;",
    });
    const io = captureIO();
    expect(await run(["--cwd", cwd, "unused", "--no-color"], io)).toBe(0);
    expect(io.stdout()).toContain("Potentially unused variables (1)");
    expect(io.stdout()).toContain("Undeclared variables (1)");
    expect(
      await run(["--cwd", cwd, "unused", "--strict", "--quiet"], captureIO()),
    ).toBe(1);
    expect(
      await run(
        ["--cwd", cwd, "unused", "--ignore", "OLD,NEW_ONE"],
        captureIO(),
      ),
    ).toBe(0);
    expect(
      await run(["--cwd", cwd, "unused", "--dir", "elsewhere"], captureIO()),
    ).toBe(0);
    expect(await run(["--cwd", cwd, "unused", "--no-scan"], captureIO())).toBe(
      2,
    );
  });

  describe("validate", () => {
    const schema = {
      PORT: { type: "number" },
      MODE: { type: "enum", values: ["a", "b"] },
    };
    const project = (env: string) =>
      makeProject({
        ".env": env,
        "envclinic.config.json": JSON.stringify({ schema }),
      });

    it("passes and fails based on the schema", async () => {
      expect(
        await run(
          ["--cwd", project("PORT=1\nMODE=a\n"), "validate"],
          captureIO(),
        ),
      ).toBe(0);
      const io = captureIO();
      expect(
        await run(
          ["--cwd", project("PORT=x\nMODE=c\n"), "validate", "--no-color"],
          io,
        ),
      ).toBe(1);
      expect(io.stdout()).toContain("Schema validation (2)");
      expect(io.stdout()).toContain("PORT must be a number");
      expect(io.stdout()).toContain("MODE must be one of: a, b");
    });

    it("can validate the process environment", async () => {
      const cwd = makeProject({
        "envclinic.config.json": JSON.stringify({ schema }),
      });
      process.env.PORT = "8080";
      process.env.MODE = "b";
      try {
        expect(
          await run(["--cwd", cwd, "validate", "--process-env"], captureIO()),
        ).toBe(0);
        process.env.MODE = "zzz";
        expect(
          await run(["--cwd", cwd, "validate", "--process-env"], captureIO()),
        ).toBe(1);
      } finally {
        delete process.env.PORT;
        delete process.env.MODE;
      }
    });

    it("explains missing prerequisites with exit code 2", async () => {
      const noSchema = captureIO();
      expect(
        await run(
          ["--cwd", makeProject({ ".env": "A=1\n" }), "validate"],
          noSchema,
        ),
      ).toBe(2);
      expect(noSchema.stderr()).toContain("No schema found");

      const noEnv = captureIO();
      expect(
        await run(
          [
            "--cwd",
            makeProject({
              "envclinic.config.json": JSON.stringify({ schema }),
            }),
            "validate",
          ],
          noEnv,
        ),
      ).toBe(2);
      expect(noEnv.stderr()).toContain("--process-env");
    });
  });
});

describe("CI output", () => {
  const cwd = () =>
    makeProject({ ".env": "A=1\nSTRAY=1\n", ".env.example": "A=\nMISSING=\n" });

  it("--format github prints one annotation per issue", async () => {
    const io = captureIO();
    expect(await run(["--cwd", cwd(), "--format", "github"], io)).toBe(1);
    expect(io.stdout().trim().split("\n")).toEqual([
      "::error file=.env,title=envclinic%3A missing-variable::MISSING is declared in .env.example but missing from .env",
      "::warning file=.env,title=envclinic%3A undocumented-variable::STRAY is set in .env but not documented in .env.example",
    ]);
  });

  it("--ci adds annotations only when running in GitHub Actions", async () => {
    const plain = captureIO({ color: true });
    await run(["--cwd", cwd(), "audit", "--ci"], plain);
    expect(plain.stdout()).not.toContain("::error");

    const actions = captureIO({ color: true, env: { GITHUB_ACTIONS: "true" } });
    await run(["--cwd", cwd(), "audit", "--ci"], actions);
    expect(actions.stdout()).toContain("::error file=.env");
    expect(actions.stdout()).not.toContain("\u001b[");
  });

  it("escapes special characters in annotations", async () => {
    const { formatAnnotation } = await import("../../src/cli/output/github");
    expect(
      formatAnnotation({
        code: "x",
        severity: "info",
        message: "100%\nnext",
        file: "a,b:c.env",
        line: 2,
      }),
    ).toBe(
      "::notice file=a%2Cb%3Ac.env,line=2,title=envclinic%3A x::100%25%0Anext",
    );
  });

  it("rejects an unknown format", async () => {
    const io = captureIO();
    expect(await run(["--cwd", cwd(), "--format", "xml"], io)).toBe(2);
    expect(io.stderr()).toContain('Unknown format "xml"');
  });
});

describe("config files", () => {
  it("loads a .ts config on Node versions that can import TypeScript", async () => {
    const cwd = makeProject({
      ".env": "A=1\n",
      "envclinic.config.ts":
        "const config: { ignore: { variables: string[] } } = { ignore: { variables: ['A'] } };\nexport default config;\n",
    });
    const io = captureIO();
    const code = await run(["--cwd", cwd, "--json"], io);
    if ((process.features as { typescript?: unknown }).typescript) {
      expect(code).toBe(0);
      expect(JSON.parse(io.stdout()).configFile).toBe("envclinic.config.ts");
    } else {
      expect(code).toBe(2);
      expect(io.stdout()).toContain("TypeScript config files need");
    }
  });

  it("loads a config that uses defineConfig from the package", async () => {
    const cwd = makeProject({
      ".env": "A=1\n",
      "envclinic.config.mjs":
        "export default { schema: { A: { type: 'custom', validate: (v) => v === '1' } } };\n",
    });
    expect(await run(["--cwd", cwd, "validate"], captureIO())).toBe(0);
  });
});
