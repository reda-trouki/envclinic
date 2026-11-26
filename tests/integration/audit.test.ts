import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { audit } from "../../src";
import { makeProject } from "../helpers";

function codes(result: Awaited<ReturnType<typeof audit>>): string[] {
  return result.issues.map((i) => i.code);
}

describe("audit", () => {
  it("reproduces the example from the specification", async () => {
    const cwd = makeProject({
      ".env":
        "DATABASE_URL=postgresql://localhost:5432/app\nJWT_SECRET=my-secret\nAPI_KEY=123456\n",
      ".env.example": "DATABASE_URL=\nJWT_SECRET=\nREDIS_URL=\n",
    });
    const result = await audit({ cwd, checks: ["files"] });

    expect(result.success).toBe(false);
    expect(result.files.map((f) => f.path)).toEqual([".env", ".env.example"]);
    const missing = result.issues.filter((i) => i.code === "missing-variable");
    const undocumented = result.issues.filter(
      (i) => i.code === "undocumented-variable",
    );
    expect(missing.map((i) => i.variable)).toEqual(["REDIS_URL"]);
    expect(missing[0]?.severity).toBe("error");
    expect(undocumented.map((i) => i.variable)).toEqual(["API_KEY"]);
    expect(undocumented[0]?.severity).toBe("warning");
    expect(result.summary).toMatchObject({
      filesScanned: 2,
      variablesFound: 4,
      errors: 1,
      warnings: 1,
    });
  });

  it("succeeds on a consistent project", async () => {
    const cwd = makeProject({
      ".env": "A=1\nB=2\n",
      ".env.example": "A=\nB=\n",
    });
    const result = await audit({ cwd });
    expect(result).toMatchObject({
      success: true,
      issues: [],
      summary: { filesScanned: 2, variablesFound: 2, errors: 0, warnings: 0 },
    });
  });

  it("falls back to .env.sample when there is no .env.example", async () => {
    const cwd = makeProject({ ".env": "A=1\n", ".env.sample": "A=\nB=\n" });
    const result = await audit({ cwd });
    expect(result.files.find((f) => f.role === "example")?.path).toBe(
      ".env.sample",
    );
    expect(codes(result)).toEqual(["missing-variable"]);
  });

  it("reports empty variables as warnings", async () => {
    const cwd = makeProject({
      ".env": "A=\nB=1\n",
      ".env.example": "A=\nB=\n",
    });
    const result = await audit({ cwd });
    expect(result.success).toBe(true);
    expect(result.issues).toMatchObject([
      { code: "empty-variable", variable: "A", severity: "warning", line: 1 },
    ]);
  });

  it("reports duplicates as errors in both file kinds", async () => {
    const cwd = makeProject({
      ".env": "A=1\nA=2\n",
      ".env.example": "A=\nA=\n",
    });
    const result = await audit({ cwd });
    expect(result.success).toBe(false);
    expect(
      result.issues
        .filter((i) => i.code === "duplicate-variable")
        .map((i) => i.file)
        .sort(),
    ).toEqual([".env", ".env.example"]);
  });

  it("excludes invalid names from the comparison", async () => {
    const cwd = makeProject({
      ".env": "good=1\nbad-name=2\nA=1\n",
      ".env.example": "A=\n",
    });
    const result = await audit({ cwd });
    expect(codes(result).sort()).toEqual([
      "invalid-variable-name",
      "undocumented-variable",
    ]);
    expect(result.summary.variablesFound).toBe(2);
  });

  describe("missing files", () => {
    it("treats a missing default .env as information (CI has no .env)", async () => {
      const cwd = makeProject({ ".env.example": "A=\n" });
      const result = await audit({ cwd });
      expect(result.success).toBe(true);
      expect(result.issues).toMatchObject([
        { code: "source-file-missing", severity: "info" },
      ]);
      expect(result.summary).toMatchObject({ filesScanned: 1, infos: 1 });
    });

    it("treats an explicitly requested missing file as an error", async () => {
      const cwd = makeProject({ ".env.example": "A=\n" });
      const result = await audit({ cwd, files: [".env.production"] });
      expect(result.success).toBe(false);
      expect(result.issues[0]).toMatchObject({
        code: "source-file-missing",
        severity: "error",
        file: ".env.production",
      });
    });

    it("warns when there is no example file", async () => {
      const cwd = makeProject({ ".env": "A=1\n" });
      const result = await audit({ cwd });
      expect(result.success).toBe(true);
      expect(result.issues).toMatchObject([
        { code: "example-file-missing", severity: "warning" },
      ]);
    });

    it("errors when an explicitly requested example file is missing", async () => {
      const cwd = makeProject({ ".env": "A=1\n" });
      const result = await audit({ cwd, example: "template.env" });
      expect(result.success).toBe(false);
      expect(result.issues[0]).toMatchObject({
        code: "example-file-missing",
        severity: "error",
      });
      expect(result.issues[0]?.message).toContain("template.env");
    });

    it("errors when there is nothing to audit", async () => {
      const result = await audit({ cwd: makeProject() });
      expect(result.success).toBe(false);
      expect(codes(result)).toContain("no-env-files");
    });
  });

  describe("options and config", () => {
    it("audits several source files against the example", async () => {
      const cwd = makeProject({
        ".env": "A=1\nB=1\n",
        ".env.production": "A=1\n",
        ".env.example": "A=\nB=\n",
      });
      const result = await audit({ cwd, files: [".env", ".env.production"] });
      expect(result.issues).toMatchObject([
        { code: "missing-variable", variable: "B", file: ".env.production" },
      ]);
    });

    it("does not audit the example file as its own source", async () => {
      const cwd = makeProject({ ".env.example": "A=\n" });
      const result = await audit({ cwd, files: [".env.example"] });
      expect(result.issues).toEqual([]);
      expect(result.files).toHaveLength(1);
    });

    it("strict mode turns warnings into errors but leaves info alone", async () => {
      const cwd = makeProject({ ".env.example": "A=\n" });
      expect((await audit({ cwd, strict: true })).success).toBe(true);

      const noisy = makeProject({ ".env": "A=\n", ".env.example": "A=\n" });
      const result = await audit({ cwd: noisy, strict: true });
      expect(result.success).toBe(false);
      expect(result.issues[0]).toMatchObject({
        code: "empty-variable",
        severity: "error",
      });
    });

    it("ignores variables given through options and config", async () => {
      const cwd = makeProject({
        ".env": "API_KEY=1\nOTHER=1\n",
        ".env.example": "REDIS_URL=\n",
        "envclinic.config.json": '{"ignore":{"variables":["REDIS_URL"]}}',
      });
      const result = await audit({ cwd, ignore: ["API_KEY"] });
      expect(result.issues.map((i) => i.variable)).toEqual(["OTHER"]);
      expect(result.configFile).toBe("envclinic.config.json");
    });

    it("applies rule levels from config, including off", async () => {
      const cwd = makeProject({
        ".env": "A=\nB=1\n",
        ".env.example": "A=\nB=\nC=\n",
      });
      const result = await audit({
        cwd,
        config: { rules: { missing: "warning", empty: "off" } },
      });
      expect(result.success).toBe(true);
      expect(result.issues).toMatchObject([
        { code: "missing-variable", severity: "warning" },
      ]);
    });

    it("honours files from config", async () => {
      const cwd = makeProject({
        ".env.local": "A=1\n",
        "template.env": "A=\nB=\n",
      });
      const result = await audit({
        cwd,
        config: { files: { source: [".env.local"], example: "template.env" } },
      });
      expect(result.issues).toMatchObject([
        { code: "missing-variable", variable: "B", file: ".env.local" },
      ]);
    });

    it("rejects invalid inline config", async () => {
      await expect(
        audit({
          cwd: makeProject(),
          config: { rules: { missing: "fatal" } } as never,
        }),
      ).rejects.toThrow(/rules\.missing/);
    });

    it("uses process.cwd() by default", async () => {
      const cwd = makeProject({ ".env": "A=1\n", ".env.example": "A=\n" });
      const previous = process.cwd();
      process.chdir(cwd);
      try {
        expect((await audit()).success).toBe(true);
      } finally {
        process.chdir(previous);
      }
    });
  });

  describe("file safety", () => {
    it("refuses paths outside the project root", async () => {
      const cwd = makeProject({ ".env.example": "A=\n" });
      const result = await audit({ cwd, files: ["../secrets.env"] });
      expect(result.success).toBe(false);
      expect(result.issues[0]).toMatchObject({
        code: "unsafe-path",
        severity: "error",
      });
    });

    it("refuses symlinks that point outside the project root", async () => {
      const outside = makeProject({ "outside.env": "OUTSIDE_ONLY=1\n" });
      const cwd = makeProject({ ".env.example": "A=\n" });
      try {
        symlinkSync(path.join(outside, "outside.env"), path.join(cwd, ".env"));
      } catch {
        return; // symlinks unavailable (for example without privileges on Windows)
      }
      const result = await audit({ cwd });
      expect(result.issues.map((i) => i.code)).toContain("unsafe-path");
      expect(JSON.stringify(result)).not.toContain("OUTSIDE_ONLY");
    });

    it("refuses directories", async () => {
      const cwd = makeProject({ ".env.example": "A=\n" });
      mkdirSync(path.join(cwd, ".env"));
      const result = await audit({ cwd });
      expect(result.issues.map((i) => i.code)).toContain("unsafe-path");
    });

    it("refuses oversized files", async () => {
      const cwd = makeProject({ ".env.example": "A=\n" });
      writeFileSync(
        path.join(cwd, ".env"),
        "A=" + "x".repeat(5 * 1024 * 1024 + 1),
      );
      const result = await audit({ cwd });
      expect(result.success).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain("file-too-large");
    });

    it("handles large but acceptable files", async () => {
      const lines = Array.from(
        { length: 20000 },
        (_, i) => `VAR_${i}=value`,
      ).join("\n");
      const cwd = makeProject({
        ".env": lines,
        ".env.example": lines.replace(/=value/g, "="),
      });
      const result = await audit({ cwd });
      expect(result.success).toBe(true);
      expect(result.summary.variablesFound).toBe(20000);
    });
  });
});
