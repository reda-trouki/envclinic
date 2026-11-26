import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/core/parser";

function values(source: string): Record<string, string> {
  return Object.fromEntries(parseEnv(source).entries.map((e) => [e.key, e.value]));
}

describe("parseEnv", () => {
  it("parses simple declarations and skips comments and blank lines", () => {
    const { entries, problems } = parseEnv("# comment\n\nA=1\n  # indented comment\nB=two\n");
    expect(problems).toEqual([]);
    expect(entries.map((e) => [e.key, e.value, e.line])).toEqual([
      ["A", "1", 3],
      ["B", "two", 5],
    ]);
  });

  it("supports the export prefix and spaces around =", () => {
    const { entries } = parseEnv("export A=1\nB = 2\n  export   C  =  3\n");
    expect(entries.map((e) => [e.key, e.value, e.exported])).toEqual([
      ["A", "1", true],
      ["B", "2", false],
      ["C", "3", true],
    ]);
  });

  it("treats a key named export as a key", () => {
    expect(values("export=1")).toEqual({ export: "1" });
  });

  it("parses empty values", () => {
    expect(values("A=\nB=\"\"\nC=''\n")).toEqual({ A: "", B: "", C: "" });
  });

  it("handles quote styles", () => {
    const result = values("A=\"hello world\"\nB='it is literal \\n'\nC=`back tick`\n");
    expect(result).toEqual({ A: "hello world", B: "it is literal \\n", C: "back tick" });
  });

  it("expands escapes only in double quotes", () => {
    const result = values('A="line1\\nline2 \\"quoted\\""\nB=\'x\\ny\'\n');
    expect(result.A).toBe('line1\nline2 "quoted"');
    expect(result.B).toBe("x\\ny");
  });

  it("handles inline comments", () => {
    expect(values("A=1 # note\nB=a#b\nC=#all comment\nD=\"x # y\" # trailing\n")).toEqual({
      A: "1",
      B: "a#b",
      C: "",
      D: "x # y",
    });
  });

  it("handles multiline quoted values and keeps line numbers correct", () => {
    const { entries, problems } = parseEnv('KEY="-----BEGIN-----\nbody\n-----END-----"\nNEXT=1\n');
    expect(problems).toEqual([]);
    expect(entries[0]?.value).toBe("-----BEGIN-----\nbody\n-----END-----");
    expect(entries[0]?.line).toBe(1);
    expect(entries[1]).toMatchObject({ key: "NEXT", line: 4 });
  });

  it("handles CRLF line endings and a BOM", () => {
    const { entries } = parseEnv("\uFEFFA=1\r\nB=2\r\n");
    expect(entries.map((e) => [e.key, e.value, e.line])).toEqual([
      ["A", "1", 1],
      ["B", "2", 2],
    ]);
  });

  it("keeps duplicate declarations", () => {
    const { entries } = parseEnv("A=1\nA=2\n");
    expect(entries.map((e) => [e.key, e.value, e.line])).toEqual([
      ["A", "1", 1],
      ["A", "2", 2],
    ]);
  });

  it("reports malformed lines by line number only", () => {
    const { entries, problems } = parseEnv("A=1\nthis is not valid\nB=2\n");
    expect(entries.map((e) => e.key)).toEqual(["A", "B"]);
    expect(problems).toEqual([{ kind: "malformed-line", line: 2 }]);
  });

  it("treats NAME==... as malformed so pasted base64 padding is never recorded as a variable", () => {
    const { entries, problems } = parseEnv("A=1\nQUJDREVGR0g==\nB=2\n");
    expect(entries.map((e) => e.key)).toEqual(["A", "B"]);
    expect(problems).toEqual([{ kind: "malformed-line", line: 2 }]);
  });

  it("still allows = inside values", () => {
    expect(values("A=b64value==\nB=x=y\nC=\"=\"\n")).toEqual({ A: "b64value==", B: "x=y", C: "=" });
  });

  it("reports unterminated quotes but still records the variable", () => {
    const { entries, problems } = parseEnv('A="never closed\n');
    expect(problems).toEqual([{ kind: "unterminated-quote", line: 1 }]);
    expect(entries[0]?.key).toBe("A");
  });

  it("handles files without a trailing newline and empty input", () => {
    expect(values("A=1")).toEqual({ A: "1" });
    expect(parseEnv("")).toEqual({ entries: [], problems: [] });
  });
});
