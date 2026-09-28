// Load/save data/gallery.json — the single source of truth for the gallery.

import fs from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from './config.mjs';

export const DEFAULT_DATA = {
  settings: {
    name: 'Martin Pošta',
    bio: 'Fotky z cest, z Prahy a odjinud.',
    links: [{ label: 'martinposta.com', url: 'https://www.martinposta.com' }],
    siteUrl: '',        // absolute public URL, e.g. https://www.martinposta.com/foto/ (needed for link previews)
    customDomain: '',   // only for a subdomain setup, e.g. foto.martinposta.com (writes docs/CNAME)
    coverPhotoId: '',   // photo used as the link-preview image of the whole gallery
    avatar: '',         // relative path inside docs/, e.g. img/avatar.webp
    sort: 'taken',      // automatic order: 'taken' (date taken, newest first) | 'added' (upload order, newest first)
    order: null,        // custom order of "Vše" as an array of photo ids; null = automatic (lib/order.mjs)
    copyright: '© Martin Pošta', // written into every web copy with `name` as Artist (D11); '' = write nothing
    analyticsToken: '', // Cloudflare Web Analytics site token (D18); '' = no analytics
    contact: null,      // { user, domain }: kept split so the address never sits whole in a file (D26)
  },
  collections: [],      // [{ id, slug, title, description, coverId }]
  photos: [],           // see images.mjs -> createPhotoRecord()
  redirects: {},        // old page path -> current one, e.g. "groups/czech-republic/": "groups/czechia/" (D21)
};

// Collection order (D15, D20): starred first, alphabetically among themselves regardless of their
// group; then the rest by group name (collections without a group last) and by title within a
// group. Czech collation ("Č" after "C", numbers by value). The array is kept sorted, so its order
// is the display order everywhere. admin.js mirrors this.
const cs = (a, b) => a.localeCompare(b, 'cs', { sensitivity: 'base', numeric: true });
export const collectionOrder = (a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0)
  || (a.starred ? 0 : (a.group ? 0 : 1) - (b.group ? 0 : 1) || cs(a.group || '', b.group || ''))
  || cs(a.title, b.title);

let cache = null;

// Drafts (D24) live in the same in-memory model as everything else: a photo with `draft: true`.
// Only saving splits it: published photos, and collections holding at least one published photo,
// go to data/gallery.json (public in the repo); drafts and every other collection (empty, or
// drafts only, Q13) go to data/drafts.json, which git ignores. Whether a collection is public is
// therefore never stored, it follows from its photos on every save.
const isPublicCollection = (data, c) => data.photos.some(p => !p.draft && p.collections.includes(c.id));

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return fallback; throw err; }
}

export async function loadData() {
  if (cache) return cache;
  const raw = await readJson(PATHS.data, null);
  const drafts = await readJson(PATHS.drafts, { photos: [], collections: [] });
  cache = {
    ...structuredClone(DEFAULT_DATA),
    ...(raw || {}),
    settings: { ...DEFAULT_DATA.settings, ...(raw?.settings || {}) },
  };
  // A crash between writing the two files can leave a record in both; the published one wins.
  const ids = new Set(cache.photos.map(p => p.id));
  cache.photos.push(...drafts.photos.filter(p => !ids.has(p.id)).map(p => ({ ...p, draft: true })));
  const cids = new Set(cache.collections.map(c => c.id));
  cache.collections.push(...drafts.collections.filter(c => !cids.has(c.id)));
  cache.collections.sort(collectionOrder);
  if (!raw) await saveData();
  return cache;
}

let writeChain = Promise.resolve();

// Drop the in-memory copy and read the files again. Needed after git changed them underneath the
// admin (sync with GitHub, D25): without it the next save would write the old state back over the
// pulled one. Waits for pending writes first so nothing half-saved is lost.
export async function reloadData() {
  await writeChain;
  cache = null;
  return loadData();
}

async function writeAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(file + '.tmp', file);
}

export function saveData() {
  // Serialize writes and use write-then-rename so a crash never leaves a half-written file.
  // gallery.json first: if the process dies in between, a just-published photo is in both files,
  // and loadData() resolves that in favour of the published copy.
  writeChain = writeChain.then(async () => {
    const d = cache;
    await writeAtomic(PATHS.data, {
      ...d,
      collections: d.collections.filter(c => isPublicCollection(d, c)),
      photos: d.photos.filter(p => !p.draft),
    });
    await writeAtomic(PATHS.drafts, {
      photos: d.photos.filter(p => p.draft).map(({ draft: _, ...p }) => p),
      collections: d.collections.filter(c => !isPublicCollection(d, c)),
    });
  });
  return writeChain;
}

export function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'kolekce';
}

export function uniqueSlug(base, collections, ignoreId) {
  let slug = slugify(base);
  let n = 2;
  const taken = new Set(collections.filter(c => c.id !== ignoreId).map(c => c.slug));
  const root = slug;
  while (taken.has(slug)) slug = `${root}-${n++}`;
  return slug;
}

export function newId(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}
