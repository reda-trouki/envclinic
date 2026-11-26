# Contributing to envclinic

Thanks for helping. This guide covers how to set up, what we care about, and how changes are released.

## Setup

```bash
git clone <your fork>
cd envclinic
npm install
npm run typecheck
npm test
npm run build
```

Node.js 18 or newer is required. Try the built CLI against any project:

```bash
node dist/cli/index.js --cwd path/to/project
```

## How the code is organized

```text
src/
  cli/          Commander wiring, one file per command, output formatters, prompts
  core/         env parser, project loader, auditor, scanner, secrets detector,
                validator, generators, safe file writer
  analyzers/    one small independent module per kind of finding
  config/       config loading, validation, defaults
  frameworks/   framework detection
tests/
  unit/ integration/ cli/ security/ fixtures/
```

An analyzer takes parsed data and returns `RawIssue[]`. To add a check: write the analyzer, call it from `collectIssues` in `src/core/auditor.ts`, add a rule name in `src/types.ts` and `src/config/defaults.ts`, and document the issue code in `docs/cli-reference.md`.

## Ground rules

These come from the project's purpose; pull requests that break them cannot be merged.

1. **Never output a value.** Issues carry names, files and line numbers only. Do not add fields, messages, logs or error text that can include an env value or the text of a source line. If you add a command or analyzer, add it to `tests/security/leaks-all-commands.test.ts`.
2. **Never write outside the project or to real env files.** Use `writeProjectFile`; do not call `fs.writeFile` directly.
3. **Never execute project code.** Read files as text.
4. **Be honest about uncertainty.** Static analysis says "potentially", detection says "potential", never "definitely".
5. **Keep dependencies minimal.** Do not add a dependency for a small utility.

## Tests

```bash
npm test                              # everything
npx vitest run tests/unit/parser.test.ts
npm run typecheck
```

- Fixtures for framework projects live in `tests/fixtures/`. Files named `dot-env*` are renamed to `.env*` when copied (`copyFixture` in `tests/helpers.ts`), because real `.env` files are git-ignored. Use only obviously fake values.
- Build fake credentials at runtime (`"ghp_" + "a".repeat(36)`) so test files do not trip secret scanners.
- Tests that need symlinks skip themselves when the platform cannot create them.

## Pull requests

1. Open an issue first for anything larger than a small fix.
2. Keep the change focused and include tests.
3. Run `npm run typecheck && npm test && npm run build`.
4. Add a changeset describing the change for users:

   ```bash
   npx changeset
   ```

   Choose `patch` for fixes, `minor` for features, `major` for breaking changes. Pure documentation or test changes do not need one.

## Releasing (maintainers)

Releases use [Changesets](https://github.com/changesets/changesets) and npm provenance.

1. Merge pull requests that include changesets. A "Version Packages" pull request is opened automatically.
2. Merging that pull request publishes to npm from GitHub Actions (`.github/workflows/release.yml`).

One-time setup before the first release:

- Add the `repository` field to `package.json` (npm provenance requires it to match the GitHub repository).
- Add an `NPM_TOKEN` secret (an npm automation token) to the repository.
- Check the package name is available: `npm view envclinic` should return 404.
- Run `npm pack --dry-run` and inspect the file list.
- Test a clean install of the packed tarball: `npm pack`, then `npm install ./envclinic-<version>.tgz` in an empty project and run `npx envclinic --version`.

## Reporting bugs and security issues

Use the issue templates for bugs and feature requests. For vulnerabilities, see [SECURITY.md](./SECURITY.md); please do not open a public issue.
