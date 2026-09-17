// The homework view. Drawn in a shadow root on top of the school's page, so the page's styles can't leak in.
// Everything stays in this browser: plans and "seen" ids live in localStorage on the school site's origin.
//
// SECURITY: this runs inside the school site with the student's session, and titles, descriptions and
// attachment names are typed by other people. Every value from the adapter MUST go through esc() (or
// linkify(), which escapes first) before it reaches innerHTML, and every href through safeUrl().
// Never interpolate adapter data into markup raw.

function createUI(adapter, css) {
  const DAY = 86400000;
  const STORE = "hwb-v1";            // {plans: {id: "YYYY-MM-DD"}, seen: [ids]}
  const HOST_ID = "hwb-overlay";
  let items = [];                    // from adapter.load()
  let newIds = new Set();
  const openIds = new Set();         // cards with details expanded

  const host = document.createElement("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${css}</style>
    <div class="app" tabindex="-1"><div class="wrap">
      <header class="top">
        <div><h1 id="hello">Your <mark>homework</mark></h1><p class="sub" id="summary">Getting your homework...</p></div>
        <div class="btns">
          <button type="button" class="icon-btn" id="refresh" aria-label="Check again"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg></button>
          <button type="button" class="icon-btn text" id="close">Back to ${esc(adapter.name)}</button>
        </div>
      </header>
      <div class="banner" id="banner" hidden></div>
      <div id="body" hidden>
        <section><h2>Next two weeks</h2><div class="week" id="week" role="list"></div>
          <p class="legend"><span class="k due"></span>due <span class="k plan"></span>planned</p></section>
        <section id="tonight" hidden><h2 id="tn">Tonight's plan</h2><ul class="list" id="tonight-list"></ul></section>
        <div id="groups"></div>
        <footer class="foot" id="foot"></footer>
      </div>
    </div><div class="toast" id="toast" role="status" hidden></div></div>`;
  const $ = s => root.querySelector(s);

  // ---------- storage ----------
  const readStore = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
  const writeStore = s => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch {} };

  // ---------- dates ----------
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const daysFrom = s => Math.round((parse(s) - today0()) / DAY);
  const plus = n => { const d = today0(); d.setDate(d.getDate() + n); return d; };
  const dueLabel = n => n < 0 ? `${-n} day${n === -1 ? "" : "s"} late` : n === 0 ? "Due today" : n === 1 ? "Due tomorrow"
    : n < 7 ? `Due ${plus(n).toLocaleDateString("en-GB", { weekday: "long" })}`
    : `Due ${plus(n).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
  const planLabel = s => { const n = daysFrom(s); return n === 0 ? "Tonight" : n === 1 ? "Tomorrow" : parse(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }); };

  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  const safeUrl = u => /^https?:\/\//i.test(u) ? u : "#";

  // ---------- data ----------
  function derive() {
    const plans = readStore().plans || {};
    return items.map(it => {
      const d = it.due ? daysFrom(it.due) : 999;
      const p = plans[it.id];
      const plan = p && !it.done && daysFrom(p) >= 0 ? p : null;
      const missedPlan = p && !it.done && daysFrom(p) < 0 ? p : null;
      return { ...it, d, plan, missedPlan };
    });
  }

  async function load() {
    $("#refresh").classList.add("spin");
    try {
      items = await adapter.load();
      const store = readStore();
      const seen = new Set(store.seen || []);
      newIds = store.seen ? new Set(items.filter(i => !seen.has(i.id)).map(i => i.id)) : new Set();
      writeStore({ ...store, seen: items.map(i => i.id) });
      banner(null);
      $("#body").hidden = false;
      render();
    } catch (e) {
      $("#body").hidden = !items.length;
      if (e instanceof AuthError) gate(`Log in to ${adapter.name} first`, "Once you can see your homework there, tap this bookmark again.");
      else if (navigator.onLine === false) banner("You're offline. Try again when you're back online.");
      else banner(`Couldn't get your homework from ${esc(adapter.name)} just now. Try the refresh button, or use ${esc(adapter.name)} itself for today.`);
    } finally {
      $("#refresh").classList.remove("spin");
    }
  }

  function banner(html) {
    const b = $("#banner");
    b.className = "banner";
    b.hidden = !html;
    b.innerHTML = html || "";
  }

  function gate(title, text, href) {
    const b = $("#banner");
    b.className = "gate";
    b.hidden = false;
    b.innerHTML = `<b>${esc(title)}</b><span>${esc(text)}</span>${href ? `<a class="go" href="${esc(safeUrl(href))}">Open ${esc(adapter.name)}</a>` : ""}`;
    $("#summary").textContent = "";
  }

  let toastTimer;
  function toast(msg, undo) {
    const t = $("#toast");
    t.innerHTML = esc(msg) + (undo ? ` <button type="button">Undo</button>` : "");
    t.hidden = false;
    if (undo) t.querySelector("button").onclick = () => { t.hidden = true; undo(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 4000);
  }

  async function setDone(it, done, quiet) {
    const target = items.find(i => i.id === it.id);
    if (!target) return;
    target.done = done;
    render();
    if (done && navigator.vibrate) navigator.vibrate(15);
    if (!quiet) toast(done ? "Nice, that's done." : "Moved back to your list.", () => setDone(it, !done, true));
    try {
      await adapter.setDone(it.id, done);
    } catch (e) {
      target.done = !done;
      render();
      if (e instanceof AuthError) gate(`Log in to ${adapter.name} again`, "You've been logged out, so that tick didn't save. Log in, then tap this bookmark again.");
      else toast("Couldn't save that. Check your connection and try again.");
    }
  }

  function setPlan(it, plan) {
    const store = readStore();
    const plans = store.plans || {};
    if (plan) plans[it.id] = plan; else delete plans[it.id];
    for (const id of Object.keys(plans)) if (!items.some(i => String(i.id) === id)) delete plans[id];  // tidy old ones
    writeStore({ ...store, plans });
    render();
  }

  // ---------- render ----------
  const CHECK = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

  function planPills(it) {
    if (it.done || it.d < 0) return "";
    const last = Math.max(0, Math.min(it.d === 0 ? 0 : it.d - 1, 9));  // plan up to the night before it's due
    const pills = [];
    for (let n = 0; n <= last; n++) {
      const s = key(plus(n));
      pills.push(`<button type="button" class="pill" data-plan="${s}" aria-pressed="${it.plan === s}">${planLabel(s)}</button>`);
    }
    const missed = it.missedPlan ? `<span class="lbl" style="color:var(--late)">Missed ${planLabel(it.missedPlan)}.</span>` : "";
    return `<div class="plan-row" role="group" aria-label="When will you do it?">${missed}<span class="lbl">Do it:</span>${pills.join("")}</div>`;
  }

  function card(it) {
    const li = document.createElement("li");
    li.className = "card" + (it.done ? " is-done" : "") + (!it.done && it.d < 0 ? " late" : "");
    const dueCls = it.done ? "" : it.d < 0 ? "late" : it.d <= 1 ? "soon" : "";
    const links = (it.attachments || []).map(a => {
      const label = /^https?:/.test(a.name) ? "Open link"
        : /\.(png|jpe?g|gif|webp|heic)$/i.test(a.name) ? "View image"
        : a.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_+]/g, " ");
      return `<a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
    });
    const fb = (it.feedback || []).map(f => typeof f === "string" ? f : (f.feedback_text || f.comment || f.text || "")).filter(Boolean);
    const online = /^submit online$/i.test(it.hand_in || "");
    const open = openIds.has(it.id);
    li.innerHTML = `
      <button type="button" class="check" aria-pressed="${it.done}" aria-label="${it.done ? "Mark as not done" : "Mark as done"}: ${esc(it.title)}">${CHECK}</button>
      <div class="main">
        <button type="button" class="title" aria-expanded="${open}">${esc(it.title)}</button>
        <div class="meta">
          <span class="chip">${esc(it.subject)}</span>
          ${it.due ? `<span class="due-tag ${dueCls}">${dueLabel(it.d)}</span>` : ""}
          ${it.minutes ? `<span class="num">${Number(it.minutes) || 0} min</span>` : ""}
          ${it.hand_in ? `<span>${esc(it.hand_in)}</span>` : ""}
          ${newIds.has(it.id) && !it.done ? `<span class="new">New</span>` : ""}
        </div>
        ${planPills(it)}
        <div class="more" ${open ? "" : "hidden"}>
          ${it.description ? `<p>${linkify(it.description)}</p>` : ""}
          ${online ? `<p class="small">This one is handed in on ${esc(adapter.name)} itself. Ticking it here doesn't hand it in.</p>` : ""}
          ${fb.length ? `<p><b>Feedback:</b> ${fb.map(esc).join("<br>")}</p>` : ""}
          ${it.grade ? `<p><b>Grade:</b> ${esc(it.grade)}</p>` : ""}
          <p class="small">Set ${it.set ? parse(it.set).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "?"}${it.class ? " · " + esc(it.class) : ""}${it.type ? " · " + esc(it.type) : ""}</p>
          ${links.length ? `<div class="links">${links.join("")}</div>` : ""}
        </div>
      </div>`;
    li.querySelector(".check").onclick = () => setDone(it, !it.done);
    li.querySelector(".title").onclick = () => {
      if (openIds.has(it.id)) openIds.delete(it.id); else openIds.add(it.id);
      const m = li.querySelector(".more"); m.hidden = !m.hidden;
      li.querySelector(".title").setAttribute("aria-expanded", String(!m.hidden));
    };
    li.querySelectorAll(".pill").forEach(p => p.onclick = () => setPlan(it, it.plan === p.dataset.plan ? null : p.dataset.plan));
    const row = li.querySelector(".plan-row"), sel = li.querySelector('.pill[aria-pressed="true"]');
    if (row && sel) requestAnimationFrame(() => { row.scrollLeft = Math.max(0, sel.offsetLeft - row.offsetLeft - 60); });
    return li;
  }

  function render() {
    const all = derive();
    const todo = all.filter(i => !i.done);
    const late = todo.filter(i => i.d < 0);
    const soon = todo.filter(i => i.d >= 0 && i.d <= 7);
    const later = todo.filter(i => i.d > 7);
    const tonight = todo.filter(i => i.plan && daysFrom(i.plan) === 0);
    const unplanned = todo.filter(i => !i.plan && !i.not_homework && i.d >= 1);
    const done = all.filter(i => i.done && i.d >= -14);

    const mins = soon.filter(i => !i.not_homework).reduce((s, i) => s + (i.minutes || 0), 0);
    const bits = [];
    if (late.length) bits.push(`<b class="num">${late.length}</b> overdue`);
    bits.push(`<b class="num">${soon.length}</b> due this week`);
    if (mins) bits.push(`about <b class="num">${mins}</b> min`);
    if (unplanned.length) bits.push(`<b class="num">${unplanned.length}</b> not planned yet`);
    $("#summary").innerHTML = todo.length ? bits.join(" · ") : "All done. Nothing to do right now.";

    // two-week strip from Monday of this week
    const t0 = today0();
    const mon = new Date(t0); mon.setDate(t0.getDate() - ((t0.getDay() + 6) % 7));
    const wk = $("#week"); wk.innerHTML = "";
    for (let k = 0; k < 14; k++) {
      const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + k), s = key(d);
      const dueN = todo.filter(i => i.due === s).length;
      const planN = todo.filter(i => i.plan === s).length;
      const el = document.createElement("div");
      el.setAttribute("role", "listitem");
      el.className = "day" + (d < t0 ? " past" : "") + (s === key(t0) ? " today" : "") + (d.getDay() % 6 === 0 ? " weekend" : "");
      el.setAttribute("aria-label", `${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}: ${dueN} due, ${planN} planned`);
      el.innerHTML = `<span class="dn">${d.toLocaleDateString("en-GB", { weekday: "short" })}</span><span class="dd num">${d.getDate()}</span><span class="marks">${'<i class="due"></i>'.repeat(Math.min(dueN, 3))}${'<i class="plan"></i>'.repeat(Math.min(planN, 3))}</span>`;
      wk.appendChild(el);
    }

    const tn = $("#tonight");
    tn.hidden = !tonight.length;
    const tl = $("#tonight-list"); tl.innerHTML = "";
    tonight.sort((a, b) => a.d - b.d).forEach(i => tl.appendChild(card(i)));
    if (tonight.length) {
      const m = tonight.reduce((s, i) => s + (i.minutes || 0), 0);
      $("#tn").textContent = m ? `Tonight's plan · ${m} min` : "Tonight's plan";
    }

    const groups = $("#groups"); groups.innerHTML = "";
    const add = (title, list, empty) => {
      if (!list.length && !empty) return;
      const sec = document.createElement("section");
      sec.innerHTML = `<h2>${title}</h2>`;
      if (!list.length) sec.insertAdjacentHTML("beforeend", `<div class="empty">${empty}</div>`);
      else {
        const ul = document.createElement("ul"); ul.className = "list";
        list.sort((a, b) => a.d - b.d).forEach(i => ul.appendChild(card(i)));
        sec.appendChild(ul);
      }
      groups.appendChild(sec);
    };
    const notTonight = x => !tonight.includes(x);
    add("Overdue", late.filter(notTonight));
    add("This week", soon.filter(notTonight), tonight.length ? "Nothing else due this week." : "<b>Nothing due this week.</b> Enjoy it.");
    add("Coming up", later.filter(notTonight));
    add("Done", done.sort((a, b) => b.d - a.d).slice(0, 10));

    $("#foot").innerHTML = `<span>Ticks are saved on ${esc(adapter.name)}, the same as ticking there. Your evening plans are only saved in this browser.</span>
      <span>Ticking something off doesn't hand it in. Online work still needs submitting on ${esc(adapter.name)}.</span>`;
  }

  // ---------- open / close ----------
  const prevOverflow = document.documentElement.style.overflow;
  const onKey = e => { if (e.key === "Escape") close(); };
  function close() {
    document.removeEventListener("keydown", onKey, true);
    document.documentElement.style.overflow = prevOverflow;
    host.remove();
  }

  return {
    open({ wrongSite } = {}) {
      document.documentElement.appendChild(host);
      document.documentElement.style.overflow = "hidden";
      document.addEventListener("keydown", onKey, true);
      $("#close").onclick = close;
      $(".app").focus();
      if (wrongSite) {
        $("#refresh").hidden = true;
        $("#close").textContent = "Close";
        return gate(`This bookmark works on ${adapter.name}`, `Open ${adapter.name}, log in so you can see your homework, then tap this bookmark again.`, adapter.home);
      }
      $("#refresh").onclick = load;
      load();
    },
  };
}
