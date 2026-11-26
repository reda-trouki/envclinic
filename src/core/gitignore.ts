import { promises as fs } from "node:fs";
import path from "node:path";
import { globToRegexSource } from "./glob";

interface GitRule {
  negated: boolean;
  dirOnly: boolean;
  regex: RegExp;
}

/** Parse the lines of a .gitignore file into rules. */
export function parseGitignore(text: string): GitRule[] {
  const rules: GitRule[] = [];
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = rawLine.replace(/(?<!\\)\s+$/, "");
    if (line === "" || line.startsWith("#")) continue;

    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    } else if (line.startsWith("\\#") || line.startsWith("\\!")) {
      line = line.slice(1);
    }

    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (line === "") continue;

    const anchored = line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);

    const body = globToRegexSource(line);
    // A rule also matches everything inside a matched directory.
    const tail = dirOnly ? "/.*" : "(?:/.*)?";
    const head = anchored ? "^" : "^(?:.*/)?";
    rules.push({ negated, dirOnly, regex: new RegExp(`${head}${body}${tail}$`) });
  }
  return rules;
}

/** Last matching rule wins. Returns undefined when no rule matches. */
function evaluate(rules: GitRule[], relativePath: string): boolean | undefined {
  let result: boolean | undefined;
  for (const rule of rules) {
    if (rule.regex.test(relativePath)) result = !rule.negated;
  }
  return result;
}

async function findGitRoot(start: string): Promise<string | undefined> {
  let dir = start;
  for (;;) {
    try {
      await fs.stat(path.join(dir, ".git"));
      return dir;
    } catch {
      // keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

export type GitStatus = "ignored" | "not-ignored" | "no-repo";

export interface GitChecker {
  status(absoluteFile: string): Promise<GitStatus>;
}

/**
 * Create a checker that tells whether files are covered by .gitignore.
 *
 * Reads `.gitignore` files from the repository root down to the file's
 * directory, plus `.git/info/exclude`. It does not run git, and does not
 * consult global ignore files, so a file ignored only globally is reported as
 * not ignored.
 */
export function createGitChecker(cwd: string): GitChecker {
  let rootPromise: Promise<string | undefined> | undefined;
  const cache = new Map<string, Promise<GitRule[]>>();

  const rulesFor = (file: string): Promise<GitRule[]> => {
    let cached = cache.get(file);
    if (!cached) {
      cached = readIfExists(file).then((text) => (text === undefined ? [] : parseGitignore(text)));
      cache.set(file, cached);
    }
    return cached;
  };

  return {
    async status(absoluteFile) {
      rootPromise ??= findGitRoot(cwd);
      const root = await rootPromise;
      if (root === undefined) return "no-repo";

      const rel = path.relative(root, absoluteFile).split(path.sep).join("/");
      if (rel.startsWith("..")) return "no-repo";

      let ignored: boolean | undefined;
      const exclude = evaluate(await rulesFor(path.join(root, ".git", "info", "exclude")), rel);
      if (exclude !== undefined) ignored = exclude;

      const parts = rel.split("/");
      let dir = root;
      for (let i = 0; i < parts.length; i++) {
        const sub = parts.slice(i).join("/");
        const result = evaluate(await rulesFor(path.join(dir, ".gitignore")), sub);
        if (result !== undefined) ignored = result;
        if (i < parts.length - 1) dir = path.join(dir, parts[i] as string);
      }
      return ignored ? "ignored" : "not-ignored";
    },
  };
}
