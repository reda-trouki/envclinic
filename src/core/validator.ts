import type { Schema, SchemaField } from "../types";

export interface ValidationIssue {
  variable: string;
  code:
    | "missing-required"
    | "invalid-type"
    | "invalid-enum"
    | "invalid-protocol"
    | "too-short"
    | "too-long"
    | "out-of-range"
    | "pattern-mismatch"
    | "custom-failed";
  /** Describes the problem without ever including the value. */
  message: string;
}

export interface ValidationResult {
  success: boolean;
  /** Parsed values with defaults applied. Optional variables without a value are omitted. */
  values: Record<string, string | number | boolean>;
  errors: ValidationIssue[];
}

type Env = Record<string, string | undefined>;

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function isRequired(field: SchemaField): boolean {
  return field.required ?? field.default === undefined;
}

function parseOne(
  name: string,
  field: SchemaField,
  raw: string,
): { value: string | number | boolean } | { error: ValidationIssue } {
  const fail = (code: ValidationIssue["code"], message: string) => ({ error: { variable: name, code, message } });

  switch (field.type) {
    case "string": {
      if (field.minLength !== undefined && raw.length < field.minLength) {
        return fail("too-short", `${name} must be at least ${field.minLength} characters long`);
      }
      if (field.maxLength !== undefined && raw.length > field.maxLength) {
        return fail("too-long", `${name} must be at most ${field.maxLength} characters long`);
      }
      if (field.pattern !== undefined && !new RegExp(field.pattern).test(raw)) {
        return fail("pattern-mismatch", `${name} does not match the required pattern`);
      }
      return { value: raw };
    }
    case "number":
    case "integer": {
      const text = raw.trim();
      const integer = field.type === "integer";
      const valid = integer ? /^[+-]?\d+$/.test(text) : text !== "" && Number.isFinite(Number(text));
      const number = Number(text);
      if (!valid || (integer && !Number.isSafeInteger(number))) {
        return fail("invalid-type", `${name} must be ${integer ? "an integer" : "a number"}`);
      }
      if (field.min !== undefined && number < field.min) {
        return fail("out-of-range", `${name} must be at least ${field.min}`);
      }
      if (field.max !== undefined && number > field.max) {
        return fail("out-of-range", `${name} must be at most ${field.max}`);
      }
      return { value: number };
    }
    case "boolean": {
      const lowered = raw.trim().toLowerCase();
      if (TRUE_VALUES.has(lowered)) return { value: true };
      if (FALSE_VALUES.has(lowered)) return { value: false };
      return fail("invalid-type", `${name} must be a boolean (true, false, 1, 0, yes, no, on or off)`);
    }
    case "url": {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return fail("invalid-type", `${name} must be a valid URL`);
      }
      if (field.protocols !== undefined) {
        const protocol = url.protocol.replace(/:$/, "").toLowerCase();
        if (!field.protocols.map((p) => p.toLowerCase()).includes(protocol)) {
          return fail("invalid-protocol", `${name} must use one of these protocols: ${field.protocols.join(", ")}`);
        }
      }
      return { value: raw };
    }
    case "email":
      return EMAIL.test(raw) ? { value: raw } : fail("invalid-type", `${name} must be a valid email address`);
    case "enum": {
      const values = field.values ?? [];
      return values.includes(raw)
        ? { value: raw }
        : fail("invalid-enum", `${name} must be one of: ${values.join(", ")}`);
    }
    case "custom": {
      let outcome: boolean | string | void;
      try {
        outcome = field.validate?.(raw);
      } catch {
        return fail("custom-failed", `${name} failed custom validation`);
      }
      if (outcome === undefined || outcome === true) return { value: raw };
      return fail("custom-failed", typeof outcome === "string" && outcome !== "" ? outcome : `${name} failed custom validation`);
    }
  }
}

/**
 * Validate environment values against a schema.
 *
 * Messages never contain the offending value. An empty value is treated the
 * same as a missing one. Variables not mentioned in the schema are ignored.
 */
export function validateEnv(schema: Schema, env: Env = process.env): ValidationResult {
  const values: ValidationResult["values"] = {};
  const errors: ValidationIssue[] = [];

  for (const [name, field] of Object.entries(schema)) {
    const raw = env[name];
    if (raw === undefined || raw === "") {
      if (field.default !== undefined) {
        values[name] = field.default;
      } else if (isRequired(field)) {
        errors.push({ variable: name, code: "missing-required", message: `${name} is required but not set` });
      }
      continue;
    }
    const parsed = parseOne(name, field, raw);
    if ("error" in parsed) errors.push(parsed.error);
    else values[name] = parsed.value;
  }
  return { success: errors.length === 0, values, errors };
}

export class EnvValidationError extends Error {
  readonly errors: ValidationIssue[];

  constructor(errors: ValidationIssue[]) {
    super(`Invalid environment variables:\n${errors.map((e) => `  - ${e.message}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.errors = errors;
  }
}

type FieldValue<F extends SchemaField> = F["type"] extends "number" | "integer"
  ? number
  : F["type"] extends "boolean"
    ? boolean
    : F extends { values: readonly (infer V)[] }
      ? V
      : string;

/** The typed result of validating a schema. Optional variables without a default may be undefined. */
export type InferEnv<S extends Schema> = {
  [K in keyof S]: S[K] extends { required: false }
    ? S[K] extends { default: string | number | boolean }
      ? FieldValue<S[K]>
      : FieldValue<S[K]> | undefined
    : FieldValue<S[K]>;
};

/** Identity helper that preserves literal types so `assertEnv` can infer a precise result. */
export function defineSchema<S extends Schema>(schema: S): S {
  return schema;
}

/**
 * Validate at application startup and return typed values, or throw an
 * EnvValidationError that lists every problem (without values).
 */
export function assertEnv<S extends Schema>(schema: S, env: Env = process.env): InferEnv<S> {
  const result = validateEnv(schema, env);
  if (!result.success) throw new EnvValidationError(result.errors);
  return result.values as InferEnv<S>;
}
