import { describe, expect, it } from "vitest";
import { findDuplicates } from "../../src/analyzers/duplicates";
import { findEmpty } from "../../src/analyzers/empty";
import { findMissing, findUndocumented } from "../../src/analyzers/missing";
import { findSyntaxIssues, isValidName } from "../../src/analyzers/syntax";
import { parseEnv } from "../../src/core/parser";

describe("missing / undocumented", () => {
  const example = new Set(["A", "B", "C"]);
  const source = new Set(["B", "C", "D", "E"]);

  it("finds variables missing from the source, sorted", () => {
    const issues = findMissing(".env.example", example, ".env", source);
    expect(issues.map((i) => i.variable)).toEqual(["A"]);
    expect(issues[0]).toMatchObject({ code: "missing-variable", rule: "missing", file: ".env" });
  });

  it("finds undocumented variables, sorted", () => {
    const issues = findUndocumented(".env.example", example, ".env", source);
    expect(issues.map((i) => i.variable)).toEqual(["D", "E"]);
    expect(issues[0]).toMatchObject({ code: "undocumented-variable", rule: "undocumented" });
  });

  it("finds nothing when the sets match", () => {
    expect(findMissing("e", example, "s", example)).toEqual([]);
    expect(findUndocumented("e", example, "s", example)).toEqual([]);
  });
});

describe("findEmpty", () => {
  it("flags empty values once per variable", () => {
    const { entries } = parseEnv('A=\nB=1\nC=""\nA=\nD=" "\n');
    const issues = findEmpty(".env", entries);
    expect(issues.map((i) => [i.variable, i.line])).toEqual([
      ["A", 1],
      ["C", 3],
    ]);
  });
});

describe("findDuplicates", () => {
  it("reports every duplicated variable with its lines", () => {
    const { entries } = parseEnv("A=1\nB=1\nA=2\nB=2\nA=3\nC=1\n");
    const issues = findDuplicates(".env", entries);
    expect(issues.map((i) => i.variable)).toEqual(["A", "B"]);
    expect(issues[0]?.message).toContain("3 times");
    expect(issues[0]?.message).toContain("lines 1, 3, 5");
    expect(issues[0]?.line).toBe(1);
  });

  it("reports nothing without duplicates", () => {
    expect(findDuplicates(".env", parseEnv("A=1\nB=2\n").entries)).toEqual([]);
  });
});

describe("syntax issues", () => {
  it("validates variable names", () => {
    expect(["A", "_A", "a1", "DATABASE_URL"].every(isValidName)).toBe(true);
    expect(["1A", "A-B", "A.B", "A B", ""].some(isValidName)).toBe(false);
  });

  it("reports invalid names and syntax problems with line numbers only", () => {
    const parsed = parseEnv("OK=1\nbad-name=x\nnot valid\nQ=\"open\n");
    const issues = findSyntaxIssues(".env", parsed);
    expect(issues.map((i) => [i.code, i.line])).toEqual([
      ["invalid-variable-name", 2],
      ["malformed-line", 3],
      ["unterminated-quote", 4],
    ]);
    for (const issue of issues) {
      expect(issue.variable).toBeUndefined();
      expect(issue.message).not.toContain("bad-name");
    }
  });
});
