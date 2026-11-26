import { describe, expect, it } from "vitest";
import { audit } from "../../src";
import { copyFixture } from "../helpers";

interface Expectation {
  fixture: string;
  framework: string;
  success: boolean;
  codes: string[];
  sourceFiles: number;
}

// The same audit workflow, run against a sample project for each supported framework.
const CASES: Expectation[] = [
  { fixture: "node", framework: "node", success: true, codes: [], sourceFiles: 1 },
  { fixture: "express", framework: "express", success: true, codes: [], sourceFiles: 1 },
  { fixture: "nestjs", framework: "nestjs", success: true, codes: ["undocumented-variable", "unused-variable"], sourceFiles: 2 },
  { fixture: "nextjs", framework: "nextjs", success: true, codes: ["public-secret"], sourceFiles: 3 },
  { fixture: "vite", framework: "vite", success: true, codes: [], sourceFiles: 2 },
  { fixture: "react", framework: "react", success: true, codes: [], sourceFiles: 1 },
];

describe("audit against framework sample projects", () => {
  it.each(CASES)("$fixture", async ({ fixture, framework, success, codes, sourceFiles }) => {
    const cwd = copyFixture(fixture);
    const result = await audit({ cwd });
    expect(result.framework?.id).toBe(framework);
    expect(result.summary.sourceFilesScanned).toBe(sourceFiles);
    expect(result.issues.map((issue) => issue.code).sort()).toEqual([...codes].sort());
    expect(result.success).toBe(success);
  });

  it("flags the stale NestJS variable by name", async () => {
    const result = await audit({ cwd: copyFixture("nestjs") });
    expect(result.issues.filter((i) => i.code === "unused-variable").map((i) => i.variable)).toEqual(["OLD_FLAG"]);
    expect(result.issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("reports the browser-exposed secret in Next.js as a warning on the variable", async () => {
    const result = await audit({ cwd: copyFixture("nextjs") });
    expect(result.issues).toMatchObject([{ code: "public-secret", variable: "NEXT_PUBLIC_SESSION_SECRET", severity: "warning", file: ".env", line: 3 }]);
  });

  it("fails in strict mode when only warnings are present", async () => {
    expect((await audit({ cwd: copyFixture("nestjs"), strict: true })).success).toBe(false);
    expect((await audit({ cwd: copyFixture("node"), strict: true })).success).toBe(true);
  });

  it("treats built-in variables such as MODE as declared", async () => {
    const result = await audit({ cwd: copyFixture("vite") });
    expect(result.issues.find((i) => i.variable === "MODE")).toBeUndefined();
  });
});
