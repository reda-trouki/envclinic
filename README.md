# envclinic

Audit, validate and secure your environment configuration, before it breaks your app.

`envclinic` is a CLI and Node.js library that compares your `.env` files with `.env.example`, finds variables your code needs but nobody documented, flags potentially unused and exposed ones, validates values against a schema, and generates `.env.example` and TypeScript declarations. It never prints, uploads or stores variable values.

```text
╭──────────────────────────────────────╮
│              ENV DOCTOR              │
│      Environment Configuration       │
╰──────────────────────────────────────╯

✔ Framework detected: Next.js

Missing variables (1)
  ✘ REDIS_URL is declared in .env.example but missing from .env

Potentially unused variables (1)
  ⚠ OLD_API_KEY is declared in .env but was not found in 12 scanned source files (potentially unused)

Undeclared variables (1)
  ⚠ STRIPE_SECRET_KEY is used in app/page.ts but is not set in any env file or documented in .env.example

Security audit (2)
  [WARNING] Weak secret (shorter than 12 characters)
    File: .env:2
    Variable: JWT_SECRET
    Value: ********
  [WARNING] NEXT_PUBLIC_API_SECRET looks like a secret but its NEXT_PUBLIC_ prefix exposes it to the browser bundle
    File: .env:3
    Variable: NEXT_PUBLIC_API_SECRET
    Value: ********

Summary
  2 env files analyzed, 5 variables found, 12 source files scanned
  1 error, 4 warnings
```

## Features

- **Environment file audit**: missing, undocumented, empty and duplicate variables, invalid names, malformed lines; handles quotes, multiline values, `export`, comments and CRLF
- **Unused and undeclared variables**: static scan of your source (`process.env.X`, `process.env["X"]`, `import.meta.env.X`, destructuring...). Results say *potentially unused* and note when dynamic access makes them uncertain
- **Secret detection**: provider tokens, private keys, URLs with passwords, weak secrets, secrets exposed through `NEXT_PUBLIC_`/`VITE_` prefixes, env files missing from `.gitignore`
- **Schema validation**: `string`, `number`, `integer`, `boolean`, `url`, `email`, `enum`, `custom`; required, defaults, ranges, patterns. Also usable at app startup
- **`.env.example` generation**: names only, grouped and commented; merge into an existing file without losing your comments
- **TypeScript declarations** for `process.env` and `import.meta.env`, with a `--check` mode for CI
- **Framework detection**: Next.js, Vite, Astro, NestJS, Express, React, Node.js, overridable
- **CI friendly**: exit codes, `--json`, GitHub annotations
- **Safe by design**: see [Security](#security)

## Install

```bash
npm install --save-dev envclinic
# or run without installing
npx envclinic
```

Requires Node.js 18+. Works on Linux, macOS and Windows. See [docs/installation.md](./docs/installation.md).

## Quick start

```bash
npx envclinic                 # full audit (same as `audit`)
npx envclinic init            # optional: create a config file interactively
npx envclinic generate        # create .env.example from what you already have
npx envclinic types           # generate env.d.ts
npx envclinic audit --ci      # for CI: no colors, exit code 1 on errors
```

## Commands

| Command | What it does |
|---|---|
| `audit` | The complete audit (default) |
| `check` | Missing, empty, duplicate, invalid variables and schema validation |
| `secrets` | Potentially exposed and weak secrets |
| `unused` | Potentially unused and undeclared variables |
| `validate` | Validate values against your schema |
| `generate` | Create or update `.env.example` |
| `types` | Generate TypeScript declarations |
| `framework` | Show the detected framework and its conventions |
| `init` | Create a config file |

Global options: `--cwd`, `--config`, `--json`, `--format <terminal\|json\|github>`, `--quiet`, `--verbose`, `--no-color`. Audit options include `--strict`, `--ci`, `--file`, `--example`, `--ignore`, `--no-scan`, `--process-env`, `--fix`. Everything is in the [CLI reference](./docs/cli-reference.md).

Exit codes: `0` ok, `1` problems found, `2` usage or runtime error.

## Configuration

Optional. Create `envclinic.config.json` (or `.mjs`) in your project root, or run `npx envclinic init`.

```js
// envclinic.config.mjs
import { defineConfig } from "envclinic";

export default defineConfig({
  files: { source: [".env"], example: ".env.example" },
  scan: { directories: ["src", "app"], ignore: ["generated"] },
  rules: { missing: "error", unused: "warning", secrets: "error" },
  ignore: { variables: ["NEXT_RUNTIME"] },
  types: { enabled: true, output: "env.d.ts" },
  schema: {
    DATABASE_URL: { type: "url", required: true },
    PORT: { type: "integer", required: false, default: 3000 },
    NODE_ENV: { type: "enum", values: ["development", "production", "test"] },
    JWT_SECRET: { type: "string", minLength: 32, secret: true },
  },
});
```

Unknown options are rejected with a clear message. Full reference: [docs/configuration.md](./docs/configuration.md).

## Use it in CI

```yaml
- run: npx envclinic audit --ci
- run: npx envclinic types --check
```

In GitHub Actions, findings also appear as annotations on the pull request. More in [docs/integrations.md](./docs/integrations.md), including pre-commit hooks, monorepos and using it alongside Zod, Envalid or T3 Env.

## Programmatic API

```ts
import { audit, assertEnv, defineSchema } from "envclinic";

// Audit a project
const result = await audit({ cwd: process.cwd() });
if (!result.success) console.error(result.issues);

// Validate at startup, with typed results
const env = assertEnv(
  defineSchema({
    PORT: { type: "integer", required: false, default: 3000 },
    DATABASE_URL: { type: "url" },
  }),
);
env.PORT; // number
```

`audit` returns `{ success, summary, files, issues, framework, configFile? }` where each issue has `code`, `severity`, `message` and optionally `file`, `variable`, `line`, `recommendation`. Issues have no field that can hold a value.

## Security

- **Nothing is sent over the network.**
- **Values are never printed**: not in the terminal, JSON, annotations, errors or generated files. Verified by tests that run every command against planted marker values.
- **Your real env files are never modified.** `generate` and `--fix` only write template files such as `.env.example`, ask before replacing, and support `--dry-run`.
- **Your code is never executed.** Source is read as text. (Your own `envclinic.config.mjs` is JavaScript and runs when loaded; use JSON if you prefer.)
- Only files inside the project are read or written; unsafe symlinks are refused.

Detection is conservative and static: **a clean report does not prove there are no secrets, and "unused" means "potentially unused".** Pair envclinic with a dedicated secret scanner. Read the guarantees and limitations in [docs/security.md](./docs/security.md).

## Examples

[`examples/`](./examples) contains small Next.js, Express and NestJS projects.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md). Please report vulnerabilities privately, see [SECURITY.md](./SECURITY.md).

## License

MIT
