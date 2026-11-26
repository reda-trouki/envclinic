import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { nonInteractivePrompter, type IO, type Prompter } from "../src/cli/io";

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** Create a temporary project directory containing the given files. */
export function makeProject(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "envclinic-test-"));
  created.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

const FIXTURES = path.join(__dirname, "fixtures");

/**
 * Copy a fixture project into a temporary directory. Files named `dot-env*`
 * become `.env*`, so fixtures can contain env files even though real env
 * files are git-ignored.
 */
export function copyFixture(name: string): string {
  const dir = makeProject();
  cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  const rename = (folder: string): void => {
    for (const entry of readdirSync(folder)) {
      const full = path.join(folder, entry);
      if (statSync(full).isDirectory()) rename(full);
      else if (entry.startsWith("dot-env"))
        renameSync(full, path.join(folder, entry.replace(/^dot-env/, ".env")));
    }
  };
  rename(dir);
  return dir;
}

export interface CapturedIO extends IO {
  stdout: () => string;
  stderr: () => string;
}

export interface CaptureOptions {
  color?: boolean;
  env?: Record<string, string | undefined>;
  prompter?: Prompter;
}

export function captureIO(options: CaptureOptions | boolean = {}): CapturedIO {
  const settings: CaptureOptions =
    typeof options === "boolean" ? { color: options } : options;
  let out = "";
  let err = "";
  return {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    color: settings.color ?? false,
    env: settings.env ?? {},
    prompter: settings.prompter ?? nonInteractivePrompter,
    stdout: () => out,
    stderr: () => err,
  };
}

/** An interactive prompter that answers from a script, in order. */
export function scriptedPrompter(
  answers: Array<string | boolean>,
): Prompter & { asked: string[] } {
  const asked: string[] = [];
  const next = (message: string): string | boolean => {
    asked.push(message);
    if (answers.length === 0) throw new Error(`Unexpected prompt: ${message}`);
    return answers.shift() as string | boolean;
  };
  return {
    interactive: true,
    asked,
    async confirm(message) {
      return Boolean(next(message));
    },
    async select(message) {
      return next(message) as never;
    },
    async input(message) {
      return String(next(message));
    },
  };
}
