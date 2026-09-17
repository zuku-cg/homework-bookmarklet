// Adapter: DPR (dpr.education), student login.
// Runs inside the DPR page, using the session the student already has. Same requests DPR's own page makes.
// An adapter gives the UI: matches(), home, openUrl, load() -> items, setDone(id, done).
// Item shape: {id, title, subject, class, type, hand_in, set, due (YYYY-MM-DD), minutes, description,
//              attachments[{name,url}], grade, feedback[], done, not_homework}

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

    // The same request DPR's page sends when the student ticks a homework card.
    setDone: (id, done) => req("/api/student/assignment-students/" + encodeURIComponent(id), {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_check: done ? 1 : 0 }),
    }),
  };
})();
