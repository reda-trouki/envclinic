import { describe, expect, it } from "vitest";
import { detectFramework } from "../../src";
import { makeProject } from "../helpers";

const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
  JSON.stringify({ name: "x", dependencies: deps, devDependencies: dev });

describe("detectFramework", () => {
  it.each([
    ["nextjs", "Next.js", { next: "14" }, ["NEXT_PUBLIC_"]],
    ["vite", "Vite", { vite: "5" }, ["VITE_"]],
    ["astro", "Astro", { astro: "4" }, ["PUBLIC_"]],
    ["nestjs", "NestJS", { "@nestjs/core": "10" }, []],
    ["express", "Express", { express: "4" }, []],
    ["react", "React", { react: "18" }, []],
  ] as const)("detects %s from dependencies", async (id, name, deps, prefixes) => {
    const info = await detectFramework(makeProject({ "package.json": pkg(deps) }));
    expect(info).toMatchObject({ id, name, publicPrefixes: prefixes, forced: false });
    expect(info.evidence.join(" ")).toContain(Object.keys(deps)[0]);
  });

  it("falls back to Node.js", async () => {
    expect(await detectFramework(makeProject({ "package.json": pkg({ lodash: "4" }) }))).toMatchObject({ id: "node", name: "Node.js" });
    expect(await detectFramework(makeProject())).toMatchObject({ id: "node" });
    expect(await detectFramework(makeProject({ "package.json": "{ not json" }))).toMatchObject({ id: "node" });
  });

  it("detects from config files and devDependencies", async () => {
    expect(await detectFramework(makeProject({ "vite.config.ts": "" }))).toMatchObject({ id: "vite" });
    expect(await detectFramework(makeProject({ "next.config.mjs": "" }))).toMatchObject({ id: "nextjs" });
    expect(await detectFramework(makeProject({ "nest-cli.json": "{}" }))).toMatchObject({ id: "nestjs" });
    expect(await detectFramework(makeProject({ "package.json": pkg({}, { vite: "5" }) }))).toMatchObject({ id: "vite" });
  });

  it("applies precedence and lists everything detected", async () => {
    const info = await detectFramework(makeProject({ "package.json": pkg({ next: "14", react: "18", express: "4" }) }));
    expect(info.id).toBe("nextjs");
    expect(info.detected).toEqual(["nextjs", "react", "express"]);
    const fullstack = await detectFramework(makeProject({ "package.json": pkg({ express: "4", react: "18" }, { vite: "5" }) }));
    expect(fullstack.id).toBe("vite");
    expect(fullstack.publicPrefixes).toEqual(["VITE_"]);
  });

  it("recognises Create React App prefixes", async () => {
    const info = await detectFramework(makeProject({ "package.json": pkg({ react: "18", "react-scripts": "5" }) }));
    expect(info).toMatchObject({ id: "react", publicPrefixes: ["REACT_APP_"] });
  });

  it("can be forced and its prefixes overridden by config", async () => {
    const cwd = makeProject({ "package.json": pkg({ next: "14" }) });
    expect(await detectFramework(cwd, { framework: "vite" })).toMatchObject({ id: "vite", forced: true, publicPrefixes: ["VITE_"] });
    expect(await detectFramework(cwd, { framework: "auto" })).toMatchObject({ id: "nextjs", forced: false });
    expect(await detectFramework(cwd, { publicPrefixes: ["CUSTOM_", "PUB_"] })).toMatchObject({ publicPrefixes: ["CUSTOM_", "PUB_"] });
  });
});
