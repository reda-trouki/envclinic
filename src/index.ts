export { audit } from "./core/auditor";
export { parseEnv } from "./core/parser";
export type { EnvEntry, ParsedEnv, ParseProblem, QuoteStyle } from "./core/parser";
export { defineConfig, ConfigError } from "./config/schema";
export { detectFramework } from "./frameworks/detector";
export type { FrameworkInfo } from "./frameworks/detector";
export { assertEnv, defineSchema, validateEnv, EnvValidationError } from "./core/validator";
export type { InferEnv, ValidationIssue, ValidationResult } from "./core/validator";
export type {
  AnalyzedFile,
  AuditCheck,
  AuditIssue,
  AuditOptions,
  AuditResult,
  CustomSecretPattern,
  CustomValidator,
  EnvDoctorConfig,
  FrameworkId,
  FrameworkSummary,
  RuleLevel,
  RuleName,
  Schema,
  SchemaField,
  SchemaType,
  Severity,
} from "./types";
