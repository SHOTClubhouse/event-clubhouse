// Event storage in D1: load, and save with a compare-and-swap on rev so two saves at once never
// overwrite each other.

const COLUMNS = "id, slug, organiser, demo, listed, doc, rev";

const hydrate = (r) => (r ? { id: r.id, slug: r.slug, organiser: r.organiser, demo: !!r.demo, listed: !!r.listed, rev: r.rev, doc: JSON.parse(r.doc) } : null);

export async function loadEvent(db, slug) {
  return hydrate(await db.prepare(`SELECT ${COLUMNS} FROM events WHERE slug = ?`).bind(slug).first());
}

export async function currentRev(db, slug) {
  const r = await db.prepare("SELECT rev FROM events WHERE slug = ?").bind(slug).first();
  return r ? r.rev : null;
}

export async function casWrite(db, id, rev, doc, now) {
  const r = await db.prepare("UPDATE events SET doc = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ?").bind(JSON.stringify(doc), now, id, rev).run();
  return r.meta.changes === 1;
}

// Runs fn(doc, row) against the latest stored document and saves what it returns, retrying when
// someone else saved first. fn returns { error: { status, error } } to refuse, { unchanged: true }
// to save nothing, or { doc, result }.
export async function mutateEvent(db, slug, fn, { tries = 5, now = () => Date.now() } = {}) {
  for (let i = 0; i < tries; i++) {
    const row = await loadEvent(db, slug);
    if (!row) return { ok: false, status: 404, error: "We can't find that event." };
    const out = await fn(structuredClone(row.doc), row);
    if (out.error) return { ok: false, ...out.error };
    if (out.unchanged) return { ok: true, rev: row.rev, doc: row.doc, row, result: out.result, written: false };
    if (await casWrite(db, row.id, row.rev, out.doc, now())) return { ok: true, rev: row.rev + 1, doc: out.doc, row, result: out.result, written: true };
  }
  return { ok: false, status: 409, error: "Lots of people are saving at once. Wait a moment and try again." };
}
