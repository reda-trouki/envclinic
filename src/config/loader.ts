import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { EnvDoctorConfig } from "../types";
import { displayPath } from "../core/files";
import { ConfigError, validateConfig } from "./schema";

const CONFIG_FILE_NAMES = [
  "envclinic.config.json",
  "envclinic.config.mjs",
  "envclinic.config.js",
  "envclinic.config.cjs",
  "envclinic.config.ts",
];

export interface LoadedConfig {
  config: EnvDoctorConfig;
  /** Display path of the file that was loaded, if any. */
  file?: string;
}

/**
 * Load the optional config file. With an explicit path the file must exist;
 * otherwise the first matching file in `cwd` is used, and no file means
 * defaults.
 *
 * JavaScript and TypeScript config files are executed by Node when imported
 * (the same trust model as any other tool config). `.ts` files work only on
 * Node versions that can import TypeScript natively; use `.json` or `.mjs`
 * otherwise.
 */
export async function loadConfig(
  cwd: string,
  explicitPath?: string,
): Promise<LoadedConfig> {
  let absolute: string | undefined;

  if (explicitPath !== undefined) {
    absolute = path.resolve(cwd, explicitPath);
    if (!(await exists(absolute))) {
      throw new ConfigError(
        `Config file not found: ${displayPath(cwd, absolute)}`,
      );
    }
  } else {
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = path.join(cwd, name);
      if (await exists(candidate)) {
        absolute = candidate;
        break;
      }
    }
  }

  if (absolute === undefined) return { config: {} };

  const shown = displayPath(cwd, absolute);
  const raw = await readRaw(absolute, shown);
  return { config: validateConfig(raw, shown), file: shown };
}

async function readRaw(absolute: string, shown: string): Promise<unknown> {
  const ext = path.extname(absolute).toLowerCase();

  if (ext === ".json") {
    let text: string;
    try {
      text = await fs.readFile(absolute, "utf8");
    } catch (error) {
      throw new ConfigError(
        `Could not read config file ${shown}: ${(error as Error).message}`,
      );
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new ConfigError(
        `Config file ${shown} is not valid JSON: ${(error as Error).message}`,
      );
    }
  }

  try {
    const mod = (await import(pathToFileURL(absolute).href)) as {
      default?: unknown;
    };
    return mod.default ?? mod;
  } catch (error) {
    const hint =
      ext === ".ts"
        ? " TypeScript config files need a Node.js version that can import .ts files; use envclinic.config.json or .mjs instead."
        : "";
    throw new ConfigError(
      `Could not load config file ${shown}: ${(error as Error).message}.${hint}`,
    );
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
