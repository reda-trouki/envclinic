import { describe, expect, it } from "vitest";
import {
  BUILTIN_PATTERNS,
  buildPatterns,
  findValueMatch,
  isSecretName,
  scanTextForSecrets,
  shannonEntropy,
  weakSecretReason,
} from "../../src/core/secrets-detector";

const patterns = buildPatterns();
const match = (value: string, name = "SOME_VAR") =>
  findValueMatch(value, name, patterns)?.id;

// Test credentials are assembled at runtime so this file does not itself contain scannable secrets.
const fake = {
  aws: "AKIA" + "IOSFODNN7EXAMPLE",
  github: "ghp_" + "a".repeat(36),
  githubFine: "github_pat_" + "A1b2C3d4E5f6G7h8I9j0K1l2",
  slack: "xoxb-" + "1234567890-abcdefghij",
  stripe: "sk_live_" + "a1B2c3D4e5F6g7H8i9J0",
  google: "AIza" + "SyA1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q",
  sendgrid: "SG." + "abcdefghijklmnop" + "." + "qrstuvwxyz012345",
  npm: "npm_" + "a".repeat(36),
  anthropic: "sk-ant-" + "abcdefghijklmnopqrstuvwxyz",
  openai: "sk-" + "a1B2c3D4e5".repeat(5),
  twilio: "SK" + "0123456789abcdef".repeat(2),
  jwt:
    "eyJhbGciOiJIUzI1" +
    "." +
    "eyJzdWIiOiIxMjM0NTY3" +
    "." +
    "SflKxwRJSMeKKF2QT4fw",
  pem: "-----BEGIN RSA " + "PRIVATE KEY-----",
};

describe("provider patterns", () => {
  it.each([
    ["aws-access-key-id", fake.aws],
    ["github-token", fake.github],
    ["github-fine-grained-token", fake.githubFine],
    ["slack-token", fake.slack],
    ["stripe-secret-key", fake.stripe],
    ["google-api-key", fake.google],
    ["sendgrid-api-key", fake.sendgrid],
    ["npm-token", fake.npm],
    ["anthropic-api-key", fake.anthropic],
    ["openai-api-key", fake.openai],
    ["twilio-api-key", fake.twilio],
    ["json-web-token", fake.jwt],
    ["private-key", fake.pem],
  ])("detects %s", (id, value) => {
    expect(match(value)).toBe(id);
  });

  it("does not flag ordinary values", () => {
    for (const value of [
      "3000",
      "https://api.example.com",
      "postgresql://localhost:5432/app",
      "true",
      "hello world",
      "sk_test_abcdefghijklmnop1234",
    ]) {
      expect(match(value), value).toBeUndefined();
    }
  });

  it("detects URLs with real-looking passwords but not placeholders", () => {
    expect(match("postgresql://admin:Xk29vLpQ7@db.internal:5432/app")).toBe(
      "credentialed-url",
    );
    for (const placeholder of [
      "postgresql://user:password@localhost/db",
      "postgresql://user:pass@localhost/db",
      "mysql://root:<password>@localhost/db",
      "redis://default:${REDIS_PASSWORD}@host:6379",
      "postgres://postgres:postgres@localhost/db",
    ]) {
      expect(match(placeholder), placeholder).toBeUndefined();
    }
  });

  it("detects the AWS secret access key by variable name only", () => {
    const value = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    expect(findValueMatch(value, "AWS_SECRET_ACCESS_KEY", patterns)?.id).toBe(
      "aws-secret-access-key",
    );
    expect(findValueMatch(value, "SOMETHING_ELSE", patterns)).toBeUndefined();
  });

  it("supports custom patterns", () => {
    const custom = buildPatterns([
      {
        id: "internal",
        description: "internal token",
        pattern: "^corp-[0-9]{6}$",
        severity: "warning",
      },
    ]);
    const found = findValueMatch("corp-123456", "X", custom);
    expect(found).toMatchObject({
      id: "internal",
      severity: "warning",
      description: "internal token",
    });
  });

  it("has unique pattern ids", () => {
    const ids = BUILTIN_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("scanTextForSecrets", () => {
  it("reports line numbers and never the matched text", () => {
    const text = `const ok = 1;\nconst token = "${fake.github}";\n`;
    const result = scanTextForSecrets(text, patterns);
    expect(result).toHaveLength(1);
    expect(result[0]?.line).toBe(2);
    expect(JSON.stringify(result)).not.toContain(fake.github);
  });

  it("skips lines marked with envclinic-ignore", () => {
    expect(
      scanTextForSecrets(
        `const t = "${fake.github}"; // envclinic-ignore`,
        patterns,
      ),
    ).toEqual([]);
  });

  it("does not apply name-dependent patterns to source code", () => {
    expect(
      scanTextForSecrets(
        "const x = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';",
        patterns,
      ),
    ).toEqual([]);
  });

  it("skips absurdly long lines such as minified bundles", () => {
    expect(
      scanTextForSecrets(`${"x".repeat(10_001)}${fake.github}`, patterns),
    ).toEqual([]);
  });
});

describe("secret name heuristics", () => {
  it.each([
    "JWT_SECRET",
    "DB_PASSWORD",
    "API_KEY",
    "GITHUB_TOKEN",
    "STRIPE_SECRET_KEY",
    "PRIVATE_KEY",
    "AUTH_TOKEN",
    "CLIENT_SECRET",
  ])("%s looks secret", (name) => expect(isSecretName(name)).toBe(true));

  it.each([
    "PORT",
    "DATABASE_URL",
    "TOKEN_EXPIRES_IN",
    "SECRET_NAME",
    "NEXT_PUBLIC_API_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "PASSWORD_MIN_LENGTH",
    "NODE_ENV",
    "KEYBOARD",
  ])("%s does not", (name) => expect(isSecretName(name)).toBe(false));
});

describe("weakSecretReason", () => {
  it("flags placeholders, short values and low entropy", () => {
    expect(weakSecretReason("changeme")).toMatch(/placeholder/);
    expect(weakSecretReason("secret")).toMatch(/placeholder/);
    expect(weakSecretReason("your-secret-here")).toMatch(/placeholder/);
    expect(weakSecretReason("my-secret")).toMatch(/shorter/);
    expect(weakSecretReason("123456")).toBeDefined();
    expect(weakSecretReason("aaaaaaaaaaaaaaaaaaaaaaaa")).toBe("low entropy");
  });

  it("accepts strong values, references, booleans and empty values", () => {
    expect(
      weakSecretReason("k8Jd92Lm4Qx7Vb1Zp3Nt6Rw0Ys5Fh2Gc"),
    ).toBeUndefined();
    expect(weakSecretReason("${OTHER_VAR}")).toBeUndefined();
    expect(weakSecretReason("$OTHER")).toBeUndefined();
    expect(weakSecretReason("true")).toBeUndefined();
    expect(weakSecretReason("")).toBeUndefined();
  });

  it("computes entropy", () => {
    expect(shannonEntropy("")).toBe(0);
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("abab")).toBeCloseTo(1);
    expect(shannonEntropy("abcdefgh")).toBeCloseTo(3);
  });
});
