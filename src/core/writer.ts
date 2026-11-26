import { promises as fs } from "node:fs";
import path from "node:path";
import { decodeText, displayPath, isInside } from "./files";

export type WriteStatus = "written" | "unchanged" | "refused";

export interface WriteResult {
  status: WriteStatus;
  /** Display path of the target. */
  path: string;
  /** Why the write was refused. */
  reason?: string;
}

const TEMPLATE_NAME = /(example|sample|template|dist|defaults?)/i;

/**
 * Real env files hold actual values (`.env`, `.env.local`, `prod.env`...).
 * envclinic never writes to them; only template names are allowed.
 */
export function isProtectedEnvFileName(file: string): boolean {
  const base = path.basename(file);
  const looksLikeEnv = /^\.env(\.|$)/i.test(base) || /\.env$/i.test(base);
  return looksLikeEnv && !TEMPLATE_NAME.test(base);
}

/** Resolve a target path to an absolute one, or explain why it is not allowed. */
export async function resolveWriteTarget(
  cwd: string,
  relative: string,
): Promise<{ ok: true; absolute: string } | { ok: false; reason: string }> {
  const absolute = path.resolve(cwd, relative);
  if (!isInside(cwd, absolute) || absolute === path.resolve(cwd)) {
    return { ok: false, reason: "the path is outside the project directory" };
  }
  if (isProtectedEnvFileName(absolute)) {
    return {
      ok: false,
      reason:
        "envclinic never writes to real environment files; choose a template name such as .env.example",
    };
  }

  // The nearest existing ancestor must really be inside the project (no symlink escapes).
  const realRoot = await fs.realpath(cwd);
  let ancestor = path.dirname(absolute);
  for (;;) {
    try {
      const real = await fs.realpath(ancestor);
      if (!isInside(realRoot, real))
        return {
          ok: false,
          reason: "the directory resolves outside the project directory",
        };
      break;
    } catch {
      const parent = path.dirname(ancestor);
      if (parent === ancestor)
        return { ok: false, reason: "the directory could not be resolved" };
      ancestor = parent;
    }
  }
  return { ok: true, absolute };
}

export async function readExisting(
  absolute: string,
): Promise<string | undefined> {
  try {
    const stat = await fs.lstat(absolute);
    if (!stat.isFile()) return undefined;
    return decodeText(await fs.readFile(absolute)).text;
  } catch {
    return undefined;
  }
}

/**
 * Write a file inside the project safely: the path must stay within the
 * project, symlinks and real env files are refused, existing files are only
 * replaced when `overwrite` is true, and the content is written to a temporary
 * file first and renamed into place so a crash never leaves a half-written file.
 */
export async function writeProjectFile(
  cwd: string,
  relative: string,
  content: string,
  options: { overwrite: boolean },
): Promise<WriteResult> {
  const shown = displayPath(cwd, path.resolve(cwd, relative));
  const target = await resolveWriteTarget(cwd, relative);
  if (!target.ok)
    return { status: "refused", path: shown, reason: target.reason };
  const { absolute } = target;

  let exists = false;
  try {
    const stat = await fs.lstat(absolute);
    exists = true;
    if (stat.isSymbolicLink())
      return {
        status: "refused",
        path: shown,
        reason: "the target is a symbolic link",
      };
    if (!stat.isFile())
      return {
        status: "refused",
        path: shown,
        reason: "the target is not a regular file",
      };
  } catch {
    // does not exist yet
  }

  if (exists) {
    const current = await fs.readFile(absolute, "utf8");
    if (current.replace(/\r\n/g, "\n") === content)
      return { status: "unchanged", path: shown };
    if (!options.overwrite)
      return {
        status: "refused",
        path: shown,
        reason: "the file already exists",
      };
  }

  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { flag: "wx" });
    await fs.rename(temporary, absolute);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    return {
      status: "refused",
      path: shown,
      reason: `could not write the file (${(error as NodeJS.ErrnoException).code ?? "unknown error"})`,
    };
  }
  return { status: "written", path: shown };
}
