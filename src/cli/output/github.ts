import type { AuditIssue, AuditResult } from "../../types";

function escapeData(text: string): string {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(text: string): string {
  return escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

const LEVEL = { error: "error", warning: "warning", info: "notice" } as const;

export function formatAnnotation(issue: AuditIssue): string {
  const properties: string[] = [];
  if (issue.file !== undefined) {
    properties.push(`file=${escapeProperty(issue.file)}`);
    if (issue.line !== undefined) properties.push(`line=${issue.line}`);
  }
  properties.push(`title=${escapeProperty(`envclinic: ${issue.code}`)}`);
  return `::${LEVEL[issue.severity]} ${properties.join(",")}::${escapeData(issue.message)}`;
}

/** GitHub Actions workflow commands, one annotation per issue. Messages never contain values. */
export function formatGithub(result: AuditResult): string {
  return result.issues.map((issue) => formatAnnotation(issue) + "\n").join("");
}
