export type QuoteStyle = "double" | "single" | "backtick";

export interface EnvEntry {
  key: string;
  value: string;
  /** 1-based line where the declaration starts. */
  line: number;
  quote: QuoteStyle | null;
  exported: boolean;
}

export interface ParseProblem {
  kind: "malformed-line" | "unterminated-quote";
  line: number;
}

export interface ParsedEnv {
  entries: EnvEntry[];
  problems: ParseProblem[];
}

const LINE_RE = /^[ \t]*(export[ \t]+)?([^\s=]+)[ \t]*=/;

const QUOTES: Record<string, QuoteStyle> = {
  '"': "double",
  "'": "single",
  "`": "backtick",
};

/**
 * Parse the contents of a .env file.
 *
 * Handles comments, `export` prefixes, single/double/backtick quotes,
 * multiline quoted values, inline comments and CRLF line endings. Unlike
 * dotenv, it keeps every declaration (so duplicates can be reported) and
 * records line numbers. Problems never include the offending text, only the
 * line number, so malformed secrets cannot leak through error reporting.
 */
export function parseEnv(source: string): ParsedEnv {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const entries: EnvEntry[] = [];
  const problems: ParseProblem[] = [];

  let i = 0;
  let line = 1;

  while (i < text.length) {
    let eol = text.indexOf("\n", i);
    if (eol === -1) eol = text.length;
    const raw = text.slice(i, eol);
    const trimmed = raw.trim();
    let next = eol + 1;

    if (trimmed !== "" && !trimmed.startsWith("#")) {
      const match = LINE_RE.exec(raw);
      if (!match) {
        problems.push({ kind: "malformed-line", line });
      } else {
        const key = match[2] as string;
        const exported = match[1] !== undefined;
        let p = i + match[0].length;
        while (text[p] === " " || text[p] === "\t") p++;

        const quoteChar = text[p];
        const style = quoteChar !== undefined ? QUOTES[quoteChar] : undefined;

        if (style && quoteChar !== undefined) {
          const end = findClosingQuote(text, p, quoteChar);
          if (end === -1) {
            problems.push({ kind: "unterminated-quote", line });
            entries.push({
              key,
              value: text.slice(p + 1, eol),
              line,
              quote: style,
              exported,
            });
          } else {
            let value = text.slice(p + 1, end);
            if (style === "double") value = unescapeDouble(value);
            entries.push({ key, value, line, quote: style, exported });
            let eol2 = text.indexOf("\n", end + 1);
            if (eol2 === -1) eol2 = text.length;
            next = eol2 + 1;
          }
        } else if (text[p] === "=") {
          // `NAME==...` is almost always pasted base64 (padding) or other
          // garbage, and its "name" may be a fragment of key material. Treat
          // the line as malformed so the name is never recorded or reported.
          problems.push({ kind: "malformed-line", line });
        } else {
          entries.push({
            key,
            value: parseUnquoted(text.slice(p, eol)),
            line,
            quote: null,
            exported,
          });
        }
      }
    }

    line += countNewlines(text, i, Math.min(next, text.length));
    i = next;
  }

  return { entries, problems };
}

function findClosingQuote(text: string, start: number, quote: string): number {
  for (let j = start + 1; j < text.length; j++) {
    const c = text[j];
    if (quote === '"' && c === "\\") {
      j++;
      continue;
    }
    if (c === quote) return j;
  }
  return -1;
}

function unescapeDouble(value: string): string {
  return value.replace(/\\([nrt"\\])/g, (_, c: string) => {
    if (c === "n") return "\n";
    if (c === "r") return "\r";
    if (c === "t") return "\t";
    return c;
  });
}

function parseUnquoted(rest: string): string {
  if (rest.startsWith("#")) return "";
  const comment = /[ \t]#/.exec(rest);
  return (comment ? rest.slice(0, comment.index) : rest).trim();
}

function countNewlines(text: string, from: number, to: number): number {
  let count = 0;
  for (let k = from; k < to; k++) {
    if (text.charCodeAt(k) === 10) count++;
  }
  return count;
}
