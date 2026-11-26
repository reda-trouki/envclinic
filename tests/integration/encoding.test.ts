import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { audit } from "../../src";
import { decodeText } from "../../src/core/files";
import { run } from "../../src/cli/run";
import { captureIO, makeProject } from "../helpers";

const utf16le = (text: string, bom = true) => Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(text, "utf16le")]);
const utf16be = (text: string, bom = true) => {
  const body = Buffer.from(Buffer.from(text, "utf16le")).swap16();
  return Buffer.concat([bom ? Buffer.from([0xfe, 0xff]) : Buffer.alloc(0), body]);
};

const ENV = "DATABASE_URL=postgres://localhost/app\r\nPORT=3000\r\n";
const EXAMPLE = "DATABASE_URL=\r\nPORT=\r\nREDIS_URL=\r\n";

describe("decodeText", () => {
  it("decodes every common encoding", () => {
    expect(decodeText(utf16le(ENV))).toEqual({ text: ENV, encoding: "utf-16le" });
    expect(decodeText(utf16be(ENV))).toEqual({ text: ENV, encoding: "utf-16be" });
    expect(decodeText(utf16le(ENV, false)).encoding).toBe("utf-16le");
    expect(decodeText(utf16be(ENV, false)).encoding).toBe("utf-16be");
    expect(decodeText(Buffer.from(ENV)).encoding).toBe("utf-8");
    expect(decodeText(Buffer.from("﻿A=1\n")).encoding).toBe("utf-8");
    expect(decodeText(Buffer.alloc(0)).encoding).toBe("utf-8");
  });
});

describe("UTF-16 env files", () => {
  it("are read correctly and reported with a warning", async () => {
    const cwd = makeProject();
    writeFileSync(path.join(cwd, ".env"), utf16le(ENV));
    writeFileSync(path.join(cwd, ".env.example"), utf16le(EXAMPLE));
    const result = await audit({ cwd, checks: ["files"] });
    const codes = result.issues.map((i) => i.code);

    expect(result.files.map((f) => f.variables)).toEqual([2, 3]);
    expect(codes).not.toContain("malformed-line");
    expect(codes).not.toContain("invalid-variable-name");
    expect(codes.filter((c) => c === "non-utf8-file")).toHaveLength(2);
    expect(result.issues.filter((i) => i.code === "missing-variable").map((i) => i.variable)).toEqual(["REDIS_URL"]);
  });

  it("never leak values in the warning", async () => {
    const cwd = makeProject();
    writeFileSync(path.join(cwd, ".env"), utf16le("MRK_SECRET_VALUE_1=zzMARKERzz\n"));
    const result = await audit({ cwd, checks: ["files"] });
    expect(JSON.stringify(result)).not.toContain("zzMARKERzz");
  });

  it("UTF-8 files do not get the warning", async () => {
    const cwd = makeProject({ ".env": "﻿A=1\r\n", ".env.example": "A=\n" });
    const result = await audit({ cwd, checks: ["files"] });
    expect(result.issues.map((i) => i.code)).not.toContain("non-utf8-file");
  });

  it("generate merges into a UTF-16 example without mangling it", async () => {
    const cwd = makeProject();
    writeFileSync(path.join(cwd, ".env"), "A=1\nB=2\n");
    writeFileSync(path.join(cwd, ".env.example"), utf16le("# my note\nA=\n"));
    const io = captureIO();
    const code = await run(["generate", "--cwd", cwd, "--merge"], io);
    expect(code).toBe(0);
    const text = readFileSync(path.join(cwd, ".env.example"), "utf8");
    expect(text).not.toContain("\u0000");
    expect(text).toContain("# my note");
    expect(text).toContain("B=");
  });
});
