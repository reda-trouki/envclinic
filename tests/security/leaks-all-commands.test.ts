import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/run";
import { captureIO, makeProject } from "../helpers";

// Markers are embedded in values of every kind that the tool inspects.
const MARKERS = [
  "SECRETMARKERstripe0123456789",
  "SECRET_MARKER_url_password",
  "SECRET_MARKER_bad_port",
  "MRK_weak_1",
  "SECRET_MARKER_public_value",
  "SECRET_MARKER_example_value",
  "SECRETMARKERgithub" + "a".repeat(18),
  "SECRET_MARKER_bad_enum",
];

function projectWithEverything(): string {
  const cwd = makeProject({
    "package.json": '{"dependencies":{"next":"14"}}',
    ".env": [
      `STRIPE_KEY=sk_live_${MARKERS[0]}`,
      `DATABASE_URL=postgresql://admin:${MARKERS[1]}@db.internal:5432/app`,
      `PORT=${MARKERS[2]}`,
      `JWT_SECRET=${MARKERS[3]}`,
      `NEXT_PUBLIC_API_SECRET=${MARKERS[4]}`,
      `MODE=${MARKERS[7]}`,
      "UNUSED_ONE=1",
    ].join("\n"),
    ".env.example": `STRIPE_KEY=\nDB_PASSWORD=${MARKERS[5]}\nPORT=\nREDIS_URL=\n`,
    "src/a.ts": `const t = "ghp_${MARKERS[6]}";\nprocess.env.STRIPE_KEY;\nprocess.env.UNDECLARED;\n`,
    "envclinic.config.json": JSON.stringify({
      schema: {
        PORT: { type: "number" },
        MODE: { type: "enum", values: ["a", "b"] },
        REDIS_URL: { type: "url" },
      },
      types: { enabled: true },
    }),
  });
  mkdirSync(path.join(cwd, ".git"));
  return cwd;
}

const COMMANDS: string[][] = [
  [],
  ["--json"],
  ["--format", "github"],
  ["--verbose"],
  ["--quiet"],
  ["audit", "--strict", "--ci"],
  ["check", "--json"],
  ["secrets"],
  ["secrets", "--json"],
  ["unused", "--json"],
  ["validate"],
  ["validate", "--json"],
  ["generate", "--dry-run"],
  ["types", "--dry-run"],
  ["types", "--check"],
  ["framework", "--json"],
  ["audit", "--fix", "--dry-run"],
];

describe("no command ever prints a value", () => {
  it.each(COMMANDS)("envclinic %s", async (...args) => {
    const cwd = projectWithEverything();
    for (const color of [false, true]) {
      const io = captureIO({ color, env: { GITHUB_ACTIONS: "true" } });
      await run(["--cwd", cwd, ...args], io);
      const output = io.stdout() + io.stderr();
      // A merge dry-run prints the user's existing template back, which is their own file content.
      const checked =
        args[0] === "generate"
          ? MARKERS.filter((m) => m !== MARKERS[5])
          : MARKERS;
      for (const marker of checked)
        expect(output, `leaked ${marker}`).not.toContain(marker);
    }
  });

  it("the scenario really produces findings of every sensitive kind", async () => {
    const io = captureIO();
    await run(["--cwd", projectWithEverything(), "--json"], io);
    const codes = new Set(
      JSON.parse(io.stdout()).issues.map((i: { code: string }) => i.code),
    );
    for (const expected of [
      "exposed-credential",
      "weak-secret",
      "public-secret",
      "secret-in-example",
      "env-file-not-ignored",
      "schema-invalid-type",
      "schema-invalid-enum",
      "unused-variable",
      "undeclared-variable",
      "types-missing",
    ]) {
      expect(codes, expected).toContain(expected);
    }
  });

  it("files written by generate, types and --fix contain no values", async () => {
    const cwd = projectWithEverything();
    await run(["--cwd", cwd, "generate", "--merge"], captureIO());
    await run(["--cwd", cwd, "types"], captureIO());
    await run(["--cwd", cwd, "audit", "--fix", "--yes"], captureIO());
    for (const file of [".env.example", "env.d.ts"]) {
      const content = readFileSync(path.join(cwd, file), "utf8");
      for (const marker of MARKERS.filter((m) => m !== MARKERS[5]))
        expect(content, `${file} leaked ${marker}`).not.toContain(marker);
    }
    // The pre-existing template value is the user's own content; merging must not copy new values.
    expect(readFileSync(path.join(cwd, "env.d.ts"), "utf8")).not.toContain(
      MARKERS[5] as string,
    );
  });

  it("failures do not print values either", async () => {
    const cwd = makeProject({
      ".env": `A=${MARKERS[3]}\n`,
      "envclinic.config.json": '{"schema":{"A":{"type":"enum"}}}',
    });
    for (const args of [
      [],
      ["--json"],
      ["validate"],
      ["generate", "--output", ".env"],
      ["types", "--output", "../x"],
    ]) {
      const io = captureIO();
      expect(await run(["--cwd", cwd, ...args], io)).toBe(2);
      expect(io.stdout() + io.stderr()).not.toContain(MARKERS[3] as string);
    }
  });
});
