import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

function optional(name: string): string {
  return process.env[name] ?? "";
}

export const env = {
  appId: optional("APP_ID") || "dev-app-id",
  appSecret: optional("APP_SECRET") || "dev-secret",
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: optional("DATABASE_URL") || "./dev.db",
  kimiAuthUrl: optional("KIMI_AUTH_URL") || "https://auth.kimi.com",
  kimiOpenUrl: optional("KIMI_OPEN_URL") || "https://open.kimi.com",
  ownerUnionId: process.env.OWNER_UNION_ID ?? "",
};
