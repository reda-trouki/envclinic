import { promises as fs } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { displayPath, isInside } from "./files";
import { ConfigError } from "../config/schema";

export const DEFAULT_EXTENSIONS = [
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "mts",
  "cts",
  "vue",
  "svelte",
  "astro",
];

export const DEFAULT_SCAN_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".turbo",
  ".cache",
  ".vercel",
  ".netlify",
  ".parcel-cache",
  ".yarn",
  ".pnpm-store",
];

/** Source files larger than this are skipped (usually bundles or generated code). */
export const MAX_SOURCE_FILE_BYTES = 1024 * 1024;

export interface SourceLocation {
  file: string;
  line: number;
}

export interface ScanOptions {
  directories: string[];
  ignore: string[];
  extensions: string[];
}

export interface SourceFile {
  /** Path relative to the project root, with forward slashes. */
  path: string;
  content: string;
}

export interface ScanSummary {
  filesScanned: number;
  /** Files skipped because they were symlinks, too large or unreadable. */
  skipped: number;
}

function ignoreToGlob(entry: string): string {
  const cleaned = entry.replace(/^\.\//, "").replace(/\/+$/, "");
  if (/[*?]/.test(cleaned)) return cleaned;
  if (cleaned.includes("/")) return `${cleaned}/**`;
  return `**/${cleaned}/**`;
}

/** Find source files to scan. Never follows symlinks and never leaves the project root. */
export async function discoverSourceFiles(
  cwd: string,
  options: ScanOptions,
): Promise<string[]> {
  const realRoot = await fs.realpath(cwd);
  const extensions =
    options.extensions.length === 1
      ? options.extensions[0]
      : `{${options.extensions.join(",")}}`;
  const ignore = [
    ...DEFAULT_SCAN_IGNORE.map(ignoreToGlob),
    ...options.ignore.map(ignoreToGlob),
    "**/*.d.ts",
    "**/*.min.js",
    "**/envclinic.config.*",
  ];

  const found = new Set<string>();
  for (const directory of options.directories) {
    const absolute = path.resolve(cwd, directory);
    if (!isInside(cwd, absolute)) {
      throw new ConfigError(
        `scan.directories entry "${directory}" is outside the project directory.`,
      );
    }
    let real: string;
    try {
      real = await fs.realpath(absolute);
    } catch {
      continue; // a missing directory simply has nothing to scan
    }
    if (!isInside(realRoot, real)) continue;

    const relative = displayPath(cwd, absolute);
    const base = relative === "." ? "" : `${fg.escapePath(relative)}/`;
    const entries = await fg(`${base}**/*.${extensions}`, {
      cwd,
      ignore,
      onlyFiles: true,
      followSymbolicLinks: false,
      dot: false,
      unique: true,
    });
    for (const entry of entries) found.add(entry);
  }
  return [...found].sort();
}

/**
 * Read every source file once and pass it to `visit`. Symlinks, oversized
 * files and unreadable files are skipped.
 */
export async function scanSources(
  cwd: string,
  options: ScanOptions,
  visit: (file: SourceFile) => void,
): Promise<ScanSummary> {
  const files = await discoverSourceFiles(cwd, options);
  let filesScanned = 0;
  let skipped = 0;

  const BATCH = 64;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const loaded = await Promise.all(
      batch.map(async (relative) => {
        const absolute = path.join(cwd, relative);
        try {
          const stat = await fs.lstat(absolute);
          if (!stat.isFile() || stat.size > MAX_SOURCE_FILE_BYTES)
            return undefined;
          return {
            path: relative,
            content: await fs.readFile(absolute, "utf8"),
          };
        } catch {
          return undefined;
        }
      }),
    );
    for (const file of loaded) {
      if (file === undefined) {
        skipped++;
      } else {
        filesScanned++;
        visit(file);
      }
    }
  }
  return { filesScanned, skipped };
}

// --- Reference extraction --------------------------------------------------

export interface ExtractedReferences {
  /** Variables read with a literal name. */
  names: Array<{ name: string; line: number }>;
  /** Places where the variable name is not known statically. */
  dynamic: Array<{ line: number }>;
}

// Not preceded by an identifier character, nor by member access (`foo.process.env`),
// but spread syntax (`...process.env`) is fine.
const ENV_OBJECT =
  /(?<![\w$])(?<![\w$)\]]\s*\.)(?:process\.env|import\.meta\.env|Bun\.env)(?![\w$])/g;
const MEMBER = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/;
const BRACKET_LITERAL = /^\s*\??\.?\s*\[\s*(["'`])([A-Za-z_][\w]*)\1\s*\]/;
const BRACKET_ANY = /^\s*\??\.?\s*\[/;
const CAST_MEMBER = /^\s+as\s+[^)]*\)\s*\??\.\s*([A-Za-z_$][\w$]*)/;
const DENO_GET = /\bDeno\.env\.get\(\s*(["'`])([A-Za-z_]\w*)\1\s*\)/g;
const DESTRUCTURE = /\{([^{}]*)\}\s*=\s*$/;

/**
 * Find environment variable reads in source text.
 *
 * Recognizes `process.env.X`, `process.env["X"]`, `import.meta.env.X`,
 * `Bun.env.X`, `Deno.env.get("X")` and destructuring such as
 * `const { X, Y } = process.env`. Anything it cannot resolve to a literal name
 * (computed keys, aliases, spreading the whole object) is reported as dynamic.
 */
export function extractReferences(content: string): ExtractedReferences {
  const result: ExtractedReferences = { names: [], dynamic: [] };
  if (!/process\.env|import\.meta\.env|Bun\.env|Deno\.env/.test(content))
    return result;

  let lineStarts: number[] | undefined;
  const lineAt = (index: number): number => {
    if (lineStarts === undefined) {
      lineStarts = [0];
      for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10) lineStarts.push(i + 1);
      }
    }
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((lineStarts[mid] as number) <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };

  for (const match of content.matchAll(ENV_OBJECT)) {
    const start = match.index as number;
    const end = start + match[0].length;
    const rest = content.slice(end, end + 200);
    const line = lineAt(start);

    const member = MEMBER.exec(rest);
    if (member) {
      result.names.push({ name: member[1] as string, line });
      continue;
    }
    const literal = BRACKET_LITERAL.exec(rest);
    if (literal) {
      result.names.push({ name: literal[2] as string, line });
      continue;
    }
    if (BRACKET_ANY.test(rest)) {
      result.dynamic.push({ line });
      continue;
    }
    const cast = CAST_MEMBER.exec(rest);
    if (cast) {
      result.names.push({ name: cast[1] as string, line });
      continue;
    }

    const before = content.slice(Math.max(0, start - 1000), start);
    const destructure = DESTRUCTURE.exec(before);
    if (destructure) {
      let dynamic = false;
      for (const part of (destructure[1] as string).split(",")) {
        const piece = part.trim();
        if (piece === "") continue;
        if (piece.startsWith("...")) {
          dynamic = true;
          continue;
        }
        const name = /^([A-Za-z_$][\w$]*)/.exec(piece);
        if (name) result.names.push({ name: name[1] as string, line });
      }
      if (dynamic) result.dynamic.push({ line });
      continue;
    }

    // The whole object is used (aliased, spread, passed to a function...).
    result.dynamic.push({ line });
  }

  for (const match of content.matchAll(DENO_GET)) {
    result.names.push({
      name: match[2] as string,
      line: lineAt(match.index as number),
    });
  }
  return result;
}
