// What publishing would change on the web, in the owner's terms (preview before publishing).
//
// git can say which files changed, but docs/ is regenerated as a whole and gallery.json is one
// long file, so a file diff answers "something changed". This compares the published data the
// way lib/merge.mjs merges it: photos and collections by id, field by field, settings by key.
//   before = data/gallery.json as GitHub has it, after = what the next publish would send.
// Only fields the owner edits are reported; derived ones (colour, widths, bytes) follow from them.

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const text = v => (v === undefined || v === null || v === '' ? '' : String(v));
const date = v => text(v).replace('T', ' ');

const PHOTO_FIELDS = [
  ['title', 'Název'],
  ['description', 'Popis'],
  ['location', 'Místo'],
  ['takenAt', 'Datum pořízení', date],
];
const COLLECTION_FIELDS = [
  ['title', 'Název'],
  ['description', 'Popis'],
  ['group', 'Skupina'],
  ['slug', 'Adresa'],
  ['starred', 'Zvýrazněná', v => (v ? 'ano' : 'ne')],
];
// show: false = say that it changed, not to what (long, structured or not meant for the screen).
const SETTINGS_FIELDS = [
  ['name', 'Jméno'],
  ['bio', 'Popisek'],
  ['links', 'Odkazy', null, false],
  ['siteUrl', 'Veřejná adresa'],
  ['customDomain', 'Vlastní doména'],
  ['coverPhotoId', 'Náhledový obrázek galerie', null, false],
  ['avatar', 'Profilová fotka', null, false],
  ['avatarVersion', 'Profilová fotka', null, false],
  ['sort', 'Automatické řazení', v => ({ taken: 'podle data pořízení', added: 'podle nahrání' }[v] || text(v))],
  ['copyright', 'Copyright'],
  ['analyticsToken', 'Statistika návštěv', null, false],
  ['contact', 'Kontaktní e-mail', null, false],
];

function fieldChanges(b, a, fields) {
  const out = [];
  for (const [key, label, fmt = text, show = true] of fields) {
    if (same(b[key], a[key])) continue;
    if (out.some(c => c.label === label)) continue; // two keys behind one label (avatar)
    out.push(show ? { label, from: (fmt || text)(b[key]), to: (fmt || text)(a[key]) } : { label });
  }
  return out;
}

// An order only "changed" if the photos both versions share now stand differently: a photo
// added or removed shifts the array without anyone having reordered anything.
function orderChanged(b, a, shared) {
  if (!Array.isArray(b) && !Array.isArray(a)) return false;
  if (!Array.isArray(b) || !Array.isArray(a)) return true; // switched between custom and automatic
  const keep = list => list.filter(id => shared.has(id));
  return !same(keep(b), keep(a));
}

export function diffGallery(before, after) {
  before = before || { settings: {}, collections: [], photos: [] };
  const bp = new Map(before.photos.map(p => [p.id, p]));
  const ap = new Map(after.photos.map(p => [p.id, p]));
  const bc = new Map(before.collections.map(c => [c.id, c]));
  const ac = new Map(after.collections.map(c => [c.id, c]));
  const collName = id => (ac.get(id) || bc.get(id))?.title || '?';
  const photoName = p => p.title || p.location || p.originalName || p.id;

  const photos = { added: [], removed: [], edited: [] };
  for (const p of after.photos) if (!bp.has(p.id)) photos.added.push({ id: p.id, label: photoName(p) });
  for (const p of before.photos) if (!ap.has(p.id)) photos.removed.push({ id: p.id, label: photoName(p) });
  for (const a of after.photos) {
    const b = bp.get(a.id);
    if (!b) continue;
    const fields = fieldChanges(b, a, PHOTO_FIELDS);
    const inB = b.collections || [], inA = a.collections || [];
    const plus = inA.filter(id => !inB.includes(id)), minus = inB.filter(id => !inA.includes(id));
    if (plus.length || minus.length) {
      fields.push({ label: 'Kolekce', added: plus.map(collName), removed: minus.map(collName) });
    }
    if ((b.version || 1) !== (a.version || 1)) fields.push({ label: 'Nahrazená fotka' });
    if (fields.length) photos.edited.push({ id: a.id, label: photoName(a), fields });
  }

  const collections = { added: [], removed: [], edited: [] };
  for (const c of after.collections) if (!bc.has(c.id)) collections.added.push({ id: c.id, label: c.title });
  for (const c of before.collections) if (!ac.has(c.id)) collections.removed.push({ id: c.id, label: c.title });
  for (const a of after.collections) {
    const b = bc.get(a.id);
    if (!b) continue;
    const fields = fieldChanges(b, a, COLLECTION_FIELDS);
    if (!same(b.coverId, a.coverId)) fields.push({ label: 'Titulní fotka' });
    if (fields.length) collections.edited.push({ id: a.id, label: a.title, fields });
  }

  const shared = new Set([...ap.keys()].filter(id => bp.has(id)));
  const order = [];
  if (orderChanged(before.settings?.order, after.settings?.order, shared)) order.push('Vše');
  for (const a of after.collections) {
    const b = bc.get(a.id);
    if (b && orderChanged(b.order, a.order, shared)) order.push(a.title);
  }

  const settings = fieldChanges(before.settings || {}, after.settings || {}, SETTINGS_FIELDS);

  const count = photos.added.length + photos.removed.length + photos.edited.length
    + collections.added.length + collections.removed.length + collections.edited.length
    + order.length + settings.length;
  return { photos, collections, order, settings, count };
}
