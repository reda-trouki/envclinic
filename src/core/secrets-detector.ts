import type { CustomSecretPattern } from "../types";

export interface SecretPattern {
  id: string;
  description: string;
  pattern: RegExp;
  /** Natural severity of a match before rule levels and file context are applied. */
  severity: "error" | "warning";
  /** Only match values of variables whose name matches (env files only). */
  name?: RegExp;
  /** Env files only: never applied to source code. */
  envOnly?: boolean;
}

export const BUILTIN_PATTERNS: SecretPattern[] = [
  {
    id: "aws-access-key-id",
    description: "AWS access key ID",
    pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/,
    severity: "error",
  },
  {
    id: "aws-secret-access-key",
    description: "AWS secret access key",
    pattern: /^[A-Za-z0-9/+=]{40}$/,
    name: /AWS_SECRET_ACCESS_KEY|AWS_SECRET_KEY/i,
    envOnly: true,
    severity: "error",
  },
  {
    id: "github-token",
    description: "GitHub token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
    severity: "error",
  },
  {
    id: "github-fine-grained-token",
    description: "GitHub fine-grained token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/,
    severity: "error",
  },
  {
    id: "slack-token",
    description: "Slack token",
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
    severity: "error",
  },
  {
    id: "stripe-secret-key",
    description: "Stripe secret key",
    pattern: /\b(?:sk|rk)_live_[0-9a-zA-Z]{16,}\b/,
    severity: "error",
  },
  {
    id: "google-api-key",
    description: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
    severity: "error",
  },
  {
    id: "private-key",
    description: "private key",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/,
    severity: "error",
  },
  {
    id: "sendgrid-api-key",
    description: "SendGrid API key",
    pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
    severity: "error",
  },
  {
    id: "npm-token",
    description: "npm access token",
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/,
    severity: "error",
  },
  {
    id: "anthropic-api-key",
    description: "Anthropic API key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
    severity: "error",
  },
  {
    id: "openai-api-key",
    description: "OpenAI API key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/,
    severity: "error",
  },
  {
    id: "twilio-api-key",
    description: "Twilio API key",
    pattern: /\bSK[0-9a-f]{32}\b/,
    severity: "error",
  },
  {
    id: "json-web-token",
    description: "JSON Web Token",
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    severity: "warning",
  },
  {
    id: "credentialed-url",
    description: "URL with embedded credentials",
    pattern:
      /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"`<>]+:([^\s@/'"`<>]+)@[^\s'"`<>]+/i,
    severity: "warning",
  },
];

/** Compile user-defined patterns. Invalid expressions are rejected by config validation. */
export function buildPatterns(
  custom: readonly CustomSecretPattern[] = [],
): SecretPattern[] {
  return [
    ...BUILTIN_PATTERNS,
    ...custom.map(
      (entry): SecretPattern => ({
        id: entry.id,
        description: entry.description ?? entry.id,
        pattern: new RegExp(entry.pattern),
        severity: entry.severity ?? "error",
      }),
    ),
  ];
}

const URL_PASSWORD_PLACEHOLDER =
  /^(?:pass(?:word)?|pwd|secret|changeme|change[-_]?me|example|xxx+|\*+|\.\.\.|<.*>|\$\{.*\}|\{\{.*\}\}|%.*%|your[-_ ].*|password\d*|postgres|root|admin|test|user|db|mysql)$/i;

/** True when a credentialed URL's password is clearly a placeholder. */
function isPlaceholderUrlPassword(value: string, pattern: RegExp): boolean {
  const match = pattern.exec(value);
  const password = match?.[1];
  return password === undefined || URL_PASSWORD_PLACEHOLDER.test(password);
}

/** Find the first pattern that matches an env variable's value. */
export function findValueMatch(
  value: string,
  name: string,
  patterns: readonly SecretPattern[],
): SecretPattern | undefined {
  for (const pattern of patterns) {
    if (pattern.name !== undefined && !pattern.name.test(name)) continue;
    if (!pattern.pattern.test(value)) continue;
    if (
      pattern.id === "credentialed-url" &&
      isPlaceholderUrlPassword(value, pattern.pattern)
    )
      continue;
    return pattern;
  }
  return undefined;
}

export interface TextMatch {
  pattern: SecretPattern;
  line: number;
}

const MAX_LINE_LENGTH = 10_000;
const SUPPRESS_COMMENT = "envclinic-ignore";

/**
 * Find credentials in source text. Only patterns that are meaningful without
 * a variable name are used. Matches are reported by line only; the matched
 * text is never returned. A line containing `envclinic-ignore` is skipped.
 */
export function scanTextForSecrets(
  content: string,
  patterns: readonly SecretPattern[],
): TextMatch[] {
  const usable = patterns.filter(
    (pattern) => !pattern.envOnly && pattern.name === undefined,
  );
  const matches: TextMatch[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.length > MAX_LINE_LENGTH || line.includes(SUPPRESS_COMMENT))
      continue;
    for (const pattern of usable) {
      if (!pattern.pattern.test(line)) continue;
      if (
        pattern.id === "credentialed-url" &&
        isPlaceholderUrlPassword(line, pattern.pattern)
      )
        continue;
      matches.push({ pattern, line: i + 1 });
    }
  }
  return matches;
}

// --- Name and value heuristics ----------------------------------------------

const SECRET_NAME =
  /(?:^|_)(?:SECRET|PASSWORD|PASSWD|PASSPHRASE|TOKEN|PRIVATE_KEY|API_KEY|APIKEY|ACCESS_KEY|SECRET_KEY|SIGNING_KEY|ENCRYPTION_KEY|AUTH_KEY|CREDENTIALS?)(?:_|$)/i;
const NOT_A_SECRET_SUFFIX =
  /_(?:URL|URI|PATH|FILE|DIR|ENABLED|ENDPOINT|HEADER|TTL|EXPIRES|EXPIRES_IN|EXPIRY|ALGORITHM|TYPE|NAME|ID|LENGTH|ROUNDS|COST|PREFIX|FORMAT|REGION|HOST|PORT)$/i;
const PUBLIC_NAME = /PUBLIC|PUBLISHABLE/i;

/** Does the variable name suggest a secret value? */
export function isSecretName(name: string): boolean {
  return (
    SECRET_NAME.test(name) &&
    !NOT_A_SECRET_SUFFIX.test(name) &&
    !PUBLIC_NAME.test(name)
  );
}

const PLACEHOLDER_EXACT =
  /^(?:secret|password|passwd|pass|admin|root|test|testing|changeme|change[-_ ]?me|default|example|token|key|none|null|undefined|todo|xxx+|\*+|1234\d*|abc\d*|qwerty|letmein|postgres|mysql|redis|dev|development)$/i;
const PLACEHOLDER_CONTAINS =
  /(?:change[-_ ]?me|your[-_ ]?(?:secret|key|token|password|api)|<[^>]+>|placeholder|replace[-_ ]?(?:me|this)|xxxxxx|dummy|\.\.\.)/i;
const BOOLEANISH = /^(?:true|false|yes|no|on|off)$/i;
const REFERENCE = /^\$\{.*\}$|^\$[A-Za-z_]\w*$/;

export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_EXACT.test(value) || PLACEHOLDER_CONTAINS.test(value);
}

export function isReferenceOrFlag(value: string): boolean {
  return REFERENCE.test(value) || BOOLEANISH.test(value);
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export const MIN_SECRET_LENGTH = 12;
export const MIN_SECRET_ENTROPY = 3;

/** Why a value is a weak secret, or undefined when it is acceptable. */
export function weakSecretReason(value: string): string | undefined {
  if (value === "" || isReferenceOrFlag(value)) return undefined;
  if (isPlaceholder(value)) return "looks like a placeholder or common default";
  if (value.length < MIN_SECRET_LENGTH)
    return `shorter than ${MIN_SECRET_LENGTH} characters`;
  if (shannonEntropy(value) < MIN_SECRET_ENTROPY) return "low entropy";
  return undefined;
}
