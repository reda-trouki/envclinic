import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  categorize,
  renderExample,
  renderMerge,
} from "../../src/core/generator";
import { GENERATED_MARKER, renderTypes } from "../../src/core/type-generator";
import type { VariableInfo } from "../../src/core/variables";
import {
  isProtectedEnvFileName,
  writeProjectFile,
} from "../../src/core/writer";
import type { FrameworkInfo } from "../../src/frameworks/detector";
import { makeProject } from "../helpers";

const v = (name: string, extra: Partial<VariableInfo> = {}): VariableInfo => ({
  name,
  inSource: true,
  inExample: true,
  usedInCode: false,
  ...extra,
});

const framework = (
  id: FrameworkInfo["id"],
  publicPrefixes: string[] = [],
): FrameworkInfo => ({
  id,
  name: id,
  accessPatterns: [],
  publicPrefixes,
  evidence: [],
  detected: [id],
  forced: false,
  notes: [],
});

describe("renderExample", () => {
  it("groups variables like the specification example and writes empty values", () => {
    const out = renderExample(
      [v("DATABASE_URL"), v("JWT_SECRET"), v("STRIPE_SECRET_KEY")],
      [],
    );
    expect(out).toBe(
      "# Database configuration\nDATABASE_URL=\n\n# Authentication\nJWT_SECRET=\n\n# External services\nSTRIPE_SECRET_KEY=\n",
    );
  });

  it("categorizes names", () => {
    expect(categorize("NEXT_PUBLIC_X", ["NEXT_PUBLIC_"])).toBe(
      "Client-exposed variables",
    );
    expect(categorize("REDIS_URL", [])).toBe("Database configuration");
    expect(categorize("SESSION_TTL", [])).toBe("Authentication");
    expect(categorize("SENDGRID_API_KEY", [])).toBe("External services");
    expect(categorize("PORT", [])).toBe("Application");
    expect(categorize("MYSTERY", [])).toBe("Other");
  });

  it("writes schema descriptions and never secret defaults", () => {
    const out = renderExample(
      [
        v("PORT", {
          schema: { type: "number", default: 3000, description: "HTTP port" },
        }),
        v("JWT_SECRET", {
          schema: {
            type: "string",
            secret: true,
            default: "SECRET_MARKER_default",
          },
        }),
        v("MODE", { schema: { type: "enum", values: ["a", "b"] } }),
      ],
      [],
    );
    expect(out).toContain(
      "# HTTP port\n# number, optional, default: 3000\nPORT=",
    );
    expect(out).toContain("# string, optional\nJWT_SECRET=");
    expect(out).toContain("# one of: a, b, required\nMODE=");
    expect(out).not.toContain("SECRET_MARKER_default");
  });

  it("returns an empty string for no variables", () => {
    expect(renderExample([], [])).toBe("");
  });
});

describe("renderMerge", () => {
  it("appends only missing variables and keeps existing content untouched", () => {
    const existing = "# my notes\nA=default-value\n\nB=\n";
    const merged = renderMerge(existing, [v("A"), v("B"), v("C"), v("D")]);
    expect(merged.added).toEqual(["C", "D"]);
    expect(merged.content.startsWith(existing.trimEnd())).toBe(true);
    expect(merged.content).toBe(
      "# my notes\nA=default-value\n\nB=\n\n# Added by envclinic\nC=\nD=\n",
    );
  });

  it("returns the file unchanged when nothing is missing", () => {
    expect(renderMerge("A=\n", [v("A")])).toEqual({
      content: "A=\n",
      added: [],
    });
  });

  it("works on an empty file", () => {
    expect(renderMerge("", [v("A")]).content).toBe(
      "# Added by envclinic\nA=\n",
    );
  });
});

describe("renderTypes", () => {
  const base = { hasSourceFiles: true, hasExample: true };

  it("matches the specification example", () => {
    const out = renderTypes({
      ...base,
      framework: framework("node"),
      variables: [
        v("DATABASE_URL"),
        v("JWT_SECRET"),
        v("REDIS_URL", { inSource: false }),
      ],
    });
    expect(out.startsWith(GENERATED_MARKER)).toBe(true);
    expect(out).toContain(
      "declare namespace NodeJS {\n  interface ProcessEnv {\n    DATABASE_URL: string;\n    JWT_SECRET: string;\n    REDIS_URL?: string;\n  }\n}",
    );
  });

  it("uses the schema for required/optional and enum literals", () => {
    const out = renderTypes({
      ...base,
      framework: framework("node"),
      variables: [
        v("PORT", {
          schema: { type: "number", default: 3000, description: "HTTP port" },
        }),
        v("MODE", {
          schema: { type: "enum", values: ["development", "production"] },
        }),
        v("OPT", { schema: { type: "string", required: false } }),
      ],
    });
    expect(out).toContain(
      "/** HTTP port Parse as number (the value is a string at runtime). */\n    PORT?: string;",
    );
    expect(out).toContain('MODE: "development" | "production";');
    expect(out).toContain("OPT?: string;");
  });

  it("skips NODE_ENV and TZ unless the schema defines them", () => {
    const without = renderTypes({
      ...base,
      framework: framework("node"),
      variables: [v("NODE_ENV"), v("TZ"), v("A")],
    });
    expect(without).not.toContain("NODE_ENV");
    expect(without).not.toContain("TZ");
    const withSchema = renderTypes({
      ...base,
      framework: framework("node"),
      variables: [
        v("NODE_ENV", {
          schema: { type: "enum", values: ["development", "production"] },
        }),
      ],
    });
    expect(withSchema).toContain("NODE_ENV");
  });

  it("puts client variables of Vite and Astro into ImportMetaEnv", () => {
    const out = renderTypes({
      ...base,
      framework: framework("vite", ["VITE_"]),
      variables: [v("VITE_API_URL"), v("DATABASE_URL")],
    });
    expect(out).toContain(
      "interface ImportMetaEnv {\n  readonly VITE_API_URL: string;\n}",
    );
    expect(out).toContain(
      "interface ImportMeta {\n  readonly env: ImportMetaEnv;\n}",
    );
    expect(out).toContain("DATABASE_URL: string;");
    expect(out).not.toContain("    VITE_API_URL");
  });

  it("keeps everything in ProcessEnv for Next.js", () => {
    const out = renderTypes({
      ...base,
      framework: framework("nextjs", ["NEXT_PUBLIC_"]),
      variables: [v("NEXT_PUBLIC_X")],
    });
    expect(out).toContain("    NEXT_PUBLIC_X: string;");
    expect(out).not.toContain("ImportMetaEnv");
  });

  it("derives requiredness without a schema from where the variable appears", () => {
    const only = (
      info: VariableInfo,
      hasSourceFiles: boolean,
      hasExample: boolean,
    ) =>
      renderTypes({
        variables: [info],
        framework: framework("node"),
        hasSourceFiles,
        hasExample,
      });
    expect(only(v("A"), true, true)).toContain("A: string;");
    expect(only(v("A", { inSource: false }), true, true)).toContain(
      "A?: string;",
    );
    expect(only(v("A", { inExample: false }), true, true)).toContain(
      "A?: string;",
    );
    expect(only(v("A", { inExample: false }), true, false)).toContain(
      "A: string;",
    );
    expect(only(v("A", { inSource: false }), false, true)).toContain(
      "A: string;",
    );
    expect(
      only(
        v("A", { inSource: false, inExample: false, usedInCode: true }),
        false,
        false,
      ),
    ).toContain("A?: string;");
  });

  it("produces a valid module when there is nothing to declare", () => {
    expect(
      renderTypes({ ...base, framework: framework("node"), variables: [] }),
    ).toContain("export {};");
  });
});

describe("isProtectedEnvFileName", () => {
  it("protects real env files but allows templates", () => {
    for (const name of [
      ".env",
      ".env.local",
      ".env.production",
      "prod.env",
      "sub/.env",
      ".ENV",
    ]) {
      expect(isProtectedEnvFileName(name), name).toBe(true);
    }
    for (const name of [
      ".env.example",
      ".env.sample",
      ".env.template",
      "env.d.ts",
      "config.json",
      ".env.dist",
    ]) {
      expect(isProtectedEnvFileName(name), name).toBe(false);
    }
  });
});

describe("writeProjectFile", () => {
  it("creates files and parent directories", async () => {
    const cwd = makeProject();
    const result = await writeProjectFile(cwd, "types/deep/env.d.ts", "x\n", {
      overwrite: false,
    });
    expect(result).toEqual({ status: "written", path: "types/deep/env.d.ts" });
    expect(readFileSync(path.join(cwd, "types/deep/env.d.ts"), "utf8")).toBe(
      "x\n",
    );
  });

  it("refuses to overwrite unless asked, and reports unchanged content", async () => {
    const cwd = makeProject({ "a.txt": "old\n" });
    expect(
      await writeProjectFile(cwd, "a.txt", "new\n", { overwrite: false }),
    ).toMatchObject({ status: "refused", reason: "the file already exists" });
    expect(readFileSync(path.join(cwd, "a.txt"), "utf8")).toBe("old\n");
    expect(
      (await writeProjectFile(cwd, "a.txt", "new\n", { overwrite: true }))
        .status,
    ).toBe("written");
    expect(readFileSync(path.join(cwd, "a.txt"), "utf8")).toBe("new\n");
    expect(
      (await writeProjectFile(cwd, "a.txt", "new\n", { overwrite: false }))
        .status,
    ).toBe("unchanged");
  });

  it("refuses paths outside the project and the project root itself", async () => {
    const cwd = makeProject();
    expect(
      (await writeProjectFile(cwd, "../escape.txt", "x", { overwrite: true }))
        .status,
    ).toBe("refused");
    expect(
      (
        await writeProjectFile(cwd, "/etc/passwd-test", "x", {
          overwrite: true,
        })
      ).status,
    ).toBe("refused");
    expect(
      (await writeProjectFile(cwd, ".", "x", { overwrite: true })).status,
    ).toBe("refused");
  });

  it("refuses real env files", async () => {
    const cwd = makeProject({ ".env": "KEEP=1\n" });
    const result = await writeProjectFile(cwd, ".env", "X=\n", {
      overwrite: true,
    });
    expect(result).toMatchObject({ status: "refused" });
    expect(result.reason).toMatch(/never writes to real environment files/);
    expect(readFileSync(path.join(cwd, ".env"), "utf8")).toBe("KEEP=1\n");
  });

  it("refuses symlink targets and directories that resolve outside the project", async () => {
    const outside = makeProject({ "victim.txt": "safe\n" });
    const cwd = makeProject({ "real.txt": "x\n" });
    try {
      symlinkSync(path.join(outside, "victim.txt"), path.join(cwd, "link.txt"));
      symlinkSync(outside, path.join(cwd, "linkdir"));
    } catch {
      return; // symlinks unavailable on this platform
    }
    expect(
      (await writeProjectFile(cwd, "link.txt", "pwned", { overwrite: true }))
        .status,
    ).toBe("refused");
    expect(
      (
        await writeProjectFile(cwd, "linkdir/new.txt", "pwned", {
          overwrite: true,
        })
      ).status,
    ).toBe("refused");
    expect(readFileSync(path.join(outside, "victim.txt"), "utf8")).toBe(
      "safe\n",
    );
  });

  it("refuses to write over a directory", async () => {
    const cwd = makeProject();
    mkdirSync(path.join(cwd, "dir"));
    expect(
      (await writeProjectFile(cwd, "dir", "x", { overwrite: true })).status,
    ).toBe("refused");
  });

  it("leaves no temporary files behind", async () => {
    const cwd = makeProject();
    await writeProjectFile(cwd, "a.txt", "x", { overwrite: false });
    writeFileSync(path.join(cwd, "b.txt"), "y");
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(cwd).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
