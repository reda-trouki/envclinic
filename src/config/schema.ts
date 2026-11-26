import type { EnvDoctorConfig, RuleLevel, RuleName, Schema, SchemaField, SchemaType } from "../types";
import { FRAMEWORK_IDS } from "../frameworks/detector";
import { DEFAULT_RULES } from "./defaults";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const TOP_LEVEL_KEYS = [
  "files", "scan", "rules", "ignore", "secrets", "schema", "framework", "publicPrefixes", "types", "generate",
];
const LEVELS: RuleLevel[] = ["error", "warning", "off"];
const SCHEMA_TYPES: SchemaType[] = ["string", "number", "boolean", "url", "email", "enum", "integer", "custom"];
const SCHEMA_FIELD_KEYS = [
  "type", "required", "default", "description", "secret", "minLength", "maxLength", "min", "max",
  "pattern", "values", "protocols", "validate",
];
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class Validator {
  constructor(private readonly origin: string) {}

  fail(message: string): never {
    throw new ConfigError(`Invalid config in ${this.origin}: ${message}`);
  }

  object(value: unknown, name: string): Record<string, unknown> {
    if (!isObject(value)) this.fail(`"${name}" must be an object.`);
    return value;
  }

  known(obj: Record<string, unknown>, allowed: string[], prefix: string): void {
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key)) {
        this.fail(`unknown option "${prefix}${key}". Allowed: ${allowed.map((k) => prefix + k).join(", ")}.`);
      }
    }
  }

  strings(value: unknown, name: string): string[] {
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v === "")) {
      this.fail(`"${name}" must be an array of non-empty strings.`);
    }
    return value as string[];
  }

  string(value: unknown, name: string): string {
    if (typeof value !== "string" || value === "") this.fail(`"${name}" must be a non-empty string.`);
    return value;
  }

  boolean(value: unknown, name: string): boolean {
    if (typeof value !== "boolean") this.fail(`"${name}" must be true or false.`);
    return value;
  }

  number(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) this.fail(`"${name}" must be a number.`);
    return value;
  }

  regex(value: unknown, name: string): string {
    const source = this.string(value, name);
    try {
      new RegExp(source);
    } catch {
      this.fail(`"${name}" is not a valid regular expression.`);
    }
    return source;
  }
}

function validateSchema(v: Validator, raw: unknown): Schema {
  const input = v.object(raw, "schema");
  const schema: Schema = {};

  for (const [name, entry] of Object.entries(input)) {
    const where = `schema.${name}`;
    if (!VARIABLE_NAME.test(name)) v.fail(`"${where}" is not a valid variable name.`);
    const obj = v.object(entry, where);
    v.known(obj, SCHEMA_FIELD_KEYS, `${where}.`);

    const type = obj.type;
    if (typeof type !== "string" || !SCHEMA_TYPES.includes(type as SchemaType)) {
      v.fail(`"${where}.type" must be one of ${SCHEMA_TYPES.map((t) => `"${t}"`).join(", ")}.`);
    }
    const field: SchemaField = { type: type as SchemaType };

    if (obj.required !== undefined) field.required = v.boolean(obj.required, `${where}.required`);
    if (obj.secret !== undefined) field.secret = v.boolean(obj.secret, `${where}.secret`);
    if (obj.description !== undefined) field.description = v.string(obj.description, `${where}.description`);
    for (const key of ["minLength", "maxLength", "min", "max"] as const) {
      if (obj[key] !== undefined) field[key] = v.number(obj[key], `${where}.${key}`);
    }
    if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) {
      v.fail(`"${where}.minLength" cannot be greater than "${where}.maxLength".`);
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      v.fail(`"${where}.min" cannot be greater than "${where}.max".`);
    }
    if (obj.pattern !== undefined) field.pattern = v.regex(obj.pattern, `${where}.pattern`);
    if (obj.protocols !== undefined) field.protocols = v.strings(obj.protocols, `${where}.protocols`);

    if (obj.values !== undefined) field.values = v.strings(obj.values, `${where}.values`);
    if (field.type === "enum" && (field.values === undefined || field.values.length === 0)) {
      v.fail(`"${where}.values" is required for enum variables and must not be empty.`);
    }

    if (obj.validate !== undefined) {
      if (typeof obj.validate !== "function") v.fail(`"${where}.validate" must be a function.`);
      field.validate = obj.validate as SchemaField["validate"];
    }
    if (field.type === "custom" && field.validate === undefined) {
      v.fail(`"${where}.validate" is required for custom variables (custom validators need a JavaScript config file).`);
    }

    if (obj.default !== undefined) {
      const d = obj.default;
      const expected = field.type === "number" || field.type === "integer" ? "number" : field.type === "boolean" ? "boolean" : "string";
      if (typeof d !== expected) v.fail(`"${where}.default" must be a ${expected} for ${field.type} variables.`);
      field.default = d as string | number | boolean;
    }
    schema[name] = field;
  }
  return schema;
}

/** Validate an untrusted config value and return it typed. Throws ConfigError. */
export function validateConfig(raw: unknown, origin: string): EnvDoctorConfig {
  const v = new Validator(origin);
  const input = v.object(raw, "config");
  v.known(input, TOP_LEVEL_KEYS, "");
  const config: EnvDoctorConfig = {};

  if (input.files !== undefined) {
    const files = v.object(input.files, "files");
    v.known(files, ["source", "example"], "files.");
    config.files = {};
    if (files.source !== undefined) config.files.source = v.strings(files.source, "files.source");
    if (files.example !== undefined) config.files.example = v.string(files.example, "files.example");
  }

  if (input.scan !== undefined) {
    const scan = v.object(input.scan, "scan");
    v.known(scan, ["directories", "ignore", "extensions"], "scan.");
    config.scan = {};
    if (scan.directories !== undefined) config.scan.directories = v.strings(scan.directories, "scan.directories");
    if (scan.ignore !== undefined) config.scan.ignore = v.strings(scan.ignore, "scan.ignore");
    if (scan.extensions !== undefined) {
      config.scan.extensions = v.strings(scan.extensions, "scan.extensions").map((e) => e.replace(/^\./, ""));
    }
  }

  if (input.rules !== undefined) {
    const rules = v.object(input.rules, "rules");
    v.known(rules, Object.keys(DEFAULT_RULES), "rules.");
    config.rules = {};
    for (const [name, level] of Object.entries(rules)) {
      if (typeof level !== "string" || !LEVELS.includes(level as RuleLevel)) {
        v.fail(`"rules.${name}" must be one of ${LEVELS.map((l) => `"${l}"`).join(", ")}.`);
      }
      config.rules[name as RuleName] = level as RuleLevel;
    }
  }

  if (input.ignore !== undefined) {
    const ignore = v.object(input.ignore, "ignore");
    v.known(ignore, ["variables"], "ignore.");
    config.ignore = {};
    if (ignore.variables !== undefined) config.ignore.variables = v.strings(ignore.variables, "ignore.variables");
  }

  if (input.secrets !== undefined) {
    const secrets = v.object(input.secrets, "secrets");
    v.known(secrets, ["allow", "ignoreFiles", "patterns"], "secrets.");
    config.secrets = {};
    if (secrets.allow !== undefined) config.secrets.allow = v.strings(secrets.allow, "secrets.allow");
    if (secrets.ignoreFiles !== undefined) config.secrets.ignoreFiles = v.strings(secrets.ignoreFiles, "secrets.ignoreFiles");
    if (secrets.patterns !== undefined) {
      const list: unknown = secrets.patterns;
      if (!Array.isArray(list)) return v.fail(`"secrets.patterns" must be an array.`);
      config.secrets.patterns = (list as unknown[]).map((entry, index) => {
        const where = `secrets.patterns[${index}]`;
        const obj = v.object(entry, where);
        v.known(obj, ["id", "description", "pattern", "severity"], `${where}.`);
        const pattern: NonNullable<NonNullable<EnvDoctorConfig["secrets"]>["patterns"]>[number] = {
          id: v.string(obj.id, `${where}.id`),
          pattern: v.regex(obj.pattern, `${where}.pattern`),
        };
        if (obj.description !== undefined) pattern.description = v.string(obj.description, `${where}.description`);
        if (obj.severity !== undefined) {
          const severity: unknown = obj.severity;
          if (severity !== "error" && severity !== "warning") {
            return v.fail(`"${where}.severity" must be "error" or "warning".`);
          }
          pattern.severity = severity;
        }
        return pattern;
      });
    }
  }

  if (input.schema !== undefined) config.schema = validateSchema(v, input.schema);

  if (input.framework !== undefined) {
    const allowed = ["auto", ...FRAMEWORK_IDS];
    if (typeof input.framework !== "string" || !allowed.includes(input.framework)) {
      v.fail(`"framework" must be one of ${allowed.map((f) => `"${f}"`).join(", ")}.`);
    }
    config.framework = input.framework as EnvDoctorConfig["framework"];
  }

  if (input.publicPrefixes !== undefined) {
    config.publicPrefixes = v.strings(input.publicPrefixes, "publicPrefixes");
  }

  if (input.types !== undefined) {
    const types = v.object(input.types, "types");
    v.known(types, ["enabled", "output"], "types.");
    config.types = {};
    if (types.enabled !== undefined) config.types.enabled = v.boolean(types.enabled, "types.enabled");
    if (types.output !== undefined) config.types.output = v.string(types.output, "types.output");
  }

  if (input.generate !== undefined) {
    const generate = v.object(input.generate, "generate");
    v.known(generate, ["output", "exclude"], "generate.");
    config.generate = {};
    if (generate.output !== undefined) config.generate.output = v.string(generate.output, "generate.output");
    if (generate.exclude !== undefined) config.generate.exclude = v.strings(generate.exclude, "generate.exclude");
  }

  return config;
}

/** Identity helper that gives config files type checking and autocomplete. */
export function defineConfig(config: EnvDoctorConfig): EnvDoctorConfig {
  return config;
}
