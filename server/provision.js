import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { DB_COUNT, PG, dbName, rolePassword } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedSql = fs.readFileSync(path.join(here, "../db/seed.sql"), "utf8");
const SEED_MARKER = "seeded";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`; // only used for generated values

async function withClient(config, fn) {
  const client = new pg.Client(config);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export function studentConfig(n) {
  return {
    host: PG.host,
    port: PG.port,
    user: dbName(n),
    password: rolePassword(n),
    database: dbName(n),
    statement_timeout: 5000,
    query_timeout: 10000,
    connectionTimeoutMillis: 5000,
  };
}

export async function seedDatabase(n) {
  await withClient(studentConfig(n), (c) => c.query(seedSql));
}

export async function resetDatabase(n) {
  await withClient(studentConfig(n), async (c) => {
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await c.query(seedSql);
  });
}

async function waitForPostgres() {
  for (let i = 0; i < 60; i++) {
    try {
      await withClient({ ...PG, database: "postgres" }, (c) => c.query("SELECT 1"));
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error("PostgreSQL did not become ready in time");
}

export async function provision() {
  await waitForPostgres();
  await withClient({ ...PG, database: "postgres" }, async (admin) => {
    for (let n = 1; n <= DB_COUNT; n++) {
      const name = dbName(n);
      const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);
      const pw = lit(rolePassword(n));
      if (role.rowCount === 0) {
        await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD ${pw} CONNECTION LIMIT 10`);
      } else {
        await admin.query(`ALTER ROLE ${name} PASSWORD ${pw}`);
      }
      await admin.query(`ALTER ROLE ${name} SET statement_timeout = '5s'`);

      const db = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      if (db.rowCount === 0) {
        await admin.query(`CREATE DATABASE ${name} OWNER ${name}`);
      }
      // Nobody except the owner (and superusers) may connect to a playground.
      await admin.query(`REVOKE CONNECT ON DATABASE ${name} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${name} TO ${name}`);

      const marker = await admin.query(
        "SELECT shobj_description(oid, 'pg_database') AS c FROM pg_database WHERE datname = $1",
        [name],
      );
      if (marker.rows[0].c !== SEED_MARKER) {
        await seedDatabase(n);
        await admin.query(`COMMENT ON DATABASE ${name} IS '${SEED_MARKER}'`);
        console.log(`Created and seeded ${name}`);
      }
    }
  });
  console.log(`All ${DB_COUNT} playground databases are ready.`);
}
