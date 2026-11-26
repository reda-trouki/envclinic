# Integrations

## GitHub Actions

```yaml
name: Environment Audit

on:
  pull_request:
  push:
    branches: [main]

jobs:
  env-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - run: npm ci
      - run: npx envclinic audit --ci
      - run: npx envclinic types --check   # if you commit generated types
```

With `--ci`, envclinic prints the report without colors, exits with code 1 when errors are found, and, when `GITHUB_ACTIONS=true`, also prints **annotations** (`::error file=...,line=...::message`) that GitHub shows on the pull request's changed files. `--format github` prints only the annotations.

A CI checkout normally has no `.env`. That is fine: a missing default `.env` is only an informational message, and the audit still validates your example file, scans your source for hardcoded credentials, and finds variables that are used in code but not documented.

To audit a committed env file, or to validate secrets supplied by the CI provider:

```yaml
- run: npx envclinic audit --ci --file .env.production
- run: npx envclinic validate --ci --process-env
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

`--process-env` reads the real environment. Values are validated but never printed.

For machine-readable output use `--json`. The exit code is the same.

Nothing is uploaded anywhere, and you do not need to store envclinic output as an artifact.

## Pre-commit hooks

With [husky](https://typicode.github.io/husky/):

```bash
# .husky/pre-commit
npx envclinic secrets --ci --quiet
```

## Frameworks

### Next.js

Detected from the `next` dependency or `next.config.*`. `NEXT_PUBLIC_` variables are treated as browser-exposed, so a name like `NEXT_PUBLIC_API_SECRET` is flagged. Generated types go in `NodeJS.ProcessEnv`.

### Vite and Astro

Detected from `vite`/`astro` or their config files. Variables with the `VITE_` (or Astro `PUBLIC_`) prefix are generated into `ImportMetaEnv`, so `import.meta.env.VITE_API_URL` autocompletes. Vite's `envPrefix` setting is not read; mirror it with `publicPrefixes`.

### NestJS and Express

Server-side only; no prefixes are exposed to clients. If you use `@nestjs/config`, `process.env` reads are still found by the scanner, but values read only through `ConfigService.get("NAME")` are not; add those names to `ignore.variables` or read them via `process.env`.

### React (Create React App)

`REACT_APP_` is recognized when `react-scripts` is a dependency. For other React build tools set `framework`/`publicPrefixes` yourself.

## Using it with Zod, Envalid, T3 Env and similar

envclinic does not try to replace runtime validation libraries. It audits the *files and code around* your configuration:

- Keep validating at startup with your library of choice. envclinic's own `assertEnv` is a small option if you do not already have one.
- Use `envclinic` in CI to catch undocumented, unused, duplicated and leaked variables.
- `envclinic types` and a Zod schema can coexist: the generated file declares `process.env`; your library parses it.

## Monorepos

Run envclinic once per package:

```bash
npx envclinic --cwd apps/web
npx envclinic --cwd apps/api
```

Each package uses its own config file and `.gitignore` rules (envclinic also reads `.gitignore` files above the package up to the repository root).

## Programmatic use

```ts
import { audit } from "envclinic";

const result = await audit({ cwd: process.cwd(), strict: true });
if (!result.success) {
  for (const issue of result.issues) console.error(issue.code, issue.message);
  process.exitCode = 1;
}
```

`audit` accepts the same settings as the CLI (`checks`, `files`, `example`, `ignore`, `scan`, `processEnv`, `env`, `config`...) and returns structured data, never terminal-formatted strings.
