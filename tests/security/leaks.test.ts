import path from "node:path";
import { describe, expect, it } from "vitest";
import { audit } from "../../src";
import { run } from "../../src/cli/run";
import { captureIO, makeProject } from "../helpers";

// Distinctive markers that must never appear in any output.
const SECRETS = [
  "SECRET_MARKER_password_hunter2",
  "SECRET_MARKER_token_abcdef123456",
  "SECRET_MARKER_pem_body_MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
  "SECRET_MARKER_quoted_value",
  "SECRET_MARKER_dup_first",
  "SECRET_MARKER_dup_second",
  "SECRET_MARKER_malformed_line",
  "SECRET_MARKER_unterminated",
  "SECRET_MARKER_badname_value",
  "SECRET_MARKER_empty_neighbour",
];

const files = {
  ".env": [
    "DATABASE_URL=postgresql://admin:SECRET_MARKER_password_hunter2@db.internal:5432/app",
    "API_TOKEN=SECRET_MARKER_token_abcdef123456",
    'QUOTED="SECRET_MARKER_quoted_value"',
    "DUP=SECRET_MARKER_dup_first",
    "DUP=SECRET_MARKER_dup_second",
    // Pasted PEM body lines: one parses as a "variable" because of base64 padding.
    "SECRET_MARKER_pem_body_MIIEvQIBADANBgkqhkiG9w0BAQEFAASC==",
    "SECRET_MARKER_malformed_line without equals sign",
    'UNTERMINATED="SECRET_MARKER_unterminated',
    "bad-name=SECRET_MARKER_badname_value",
    "EMPTY=",
    "UNDOCUMENTED=SECRET_MARKER_empty_neighbour",
  ].join("\n"),
  ".env.example": "DATABASE_URL=\nAPI_TOKEN=\nQUOTED=\nDUP=\nREDIS_URL=\n",
};

function assertNoSecrets(output: string): void {
  for (const secret of SECRETS) {
    expect(output, `output leaked ${secret}`).not.toContain(secret);
  }
}

describe("secret values never leak", () => {
  it("audit() results contain no values", async () => {
    const cwd = makeProject(files);
    const result = await audit({ cwd, strict: true });
    expect(result.issues.length).toBeGreaterThan(5); // the scenario really triggers many issue kinds
    assertNoSecrets(JSON.stringify(result));
  });

  it("terminal output (normal, quiet, colored) contains no values", async () => {
    const cwd = makeProject(files);
    for (const args of [[], ["--quiet"], ["--verbose"], ["--strict"]]) {
      const io = captureIO(true);
      await run(["--cwd", cwd, ...args], io);
      assertNoSecrets(io.stdout());
      assertNoSecrets(io.stderr());
    }
  });

  it("JSON output contains no values", async () => {
    const cwd = makeProject(files);
    const io = captureIO();
    await run(["--cwd", cwd, "--json"], io);
    assertNoSecrets(io.stdout());
    assertNoSecrets(io.stderr());
  });

  it("issues expose only a fixed set of non-value fields", async () => {
    const cwd = makeProject(files);
    const result = await audit({ cwd });
    const allowed = new Set([
      "code",
      "severity",
      "message",
      "file",
      "variable",
      "line",
      "recommendation",
    ]);
    for (const issue of result.issues) {
      for (const key of Object.keys(issue)) expect(allowed.has(key)).toBe(true);
    }
  });

  it("errors from the CLI do not contain env values", async () => {
    const cwd = makeProject({
      ...files,
      "envclinic.config.json": "{ broken",
    });
    const io = captureIO();
    expect(await run(["--cwd", cwd], io)).toBe(2);
    assertNoSecrets(io.stdout() + io.stderr());
  });

  it("refuses files outside the project instead of reading them", async () => {
    const outside = makeProject({
      "outside.env": "OUTSIDE=SECRET_MARKER_token_abcdef123456\n",
    });
    const cwd = makeProject({ ".env.example": "A=\n" });
    const relative = path.relative(cwd, path.join(outside, "outside.env"));
    const result = await audit({ cwd, files: [relative] });
    expect(result.issues[0]?.code).toBe("unsafe-path");
    assertNoSecrets(JSON.stringify(result));
  });
});
