import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGitChecker, parseGitignore } from "../../src/core/gitignore";
import { createNameMatcher, matchesGlob } from "../../src/core/glob";
import { makeProject } from "../helpers";

describe("matchesGlob", () => {
  it("supports *, ** and ?", () => {
    expect(matchesGlob("src/*.ts", "src/a.ts")).toBe(true);
    expect(matchesGlob("src/*.ts", "src/deep/a.ts")).toBe(false);
    expect(matchesGlob("src/**/*.ts", "src/deep/er/a.ts")).toBe(true);
    expect(matchesGlob("**/fixtures/**", "tests/fixtures/x/y.ts")).toBe(true);
    expect(matchesGlob("a?.ts", "ab.ts")).toBe(true);
    expect(matchesGlob("a?.ts", "a/.ts")).toBe(false);
    expect(matchesGlob("./src/a.ts", "src/a.ts")).toBe(true);
  });

  it("escapes regex characters", () => {
    expect(matchesGlob("a+b(1).ts", "a+b(1).ts")).toBe(true);
    expect(matchesGlob("a.ts", "aXts")).toBe(false);
  });
});

describe("createNameMatcher", () => {
  it("matches exact names and * wildcards", () => {
    const matches = createNameMatcher(["A", "NEXT_*", "*_SECRET", "X_*_Y"]);
    expect(["A", "NEXT_PUBLIC_X", "JWT_SECRET", "X_MID_Y"].every(matches)).toBe(true);
    expect(["B", "AA", "NEXTX", "SECRET_X", "X_Y"].some(matches)).toBe(false);
  });

  it("matches nothing when empty", () => {
    expect(createNameMatcher([])("ANYTHING")).toBe(false);
  });
});

describe("parseGitignore + createGitChecker", () => {
  const ignored = async (gitignore: string, file: string, extra: Record<string, string> = {}) => {
    const cwd = makeProject({ ".gitignore": gitignore, ...extra });
    mkdirSync(path.join(cwd, ".git"));
    return (await createGitChecker(cwd).status(path.join(cwd, file))) === "ignored";
  };

  it("ignores simple names and patterns", async () => {
    expect(await ignored(".env\n", ".env")).toBe(true);
    expect(await ignored(".env*\n", ".env.local")).toBe(true);
    expect(await ignored(".env.*\n!.env.example\n", ".env.example")).toBe(false);
    expect(await ignored(".env.*\n!.env.example\n", ".env.production")).toBe(true);
    expect(await ignored("*.log\n", "a.log")).toBe(true);
  });

  it("does not ignore files that no rule matches", async () => {
    expect(await ignored("node_modules\n", ".env")).toBe(false);
    expect(await ignored("", ".env")).toBe(false);
  });

  it("handles comments, blank lines, and CRLF", async () => {
    expect(await ignored("# comment\r\n\r\n.env\r\n", ".env")).toBe(true);
  });

  it("handles directory rules and anchoring", async () => {
    expect(await ignored("config/\n", "config/.env", { "config/.env": "" })).toBe(true);
    expect(await ignored("/.env\n", ".env")).toBe(true);
    expect(await ignored("/.env\n", "sub/.env", { "sub/.env": "" })).toBe(false);
    expect(await ignored("sub/.env\n", "sub/.env", { "sub/.env": "" })).toBe(true);
    expect(await ignored("**/.env\n", "a/b/.env", { "a/b/.env": "" })).toBe(true);
  });

  it("uses the last matching rule", async () => {
    expect(await ignored(".env\n!.env\n", ".env")).toBe(false);
    expect(await ignored("!.env\n.env\n", ".env")).toBe(true);
  });

  it("reads nested .gitignore files and .git/info/exclude", async () => {
    const cwd = makeProject({ "apps/web/.gitignore": ".env\n", "apps/web/.env": "" });
    mkdirSync(path.join(cwd, ".git", "info"), { recursive: true });
    writeFileSync(path.join(cwd, ".git", "info", "exclude"), "local.env\n");
    const git = createGitChecker(cwd);
    expect(await git.status(path.join(cwd, "apps/web/.env"))).toBe("ignored");
    expect(await git.status(path.join(cwd, "apps/other/.env"))).toBe("not-ignored");
    expect(await git.status(path.join(cwd, "local.env"))).toBe("ignored");
  });

  it("reports no-repo outside a git repository", async () => {
    const cwd = makeProject({ ".gitignore": ".env\n" });
    expect(await createGitChecker(cwd).status(path.join(cwd, ".env"))).toBe("no-repo");
  });

  it("returns an empty rule list for an empty file", () => {
    expect(parseGitignore("")).toEqual([]);
    expect(parseGitignore("# only a comment\n")).toEqual([]);
  });
});
