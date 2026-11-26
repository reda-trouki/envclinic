import { promises as fs } from "node:fs";
import path from "node:path";

/** Env files larger than this are refused rather than read into memory. */
export const MAX_ENV_FILE_BYTES = 5 * 1024 * 1024;

export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be";

/**
 * Decode a file's bytes. Windows PowerShell's `>` and `echo ... > file` write UTF-16, which
 * would otherwise read as text full of NUL characters. A UTF-8 BOM is dropped by the parser.
 */
export function decodeText(buf: Buffer): { text: string; encoding: TextEncoding } {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.subarray(2).toString("utf16le"), encoding: "utf-16le" };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: Buffer.from(buf.subarray(2)).swap16().toString("utf16le"), encoding: "utf-16be" };
  }
  // No BOM: ASCII-heavy UTF-16 has a zero byte in every other position.
  if (buf.length >= 4 && buf.length % 2 === 0) {
    const sample = Math.min(buf.length, 512) & ~1;
    let evenZero = 0;
    let oddZero = 0;
    for (let i = 0; i < sample; i += 2) {
      if (buf[i] === 0) evenZero++;
      if (buf[i + 1] === 0) oddZero++;
    }
    const pairs = sample / 2;
    if (oddZero > pairs * 0.4 && evenZero === 0) return { text: buf.toString("utf16le"), encoding: "utf-16le" };
    if (evenZero > pairs * 0.4 && oddZero === 0) return { text: Buffer.from(buf).swap16().toString("utf16le"), encoding: "utf-16be" };
  }
  return { text: buf.toString("utf8"), encoding: "utf-8" };
}

export type ReadResult =
  | { status: "ok"; content: string; encoding: TextEncoding }
  | { status: "missing" }
  | { status: "unsafe"; reason: string }
  | { status: "too-large" }
  | { status: "unreadable" };

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === "") return true;
  if (rel === ".." || rel.startsWith(".." + path.sep)) return false;
  return !path.isAbsolute(rel);
}

/** Path shown to the user: relative to the project root, with forward slashes. */
export function displayPath(root: string, absolute: string): string {
  const rel = path.relative(root, absolute);
  return (rel === "" ? "." : rel).split(path.sep).join("/");
}

/**
 * Read an env file, refusing anything outside the project root. Symlinks are
 * resolved and must also point inside the root, so a malicious repository
 * cannot trick the tool into reading (and reporting on) files elsewhere.
 */
export async function readEnvFile(root: string, relative: string): Promise<ReadResult> {
  const absolute = path.resolve(root, relative);
  if (!isInside(root, absolute)) {
    return { status: "unsafe", reason: "the path is outside the project directory" };
  }

  try {
    await fs.lstat(absolute);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? { status: "missing" } : { status: "unreadable" };
  }

  let real: string;
  let realRoot: string;
  try {
    real = await fs.realpath(absolute);
    realRoot = await fs.realpath(root);
  } catch {
    return { status: "unsafe", reason: "the path is a broken symbolic link" };
  }
  if (!isInside(realRoot, real)) {
    return { status: "unsafe", reason: "the file is a symbolic link that points outside the project directory" };
  }

  try {
    const stat = await fs.stat(real);
    if (!stat.isFile()) return { status: "unsafe", reason: "the path is not a regular file" };
    if (stat.size > MAX_ENV_FILE_BYTES) return { status: "too-large" };
    const decoded = decodeText(await fs.readFile(real));
    return { status: "ok", content: decoded.text, encoding: decoded.encoding };
  } catch {
    return { status: "unreadable" };
  }
}
