# Installation

envclinic needs **Node.js 18 or newer** and works on Linux, macOS and Windows.

## Use it without installing

```bash
npx envclinic
```

`npx` downloads the package for that run. Fine for trying it out.

## Add it to a project (recommended)

```bash
npm install --save-dev envclinic
# or
pnpm add -D envclinic
yarn add -D envclinic
```

Add scripts so everyone on the team runs the same checks:

```json
{
  "scripts": {
    "env:audit": "envclinic audit",
    "env:types": "envclinic types",
    "env:check-types": "envclinic types --check"
  }
}
```

## Install globally

```bash
npm install --global envclinic
envclinic --version
```

## First run

```bash
npx envclinic init      # optional: asks a few questions and writes a config file
npx envclinic           # runs the full audit
```

With no configuration, envclinic audits `.env` against `.env.example` (or `.env.sample`), scans your source code, and detects your framework from `package.json`.

If your project has no `.env.example` yet, create one from what you already have:

```bash
npx envclinic generate
```

## Using it from code

```ts
import { audit, validateEnv, assertEnv } from "envclinic";
```

The package ships ESM and CommonJS builds with TypeScript declarations, so `import` and `require` both work.

## Upgrading

envclinic follows semantic versioning. Changes are listed in the [changelog](../CHANGELOG.md). Before `1.0.0`, minor versions may contain breaking changes; they are always called out.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Could not load config file envclinic.config.ts` | `.ts` config files need a Node.js version that can import TypeScript (Node 22.18+ or 23.6+). Use `envclinic.config.json` or `.mjs` otherwise. |
| `Cannot find package 'envclinic'` in a config file | Install envclinic in the project (`npm install -D envclinic`) or drop the `defineConfig` import and export a plain object. |
| Audit is slow on a large repository | Limit scanning with `scan.directories` and add generated folders to `scan.ignore` (see [configuration](./configuration.md)). |
| Everything is reported as "potentially unused" | Your code may not be under the scanned directories, or reads variables dynamically. See the limitations in [security](./security.md). |
