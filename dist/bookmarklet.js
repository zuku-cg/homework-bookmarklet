(() => {
"use strict";
class AuthError extends Error {}
const dprStudent = (() => {
const INCLUDES = "assignment,assignment.schoolClass,assignment.schoolClass.subjectArea," +
"assignment.interventionClass,assignment.interventionClass.subjectArea,assignment.attachments,feedback";
const DONE_STATUSES = ["complete", "completed", "submitted", "handed in", "marked"];
async function req(path, opts = {}) {
const res = await fetch(path, {
credentials: "same-origin", ...opts,
headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest", ...(opts.headers || {}) },
});
if ([401, 403, 419].includes(res.status)) throw new AuthError();
if (!res.ok) throw new Error("HTTP " + res.status);
const text = await res.text();
if (!text.trim()) return null;
try { return JSON.parse(text); } catch { throw new AuthError(); }  // HTML here means the login page
}
function shortTitle(title, className) {
let t = title.trim();
if (className && t.startsWith(className)) t = t.slice(className.length).replace(/^\s*-\s*/, "");
t = t.replace(/\s*-\s*Due\s+[\d./]+\s*$/i, "");  // "... - Due 24.09.26"
return t || title.trim();
}
function attachment(att) {
const url = att.url || "";
let name = "attachment";
try { if (url) name = decodeURIComponent(url.split("/").pop().replace(/\+/g, " ")); } catch {}
if (!url.includes("s3.dpr.education")) name = url;  // external link
return { name, url };
}
function normalise(raw) {
const a = raw.assignment || {};
const cls = a.school_class || a.intervention_class || {};
const subject = (cls.subject_area || {}).subject_area || "Other";
const n = a.duration_length, unit = (a.duration_unit || "").toLowerCase();
return {
id: raw.id,
title: shortTitle(a.title || "", cls.class_name),
subject: subject.split(" / ").pop(),
class: cls.class_name || null,
type: a.type || null,
hand_in: a.submission_method || null,
set: (a.issue_date || "").slice(0, 10),
due: (a.end_date || "").slice(0, 10),
minutes: n ? (unit.startsWith("hour") ? n * 60 : n) : null,
description: (a.description_text || "").trim(),
attachments: (a.attachments || []).map(attachment),
grade: raw.grade || null,
feedback: (raw.feedback || []).filter(Boolean),
done: !!raw.student_check || DONE_STATUSES.includes(String(raw.status || "").toLowerCase()),
not_homework: subject === "Other" && (n || 0) <= 5,
};
}
return {
name: "DPR",
home: "https://www.dpr.education/",
openUrl: "https://www.dpr.education/student/assignments",
matches: () => /(^|\.)dpr\.education$/.test(location.hostname) && !location.hostname.startsWith("parents."),
async load() {
const raw = [];
for (let page = 1; page <= 20; page++) {
const q = new URLSearchParams({ page, per_page: 100, include: INCLUDES, order_by_desc: "id" });
const batch = await req("/api/student/assignment-students/me?" + q);
if (!Array.isArray(batch)) throw new AuthError();
raw.push(...batch);
if (batch.length < 100) break;
}
return raw.map(normalise);
},
setDone: (id, done) => req("/api/student/assignment-students/" + encodeURIComponent(id), {
method: "PATCH", headers: { "Content-Type": "application/json" },
body: JSON.stringify({ student_check: done ? 1 : 0 }),
}),
};
})();
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
const readStore = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
const writeStore = s => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch {} };
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
const existing = document.getElementById("hwb-overlay");
if (existing) {
existing.shadowRoot.querySelector("#close").click();
} else {
const adapters = [dprStudent];  // more school platforms can be added here
const adapter = adapters.find(a => a.matches()) || (window.__HWB_TEST__ ? adapters[0] : null);
createUI(adapter || adapters[0], ":host{all:initial;--ground:#F1F4F8;--paper:#FFFFFF;--ink:#18263B;--muted:#5B6879;--line:#D9E0EA;--hl:#F6D34A;--hl-ink:#3A2E00;--late:#C2412D;--late-bg:#FBE9E5;--done:#2F7D5B;--done-bg:#E3F3EA;--chip:#E6ECF4;--plan:#3F63B8;--display:ui-rounded,\"Avenir Next\",\"Segoe UI\",system-ui,sans-serif;--body:ui-sans-serif,system-ui,-apple-system,\"Segoe UI\",sans-serif;color-scheme:light;}@media (prefers-color-scheme:dark){:host{--ground:#0F1622;--paper:#172131;--ink:#E6ECF5;--muted:#98A5B8;--line:#2A3649;--hl:#E9C63E;--hl-ink:#1E1800;--late:#F08A76;--late-bg:#3A1E1A;--done:#6FCB9E;--done-bg:#16332A;--chip:#223047;--plan:#8FAEF5;color-scheme:dark;}}*{box-sizing:border-box}:host{position:fixed;inset:0;z-index:2147483647;display:block}.app{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;-webkit-text-size-adjust:100%;margin:0;background:var(--ground);color:var(--ink);font:16px/1.5 var(--body);text-align:left;padding:env(safe-area-inset-top,0px) max(16px,env(safe-area-inset-right,0px)) env(safe-area-inset-bottom,0px) max(16px,env(safe-area-inset-left,0px));-webkit-tap-highlight-color:transparent}.wrap{max-width:680px;margin:0 auto;padding-block:20px 48px;display:grid;gap:26px}h1,h2{font-family:var(--display);margin:0;text-wrap:balance}h1{font-size:clamp(28px,8vw,38px);font-weight:700;letter-spacing:-.02em;line-height:1.05}h1 mark{background:linear-gradient(transparent 58%,var(--hl) 58%);color:inherit;padding:0 .06em}h2{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin-bottom:10px}.sub{margin:6px 0 0;color:var(--muted)}.sub b{color:var(--ink)}.num{font-variant-numeric:tabular-nums}button{font:inherit;color:inherit}.btns{display:flex;gap:8px;flex:none}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.icon-btn.text{width:auto;padding:0 14px;font-weight:700;font-size:14.5px}.icon-btn{border:1px solid var(--line);background:var(--paper);border-radius:12px;width:44px;height:44px;display:grid;place-items:center;cursor:pointer;flex:none}.icon-btn.spin svg{animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}:focus-visible{outline:3px solid var(--hl);outline-offset:2px}.banner{background:var(--late-bg);border:1px solid var(--late);border-radius:12px;padding:12px 14px;font-size:15px}.banner a{color:inherit;font-weight:700}.week{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}.day{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:6px 2px 8px;text-align:center;display:grid;gap:1px;min-width:0}.day .dn{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}.day .dd{font-family:var(--display);font-size:18px;font-weight:700;line-height:1.1}.day .marks{display:flex;justify-content:center;gap:3px;min-height:8px;margin-top:3px}.day .marks i{width:7px;height:7px;border-radius:50%}.day .marks i.due{background:var(--late)}.day .marks i.plan{border:2px solid var(--plan)}.day.past{opacity:.45}.day.today{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}.day.weekend{background:transparent}.legend{margin:8px 0 0;font-size:12.5px;color:var(--muted);display:flex;align-items:center;gap:6px}.legend .k{display:inline-block;width:8px;height:8px;border-radius:50%}.legend .k.due{background:var(--late)}.legend .k.plan{border:2px solid var(--plan);margin-left:8px}#body,#groups{display:grid;gap:26px}.list{list-style:none;margin:0;padding:0;display:grid;gap:10px}.card{background:var(--paper);border:1px solid var(--line);border-radius:14px;display:grid;grid-template-columns:auto 1fr;gap:0 12px;padding:12px 14px 12px 10px;transition:opacity .2s}.card.late{border-color:var(--late)}.card.is-done{opacity:.6}.card.is-done .title{text-decoration:line-through;text-decoration-thickness:2px}.check{width:44px;height:44px;border-radius:50%;border:2.5px solid var(--line);background:transparent;cursor:pointer;display:grid;place-items:center;align-self:start;flex:none}.check svg{opacity:0;transform:scale(.6);transition:all .15s}.check:hover{border-color:var(--done)}.is-done .check{background:var(--done);border-color:var(--done);color:var(--paper)}.is-done .check svg{opacity:1;transform:none}.main{min-width:0;display:grid;gap:6px}.title{font-weight:700;font-size:17px;line-height:1.3;overflow-wrap:anywhere;background:none;border:0;padding:0;text-align:left;cursor:pointer}.meta{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;font-size:13.5px;color:var(--muted)}.chip{background:var(--chip);color:var(--ink);border-radius:999px;padding:1px 9px;font-size:12.5px;font-weight:700}.due-tag{font-weight:700;color:var(--ink)}.due-tag.soon{background:var(--hl);color:var(--hl-ink);border-radius:6px;padding:0 6px}.due-tag.late{color:var(--late)}.new{background:var(--ink);color:var(--paper);border-radius:999px;padding:0 7px;font-size:11.5px;font-weight:700}.plan-row{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none;align-items:center}.plan-row::-webkit-scrollbar{display:none}.plan-row .lbl{font-size:12.5px;color:var(--muted);flex:none;margin-right:2px}.pill{flex:none;border:1px solid var(--line);background:transparent;border-radius:999px;padding:6px 11px;font-size:13.5px;cursor:pointer;min-height:34px}.pill[aria-pressed=\"true\"]{background:var(--plan);border-color:var(--plan);color:var(--paper);font-weight:700}.pill.is-due{border-style:dashed}.more{display:grid;gap:10px;padding-top:4px}.more[hidden]{display:none}.more p{margin:0;white-space:pre-line;overflow-wrap:anywhere;max-width:62ch}.more .small{font-size:13.5px;color:var(--muted)}.links{display:flex;flex-wrap:wrap;gap:8px}.links a{color:var(--ink);font-weight:700;font-size:14px;text-decoration:none;border:1px solid var(--line);border-radius:10px;padding:7px 11px}.more a{color:var(--ink)}.empty{background:var(--paper);border:1px dashed var(--line);border-radius:14px;padding:16px;color:var(--muted)}.empty b{color:var(--ink)}.foot{color:var(--muted);font-size:13px;display:grid;gap:4px}.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--ink);color:var(--ground);padding:10px 16px;border-radius:12px;font-size:14.5px;max-width:calc(100% - 32px);z-index:5;box-shadow:0 6px 24px rgba(0,0,0,.2)}.toast button{background:none;border:0;color:var(--hl);font-weight:700;margin-left:10px;cursor:pointer}@media (max-width:380px){.day .dd{font-size:15px}.week{gap:3px}.card{padding-right:10px}}@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}.note{font-size:13px;color:var(--muted)}.gate{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:20px;display:grid;gap:10px}.gate a.go{justify-self:start;background:var(--ink);color:var(--ground);font-weight:700;text-decoration:none;border-radius:12px;padding:11px 16px}[hidden]{display:none!important}").open({ wrongSite: !adapter });
}
})();
