# Security policy

envclinic handles files that contain secrets, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not** open a public issue. Report it privately using GitHub's "Report a vulnerability" feature on the repository's Security tab (private vulnerability reporting). Include:

- what you found and why it matters,
- steps or a minimal project to reproduce it,
- the envclinic and Node.js versions.

You can expect an acknowledgement within a few days. Fixes are released as patch versions and credited to the reporter unless you prefer otherwise.

## What counts

Examples of in-scope problems:

- A command printing, logging or writing an environment variable **value** or source text containing one.
- Writing or reading outside the project directory, or following a symlink out of it.
- Modifying a real env file.
- Executing project code other than a JavaScript config file the user chose to add.

Missed detections (a credential format envclinic does not recognize) and false positives are not vulnerabilities; please open a normal issue or pull request. See [docs/security.md](./docs/security.md) for guarantees and known limitations.

## Supported versions

Only the latest release receives security fixes.
