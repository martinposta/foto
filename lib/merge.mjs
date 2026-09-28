// Three-way merge of data/gallery.json by meaning, not by lines (sync with GitHub, D25).
//
// git merges text line by line, and in gallery.json neighbouring fields of one photo sit on
// neighbouring lines: two admin copies editing the description and the location of the same
// photo "conflicted" although nothing clashed. This merges records instead: photos and
// collections by id, settings and redirects by key, each field three-way. A conflict is only
// the same field changed to different values on both sides.
//
//   base = the common ancestor, ours = GitHub's side, theirs = this copy's side (as in a rebase)
// Returns { merged, conflicts: ['photo <id>: title', ...] }.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One value three-way: whichever side changed it wins; both changed alike is fine.
function pick(base, ours, theirs, where, conflicts) {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  conflicts.push(where);
  return ours;
}

function mergeObject(base = {}, ours = {}, theirs = {}, where, conflicts) {
  const out = {};
  for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)])) {
    const v = pick(base[k], ours[k], theirs[k], `${where}: ${k}`, conflicts);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// Records by id. Added on one side: kept. Deleted on one side and untouched on the other: gone.
// Deleted on one side but edited on the other: a conflict (keeping or dropping would both lose work).
function mergeRecords(base = [], ours = [], theirs = [], kind, conflicts) {
  const map = list => new Map(list.map(r => [r.id, r]));
  const b = map(base), o = map(ours), t = map(theirs);
  const ids = [...o.keys(), ...[...t.keys()].filter(id => !o.has(id))]; // ours' order, then theirs' new ones
  // Name records the way the owner knows them in this admin (theirs = this copy when publishing
  // rebases it onto GitHub), not by id.
  const label = id => { const r = t.get(id) || o.get(id) || b.get(id); return `${kind} „${r.title || r.location || r.originalName || id}“`; };
  const out = [];
  for (const id of ids) {
    const inO = o.has(id), inT = t.has(id), inB = b.has(id);
    if (inO && inT) { out.push(mergeObject(b.get(id), o.get(id), t.get(id), label(id), conflicts)); continue; }
    const kept = inO ? o.get(id) : t.get(id);
    if (!inB) { out.push(kept); continue; }                         // added on one side
    if (same(b.get(id), kept)) continue;                             // deleted on the other, untouched here
    conflicts.push(`${label(id)}: smazáno na jedné straně, upraveno na druhé`);
    out.push(kept);
  }
  return out;
}

export function mergeGallery(base, ours, theirs) {
  const conflicts = [];
  const merged = {};
  for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base || {})])) {
    if (k === 'photos' || k === 'collections') {
      merged[k] = mergeRecords(base?.[k], ours[k], theirs[k], k === 'photos' ? 'fotka' : 'kolekce', conflicts);
    } else if (k === 'settings' || k === 'redirects') {
      merged[k] = mergeObject(base?.[k], ours[k], theirs[k], k === 'settings' ? 'nastavení' : 'přesměrování', conflicts);
    } else {
      const v = pick(base?.[k], ours[k], theirs[k], k, conflicts);
      if (v !== undefined) merged[k] = v;
    }
  }
  return { merged, conflicts };
}
