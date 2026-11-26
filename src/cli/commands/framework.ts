import { createColors } from "picocolors";
import { loadProject } from "../../core/project";
import type { IO } from "../io";
import { resolveFormat, toAuditOptions, type CliOptions } from "./common";

/** Show the detected framework and its environment variable conventions. */
export async function frameworkCommand(options: CliOptions, io: IO): Promise<number> {
  const project = await loadProject(toAuditOptions(options, []));
  const info = project.framework;

  if (resolveFormat(options) === "json") {
    io.out(JSON.stringify(info, null, 2) + "\n");
    return 0;
  }

  const pc = createColors(options.color !== false && io.color);
  const lines = [
    `${pc.green("✔")} Framework detected: ${pc.bold(info.name)}${info.forced ? " (set in config)" : ""}`,
    "",
    `  Access patterns:  ${info.accessPatterns.join(", ")}`,
    `  Public prefixes:  ${info.publicPrefixes.length > 0 ? info.publicPrefixes.join(", ") : "none (nothing is assumed to reach the browser)"}`,
  ];
  if (info.detected.length > 1) lines.push(`  Also detected:    ${info.detected.slice(1).join(", ")}`);
  lines.push("", pc.bold("Evidence"), ...info.evidence.map((item) => `  - ${item}`));
  if (info.notes.length > 0) lines.push("", pc.bold("Notes"), ...info.notes.map((note) => `  - ${note}`));
  io.out(lines.join("\n") + "\n");
  return 0;
}
