const $ = (id) => document.getElementById(id);
const sqlBox = $("sql");

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { location.href = "/"; throw new Error("Not logged in"); }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// ---------- SQL syntax highlighting ----------
// A coloured <pre> sits behind a transparent <textarea>. Only colours are used (no bold/italic)
// so both layers keep identical glyph widths.
const KEYWORDS = new Set(`select from where group by order having limit offset distinct as on using join inner left right full outer cross natural
  union all intersect except insert into values update set delete create table drop alter add column constraint primary key foreign references
  unique check default index view with recursive and or not in is null like ilike between exists any some case when then else end asc desc
  returning begin commit rollback truncate if cascade restrict true false fetch first next rows only over partition window filter lateral
  grant revoke explain analyze schema database`.split(/\s+/));
const TYPES = new Set(`int integer bigint smallint serial bigserial text varchar char character varying boolean bool date time timestamp timestamptz
  interval numeric decimal real double precision float json jsonb uuid bytea`.split(/\s+/));
const TOKEN = /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_$]*)|(<>|<=|>=|!=|\|\||::|[-+*\/%=<>])/g;
const known = { tables: new Set(), columns: new Set() };
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const span = (cls, t) => `<span class="${cls}">${esc(t)}</span>`;

function highlight(src) {
  let out = "";
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    out += esc(src.slice(last, m.index));
    last = m.index + m[0].length;
    const [t, comment, str, quoted, num, word, op] = m;
    if (comment) out += span("text-slate-400", t);
    else if (str) out += span("text-emerald-600", t);
    else if (quoted) out += span("text-amber-700", t);
    else if (num) out += span("text-orange-500", t);
    else if (op) out += span("text-pink-600", t);
    else if (word) {
      const w = word.toLowerCase();
      const isCall = /^\s*\(/.test(src.slice(last, last + 20));
      if (KEYWORDS.has(w)) out += span("text-indigo-600", t);
      else if (known.tables.has(w)) out += span("text-purple-700", t);
      else if (known.columns.has(w)) out += span("text-cyan-700", t);
      else if (isCall) out += span("text-sky-600", t);
      else if (TYPES.has(w)) out += span("text-teal-600", t);
      else out += esc(t);
    } else out += esc(t);
  }
  return out + esc(src.slice(last));
}

const hlBox = $("hl");
function paint() {
  hlBox.innerHTML = highlight(sqlBox.value) + "\n ";
  hlBox.scrollTop = sqlBox.scrollTop;
  hlBox.scrollLeft = sqlBox.scrollLeft;
}
sqlBox.addEventListener("input", paint);
sqlBox.addEventListener("scroll", () => { hlBox.scrollTop = sqlBox.scrollTop; hlBox.scrollLeft = sqlBox.scrollLeft; });

// ---------- structure sidebar ----------
async function loadSchema() {
  const box = $("schema");
  const { ok, data } = await api("/api/schema");
  box.replaceChildren();
  if (!ok) return box.append(el("p", "text-red-600", data.error || "Could not load structure."));
  if (!data.tables.length) return box.append(el("p", "text-slate-500", "No tables yet."));
  known.tables = new Set(data.tables.map((t) => t.name.toLowerCase()));
  known.columns = new Set(data.tables.flatMap((t) => t.columns.map((c) => c.name.toLowerCase())));
  paint();
  for (const t of data.tables) {
    const d = el("details", "rounded border border-slate-200");
    const s = el("summary", "cursor-pointer select-none px-2 py-1.5 flex items-center justify-between bg-slate-50 hover:bg-slate-100");
    s.append(el("span", "font-medium font-mono", t.name), el("span", "text-xs text-slate-500", `${t.rows} row${t.rows === 1 ? "" : "s"}`));
    d.append(s);
    const ul = el("ul", "px-2 py-1 space-y-0.5");
    for (const c of t.columns) {
      const li = el("li", "flex items-baseline gap-1");
      li.append(el("span", "font-mono", c.name), el("span", "text-xs text-slate-400", c.type));
      if (c.pk) li.append(el("span", "text-[10px] font-semibold bg-amber-100 text-amber-800 rounded px-1", "PK"));
      if (c.fk) li.append(el("span", "text-[10px] bg-sky-100 text-sky-800 rounded px-1", `→ ${c.fk}`));
      ul.append(li);
    }
    d.append(ul);
    box.append(d);
  }
}

// ---------- results ----------
function renderResult(r) {
  const wrap = el("div", "bg-white rounded-lg border border-slate-200 overflow-hidden");
  if (!r.fields.length) {
    wrap.append(el("p", "px-3 py-2 text-sm text-slate-700", `${r.command} — ${r.rowCount ?? 0} row(s) affected`));
    return wrap;
  }
  const scroll = el("div", "overflow-auto max-h-[28rem]");
  const table = el("table", "min-w-full text-sm font-mono");
  const thead = el("thead", "bg-slate-100 sticky top-0");
  const hr = el("tr");
  r.fields.forEach((f) => hr.append(el("th", "text-left px-3 py-1.5 font-semibold border-b border-slate-200 whitespace-nowrap", f)));
  thead.append(hr);
  const tbody = el("tbody");
  r.rows.forEach((row) => {
    const tr = el("tr", "odd:bg-white even:bg-slate-50");
    row.forEach((v) => {
      const td = el("td", "px-3 py-1 border-b border-slate-100 whitespace-nowrap");
      if (v === null) { td.textContent = "NULL"; td.classList.add("text-slate-400", "italic"); }
      else td.textContent = String(v);
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(thead, tbody);
  scroll.append(table);
  wrap.append(scroll);
  const note = r.truncated
    ? `Showing the first ${r.rows.length} of ${r.rowCount} rows.`
    : `${r.rowCount} row${r.rowCount === 1 ? "" : "s"}.`;
  wrap.append(el("p", "px-3 py-1.5 text-xs text-slate-500 border-t border-slate-200", note));
  return wrap;
}

async function run() {
  const sql = sqlBox.value;
  if (!sql.trim() || $("run").disabled) return;
  $("run").disabled = true;
  $("status").textContent = "Running…";
  const ticket = crypto.randomUUID();
  // While the request waits for a free slot, show the student their place in the queue.
  const poll = setInterval(async () => {
    try {
      const q = await (await fetch(`/api/queue/${ticket}`)).json();
      if (q.state === "queued") {
        $("status").textContent = `Server busy: you are #${q.position} in the queue (about ${Math.max(1, Math.round(q.estimateMs / 1000))} s)…`;
      }
    } catch {}
  }, 700);
  const out = $("output");
  let ok, data;
  try {
    ({ ok, data } = await api("/api/query", { sql, ticket }));
  } finally {
    clearInterval(poll);
  }
  out.replaceChildren();
  const waited = data.queue ? ` · waited ${(data.queue.waitedMs / 1000).toFixed(1)} s in queue` : "";
  if (!ok) {
    out.append(el("pre", "bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm whitespace-pre-wrap font-mono", data.error || "Error"));
    $("status").textContent = (data.ms != null ? `Failed after ${data.ms} ms` : "Failed") + waited;
  } else {
    data.results.forEach((r) => out.append(renderResult(r)));
    $("status").textContent = `Done in ${data.ms} ms${waited}`;
    loadSchema(); // structure / row counts may have changed
  }
  $("run").disabled = false;
  try { localStorage.setItem("lastSql", sql); } catch {}
}

// ---------- wiring ----------
$("run").addEventListener("click", run);
sqlBox.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
  if (e.key === "Tab") {
    e.preventDefault();
    const { selectionStart: s, selectionEnd: en } = sqlBox;
    sqlBox.setRangeText("  ", s, en, "end");
    paint();
  }
});
$("refresh").addEventListener("click", loadSchema);
$("logout").addEventListener("click", async () => { await api("/api/logout", {}); location.href = "/"; });
$("reset").addEventListener("click", async () => {
  if (!confirm("This deletes ALL your tables and data and restores the original sample data. Continue?")) return;
  $("status").textContent = "Resetting…";
  const { ok, data } = await api("/api/reset", {});
  $("status").textContent = ok ? "Database reset." : data.error || "Reset failed.";
  loadSchema();
});

(async () => {
  const { data } = await api("/api/me");
  $("dbname").textContent = data.database;
  try { sqlBox.value = localStorage.getItem("lastSql") || ""; } catch {}
  paint();
  loadSchema();
})();
