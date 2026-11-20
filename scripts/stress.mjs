// Simulates a class using the playground. Every student gets a UNIQUE database number (max 50).
//   node scripts/stress.mjs [baseUrl] [students] [queriesEach] [thinkMs]   one run
//   node scripts/stress.mjs [baseUrl] --ramp [queriesEach]                 raise the load until requests queue
// Env: APP_PASSWORD (default sqlrocks). Mix: mostly cheap queries, some heavy joins, a few slow ones.
const args = process.argv.slice(2);
const base = args[0] || "http://localhost:3000";
const RAMP = args.includes("--ramp");
const nums = args.slice(1).filter((a) => !a.startsWith("--"));
const PASSWORD = process.env.APP_PASSWORD || "sqlrocks";

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

async function runLoad(N, R, THINK) {
  if (N > 50) throw new Error("Only 50 databases exist, so at most 50 unique students");
  const stats = { ok: 0, error: 0, busy: 0, rejected: 0, latencies: [], waits: [] };
  async function student(i) {
    const login = await post("/api/login", { password: PASSWORD, number: i + 1 });
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
  stats.secs = (Date.now() - t0) / 1000;
  return stats;
}

const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const summary = (label, s) =>
  `${label}: ${(s.ok / s.secs).toFixed(0)} ok/s | ok ${s.ok} err ${s.error} 503 ${s.busy} 429 ${s.rejected} | ` +
  `p50 ${pct(s.latencies, 0.5)} p95 ${pct(s.latencies, 0.95)} max ${pct(s.latencies, 1)} ms | ` +
  `queued ${s.waits.length} (max wait ${Math.max(0, ...s.waits)} ms)`;

if (!RAMP) {
  const [students = "25", rounds = "20", think = "500"] = nums;
  console.log(summary(`${students} students, think ${think} ms`, await runLoad(Number(students), Number(rounds), Number(think))));
} else {
  // Step 1: add students (10..50, unique databases). Step 2: at 50 students shrink the pause between queries.
  const R = Number(nums[0] || 20);
  const steps = [...[10, 20, 30, 40, 50].map((n) => [n, 500]), ...[250, 100, 50, 20, 0].map((t) => [50, t])];
  for (const [n, think] of steps) {
    const s = await runLoad(n, R, think);
    console.log(summary(`${String(n).padStart(2)} students, think ${String(think).padStart(3)} ms`, s));
    if (s.waits.length || s.busy) {
      console.log(`\n>>> First queueing: ${n} students, ~${think} ms between queries (${s.waits.length} queued, max wait ${Math.max(0, ...s.waits)} ms).`);
      process.exit(0);
    }
  }
  console.log("\n>>> No queueing even at 50 students with no pause between queries.");
}
