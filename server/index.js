import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { APP_PASSWORD, DB_COUNT, PORT, dbName, sign } from "./config.js";
import { provision, resetDatabase, studentConfig } from "./provision.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, "../public");
const MAX_ROWS = 500;

// Return dates/timestamps as plain strings (no timezone shifting in the browser).
for (const oid of [1082, 1114, 1184]) pg.types.setTypeParser(oid, (v) => v);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

// ---------- cookies ----------
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const safeEqual = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// The database number lives in the plain `playground` cookie. A second, signed
// `auth` cookie proves the password was entered for that number.
function currentDb(req) {
  const c = parseCookies(req);
  const n = Number(c.playground);
  if (!Number.isInteger(n) || n < 1 || n > DB_COUNT) return null;
  if (!c.auth || !safeEqual(c.auth, sign(n))) return null;
  return n;
}

function requireDb(req, res, next) {
  const n = currentDb(req);
  if (!n) return res.status(401).json({ error: "Not logged in" });
  req.dbNumber = n;
  next();
}

// ---------- login ----------
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  attempts.set(ip, list);
  return list.length > 10;
}

app.post("/api/login", (req, res) => {
  if (tooManyAttempts(req.ip)) return res.status(429).json({ error: "Too many attempts, wait a minute." });
  const { password, number } = req.body || {};
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1 || n > DB_COUNT) {
    return res.status(400).json({ error: `Choose a number between 1 and ${DB_COUNT}.` });
  }
  if (typeof password !== "string" || !safeEqual(password, APP_PASSWORD)) {
    return res.status(401).json({ error: "Wrong password." });
  }
  const maxAge = 30 * 24 * 3600;
  res.setHeader("Set-Cookie", [
    `playground=${n}; Path=/; Max-Age=${maxAge}; SameSite=Lax`,
    `auth=${sign(n)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`,
  ]);
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", [
    "playground=; Path=/; Max-Age=0; SameSite=Lax",
    "auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
  ]);
  res.json({ ok: true });
});

// ---------- database access ----------
async function withStudentClient(n, fn) {
  const client = new pg.Client(studentConfig(n));
  client.on("error", () => {});
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

app.get("/api/me", requireDb, (req, res) => {
  res.json({ number: req.dbNumber, database: dbName(req.dbNumber) });
});

// Structure only: tables, columns, keys and a row count per table (never content).
app.get("/api/schema", requireDb, async (req, res) => {
  try {
    const tables = await withStudentClient(req.dbNumber, async (c) => {
      const cols = await c.query(`
        SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.ordinal_position,
               EXISTS (SELECT 1 FROM information_schema.table_constraints tc
                       JOIN information_schema.key_column_usage k
                         ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
                       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema
                         AND tc.table_name = c.table_name AND k.column_name = c.column_name) AS is_pk
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_name, c.ordinal_position`);
      const fks = await c.query(`
        SELECT kcu.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);
      const fkMap = new Map(fks.rows.map((f) => [`${f.table_name}.${f.column_name}`, `${f.ref_table}.${f.ref_column}`]));

      const byTable = new Map();
      for (const r of cols.rows) {
        if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
        byTable.get(r.table_name).push({
          name: r.column_name,
          type: r.data_type,
          nullable: r.is_nullable === "YES",
          pk: r.is_pk,
          fk: fkMap.get(`${r.table_name}.${r.column_name}`) || null,
        });
      }
      const result = [];
      for (const [name, columns] of byTable) {
        const q = `SELECT count(*)::text AS n FROM public."${name.replace(/"/g, '""')}"`;
        const { rows } = await c.query(q);
        result.push({ name, rows: Number(rows[0].n), columns });
      }
      return result;
    });
    res.json({ tables });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/query", requireDb, async (req, res) => {
  const sql = req.body?.sql;
  if (typeof sql !== "string" || !sql.trim()) return res.status(400).json({ error: "Empty query." });
  const started = Date.now();
  try {
    const out = await withStudentClient(req.dbNumber, async (c) => {
      const r = await c.query({ text: sql, rowMode: "array" });
      return Array.isArray(r) ? r : [r];
    });
    const results = out.map((r) => ({
      command: r.command,
      rowCount: r.rowCount,
      fields: r.fields.map((f) => f.name),
      rows: r.rows.slice(0, MAX_ROWS).map((row) =>
        row.map((v) => (v !== null && typeof v === "object" && !Buffer.isBuffer(v) ? JSON.stringify(v) : Buffer.isBuffer(v) ? `\\x${v.toString("hex")}` : v)),
      ),
      truncated: r.rows.length > MAX_ROWS,
    }));
    res.json({ results, ms: Date.now() - started });
  } catch (e) {
    res.status(400).json({ error: e.message, position: e.position ? Number(e.position) : null, ms: Date.now() - started });
  }
});

// Drop everything in the student's database and reload the sample data.
app.post("/api/reset", requireDb, async (req, res) => {
  try {
    await resetDatabase(req.dbNumber);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- pages ----------
app.get("/", (req, res) => {
  res.sendFile(path.join(pub, currentDb(req) ? "app.html" : "login.html"));
});
app.use(express.static(pub, { index: false, extensions: [] }));

provision()
  .then(() => app.listen(PORT, () => console.log(`SQL playground listening on :${PORT}`)))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
