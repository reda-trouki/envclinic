# Security

envclinic reads files that contain secrets, so its first job is to never make anything worse. This page lists what it guarantees, how it classifies findings, and where it can be wrong.

## Guarantees

1. **Nothing is sent over the network.** envclinic has no network code.
2. **Values are never printed.** Terminal output, JSON, GitHub annotations, errors, and `--verbose` output contain variable *names*, file paths and line numbers only. Findings have no field that can hold a value.
3. **Values are never written to generated files.** `generate` and `types` write names and types. Defaults of variables marked `secret: true` are never written.
4. **Real env files are never modified.** `generate` and `--fix` refuse to write to `.env`, `.env.local`, `prod.env` and similar. Only template names (`.env.example`, `.env.sample`...) are accepted.
5. **Writes are cautious.** Existing files are not replaced without `--force`, `--merge` or a confirmation. Writes go through a temporary file and a rename, refuse symlinks, and refuse any path that leaves the project.
6. **Your application code is not executed.** Source files are read as text. `package.json` is parsed as data. Package scripts are never run. The one exception is your own envclinic config file when it is JavaScript (see below).
7. **Reads stay inside the project.** Paths outside the project, symlinks pointing outside it, directories, and env files over 5 MB are refused. Symlinks are never followed during scanning.

These guarantees are enforced by automated tests that run every command against a project full of marker values and assert that none of them appears in any output or generated file.

### The config file

`envclinic.config.mjs/.js/.cjs/.ts` is JavaScript and is executed when loaded, like any tool config (Vite, ESLint...). Only use config files you trust, which in practice means the ones in your own repository. `envclinic.config.json` is data and is never executed.

## How findings are classified

The same credential can be fine in one place and serious in another, so severity depends on where it sits.

| Where | Severity | Why |
|---|---|---|
| A credential-shaped value in a **template** (`.env.example`) | error | Templates are committed |
| In an env file that is **not** git-ignored | error | It may be committed |
| In an env file that **is** git-ignored | info | Expected for local development. Make sure it stays ignored |
| In an env file outside a git repository | warning | Ignore status is unknown |
| In **source code** | error (provider tokens) or warning (URLs with credentials, JWTs) | Source is committed |

Other checks:

- **`env-file-not-ignored`** (error): an env file with values that `.gitignore` does not cover. envclinic reads `.gitignore` files and `.git/info/exclude` itself; it does not run git and does not know about a global ignore file.
- **`public-secret`**: a variable such as `NEXT_PUBLIC_API_SECRET` ends up in the browser bundle. Error when its value looks like a real credential, warning when only the name looks secret.
- **`weak-secret`** (warning): a variable whose name suggests a secret (`*_SECRET`, `*_PASSWORD`, `*_TOKEN`, `API_KEY`...) has a value that is a placeholder or common default, shorter than 12 characters, or low entropy. Only checked in your own env files, not templates.
- **`secret-in-example`** (warning): the template holds a non-placeholder value for a secret-looking variable.

Detected credential types: AWS access keys and secret keys, GitHub tokens, Slack tokens, Stripe live keys, Google API keys, private key blocks, SendGrid, npm, Anthropic, OpenAI and Twilio keys, JSON Web Tokens, and URLs with embedded passwords. Placeholder passwords such as `password`, `changeme` or `${DB_PASSWORD}` are not flagged.

## Detection is conservative, and it is not a scanner

Patterns are chosen to produce few false alarms. That means:

- **A clean report does not prove there are no secrets.** Credentials without a recognizable shape (a random 32-character string in a variable named `FOO`) are only caught by the name-based weak-secret check.
- **Findings mean "potentially exposed", not "compromised".** envclinic cannot know whether a value is real or was ever pushed.
- Use a dedicated scanner (for example gitleaks or GitHub secret scanning) for history scanning and broad coverage. envclinic complements those.

### Handling false positives

- `secrets.allow`: exempt variables by name (wildcards allowed).
- `secrets.ignoreFiles`: skip source files by glob (test fixtures, for example).
- `envclinic-ignore` on a line of source code skips that line.
- `ignore.variables`: skip a variable for every check.
- `rules.secrets` / `rules.weak`: lower or turn off a whole category.

## Known limitations

- **Variable names are printed.** If a line pasted into an env file parses as `NAME=`, the "name" is reported. Unquoted multi-line secrets (PEM keys) should be wrapped in quotes. envclinic treats `NAME==...` (typical base64 padding) as malformed and reports only the line number, but a pasted line ending in a single `=` is indistinguishable from an empty variable.
- **Unused-variable detection is static analysis.** It cannot see dynamic access (`process.env[name]`), aliases (`const env = process.env`), tools that read variables outside your code (Prisma, Docker, CI), or code outside the scanned directories. Results say *potentially* unused and envclinic never deletes anything.
- **Merge dry-runs echo your template.** `generate --merge --dry-run` prints the existing template with the new names appended, so anything you already wrote in the template is shown.
- Framework detection reads `package.json` and config file names. It does not understand custom prefix settings (for example Vite's `envPrefix`); set `publicPrefixes` when yours differ.

## Reporting a vulnerability

Please do not open a public issue. See [SECURITY.md](../SECURITY.md).
