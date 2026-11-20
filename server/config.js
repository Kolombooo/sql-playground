import crypto from "node:crypto";

export const DB_COUNT = 50;
export const APP_PASSWORD = process.env.APP_PASSWORD || "sqlrocks";
export const COOKIE_SECRET = process.env.COOKIE_SECRET || "change-me-secret";
export const PORT = Number(process.env.PORT || 3000);

export const PG = {
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
};

export const dbName = (n) => `playground${n}`;

// Each playgroundX database has its own role (same name) that owns it.
// Students only ever connect as that role, so they cannot touch other databases.
export const rolePassword = (n) =>
  crypto.createHmac("sha256", COOKIE_SECRET).update(`role:${n}`).digest("hex");

export const sign = (n) =>
  crypto.createHmac("sha256", COOKIE_SECRET).update(`auth:${n}`).digest("hex");
