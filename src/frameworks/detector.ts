import { promises as fs } from "node:fs";
import path from "node:path";
import type { EnvDoctorConfig, FrameworkId } from "../types";

export interface FrameworkInfo {
  /** The primary framework (forced by config, or the best detected match). */
  id: FrameworkId;
  name: string;
  /** How the framework conventionally exposes variables to code. */
  accessPatterns: string[];
  /** Prefixes whose variables end up in client bundles. */
  publicPrefixes: string[];
  /** Why each framework was detected (dependency or config file). */
  evidence: string[];
  /** Every framework that matched, primary first. */
  detected: FrameworkId[];
  /** True when the config file forced the framework. */
  forced: boolean;
  notes: string[];
}

interface Definition {
  id: FrameworkId;
  name: string;
  dependencies: string[];
  files: string[];
  accessPatterns: string[];
  publicPrefixes: string[];
  notes: string;
}

/** In precedence order: the first match becomes the primary framework. */
const DEFINITIONS: Definition[] = [
  {
    id: "nextjs",
    name: "Next.js",
    dependencies: ["next"],
    files: ["next.config.js", "next.config.mjs", "next.config.cjs", "next.config.ts"],
    accessPatterns: ["process.env"],
    publicPrefixes: ["NEXT_PUBLIC_"],
    notes: "Variables prefixed with NEXT_PUBLIC_ are inlined into the browser bundle.",
  },
  {
    id: "astro",
    name: "Astro",
    dependencies: ["astro"],
    files: ["astro.config.mjs", "astro.config.js", "astro.config.ts", "astro.config.cjs"],
    accessPatterns: ["import.meta.env"],
    publicPrefixes: ["PUBLIC_"],
    notes: "Variables prefixed with PUBLIC_ are available in client-side code.",
  },
  {
    id: "nestjs",
    name: "NestJS",
    dependencies: ["@nestjs/core"],
    files: ["nest-cli.json"],
    accessPatterns: ["process.env"],
    publicPrefixes: [],
    notes: "Server-side only. Variables are normally read through process.env or @nestjs/config.",
  },
  {
    id: "vite",
    name: "Vite",
    dependencies: ["vite"],
    files: ["vite.config.js", "vite.config.mjs", "vite.config.cjs", "vite.config.ts", "vite.config.mts"],
    accessPatterns: ["import.meta.env"],
    publicPrefixes: ["VITE_"],
    notes: "Only variables prefixed with VITE_ (or your envPrefix setting) are exposed to client code.",
  },
  {
    id: "react",
    name: "React",
    dependencies: ["react", "react-scripts"],
    files: [],
    accessPatterns: ["process.env", "import.meta.env"],
    publicPrefixes: [],
    notes: "Depends on the build tool. Create React App exposes REACT_APP_ variables.",
  },
  {
    id: "express",
    name: "Express",
    dependencies: ["express"],
    files: [],
    accessPatterns: ["process.env"],
    publicPrefixes: [],
    notes: "Server-side only. Variables are read through process.env.",
  },
];

const NODE: Definition = {
  id: "node",
  name: "Node.js",
  dependencies: [],
  files: [],
  accessPatterns: ["process.env"],
  publicPrefixes: [],
  notes: "Plain Node.js conventions: variables are read through process.env.",
};

async function readDependencies(cwd: string): Promise<{ present: boolean; names: Set<string> }> {
  try {
    const stat = await fs.stat(path.join(cwd, "package.json"));
    if (stat.size > 1024 * 1024) return { present: true, names: new Set() };
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8"));
    const names = new Set<string>();
    if (typeof parsed === "object" && parsed !== null) {
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const section = (parsed as Record<string, unknown>)[field];
        if (typeof section === "object" && section !== null) {
          for (const name of Object.keys(section)) names.add(name);
        }
      }
    }
    return { present: true, names };
  } catch {
    return { present: false, names: new Set() };
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

/**
 * Detect the project's framework from package.json dependencies and
 * well-known config files. package.json is parsed as data; nothing in the
 * project is executed.
 *
 * Detection only informs reports (such as which prefixes are exposed to the
 * browser). It can be overridden with the `framework` and `publicPrefixes`
 * config options because projects do not always follow framework defaults.
 */
export async function detectFramework(
  cwd: string,
  config: Pick<EnvDoctorConfig, "framework" | "publicPrefixes"> = {},
): Promise<FrameworkInfo> {
  const { present, names } = await readDependencies(cwd);
  const evidence: string[] = [];
  const matched: Definition[] = [];

  for (const definition of DEFINITIONS) {
    const reasons: string[] = [];
    for (const dependency of definition.dependencies) {
      if (names.has(dependency)) reasons.push(`dependency "${dependency}"`);
    }
    for (const file of definition.files) {
      if (await exists(path.join(cwd, file))) reasons.push(`file ${file}`);
    }
    if (reasons.length > 0) {
      matched.push(definition);
      evidence.push(...reasons.map((reason) => `${definition.name}: ${reason}`));
    }
  }

  const notes: string[] = [];
  let primary: Definition = matched[0] ?? NODE;
  if (matched.length === 0) {
    evidence.push(
      present
        ? "No framework dependency found; assuming plain Node.js conventions."
        : "No package.json found; assuming plain Node.js conventions.",
    );
  }

  let forced = false;
  if (config.framework !== undefined && config.framework !== "auto") {
    const requested = config.framework;
    primary = [...DEFINITIONS, NODE].find((definition) => definition.id === requested) ?? primary;
    forced = true;
    evidence.unshift(`${primary.name}: forced by the "framework" config option`);
  }

  const reactScripts = names.has("react-scripts");
  let prefixes: string[];
  if (forced) {
    prefixes = [...primary.publicPrefixes];
    if (primary.id === "react" && reactScripts) prefixes.push("REACT_APP_");
  } else {
    prefixes = [...new Set([...matched.flatMap((definition) => definition.publicPrefixes), ...(reactScripts ? ["REACT_APP_"] : [])])];
  }
  if (config.publicPrefixes !== undefined) prefixes = [...config.publicPrefixes];

  notes.push(primary.notes);
  if (primary.id === "react" && !reactScripts) {
    notes.push("react-scripts was not found, so no client prefix is assumed. Set publicPrefixes if your build tool exposes one.");
  }
  if (config.publicPrefixes !== undefined) {
    notes.push("Public prefixes come from the publicPrefixes config option.");
  }

  const detected = [...new Set([primary.id, ...matched.map((definition) => definition.id)])];
  return {
    id: primary.id,
    name: primary.name,
    accessPatterns: [...primary.accessPatterns],
    publicPrefixes: prefixes,
    evidence,
    detected,
    forced,
    notes,
  };
}

export const FRAMEWORK_IDS: FrameworkId[] = [...DEFINITIONS.map((definition) => definition.id), "node"];
