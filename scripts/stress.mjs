// Simulates a class using the playground.
//   node scripts/stress.mjs [baseUrl] [students] [queriesEach] [thinkMs]
//   node scripts/stress.mjs http://localhost:3000 25 20 500
// Env: APP_PASSWORD (default sqlrocks). Mix: mostly cheap queries, some heavy joins, a few slow ones.
const [base = "http://localhost:3000", students = "25", rounds = "20", think = "500"] = process.argv.slice(2);
const PASSWORD = process.env.APP_PASSWORD || "sqlrocks";
const N = Number(students), R = Number(rounds), THINK = Number(think);

const QUERIES = [
  ["cheap", "SELECT * FROM students LIMIT 20", 60],
  ["cheap", "SELECT class_name, count(*) FROM students GROUP BY class_name", 60],
  ["heavy", "SELECT s.name, avg(g.grade) FROM grades g JOIN lessons l ON l.id=g.lesson_id JOIN subjects s ON s.id=l.subject_id GROUP BY s.name", 25],
  ["heavy", "SELECT count(*) FROM attendance a JOIN grades g ON g.student_id=a.student_id", 10],
  ["slow", "SELECT pg_sleep(2)", 5],
];
const pick = () => { let r = Math.random() * 160; for (const q of QUERIES) if ((r -= q[2]) < 0) return q; return QUERIES[0]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, body, cookie) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });

const stats = { ok: 0, error: 0, busy: 0, rejected: 0, latencies: [], waits: [] };

async function student(i) {
  const login = await post("/api/login", { password: PASSWORD, number: 1 + (i % 50) });
  if (!login.ok) { console.error("login failed", login.status); stats.error++; return; }
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  await sleep(Math.random() * THINK);
  for (let k = 0; k < R; k++) {
    const [, sql] = pick();
    const t = Date.now();
    try {
      const res = await post("/api/query", { sql, ticket: crypto.randomUUID() }, cookie);
      const d = await res.json();
      stats.latencies.push(Date.now() - t);
      if (res.status === 200) { stats.ok++; if (d.queue) stats.waits.push(d.queue.waitedMs); }
      else if (res.status === 503) stats.busy++;
      else if (res.status === 429) stats.rejected++;
      else stats.error++;
    } catch { stats.error++; }
    await sleep(THINK * (0.5 + Math.random()));
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: N }, (_, i) => student(i)));
const secs = (Date.now() - t0) / 1000;
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
console.log(`${N} students x ${R} queries in ${secs.toFixed(1)}s (${(stats.ok / secs).toFixed(1)} ok/s)`);
console.log(`ok ${stats.ok}  errors ${stats.error}  busy(503) ${stats.busy}  duplicate(429) ${stats.rejected}`);
console.log(`latency ms  p50 ${pct(stats.latencies, 0.5)}  p95 ${pct(stats.latencies, 0.95)}  max ${pct(stats.latencies, 1)}`);
console.log(`queued ${stats.waits.length} requests, max wait ${Math.max(0, ...stats.waits)} ms`);
