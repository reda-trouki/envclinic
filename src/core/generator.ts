import { parseEnv } from "./parser";
import type { VariableInfo } from "./variables";

const CATEGORIES = [
  "Database configuration",
  "Authentication",
  "External services",
  "Application",
  "Client-exposed variables",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

const DATABASE =
  /(DATABASE|(^|_)DB(_|$)|POSTGRES|MYSQL|MONGO|REDIS|SQLITE|PRISMA|PGHOST|PGUSER|PGPASSWORD|PGDATABASE|PGPORT)/i;
const AUTH = /(JWT|AUTH|SESSION|OAUTH|COOKIE|CSRF|SALT|BCRYPT|(^|_)SECRET$)/i;
const EXTERNAL =
  /(STRIPE|AWS|(^|_)S3(_|$)|SENDGRID|TWILIO|SMTP|MAIL|SENTRY|OPENAI|ANTHROPIC|GITHUB|GOOGLE|FIREBASE|CLOUDINARY|SLACK|DISCORD|PAYPAL|MAPBOX|ALGOLIA|DATADOG|VERCEL|NETLIFY|AZURE|GCP|(^|_)R2(_|$)|SUPABASE)/i;
const APPLICATION =
  /(^PORT$|HOST|NODE_ENV|^APP_|(^|_)URL$|ORIGIN|CORS|LOG|DEBUG|(^|_)ENV$)/i;

/** Group a variable for the generated template. */
export function categorize(
  name: string,
  publicPrefixes: readonly string[],
): Category {
  if (publicPrefixes.some((prefix) => name.startsWith(prefix)))
    return "Client-exposed variables";
  if (DATABASE.test(name)) return "Database configuration";
  if (AUTH.test(name)) return "Authentication";
  if (EXTERNAL.test(name)) return "External services";
  if (APPLICATION.test(name)) return "Application";
  return "Other";
}

/** Comment lines describing a variable, taken from the schema when there is one. */
function describe(info: VariableInfo): string[] {
  const field = info.schema;
  if (field === undefined) return [];
  const lines: string[] = [];
  if (field.description) lines.push(`# ${field.description}`);

  const facts: string[] = [
    field.type === "enum" && field.values
      ? `one of: ${field.values.join(", ")}`
      : field.type,
  ];
  facts.push(
    field.default !== undefined || field.required === false
      ? "optional"
      : "required",
  );
  // Defaults of secrets are never written out.
  if (field.default !== undefined && !field.secret)
    facts.push(`default: ${String(field.default)}`);
  lines.push(`# ${facts.join(", ")}`);
  return lines;
}

function renderVariable(info: VariableInfo): string[] {
  return [...describe(info), `${info.name}=`];
}

/** Render a fresh template. Values are always empty. */
export function renderExample(
  variables: readonly VariableInfo[],
  publicPrefixes: readonly string[],
): string {
  if (variables.length === 0) return "";
  const groups = new Map<Category, VariableInfo[]>();
  for (const info of variables) {
    const category = categorize(info.name, publicPrefixes);
    const list = groups.get(category);
    if (list) list.push(info);
    else groups.set(category, [info]);
  }

  const blocks: string[] = [];
  for (const category of CATEGORIES) {
    const list = groups.get(category);
    if (!list) continue;
    blocks.push([`# ${category}`, ...list.flatMap(renderVariable)].join("\n"));
  }
  return blocks.join("\n\n") + "\n";
}

export interface MergeResult {
  content: string;
  /** Names that were appended. */
  added: string[];
}

/**
 * Add variables that an existing template lacks, leaving everything already
 * in it (comments, order, values) untouched.
 */
export function renderMerge(
  existing: string,
  variables: readonly VariableInfo[],
): MergeResult {
  const present = new Set(parseEnv(existing).entries.map((entry) => entry.key));
  const missing = variables.filter((info) => !present.has(info.name));
  if (missing.length === 0) return { content: existing, added: [] };

  const base = existing.replace(/\s+$/, "");
  const addition = [
    "# Added by envclinic",
    ...missing.flatMap(renderVariable),
  ].join("\n");
  return {
    content: `${base}${base === "" ? "" : "\n\n"}${addition}\n`,
    added: missing.map((info) => info.name),
  };
}
