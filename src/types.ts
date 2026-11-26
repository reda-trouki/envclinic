export type Severity = "error" | "warning" | "info";

/** Configurable severity for a rule. `off` disables the rule entirely. */
export type RuleLevel = "error" | "warning" | "off";

export type RuleName =
  | "missing"
  | "undocumented"
  | "empty"
  | "duplicates"
  | "names"
  | "syntax"
  | "unused"
  | "undeclared"
  | "secrets"
  | "weak"
  | "validation"
  | "types";

export type FrameworkId = "nextjs" | "vite" | "astro" | "nestjs" | "express" | "react" | "node";

/** The individual checks `audit` is made of. Other commands run subsets. */
export type AuditCheck = "files" | "unused" | "secrets" | "validation" | "types";

// --- Schema (validation) ---------------------------------------------------

export type SchemaType =
  | "string"
  | "number"
  | "boolean"
  | "url"
  | "email"
  | "enum"
  | "integer"
  | "custom";

/**
 * Custom validator. Return `true` (or nothing) for valid, `false` for invalid,
 * or a string describing why the value is invalid. The message must not
 * contain the value itself.
 */
export type CustomValidator = (value: string) => boolean | string | void;

export interface SchemaField {
  type: SchemaType;
  /** Defaults to true, unless a `default` is given. An empty value counts as missing. */
  required?: boolean;
  /** Used when the variable is missing or empty. Never written to generated files for secrets. */
  default?: string | number | boolean;
  description?: string;
  /** Marks the variable as sensitive: its default is never printed or generated. */
  secret?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  /** Regular expression source the value must match (string type). */
  pattern?: string;
  /** Allowed values (enum type). */
  values?: readonly string[];
  /** Allowed URL protocols without the colon, for example ["http", "https"]. */
  protocols?: readonly string[];
  /** Required for the custom type. Only available in JavaScript config files. */
  validate?: CustomValidator;
}

export type Schema = Record<string, SchemaField>;

// --- Config ---------------------------------------------------------------

export interface CustomSecretPattern {
  id: string;
  description?: string;
  /** Regular expression source. */
  pattern: string;
  /** Default: "error". */
  severity?: "error" | "warning";
}

export interface EnvDoctorConfig {
  files?: {
    /** Env files to audit, relative to the project root. Default: [".env"] */
    source?: string[];
    /** The documented template file. Default: first of .env.example, .env.sample */
    example?: string;
  };
  scan?: {
    /** Directories to scan for source code, relative to the project root. Default: ["."] */
    directories?: string[];
    /** Extra directories or globs to ignore (added to the built-in list). */
    ignore?: string[];
    /** File extensions to scan, without the dot. */
    extensions?: string[];
  };
  rules?: Partial<Record<RuleName, RuleLevel>>;
  ignore?: {
    /** Variable names that never produce issues. `*` wildcards are supported. */
    variables?: string[];
  };
  secrets?: {
    /** Variable names exempt from secret checks. `*` wildcards are supported. */
    allow?: string[];
    /** Source files (globs, relative to the project root) skipped by secret scanning. */
    ignoreFiles?: string[];
    /** Extra patterns to look for in env values and source code. */
    patterns?: CustomSecretPattern[];
  };
  schema?: Schema;
  /** Force a framework instead of detecting it. */
  framework?: "auto" | FrameworkId;
  /** Prefixes whose variables are exposed to client bundles. Overrides the framework default. */
  publicPrefixes?: string[];
  types?: {
    /** When true, `audit` reports a missing or outdated types file. */
    enabled?: boolean;
    /** Default: "env.d.ts" */
    output?: string;
  };
  generate?: {
    /** Default: ".env.example" */
    output?: string;
    /** Variables never written to the generated file. `*` wildcards are supported. */
    exclude?: string[];
  };
}

export interface AuditOptions {
  /** Project root. Default: process.cwd() */
  cwd?: string;
  /** Config object. When given, no config file is loaded. */
  config?: EnvDoctorConfig;
  /** Explicit config file path (relative to cwd). */
  configPath?: string;
  /** Env files to audit. Overrides config; missing files are errors. */
  files?: string[];
  /** Example file. Overrides config; a missing file is an error. */
  example?: string;
  /** Extra variable names to ignore (merged with config). */
  ignore?: string[];
  /** Treat warnings as errors. */
  strict?: boolean;
  /** Which checks to run. Default: all. */
  checks?: AuditCheck[];
  /** Scan source code (unused variables, hardcoded credentials). Default: true. */
  scan?: boolean;
  /** Also scan source code for credentials. Default: true. Set false for env files only. */
  codeSecrets?: boolean;
  /** Override the directories to scan. */
  scanDirectories?: string[];
  /** Validate the real process environment too (it wins over env files). */
  processEnv?: boolean;
  /** Extra environment values to validate against the schema (wins over env files). */
  env?: Record<string, string | undefined>;
}

/**
 * An issue found by the audit.
 *
 * Issues intentionally have no field for variable *values*: they can only
 * ever carry names, file paths and line numbers, so values cannot leak into
 * terminal output, JSON output or logs.
 */
export interface AuditIssue {
  code: string;
  severity: Severity;
  message: string;
  file?: string;
  variable?: string;
  line?: number;
  recommendation?: string;
}

export interface AnalyzedFile {
  path: string;
  role: "source" | "example";
  variables: number;
}

export interface FrameworkSummary {
  id: FrameworkId;
  name: string;
  evidence: string[];
}

export interface AuditResult {
  /** True when there are no errors (after strict-mode escalation). */
  success: boolean;
  summary: {
    /** Environment files analyzed. */
    filesScanned: number;
    /** Source code files scanned for variable usage and credentials. */
    sourceFilesScanned: number;
    variablesFound: number;
    errors: number;
    warnings: number;
    infos: number;
  };
  files: AnalyzedFile[];
  issues: AuditIssue[];
  framework?: FrameworkSummary;
  /** Config file that was loaded, if any. */
  configFile?: string;
}

/** Issue as produced by an analyzer, before severity is resolved. */
export interface RawIssue {
  code: string;
  message: string;
  /**
   * Resolve severity from this rule's configured level. When `severity` is
   * also given it is the issue's natural severity and the rule level can only
   * lower it.
   */
  rule?: RuleName;
  /** Fixed severity for issues that are not governed by a rule. */
  severity?: Severity;
  file?: string;
  variable?: string;
  line?: number;
  recommendation?: string;
}
