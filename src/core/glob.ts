const SPECIAL = /[\\^$.|+(){}[\]]/g;

function escapeRegex(text: string): string {
  return text.replace(SPECIAL, "\\$&");
}

/**
 * Convert a simple glob (`*`, `**`, `?`) to a RegExp source (without anchors).
 * `**` crosses directory separators; `*` and `?` do not.
 */
export function globToRegexSource(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += escapeRegex(c);
    }
  }
  return out;
}

/** Test a relative path (forward slashes) against a glob. */
export function matchesGlob(glob: string, relativePath: string): boolean {
  const normalized = glob.replace(/^\.\//, "");
  return new RegExp(`^${globToRegexSource(normalized)}$`).test(relativePath);
}

/**
 * Build a predicate for variable names from patterns where `*` matches any
 * run of characters. Everything else matches literally and case-sensitively.
 */
export function createNameMatcher(patterns: readonly string[]): (name: string) => boolean {
  const exact = new Set<string>();
  const regexes: RegExp[] = [];
  for (const pattern of patterns) {
    if (pattern.includes("*")) {
      regexes.push(new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`));
    } else {
      exact.add(pattern);
    }
  }
  return (name) => exact.has(name) || regexes.some((regex) => regex.test(name));
}
