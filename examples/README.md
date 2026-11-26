# Examples

Small projects showing envclinic with different frameworks. None of them contain a real `.env` file, so run an audit after creating one:

```bash
cd examples/nextjs
cp .env.example .env      # then fill in values
npx envclinic            # audit
npx envclinic types      # generate env.d.ts
```

| Example | Shows |
|---|---|
| [`nextjs`](./nextjs) | JSON config, schema with descriptions, `NEXT_PUBLIC_` handling, types freshness check |
| [`express`](./express) | JavaScript config with `defineConfig`, stricter rules |
| [`nestjs`](./nestjs) | Destructured `process.env`, scanning only `src`, `types --check` in CI |
