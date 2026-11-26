# Demo script (about 3 minutes)

A shot-by-shot script for recording a terminal demo (for example with [asciinema](https://asciinema.org/) or any screen recorder). All values are fake.

## Setup (off camera)

```bash
mkdir demo && cd demo && git init -q
cat > package.json <<'EOF'
{ "name": "demo", "dependencies": { "next": "14.0.0", "react": "18.0.0" } }
EOF
cat > .env <<'EOF'
DATABASE_URL=postgresql://localhost:5432/app
JWT_SECRET=my-secret
NEXT_PUBLIC_API_SECRET=abc
OLD_API_KEY=x9Qm2LpVz7TnRw4YkB8sXc1Dh
EOF
printf 'DATABASE_URL=\nJWT_SECRET=\nREDIS_URL=\n' > .env.example
mkdir -p app && cat > app/page.ts <<'EOF'
export const db = process.env.DATABASE_URL;
export const jwt = process.env.JWT_SECRET;
export const stripe = process.env.STRIPE_SECRET_KEY;
EOF
```

## Scenes

1. **The problem (20s).** Show `.env` and `.env.example` side by side. Say: "A teammate adds a variable and forgets the example. Another one is never used. A secret is weak. Nobody notices until production."
2. **One command (40s).** Run `npx envclinic`. Point at: framework detected, the missing `REDIS_URL`, the undocumented variables, `OLD_API_KEY` as *potentially* unused, `STRIPE_SECRET_KEY` used but undeclared, the weak `JWT_SECRET`, and `NEXT_PUBLIC_API_SECRET` exposed to the browser. Stress that `Value: ********`: no value is ever printed.
3. **Fix the safe part (30s).** `npx envclinic audit --fix --dry-run`, then `npx envclinic audit --fix`. Show that it only appends names to `.env.example` and asks first.
4. **Types (30s).** `npx envclinic types`, open `env.d.ts`, show autocomplete for `process.env.`.
5. **Schema (30s).** Add a `schema` to `envclinic.config.json` (`PORT` as integer, `JWT_SECRET` minLength 32), run `npx envclinic validate`.
6. **CI (20s).** Show the GitHub Actions snippet from the README and a pull request with annotations on the offending line.
7. **Close (10s).** "No network, no values printed, never touches your real `.env`. `npm i -D envclinic`."

## Tips

- Use `--no-color` for clean text captures; keep colors on for the recording.
- Record at 100 columns wide so the report box is not wrapped.
- Re-run the setup between takes.
