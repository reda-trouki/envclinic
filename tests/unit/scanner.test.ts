import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config/schema";
import {
  discoverSourceFiles,
  extractReferences,
  DEFAULT_EXTENSIONS,
} from "../../src/core/scanner";
import { makeProject } from "../helpers";

const names = (source: string) =>
  extractReferences(source).names.map((n) => n.name);

describe("extractReferences", () => {
  it("finds dot access, bracket access and import.meta.env", () => {
    const source = [
      "const a = process.env.DATABASE_URL;",
      'const b = process.env["JWT_SECRET"];',
      "const c = process.env['SINGLE'];",
      "const d = process.env[`TICKS`];",
      "const e = import.meta.env.VITE_API_URL;",
      "const f = Bun.env.BUN_VAR;",
      "const g = process.env?.OPTIONAL;",
    ].join("\n");
    expect(names(source)).toEqual([
      "DATABASE_URL",
      "JWT_SECRET",
      "SINGLE",
      "TICKS",
      "VITE_API_URL",
      "BUN_VAR",
      "OPTIONAL",
    ]);
  });

  it("finds Deno.env.get", () => {
    expect(names('const x = Deno.env.get("DENO_VAR");')).toEqual(["DENO_VAR"]);
  });

  it("reports correct line numbers", () => {
    const refs = extractReferences(
      "\n\nconst a = process.env.A;\n\n\nconst b = process.env.B;",
    );
    expect(refs.names).toEqual([
      { name: "A", line: 3 },
      { name: "B", line: 6 },
    ]);
  });

  it("handles destructuring with aliases and defaults", () => {
    const source = "const { A, B: renamed, C = 'x' } = process.env;";
    expect(names(source)).toEqual(["A", "B", "C"]);
    expect(extractReferences(source).dynamic).toEqual([]);
  });

  it("handles TypeScript casts", () => {
    expect(names("const x = (process.env as any).CASTED;")).toEqual(["CASTED"]);
  });

  it("treats computed access, aliases, spreads and rest destructuring as dynamic", () => {
    const cases = [
      "const x = process.env[name];",
      "const x = process.env[`PREFIX_${name}`];",
      "const env = process.env;",
      "const copy = { ...process.env };",
      "const { A, ...rest } = process.env;",
      "Object.keys(process.env);",
    ];
    for (const source of cases) {
      expect(extractReferences(source).dynamic.length, source).toBeGreaterThan(
        0,
      );
    }
  });

  it("does not match lookalikes", () => {
    expect(
      extractReferences(
        "const x = other.process.env.NOPE; const y = process.environment.NOPE;",
      ),
    ).toEqual({
      names: [],
      dynamic: [],
    });
    expect(extractReferences("const nothing = 1;")).toEqual({
      names: [],
      dynamic: [],
    });
  });
});

describe("discoverSourceFiles", () => {
  const options = {
    directories: ["."],
    ignore: [],
    extensions: DEFAULT_EXTENSIONS,
  };

  it("finds source files and skips generated directories, declarations and config files", async () => {
    const cwd = makeProject({
      "src/a.ts": "",
      "src/nested/b.tsx": "",
      "lib/c.mjs": "",
      "node_modules/pkg/index.js": "",
      "dist/out.js": "",
      ".next/cache.js": "",
      "build/x.js": "",
      "src/types.d.ts": "",
      "vendor.min.js": "",
      "envclinic.config.mjs": "",
      "readme.md": "",
    });
    expect(await discoverSourceFiles(cwd, options)).toEqual([
      "lib/c.mjs",
      "src/a.ts",
      "src/nested/b.tsx",
    ]);
  });

  it("honors directories and extra ignore entries", async () => {
    const cwd = makeProject({
      "src/a.ts": "",
      "src/skip/b.ts": "",
      "other/c.ts": "",
    });
    expect(
      await discoverSourceFiles(cwd, {
        ...options,
        directories: ["src"],
        ignore: ["skip"],
      }),
    ).toEqual(["src/a.ts"]);
    expect(
      await discoverSourceFiles(cwd, {
        ...options,
        ignore: ["src/skip", "other/**"],
      }),
    ).toEqual(["src/a.ts"]);
  });

  it("ignores directories that do not exist", async () => {
    const cwd = makeProject({ "src/a.ts": "" });
    expect(
      await discoverSourceFiles(cwd, {
        ...options,
        directories: ["src", "nope"],
      }),
    ).toEqual(["src/a.ts"]);
  });

  it("rejects directories outside the project", async () => {
    const cwd = makeProject({ "src/a.ts": "" });
    await expect(
      discoverSourceFiles(cwd, { ...options, directories: ["../elsewhere"] }),
    ).rejects.toThrow(ConfigError);
  });

  it("does not follow symlinked directories or files", async () => {
    const outside = makeProject({
      "secret.ts": "export const x = process.env.OUTSIDE;",
    });
    const cwd = makeProject({ "src/a.ts": "" });
    try {
      symlinkSync(outside, path.join(cwd, "linked"));
      symlinkSync(
        path.join(outside, "secret.ts"),
        path.join(cwd, "src", "alias.ts"),
      );
    } catch {
      return; // symlinks unavailable on this platform
    }
    mkdirSync(path.join(cwd, "empty"));
    writeFileSync(path.join(cwd, "empty", "x.ts"), "");
    const found = await discoverSourceFiles(cwd, options);
    expect(found.some((file) => file.startsWith("linked/"))).toBe(false);
    // A symlinked file may be listed, but scanning skips it (covered in the audit tests).
    expect(found).toContain("src/a.ts");
  });
});
