import { describe, expect, expectTypeOf, it } from "vitest";
import { assertEnv, defineSchema, EnvValidationError, validateEnv } from "../../src";
import type { Schema } from "../../src";

const codes = (schema: Schema, env: Record<string, string | undefined>) =>
  validateEnv(schema, env).errors.map((e) => `${e.variable}:${e.code}`);

describe("validateEnv", () => {
  it("validates the example schema from the specification", () => {
    const schema: Schema = {
      DATABASE_URL: { type: "url", required: true },
      PORT: { type: "number", required: false, default: 3000 },
      NODE_ENV: { type: "enum", values: ["development", "production", "test"], required: true },
      JWT_SECRET: { type: "string", required: true, minLength: 32, secret: true },
    };
    const good = validateEnv(schema, {
      DATABASE_URL: "postgresql://localhost:5432/app",
      NODE_ENV: "production",
      JWT_SECRET: "x".repeat(32),
    });
    expect(good.success).toBe(true);
    expect(good.values).toEqual({
      DATABASE_URL: "postgresql://localhost:5432/app",
      PORT: 3000,
      NODE_ENV: "production",
      JWT_SECRET: "x".repeat(32),
    });

    expect(codes(schema, { DATABASE_URL: "nope", NODE_ENV: "staging", JWT_SECRET: "short" })).toEqual([
      "DATABASE_URL:invalid-type",
      "NODE_ENV:invalid-enum",
      "JWT_SECRET:too-short",
    ]);
  });

  it("requires variables by default, but not when they have a default", () => {
    expect(codes({ A: { type: "string" } }, {})).toEqual(["A:missing-required"]);
    expect(codes({ A: { type: "string", default: "x" } }, {})).toEqual([]);
    expect(codes({ A: { type: "string", required: false } }, {})).toEqual([]);
  });

  it("treats empty values as missing", () => {
    expect(codes({ A: { type: "string" } }, { A: "" })).toEqual(["A:missing-required"]);
    expect(validateEnv({ A: { type: "number", default: 5 } }, { A: "" }).values.A).toBe(5);
    expect(validateEnv({ A: { type: "number", required: false } }, { A: "" }).values).toEqual({});
  });

  it("validates numbers and integers with ranges", () => {
    const schema: Schema = { N: { type: "number", min: 1, max: 10 }, I: { type: "integer" } };
    expect(validateEnv(schema, { N: "5.5", I: "-3" }).values).toEqual({ N: 5.5, I: -3 });
    expect(codes(schema, { N: "abc", I: "1.5" })).toEqual(["N:invalid-type", "I:invalid-type"]);
    expect(codes(schema, { N: "0", I: "1" })).toEqual(["N:out-of-range"]);
    expect(codes(schema, { N: "11", I: "1" })).toEqual(["N:out-of-range"]);
    expect(codes(schema, { N: "Infinity", I: "1" })).toEqual(["N:invalid-type"]);
    expect(codes(schema, { N: " ", I: "9007199254740993" })).toEqual(["N:invalid-type", "I:invalid-type"]);
  });

  it("validates booleans", () => {
    const schema: Schema = { B: { type: "boolean" } };
    for (const [raw, expected] of [["true", true], ["1", true], ["YES", true], ["on", true], ["false", false], ["0", false], ["No", false], ["off", false]] as const) {
      expect(validateEnv(schema, { B: raw }).values.B).toBe(expected);
    }
    expect(codes(schema, { B: "maybe" })).toEqual(["B:invalid-type"]);
  });

  it("validates urls and protocols", () => {
    const schema: Schema = { U: { type: "url", protocols: ["https"] } };
    expect(codes(schema, { U: "https://example.com" })).toEqual([]);
    expect(codes(schema, { U: "http://example.com" })).toEqual(["U:invalid-protocol"]);
    expect(codes(schema, { U: "not a url" })).toEqual(["U:invalid-type"]);
  });

  it("validates emails", () => {
    const schema: Schema = { E: { type: "email" } };
    expect(codes(schema, { E: "a@b.co" })).toEqual([]);
    for (const bad of ["a@b", "a b@c.d", "@c.d", "plain"]) expect(codes(schema, { E: bad }), bad).toEqual(["E:invalid-type"]);
  });

  it("validates string length and pattern", () => {
    const schema: Schema = { S: { type: "string", minLength: 2, maxLength: 4, pattern: "^[a-z]+$" } };
    expect(codes(schema, { S: "abc" })).toEqual([]);
    expect(codes(schema, { S: "a" })).toEqual(["S:too-short"]);
    expect(codes(schema, { S: "abcde" })).toEqual(["S:too-long"]);
    expect(codes(schema, { S: "ab1" })).toEqual(["S:pattern-mismatch"]);
  });

  it("supports custom validators", () => {
    const schema: Schema = {
      EVEN: { type: "custom", validate: (v) => Number(v) % 2 === 0 },
      MSG: { type: "custom", validate: (v) => (v === "ok" ? true : "MSG must be exactly ok") },
      THROWS: { type: "custom", validate: () => { throw new Error("secret-value-in-error"); } },
      VOID: { type: "custom", validate: () => undefined },
    };
    const result = validateEnv(schema, { EVEN: "3", MSG: "nope", THROWS: "x", VOID: "x" });
    expect(result.errors.map((e) => e.variable)).toEqual(["EVEN", "MSG", "THROWS"]);
    expect(result.errors[1]?.message).toBe("MSG must be exactly ok");
    expect(JSON.stringify(result.errors)).not.toContain("secret-value-in-error");
  });

  it("never includes values in messages", () => {
    const schema: Schema = {
      A: { type: "number" },
      B: { type: "enum", values: ["x"] },
      C: { type: "url" },
      D: { type: "string", minLength: 50 },
      E: { type: "boolean" },
    };
    const marker = "SECRET_MARKER_value";
    const result = validateEnv(schema, { A: marker, B: marker, C: marker, D: marker, E: marker });
    expect(result.errors).toHaveLength(5);
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("ignores variables that are not in the schema", () => {
    expect(validateEnv({ A: { type: "string" } }, { A: "x", OTHER: "y" }).values).toEqual({ A: "x" });
  });

  it("reads process.env by default", () => {
    process.env.ENV_DOCTOR_TEST_VAR = "42";
    try {
      expect(validateEnv({ ENV_DOCTOR_TEST_VAR: { type: "integer" } }).values.ENV_DOCTOR_TEST_VAR).toBe(42);
    } finally {
      delete process.env.ENV_DOCTOR_TEST_VAR;
    }
  });
});

describe("assertEnv", () => {
  const schema = defineSchema({
    PORT: { type: "number", required: false, default: 3000 },
    DEBUG: { type: "boolean", required: false },
    NAME: { type: "string" },
    MODE: { type: "enum", values: ["a", "b"] as const },
  });

  it("returns typed values", () => {
    const env = assertEnv(schema, { NAME: "app", MODE: "a", DEBUG: "yes" });
    expect(env).toEqual({ PORT: 3000, DEBUG: true, NAME: "app", MODE: "a" });
    expectTypeOf(env.PORT).toEqualTypeOf<number>();
    expectTypeOf(env.DEBUG).toEqualTypeOf<boolean | undefined>();
    expectTypeOf(env.NAME).toEqualTypeOf<string>();
  });

  it("throws one error listing every problem without values", () => {
    try {
      assertEnv(schema, { NAME: "", MODE: "SECRET_MARKER_bad" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const typed = error as EnvValidationError;
      expect(typed.errors.map((e) => e.variable)).toEqual(["NAME", "MODE"]);
      expect(typed.message).toContain("NAME is required");
      expect(typed.message).not.toContain("SECRET_MARKER_bad");
    }
  });
});
