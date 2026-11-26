import { describe, expect, it } from "vitest";
import {
  ConfigError,
  defineConfig,
  validateConfig,
} from "../../src/config/schema";
import { loadConfig } from "../../src/config/loader";
import { makeProject } from "../helpers";

describe("validateConfig", () => {
  it("accepts a full valid config", () => {
    const config = {
      files: { source: [".env", ".env.local"], example: ".env.example" },
      rules: { missing: "error", empty: "off", names: "warning" },
      ignore: { variables: ["NEXT_RUNTIME"] },
    };
    expect(validateConfig(config, "test")).toEqual(config);
  });

  it("accepts an empty config", () => {
    expect(validateConfig({}, "test")).toEqual({});
  });

  it.each([
    [null, '"config" must be an object'],
    [[], '"config" must be an object'],
    [{ nope: 1 }, 'unknown option "nope"'],
    [{ files: { source: ".env" } }, '"files.source" must be an array'],
    [{ files: { example: "" } }, '"files.example" must be a non-empty string'],
    [{ files: { other: 1 } }, 'unknown option "files.other"'],
    [{ rules: { missing: "fatal" } }, '"rules.missing" must be one of'],
    [{ rules: { bogus: "error" } }, 'unknown option "rules.bogus"'],
    [{ ignore: { variables: [1] } }, '"ignore.variables" must be an array'],
    [{ ignore: "X" }, '"ignore" must be an object'],
  ])("rejects %j", (input, message) => {
    expect(() => validateConfig(input, "test")).toThrow(ConfigError);
    expect(() => validateConfig(input, "test")).toThrow(message);
  });

  it("defineConfig returns its input", () => {
    const config = { ignore: { variables: ["A"] } };
    expect(defineConfig(config)).toBe(config);
  });
});

describe("loadConfig", () => {
  it("returns defaults when there is no config file", async () => {
    const dir = makeProject();
    expect(await loadConfig(dir)).toEqual({ config: {} });
  });

  it("auto-discovers envclinic.config.json", async () => {
    const dir = makeProject({
      "envclinic.config.json": '{"ignore":{"variables":["A"]}}',
    });
    expect(await loadConfig(dir)).toEqual({
      config: { ignore: { variables: ["A"] } },
      file: "envclinic.config.json",
    });
  });

  it("loads an ES module config", async () => {
    const dir = makeProject({
      "envclinic.config.mjs": 'export default { rules: { empty: "off" } };',
    });
    const loaded = await loadConfig(dir);
    expect(loaded.config).toEqual({ rules: { empty: "off" } });
    expect(loaded.file).toBe("envclinic.config.mjs");
  });

  it("loads an explicit config path", async () => {
    const dir = makeProject({
      "custom/cfg.json": '{"rules":{"missing":"warning"}}',
    });
    const loaded = await loadConfig(dir, "custom/cfg.json");
    expect(loaded.config).toEqual({ rules: { missing: "warning" } });
    expect(loaded.file).toBe("custom/cfg.json");
  });

  it("fails clearly when an explicit config file does not exist", async () => {
    const dir = makeProject();
    await expect(loadConfig(dir, "nope.json")).rejects.toThrow(
      "Config file not found: nope.json",
    );
  });

  it("fails clearly on invalid JSON", async () => {
    const dir = makeProject({ "envclinic.config.json": "{ not json" });
    await expect(loadConfig(dir)).rejects.toThrow(/not valid JSON/);
  });

  it("fails clearly on an invalid config shape", async () => {
    const dir = makeProject({
      "envclinic.config.json": '{"rules":{"missing":"fatal"}}',
    });
    await expect(loadConfig(dir)).rejects.toThrow(
      /envclinic\.config\.json.*rules\.missing/,
    );
  });

  it("fails clearly when a script config throws", async () => {
    const dir = makeProject({
      "envclinic.config.mjs": 'throw new Error("boom");',
    });
    await expect(loadConfig(dir)).rejects.toThrow(
      /Could not load config file.*boom/,
    );
  });
});
