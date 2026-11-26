# Draft article: "Your .env is a contract. Audit it."

*A starting point for a blog post or dev.to article. Replace the intro with your own story.*

## The bug that is not in your code

Most configuration bugs are not logic errors. A teammate adds `REDIS_URL` locally and never updates `.env.example`. A variable is renamed in code but not in the deployment. A `NEXT_PUBLIC_` prefix quietly ships a secret to the browser. A "temporary" `JWT_SECRET=secret` survives to production.

They have one thing in common: the failure shows up late, far from the cause.

## What I wanted

One command that answers, before a deploy:

- What does the code need that nobody documented?
- What is documented or set that nothing uses?
- Is anything weak, duplicated or exposed?
- Does the config match the rules we agreed on?

envclinic does this for the files and code around your configuration. It is deliberately not another runtime validation library; it works alongside Zod, Envalid or T3 Env.

```bash
npx envclinic
```

## Design choices worth sharing

**It never prints a value.** Findings are built from names, file paths and line numbers; there is no field that could hold a secret. A test suite plants marker values in every place the tool looks and asserts that none appears in any command's output.

**It says "potentially".** Static analysis cannot see `process.env[name]` or tools that read variables outside your code. Reporting "unused" as fact would get the tool uninstalled the first time it was wrong. So it reports potentially unused variables, flags when dynamic access makes the answer less certain, and never deletes anything.

**Context decides severity.** A Stripe key in a git-ignored `.env` is expected. The same key in `.env.example` or an unignored `.env` is an incident waiting to happen. envclinic reads `.gitignore` to tell the difference instead of crying wolf on every developer machine.

**Fixes are narrow.** `audit --fix` only appends variable *names* to the example file, asks first, and refuses to touch real env files.

## Try it

```bash
npm install --save-dev envclinic
npx envclinic init
npx envclinic
```

Add `npx envclinic audit --ci` to CI and findings appear as annotations on the pull request.

## What it is not

It is not a replacement for a dedicated secret scanner: a clean report does not prove there are no secrets. Pair it with gitleaks or GitHub secret scanning for history and broad coverage.

*Feedback and false-positive reports are welcome in the issue tracker.*
