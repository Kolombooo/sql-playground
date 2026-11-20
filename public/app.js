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

// ---------- structure sidebar ----------
async function loadSchema() {
  const box = $("schema");
  const { ok, data } = await api("/api/schema");
  box.replaceChildren();
  if (!ok) return box.append(el("p", "text-red-600", data.error || "Could not load structure."));
  if (!data.tables.length) return box.append(el("p", "text-slate-500", "No tables yet."));
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
  if (!sql.trim()) return;
  $("run").disabled = true;
  $("status").textContent = "Running…";
  const out = $("output");
  const { ok, data } = await api("/api/query", { sql });
  out.replaceChildren();
  if (!ok) {
    out.append(el("pre", "bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm whitespace-pre-wrap font-mono", data.error || "Error"));
    $("status").textContent = data.ms != null ? `Failed after ${data.ms} ms` : "";
  } else {
    data.results.forEach((r) => out.append(renderResult(r)));
    $("status").textContent = `Done in ${data.ms} ms`;
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
  loadSchema();
})();
