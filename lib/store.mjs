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

export async function loadData() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await fs.readFile(PATHS.data, 'utf8'));
    cache = {
      ...structuredClone(DEFAULT_DATA),
      ...raw,
      settings: { ...DEFAULT_DATA.settings, ...(raw.settings || {}) },
    };
    cache.collections.sort(collectionOrder);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    cache = structuredClone(DEFAULT_DATA);
    await saveData();
  }
  return cache;
}

let writeChain = Promise.resolve();

export function saveData() {
  // Serialize writes and use write-then-rename so a crash never leaves a half-written file.
  writeChain = writeChain.then(async () => {
    await fs.mkdir(path.dirname(PATHS.data), { recursive: true });
    const tmp = PATHS.data + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(cache, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, PATHS.data);
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
