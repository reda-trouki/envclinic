import { isBuiltinVariable } from "../config/defaults";
import type { SchemaField } from "../types";
import type { UsageData } from "../analyzers/unused";
import type { ProjectContext } from "./project";

export interface VariableInfo {
  name: string;
  inSource: boolean;
  inExample: boolean;
  usedInCode: boolean;
  schema?: SchemaField;
}

/**
 * Collect every variable the project knows about: declared in env files,
 * documented in the example, described by the schema, or read in source code.
 *
 * Variables only seen in code that look platform-provided (NODE_ENV, CI...)
 * are left out. Names are returned sorted.
 */
export function collectVariables(
  project: ProjectContext,
  usage: UsageData | undefined,
  exclude: (name: string) => boolean = () => false,
): VariableInfo[] {
  const map = new Map<string, VariableInfo>();
  const get = (name: string): VariableInfo => {
    let info = map.get(name);
    if (!info) {
      info = { name, inSource: false, inExample: false, usedInCode: false };
      map.set(name, info);
    }
    return info;
  };

  for (const file of project.sourceFiles) for (const key of file.keys) get(key).inSource = true;
  if (project.example) for (const key of project.example.keys) get(key).inExample = true;
  for (const [name, field] of Object.entries(project.schema ?? {})) get(name).schema = field;

  if (usage) {
    for (const name of usage.references.keys()) {
      const existing = map.get(name);
      if (!existing && isBuiltinVariable(name)) continue;
      get(name).usedInCode = true;
    }
  }

  return [...map.values()]
    .filter((info) => !project.isIgnored(info.name) && !exclude(info.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}
