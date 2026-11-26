import { DEFAULT_EXAMPLE_OUTPUT, DEFAULT_TYPES_OUTPUT } from "../config/defaults";
import type { UsageData } from "../analyzers/unused";
import { createNameMatcher } from "./glob";
import { renderExample } from "./generator";
import type { ProjectContext } from "./project";
import { renderTypes } from "./type-generator";
import { collectVariables, type VariableInfo } from "./variables";

export function typesOutputPath(project: ProjectContext, override?: string): string {
  return override ?? project.config.types?.output ?? DEFAULT_TYPES_OUTPUT;
}

export function exampleOutputPath(project: ProjectContext, override?: string): string {
  return override ?? project.config.generate?.output ?? DEFAULT_EXAMPLE_OUTPUT;
}

/** The variables a generated `.env.example` should list. */
export function exampleVariables(project: ProjectContext, usage: UsageData | undefined, exclude: string[] = []): VariableInfo[] {
  const matcher = createNameMatcher([...(project.config.generate?.exclude ?? []), ...exclude]);
  return collectVariables(project, usage, matcher);
}

export function buildExampleContent(project: ProjectContext, usage: UsageData | undefined, exclude: string[] = []): string {
  return renderExample(exampleVariables(project, usage, exclude), project.framework.publicPrefixes);
}

/** The TypeScript declarations for the project. */
export function buildTypesContent(project: ProjectContext, usage: UsageData | undefined): string {
  return renderTypes({
    variables: collectVariables(project, usage),
    framework: project.framework,
    hasSourceFiles: project.sourceFiles.length > 0,
    hasExample: project.example !== undefined,
  });
}
