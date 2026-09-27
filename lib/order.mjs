// Photo order of a list: the whole gallery ("Vše") or one collection. Each list has its own.
//
// A list is automatic (by date taken or by upload, settings.sort) until the owner moves a photo.
// From then on its order is stored as an array of ids and kept as is. Photos that are not in a
// stored order yet (uploaded or added to the collection later) come first, in automatic order,
// so they are easy to find and place. admin/public/admin.js mirrors orderedPhotos().

const dateKey = p => p.takenAt || p.addedAt || '';

export function sortPhotos(photos, mode) {
  const key = p => (mode === 'added' ? p.addedAt : dateKey(p)) || '';
  return [...photos].sort((a, b) => key(b).localeCompare(key(a)));
}

/** Photos of a list in display order. `stored` = saved id array, or null/undefined for automatic. */
export function orderedPhotos(photos, stored, mode) {
  const auto = sortPhotos(photos, mode);
  if (!Array.isArray(stored)) return auto;
  const byId = new Map(photos.map(p => [p.id, p]));
  const listed = new Set(stored);
  return [...auto.filter(p => !listed.has(p.id)), ...stored.filter(id => byId.has(id)).map(id => byId.get(id))];
}

export const ORDER_ACTIONS = ['move', 'start', 'end', 'bydate'];

/**
 * New id order after moving `moving` (kept in their current relative order).
 *   move   – before the photo `before` (null or one of the moved = to the end); drag and drop
 *   start / end
 *   bydate – each moved photo goes where its date taken belongs (newest first), the rest of the
 *            custom order stays untouched; for photos found later, e.g. from 2022
 */
export function reorder(photos, current, moving, action, before = null) {
  const set = new Set(moving);
  const moved = current.filter(id => set.has(id));
  const rest = current.filter(id => !set.has(id));
  if (action === 'start') return [...moved, ...rest];
  if (action === 'end') return [...rest, ...moved];
  if (action === 'move') {
    const at = before && !set.has(before) ? rest.indexOf(before) : -1;
    return at < 0 ? [...rest, ...moved] : [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  }
  if (action === 'bydate') {
    const byId = new Map(photos.map(p => [p.id, p]));
    const key = id => dateKey(byId.get(id) || {});
    const out = [...rest];
    for (const id of [...moved].sort((a, b) => key(b).localeCompare(key(a)))) {
      const at = out.findIndex(x => key(x) < key(id));
      out.splice(at < 0 ? out.length : at, 0, id);
    }
    return out;
  }
  throw new Error(`Unknown order action: ${action}`);
}
