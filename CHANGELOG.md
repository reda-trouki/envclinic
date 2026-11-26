# Changelog

## 0.1.0

Initial release.

**Auditing**
- `envclinic audit` compares `.env` files with `.env.example` / `.env.sample`: missing, undocumented, empty and duplicate variables, invalid names, syntax problems
- Potentially unused variables and undeclared variables from static source scanning (`process.env`, `import.meta.env`, `Bun.env`, `Deno.env.get`, destructuring), with dynamic-access warnings
- Secret detection in env files and source code: provider tokens, private keys, URLs with credentials, weak secrets, secrets exposed through client prefixes, env files not covered by `.gitignore`; severity depends on whether a file is git-ignored
- Framework detection (Next.js, Vite, Astro, NestJS, Express, React, Node.js) from dependencies and config files, overridable in config

**Validation**
- Schema validation with `string`, `number`, `integer`, `boolean`, `url`, `email`, `enum` and `custom` types, required/optional/default, length and numeric ranges, patterns, URL protocols and custom validators
- Runtime API: `validateEnv`, `assertEnv`, `defineSchema` with typed results

**Generation**
- `generate` creates or merges `.env.example` (names only, grouped, with schema descriptions)
- `types` generates TypeScript declarations (`ProcessEnv`, and `ImportMetaEnv` for Vite and Astro) and `--check` for CI
- `init` interactive setup; `audit --fix` appends undocumented names to the example file
- Safe writes: dry-run, confirmation, atomic writes, never real env files, never outside the project

**CLI and CI**
- Commands: `init`, `audit`, `check`, `secrets`, `unused`, `generate`, `types`, `validate`, `framework`
- Terminal report, `--json`, `--format github` annotations, `--ci`, `--strict`, `--quiet`, `--verbose`, `--no-color`
- Exit codes: 0 ok, 1 problems found, 2 usage or runtime error

**Security**
- Values are never printed, written to generated files, or included in JSON; enforced by tests across every command
- Refuses files outside the project, unsafe symlinks and oversized files; project code and package scripts are never executed
- Optional config file (`json`, `mjs`, `js`, `cjs`, `ts`) with rule levels, ignores, secret allow-lists and custom patterns

**Windows**
- UTF-16 env files (what PowerShell `>` and `echo ... > .env` create) are decoded correctly and reported with a `non-utf8-file` warning
