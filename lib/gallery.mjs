// Gallery operations used by the admin server. Every mutation saves data/gallery.json.

import { loadData, saveData, uniqueSlug, newId, collectionOrder, slugify } from './store.mjs';
import { orderedPhotos, reorder, ORDER_ACTIONS } from './order.mjs';
import { processImage, processAvatar, readMetadata, hashBuffer, removePhotoFiles, movePhotoFiles, movePhotoBetween, rewriteAuthor } from './images.mjs';

const PHOTO_EDITABLE = ['title', 'description', 'location', 'takenAt', 'collections'];
const COLLECTION_EDITABLE = ['title', 'description', 'coverId', 'slug', 'starred', 'group'];
const SETTINGS_EDITABLE = ['name', 'bio', 'links', 'siteUrl', 'customDomain', 'coverPhotoId', 'sort', 'copyright', 'analyticsToken', 'contactEmail'];

export class UserError extends Error {}

function findPhoto(data, id) {
  const p = data.photos.find(x => x.id === id);
  if (!p) throw new UserError('Fotka nenalezena');
  return p;
}

// Keep stored orders free of photos that were deleted, left a collection or went back to drafts
// (they would otherwise return to their old spot, instead of showing up first like any newcomer).
// Drafts are never part of an order (D24): they enter it only when published, at the start.
function pruneOrders(data) {
  const published = data.photos.filter(p => !p.draft);
  const all = new Set(published.map(p => p.id));
  if (Array.isArray(data.settings.order)) data.settings.order = data.settings.order.filter(id => all.has(id));
  for (const c of data.collections) {
    if (!Array.isArray(c.order)) continue;
    const members = new Set(published.filter(p => p.collections.includes(c.id)).map(p => p.id));
    c.order = c.order.filter(id => members.has(id));
  }
}

function findCollection(data, id) {
  const c = data.collections.find(x => x.id === id);
  if (!c) throw new UserError('Kolekce nenalezena');
  return c;
}

// A photo's id is the content hash of its first upload. Replacing the file keeps the id
// (links may already be shared) and tracks the current file in sourceHash, so re-uploading
// either version is still recognised as "already in the gallery".
const matchesFile = (p, hash) => p.id === hash || p.sourceHash === hash;

const authorOf = settings => ({ artist: settings.name, copyright: settings.copyright });

export async function addPhoto(buf, originalName, collectionId) {
  const data = await loadData();
  const id = hashBuffer(buf);
  const existing = data.photos.find(p => matchesFile(p, id));
  if (existing) {
    // Same file uploaded again: just add it to the requested collection.
    if (collectionId && !existing.collections.includes(collectionId)) {
      existing.collections.push(collectionId);
      await saveData();
    }
    return { photo: existing, duplicate: true };
  }
  const meta = await readMetadata(buf);
  // Every new photo starts as a draft (Q11): its files and record stay out of git until published.
  const img = await processImage(buf, id, authorOf(data.settings), { draft: true });
  const photo = {
    id,
    draft: true,
    originalName,
    addedAt: new Date().toISOString(),
    takenAt: meta.takenAt,
    title: meta.title,
    description: meta.description,
    location: meta.location,
    keywords: meta.keywords,
    collections: collectionId && data.collections.some(c => c.id === collectionId) ? [collectionId] : [],
    exif: meta.exif,
    ...img,
  };
  data.photos.push(photo);
  await saveData();
  return { photo, duplicate: false };
}

// Swap in a re-edited version of a photo (new colours, new crop). Everything the owner wrote
// stays; the image, its dimensions and EXIF come from the new file. `version` busts caches,
// because the new derivatives keep the old file names.
export async function replacePhoto(id, buf, originalName) {
  const data = await loadData();
  const p = findPhoto(data, id);
  const hash = hashBuffer(buf);
  if ((p.sourceHash || p.id) === hash) throw new UserError('Tohle je stejný soubor, jaký už fotka má.');
  const other = data.photos.find(x => x !== p && matchesFile(x, hash));
  if (other) throw new UserError(`Tenhle soubor už je v galerii jako jiná fotka${other.title ? ` („${other.title}“)` : ''}.`);

  const meta = await readMetadata(buf);
  // Generate next to the current files first, so a failed encode leaves the published photo intact.
  const tmp = `${id}.new`;
  let img;
  const draft = !!p.draft; // a draft stays a draft, its files stay in drafts/
  try { img = await processImage(buf, tmp, authorOf(data.settings), { draft }); }
  catch (err) { await removePhotoFiles(tmp); throw err; }

  const current = data.photos.find(x => x.id === id);
  if (!current) { await removePhotoFiles(tmp); throw new UserError('Fotka mezitím zmizela'); }
  await movePhotoFiles(tmp, id, { draft });

  Object.assign(current, img, {
    exif: meta.exif,
    originalName,
    sourceHash: hash,
    version: (current.version || 1) + 1,
    replacedAt: new Date().toISOString(),
  });
  for (const k of ['title', 'description', 'location', 'takenAt']) if (!current[k] && meta[k]) current[k] = meta[k];
  if (!current.keywords?.length) current.keywords = meta.keywords;
  await saveData();
  return current;
}

// Apply the current name/copyright to every photo already published (settings only affect new
// uploads otherwise). Lossless, but each changed file is a new blob in git history.
export async function rewriteAuthorInFiles() {
  const data = await loadData();
  const author = authorOf(data.settings);
  let files = 0;
  for (const p of data.photos) files += await rewriteAuthor(p.id, author, { draft: !!p.draft });
  return { photos: data.photos.length, files };
}

export async function updatePhoto(id, patch) {
  const data = await loadData();
  const p = findPhoto(data, id);
  for (const k of PHOTO_EDITABLE) {
    if (!(k in patch)) continue;
    if (k === 'collections') {
      const valid = new Set(data.collections.map(c => c.id));
      p.collections = [...new Set(patch.collections)].filter(c => valid.has(c));
      pruneOrders(data);
    } else {
      p[k] = String(patch[k] ?? '').trim();
    }
  }
  await saveData();
  return p;
}

// Fields that can be written to many photos at once. An empty value means "leave as is",
// so a half-filled form never wipes what individual photos already have; wiping is an
// explicit `clear: ['title', ...]`.
const BULK_TEXT = ['title', 'description', 'location', 'takenAt'];
const DATE_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/; // datetime-local, seconds optional

export async function bulkPhotos({ ids = [], addCollection, removeCollection, remove, set: fields, clear, onlyEmpty = false }) {
  const data = await loadData();
  const set = new Set(ids);
  if (fields || clear) {
    const wipe = BULK_TEXT.filter(k => (clear || []).includes(k));
    const patch = Object.fromEntries(BULK_TEXT
      .filter(k => !wipe.includes(k))
      .map(k => [k, String(fields?.[k] ?? '').trim()])
      .filter(([, v]) => v));
    if (!Object.keys(patch).length && !wipe.length) throw new UserError('Vyplň aspoň jedno pole');
    if (patch.takenAt) {
      const m = patch.takenAt.match(DATE_TIME);
      if (!m) throw new UserError('Datum pořízení má tvar RRRR-MM-DDTHH:MM');
      patch.takenAt = m[1] + (m[2] || ':00'); // same shape as dates read from EXIF
    }
    const changed = [];
    for (const p of data.photos) {
      if (!set.has(p.id)) continue;
      for (const [k, v] of Object.entries(patch)) if (!onlyEmpty || !p[k]) p[k] = v;
      for (const k of wipe) p[k] = '';
      changed.push(p);
    }
    await saveData();
    return { ok: true, photos: changed };
  }
  if (remove) {
    for (const id of set) await removePhotoFiles(id);
    data.photos = data.photos.filter(p => !set.has(p.id));
    for (const c of data.collections) if (set.has(c.coverId)) c.coverId = '';
    if (set.has(data.settings.coverPhotoId)) data.settings.coverPhotoId = '';
  } else {
    for (const p of data.photos) {
      if (!set.has(p.id)) continue;
      if (addCollection && !p.collections.includes(addCollection)) p.collections.push(addCollection);
      if (removeCollection) p.collections = p.collections.filter(c => c !== removeCollection);
    }
  }
  pruneOrders(data);
  await saveData();
  return { ok: true };
}

/**
 * Change the order of one list: `list` = 'all' or a collection id. The first change turns the
 * automatic order into a stored one; 'reset' goes back to automatic. Returns the stored order.
 */
export async function reorderPhotos({ list = 'all', action, ids = [], before = null }) {
  const data = await loadData();
  const coll = list === 'all' ? null : findCollection(data, list);
  const owner = coll || data.settings;
  if (action === 'reset') {
    owner.order = null;
    await saveData();
    return { order: null };
  }
  if (!ORDER_ACTIONS.includes(action)) throw new UserError('Neznámá změna pořadí');
  const published = data.photos.filter(p => !p.draft); // drafts have no place in an order yet
  const members = coll ? published.filter(p => p.collections.includes(coll.id)) : published;
  const current = orderedPhotos(members, owner.order, data.settings.sort).map(p => p.id);
  const moving = ids.filter(id => current.includes(id));
  if (!moving.length) throw new UserError('Vybrané fotky v tomhle seznamu nejsou');
  owner.order = reorder(members, current, moving, action, before);
  await saveData();
  return { order: owner.order };
}

const normGroup = g => String(g ?? '').trim().replace(/\s+/g, ' ');

// Old page paths keep working after a collection's address changes or a group is renamed (D21):
// buildSite() writes a small redirect page at every old path. No chains (everything that pointed
// at `from` now points at `to`), and a path that is live again stops being a redirect.
function addRedirect(data, from, to) {
  if (from === to) return;
  data.redirects ||= {};
  for (const [k, v] of Object.entries(data.redirects)) if (v === from) data.redirects[k] = to;
  delete data.redirects[to];
  data.redirects[from] = to;
}
const liveAgain = (data, path) => { if (data.redirects) delete data.redirects[path]; };

/**
 * Publish drafts (all of them, or `ids`): files move from drafts/img to docs/img and the records
 * from drafts.json to gallery.json on the next save. They land first in every custom order
 * (orderedPhotos puts photos missing from a stored order first). A collection holding only
 * drafts becomes public with its first published photo.
 */
export async function publishDrafts({ ids } = {}) {
  const data = await loadData();
  const want = ids ? new Set(ids) : null;
  const drafts = data.photos.filter(p => p.draft && (!want || want.has(p.id)));
  for (const p of drafts) {
    await movePhotoBetween(p.id, false);
    delete p.draft;
  }
  await saveData();
  return { published: drafts.length, photos: drafts };
}

/**
 * Take published photos back to drafts. Their files leave docs/, their records gallery.json;
 * versions already published stay in git history (the admin says so before doing it).
 */
export async function unpublishPhotos({ ids = [] }) {
  const data = await loadData();
  const set = new Set(ids);
  const photos = data.photos.filter(p => !p.draft && set.has(p.id));
  if (!photos.length) throw new UserError('Vybrané fotky nejsou zveřejněné');
  for (const p of photos) {
    await movePhotoBetween(p.id, true);
    p.draft = true;
  }
  pruneOrders(data);
  await saveData();
  return { drafts: photos.length, photos };
}

export async function createCollection({ title, description = '', group = '' }) {
  const data = await loadData();
  title = String(title || '').trim();
  if (!title) throw new UserError('Kolekce potřebuje název');
  const c = { id: newId('c'), slug: uniqueSlug(title, data.collections), title, description, coverId: '', group: normGroup(group) };
  liveAgain(data, `collections/${c.slug}/`);
  if (c.group) liveAgain(data, `groups/${slugify(c.group)}/`);
  data.collections.push(c);
  data.collections.sort(collectionOrder);
  await saveData();
  return c;
}

export async function updateCollection(id, patch) {
  const data = await loadData();
  const c = findCollection(data, id);
  const oldSlug = c.slug;
  for (const k of COLLECTION_EDITABLE) {
    if (!(k in patch)) continue;
    if (k === 'slug') c.slug = uniqueSlug(patch.slug || c.title, data.collections, c.id);
    else if (k === 'starred') c.starred = patch.starred === true;
    else if (k === 'group') c.group = normGroup(patch.group);
    else c[k] = String(patch[k] ?? '').trim();
  }
  if (!c.title) throw new UserError('Kolekce potřebuje název');
  if (c.slug !== oldSlug) addRedirect(data, `collections/${oldSlug}/`, `collections/${c.slug}/`);
  if (c.group) liveAgain(data, `groups/${slugify(c.group)}/`);
  data.collections.sort(collectionOrder); // a rename or a star can move it
  await saveData();
  return c;
}

/**
 * Rename a group in every collection that belongs to it (matched by slug, so spelling variants
 * are unified too). Renaming onto an existing group merges them. The old group page redirects.
 */
export async function renameGroup({ from, to }) {
  const data = await loadData();
  const name = normGroup(to);
  if (!name) throw new UserError('Skupina potřebuje název');
  const oldSlug = slugify(normGroup(from));
  const members = data.collections.filter(c => c.group && slugify(c.group) === oldSlug);
  if (!members.length) throw new UserError('Skupina nenalezena');
  for (const c of members) c.group = name;
  addRedirect(data, `groups/${oldSlug}/`, `groups/${slugify(name)}/`);
  data.collections.sort(collectionOrder);
  await saveData();
  return { group: name, collections: members.length };
}

export async function deleteCollection(id) {
  const data = await loadData();
  findCollection(data, id);
  data.collections = data.collections.filter(c => c.id !== id);
  for (const p of data.photos) p.collections = p.collections.filter(c => c !== id);
  await saveData();
  return { ok: true };
}


export async function updateSettings(patch) {
  const data = await loadData();
  for (const k of SETTINGS_EDITABLE) {
    if (!(k in patch)) continue;
    if (k === 'links') {
      data.settings.links = (Array.isArray(patch.links) ? patch.links : [])
        .map(l => ({ label: String(l.label || '').trim(), url: String(l.url || '').trim() }))
        .filter(l => l.url);
    } else if (k === 'contactEmail') {
      // Write-only input: stored as { user, domain } so neither gallery.json (public in the repo)
      // nor the generated site ever contains the whole address; the site joins it in the browser.
      const raw = String(patch[k] ?? '').trim();
      const m = raw.match(/^([^\s@]+)@([^\s@]+\.[^\s@]+)$/);
      if (raw && !m) throw new UserError('Kontaktní e-mail nemá platný tvar (např. foto@martinposta.com).');
      data.settings.contact = m ? { user: m[1], domain: m[2].toLowerCase() } : null;
    } else if (k === 'analyticsToken') {
      // Accept the bare token or the whole snippet Cloudflare shows (it contains "token": "…").
      const raw = String(patch[k] ?? '').trim();
      const token = raw.match(/[a-f0-9]{32}/i)?.[0] || '';
      if (raw && !token) throw new UserError('Token Cloudflare Web Analytics je 32 znaků (0–9, a–f). Vlož ho, nebo celý skript, který Cloudflare ukáže.');
      data.settings[k] = token.toLowerCase();
    } else {
      data.settings[k] = String(patch[k] ?? '').trim();
    }
  }
  await saveData();
  return data.settings;
}

export async function setAvatar(buf) {
  const data = await loadData();
  data.settings.avatar = await processAvatar(buf);
  data.settings.avatarVersion = Date.now();
  await saveData();
  return data.settings;
}
