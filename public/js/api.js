// Browser client for the Event Clubhouse API (docs/API.md). Every page uses this; nobody calls
// fetch on /api directly.
//
// Sessions: signing in with a code stores a token per event on this device, so a referee or
// coach signs in once and stays signed in ("saves the device"). One device can hold sessions
// for several events and roles.

const STORE = "ec.sessions.v1";
const VOTER = "ec.voter.v1";

const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: session lasts the tab */ } };

export class ApiError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

async function request(method, path, { body, token, signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      cache: "no-store",
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError("No connection. Check your signal and try again.", 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Something went wrong (${res.status}).`, res.status, data);
  return data;
}

export const api = {
  get: (path, opts) => request("GET", path, opts),
  post: (path, body, opts) => request("POST", path, { ...opts, body }),
  put: (path, body, opts) => request("PUT", path, { ...opts, body }),
};

// ---- Sessions ----
export const sessions = () => read(STORE, {});
export function session(slug, role) {
  const s = sessions()[slug];
  if (!s) return null;
  if (role && (Array.isArray(role) ? !role.includes(s.role) : s.role !== role)) return null;
  return s;
}
export function sessionsFor(roles) {
  return Object.entries(sessions()).filter(([, s]) => !roles || roles.includes(s.role)).map(([slug, s]) => ({ slug, ...s }));
}
export async function signIn(code) {
  const r = await api.post("/api/auth", { code: String(code || "").trim() });
  const all = sessions();
  all[r.event.slug] = { token: r.token, role: r.role, subject: r.subject, label: r.label, event: r.event, at: Date.now() };
  write(STORE, all);
  return { slug: r.event.slug, ...all[r.event.slug] };
}
export function signOut(slug) { const all = sessions(); delete all[slug]; write(STORE, all); }

// Organiser (create events) session, separate from per-event codes.
export const organiser = () => read("ec.organiser.v1", null);
export async function organiserSignIn(key) {
  const r = await api.post("/api/auth/organiser", { key: String(key || "").trim() });
  write("ec.organiser.v1", { token: r.token, organiser: r.organiser });
  return r;
}
export function organiserSignOut() { try { localStorage.removeItem("ec.organiser.v1"); } catch (e) { /* ignore */ } }

// ---- Staff calls ----
export const sendOps = (slug, ops) => { const s = session(slug); return api.post(`/api/events/${slug}/ops`, { ops }, { token: s && s.token }); };
export const fullEvent = (slug) => { const s = session(slug); return api.get(`/api/events/${slug}/full`, { token: s && s.token }); };

// ---- Fans ----
// A random id for this phone, so a fan can change their vote and nobody needs an account.
export function voterId() {
  let v = read(VOTER, null);
  if (!v) {
    const a = new Uint8Array(18);
    crypto.getRandomValues(a);
    v = Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32);
    write(VOTER, v);
  }
  return v;
}

// Polls an event, calling onChange(event, rev) only when it changes. Pauses while the tab is
// hidden. Returns stop(). The server answers 204 when ?rev= is current, so idle polling is cheap.
export function watchEvent(slug, onChange, { every = 5000, path = `/api/events/${slug}`, token = null, onError } = {}) {
  let rev = 0, timer = null, stopped = false, ctrl = null;
  const tick = async () => {
    if (stopped) return;
    if (document.hidden) { timer = setTimeout(tick, every); return; }
    ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await api.get(`${path}${path.includes("?") ? "&" : "?"}rev=${rev}`, { signal: ctrl.signal, token });
      if (r && r.rev !== rev) { rev = r.rev; onChange(r.event, r.rev, r); } // r: the whole response (me, squad, judging, counts)
    } catch (e) { if (onError) onError(e); }
    clearTimeout(t);
    timer = setTimeout(tick, every);
  };
  const onVis = () => { if (!document.hidden && !stopped) { clearTimeout(timer); tick(); } };
  document.addEventListener("visibilitychange", onVis);
  tick();
  return { stop() { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); if (ctrl) ctrl.abort(); }, refresh() { clearTimeout(timer); rev = 0; tick(); } };
}
