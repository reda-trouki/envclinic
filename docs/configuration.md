# Configuration

Configuration is optional. envclinic works with sensible defaults and only needs a config file when your project differs from them.

## Where the config lives

envclinic uses the first file it finds in the project root, in this order:

`envclinic.config.json` → `.mjs` → `.js` → `.cjs` → `.ts`

Or pass one explicitly with `--config <path>`. Run `npx envclinic init` to create one interactively.

- **JSON** is the safest choice: it is data and nothing is executed.
- **`.mjs` / `.js` / `.cjs`** are executed by Node when loaded, so they can contain functions (needed for `custom` schema validators).
- **`.ts`** works on Node versions that can import TypeScript natively (22.18+, 23.6+). Otherwise use `.json` or `.mjs`.

Unknown options are rejected with a message naming the option, so typos never go unnoticed.

`import { defineConfig } from "envclinic"` only works when envclinic is installed in the project. If you run it through `npx` without installing it, use a JSDoc type instead, which is what `envclinic init --config-format mjs` writes:

```js
/** @type {import("envclinic").EnvDoctorConfig} */
export default { rules: { unused: "error" } };
```

```js
// envclinic.config.mjs
import { defineConfig } from "envclinic";

export default defineConfig({
  files: { source: [".env", ".env.local"], example: ".env.example" },
  scan: { directories: ["src", "app"], ignore: ["generated"] },
  rules: { missing: "error", unused: "warning", secrets: "error" },
  ignore: { variables: ["NEXT_RUNTIME", "CI_*"] },
  secrets: { allow: ["TEST_*"], ignoreFiles: ["tests/fixtures/**"] },
  types: { enabled: true, output: "src/types/env.d.ts" },
  schema: {
    DATABASE_URL: { type: "url", required: true },
    PORT: { type: "integer", required: false, default: 3000 },
  },
});
```

## Reference

### `files`

| Option | Default | Description |
|---|---|---|
| `files.source` | `[".env"]` | Env files to audit. A missing default `.env` is only informational; a file you list explicitly must exist. |
| `files.example` | `.env.example`, then `.env.sample` | The template that documents your variables. |

Paths must stay inside the project. Symlinks that point outside it are refused.

### `scan`

Controls source-code scanning for unused and undeclared variables and hardcoded credentials.

| Option | Default | Description |
|---|---|---|
| `scan.directories` | `["."]` | Directories to scan, relative to the project root. |
| `scan.ignore` | `[]` | Extra directories or globs to skip. A bare name like `generated` matches at any depth. |
| `scan.extensions` | `js jsx mjs cjs ts tsx mts cts vue svelte astro` | File extensions to scan. |

Always skipped: `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.svelte-kit`, `.output`, `.turbo`, `.cache`, `.vercel`, `.netlify`, `.parcel-cache`, `.yarn`, `.pnpm-store`, `*.d.ts`, `*.min.js`, envclinic config files. Symlinks are never followed, and files over 1 MB are skipped.

Recognized access patterns: `process.env.X`, `process.env["X"]`, `import.meta.env.X`, `Bun.env.X`, `Deno.env.get("X")`, and destructuring such as `const { X, Y } = process.env`. Computed keys, aliases and spreading the whole object are counted as *dynamic access* and make "unused" results less certain.

### `rules`

Each rule is `"error"`, `"warning"` or `"off"`.

| Rule | Default | Covers |
|---|---|---|
| `missing` | error | In the example, absent from an env file |
| `undocumented` | warning | In an env file, absent from the example |
| `empty` | warning | Empty values |
| `duplicates` | error | Repeated declarations |
| `names` | warning | Invalid variable names |
| `syntax` | warning | Unparseable lines |
| `unused` | warning | Potentially unused variables |
| `undeclared` | warning | Variables read in code but declared nowhere |
| `secrets` | error | Exposed credentials, unignored env files, public secrets |
| `weak` | warning | Weak secrets |
| `validation` | error | Schema validation failures |
| `types` | warning | Missing or outdated type declarations |

A rule level can **lower** an issue's severity but never raise it. Setting `secrets: "warning"` turns critical findings into warnings; some secret findings are informational by nature (for example a credential in a git-ignored local file) and stay informational. `--strict` raises every warning to an error.

### `ignore`

`ignore.variables` lists variables that never produce issues. `*` matches any run of characters: `"NEXT_*"`, `"*_SECRET"`.

### `secrets`

| Option | Description |
|---|---|
| `secrets.allow` | Variables exempt from secret checks (wildcards allowed). |
| `secrets.ignoreFiles` | Source files, as globs relative to the root, skipped by credential scanning. |
| `secrets.patterns` | Extra patterns: `{ id, description?, pattern, severity? }` where `pattern` is a regular expression source and `severity` is `"error"` (default) or `"warning"`. Applied to env values and source code. |

To silence one line in source code, add the text `envclinic-ignore` anywhere on that line (for example in a comment).

### `framework` and `publicPrefixes`

envclinic detects your framework from `package.json` dependencies and config files and uses it to know which variable prefixes end up in browser bundles (`NEXT_PUBLIC_`, `VITE_`, `PUBLIC_` for Astro, `REACT_APP_` for Create React App).

Projects do not always follow framework defaults, so both can be overridden:

```json
{ "framework": "vite", "publicPrefixes": ["VITE_", "APP_PUBLIC_"] }
```

`framework` is one of `auto` (default), `nextjs`, `vite`, `astro`, `nestjs`, `express`, `react`, `node`. Run `npx envclinic framework` to see what was detected and why.

### `types`

| Option | Default | Description |
|---|---|---|
| `types.output` | `env.d.ts` | Where `envclinic types` writes. |
| `types.enabled` | `false` | When true, `audit` reports a missing or outdated file. |

What the generated file contains:

- A `NodeJS.ProcessEnv` declaration with every known variable, required (`NAME: string`) or optional (`NAME?: string`).
- For **Vite** and **Astro**, variables with the public prefix go into `ImportMetaEnv` instead.
- Enum variables from your schema become string literal unions.
- With a schema, requiredness follows the schema. Without one, a variable is required when it appears in both your env file and the example file, and optional otherwise. Add a schema when you need it exact.
- `NODE_ENV` and `TZ` are left out unless your schema describes them, because `@types/node` and frameworks already declare them and a second declaration can conflict.
- Values never appear in the file. Declarations only improve editor autocomplete; they do **not** validate anything at runtime.

### `generate`

| Option | Default | Description |
|---|---|---|
| `generate.output` | `.env.example` | File `envclinic generate` writes. |
| `generate.exclude` | `[]` | Variables never written (wildcards allowed). |

### `schema`

A map from variable name to a rule. Used by `validate`, by `audit`, and by `generate` and `types` for comments and types.

```ts
schema: {
  PORT: { type: "integer", min: 1, max: 65535, required: false, default: 3000 },
}
```

| Field | Applies to | Description |
|---|---|---|
| `type` | all | `string`, `number`, `integer`, `boolean`, `url`, `email`, `enum`, `custom` |
| `required` | all | Default `true`, unless a `default` is given |
| `default` | all | Used when the value is missing or empty. Must match the type |
| `description` | all | Used as a comment in generated files |
| `secret` | all | Marks the variable as sensitive; its default is never written to generated files |
| `minLength`, `maxLength` | `string` | Length limits |
| `pattern` | `string` | Regular expression source the value must match |
| `min`, `max` | `number`, `integer` | Inclusive range |
| `values` | `enum` | Allowed values |
| `protocols` | `url` | Allowed protocols, for example `["https"]` |
| `validate` | `custom` | `(value) => boolean \| string \| void`. `true`/nothing is valid; `false` or a message is invalid. JavaScript configs only |

Behavior to know:

- **Empty means missing.** `PORT=` is treated like an unset `PORT`.
- Booleans accept `true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off` in any case.
- Messages say *what* is wrong ("PORT must be a number") and never include the value.
- Variables not in the schema are ignored.

## Using the schema at runtime

The same schema can validate `process.env` when your app starts:

```ts
import { assertEnv, defineSchema } from "envclinic";

const schema = defineSchema({
  PORT: { type: "integer", required: false, default: 3000 },
  DATABASE_URL: { type: "url" },
  NODE_ENV: { type: "enum", values: ["development", "production", "test"] as const },
});

export const env = assertEnv(schema); // typed: env.PORT is a number
```

`assertEnv` throws an `EnvValidationError` listing every problem (without values). Use `validateEnv(schema, env)` to get `{ success, values, errors }` instead of an exception.
