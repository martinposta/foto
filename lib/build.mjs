// Generates the public static site into docs/ from data/gallery.json + site/ template.
// Output:
//   docs/index.html                 all photos
//   docs/collections/index.html         list of collections
//   docs/collections/<slug>/index.html  single collection
//   docs/f/<id>/index.html          single photo (shareable link with its own preview image)
//   docs/data.json                  public data consumed by site/app.js
//   docs/assets/*                   copied from site/

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PATHS, IMAGE } from './config.mjs';
import { loadData, slugify } from './store.mjs';
import { sortPhotos, orderedPhotos } from './order.mjs';

export { sortPhotos };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function publicData(data) {
  const photos = orderedPhotos(data.photos, data.settings.order, data.settings.sort);
  const collections = data.collections.map(c => {
    // Each collection has its own order (lib/order.mjs); the site gets it as a list of ids.
    const inColl = orderedPhotos(data.photos.filter(p => p.collections.includes(c.id)), c.order, data.settings.sort);
    const cover = inColl.find(p => p.id === c.coverId) || inColl[0];
    const preview = [cover, ...inColl.filter(p => p !== cover)].filter(Boolean).slice(0, 3).map(p => p.id);
    const group = c.group || '';
    return { slug: c.slug, title: c.title, description: c.description || '', starred: !!c.starred,
      group, groupSlug: group ? slugify(group) : '', count: inColl.length, preview, photos: inColl.map(p => p.id) };
  }).filter(c => c.count > 0);

  // Groups (D20) are not stored on their own: they exist while a collection names them, keyed by
  // slug so "Česko" and "Cesko" are one group (shown under the first spelling). A group's photos
  // are its collections in their order (starred ones included), each in its own order, deduped.
  const byGroup = new Map();
  for (const c of [...collections].sort((a, b) => a.title.localeCompare(b.title, 'cs', { sensitivity: 'base', numeric: true }))) {
    if (!c.groupSlug) continue;
    if (!byGroup.has(c.groupSlug)) byGroup.set(c.groupSlug, { slug: c.groupSlug, name: c.group, collections: [], photos: [] });
    const g = byGroup.get(c.groupSlug);
    g.collections.push(c.slug);
    for (const id of c.photos) if (!g.photos.includes(id)) g.photos.push(id);
  }
  const groups = [...byGroup.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'cs', { sensitivity: 'base', numeric: true }))
    .map(g => ({ ...g, count: g.photos.length, preview: g.photos.slice(0, 3) }));
  const slugById = Object.fromEntries(data.collections.map(c => [c.id, c.slug]));
  return {
    settings: {
      name: data.settings.name,
      bio: data.settings.bio,
      links: (data.settings.links || []).filter(l => l.url),
      avatar: data.settings.avatar ? `${data.settings.avatar}?v=${data.settings.avatarVersion || 0}` : '',
    },
    collections,
    groups,
    photos: photos.map(p => ({
      id: p.id,
      w: p.width, h: p.height,
      widths: p.widths, format: p.format, color: p.color,
      v: p.version || 1, // cache-buster: a replaced photo keeps its file names
      title: p.title || '', description: p.description || '', location: p.location || '',
      takenAt: p.takenAt || '',
      exif: p.exif || {},
      collections: p.collections.map(id => slugById[id]).filter(Boolean),
    })),
  };
}

function ogSize(p) {
  const s = Math.min(1, IMAGE.og.width / p.width, 1200 / p.height);
  return { w: Math.round(p.width * s), h: Math.round(p.height * s) };
}

function metaTags({ title, description, url, image }) {
  const t = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(title)}">`,
    description && `<meta property="og:description" content="${esc(description)}">`,
    description && `<meta name="description" content="${esc(description)}">`,
    url && `<meta property="og:url" content="${esc(url)}">`,
    url && `<link rel="canonical" href="${esc(url)}">`,
  ];
  if (image) {
    t.push(
      `<meta property="og:image" content="${esc(image.url)}">`,
      `<meta property="og:image:width" content="${image.w}">`,
      `<meta property="og:image:height" content="${image.h}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
    );
  }
  return t.filter(Boolean).join('\n    ');
}

// Cloudflare Web Analytics (D18): cookieless, only when a token is set. Injected from a script so
// the admin's local preview (localhost) never reports visits; `spa` counts pushState navigation
// between photos and collections as page views.
function analyticsSnippet(token) {
  if (!token) return '';
  const beacon = JSON.stringify({ token, spa: true });
  return `<script>if(!/^(localhost|127\\.|\\[::1\\])/.test(location.hostname)){var s=document.createElement('script');` +
    `s.defer=true;s.src='https://static.cloudflareinsights.com/beacon.min.js';s.setAttribute('data-cf-beacon',${JSON.stringify(beacon)});` +
    `document.head.appendChild(s)}</script>`;
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    if (e.name === 'index.html') continue; // template, rendered separately
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function writeIfChanged(file, content) {
  try { if (await fs.readFile(file, 'utf8') === content) return; } catch { /* new file */ }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

export async function buildSite() {
  const data = await loadData();
  const pub = publicData(data);
  const S = data.settings;
  const siteUrl = S.siteUrl ? S.siteUrl.replace(/\/?$/, '/') : '';
  const photoById = Object.fromEntries(data.photos.map(p => [p.id, p]));

  const json = JSON.stringify(pub);
  const assetHash = crypto.createHash('sha1');
  for (const f of ['app.js', 'style.css']) assetHash.update(await fs.readFile(path.join(PATHS.siteSrc, f)));
  const v = crypto.createHash('sha1').update(json).update(assetHash.digest('hex')).digest('hex').slice(0, 10);

  await fs.mkdir(PATHS.docs, { recursive: true });
  await writeIfChanged(path.join(PATHS.docs, 'data.json'), json);
  await copyDir(PATHS.siteSrc, path.join(PATHS.docs, 'assets'));
  await writeIfChanged(path.join(PATHS.docs, '.nojekyll'), '');
  const cname = path.join(PATHS.docs, 'CNAME');
  if (S.customDomain) await writeIfChanged(cname, S.customDomain.trim() + '\n');
  else await fs.rm(cname, { force: true });

  const template = await fs.readFile(path.join(PATHS.siteSrc, 'index.html'), 'utf8');
  const analytics = analyticsSnippet(S.analyticsToken);
  const imageFor = id => {
    const p = photoById[id];
    if (!p || !siteUrl || !IMAGE.og.enabled) return null;
    return { url: `${siteUrl}img/${p.id}/og.jpg?v=${p.version || 1}`, ...ogSize(p) };
  };
  const galleryCover = S.coverPhotoId || pub.photos[0]?.id;

  const metaFor = new Map(); // rel -> what its link preview says, reused by redirect pages
  const render = ({ rel, page, title, description, image }) => {
    metaFor.set(rel, { title, description, image });
    const depth = rel ? rel.split('/').filter(Boolean).length : 0;
    const root = depth ? '../'.repeat(depth) : './';
    return template
      .replaceAll('{{ROOT}}', root)
      .replaceAll('{{V}}', v)
      .replaceAll('{{TITLE}}', esc(title))
      .replaceAll('{{META}}', metaTags({ title, description, url: siteUrl && siteUrl + rel, image }))
      .replaceAll('{{PAGE}}', esc(JSON.stringify(page)))
      .replaceAll('{{ANALYTICS}}', analytics);
  };

  const pages = new Map();
  pages.set('', render({ rel: '', page: { view: 'photos' }, title: S.name, description: S.bio, image: imageFor(galleryCover) }));
  pages.set('collections/', render({ rel: 'collections/', page: { view: 'collections' }, title: `Collections · ${S.name}`, description: S.bio, image: imageFor(galleryCover) }));
  for (const c of pub.collections) {
    pages.set(`collections/${c.slug}/`, render({
      rel: `collections/${c.slug}/`, page: { view: 'collection', slug: c.slug },
      title: `${c.title} · ${S.name}`,
      description: c.description || `${c.count} photo${c.count === 1 ? '' : 's'}`,
      image: imageFor(c.preview[0]),
    }));
  }
  for (const p of pub.photos) {
    pages.set(`f/${p.id}/`, render({
      rel: `f/${p.id}/`, page: { view: 'photo', id: p.id },
      // Untitled photos go by their place (the owner leaves titles empty rather than repeat
      // the location); the fallback description then must not repeat it.
      title: `${p.title || p.location || 'Photo'} · ${S.name}`,
      description: p.description || [p.title && p.location, p.exif?.camera].filter(Boolean).join(' · '),
      image: imageFor(p.id),
    }));
  }

  for (const g of pub.groups) {
    pages.set(`groups/${g.slug}/`, render({
      rel: `groups/${g.slug}/`, page: { view: 'group', slug: g.slug },
      title: `${g.name} · ${S.name}`,
      description: `${g.count} photo${g.count === 1 ? '' : 's'} · ${g.collections.length} collection${g.collections.length === 1 ? '' : 's'}`,
      image: imageFor(g.photos[0]),
    }));
  }

  // Redirects (D21): an old collection address or a renamed group's page sends visitors on to the
  // current one, keeping the link preview of the target. Only while the target exists.
  for (const [from, to] of Object.entries(data.redirects || {})) {
    if (pages.has(from) || !pages.has(to)) continue;
    const target = '../'.repeat(from.split('/').filter(Boolean).length) + to;
    const m = metaFor.get(to);
    pages.set(from, `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${esc(target)}">` +
      `<title>${esc(m.title)}</title>\n    ${metaTags({ ...m, url: siteUrl && siteUrl + to })}</head>` +
      `<body><script>location.replace(${JSON.stringify(target)} + location.search + location.hash)</script>` +
      `<p>This page has moved: <a href="${esc(target)}">${esc(m.title)}</a></p></body></html>`);
  }

  // Remove pages of deleted photos/collections/groups, then write the current set.
  // The public site was Czech until 2026-09-27 (collections lived under kolekce/); nothing was shared yet.
  await fs.rm(path.join(PATHS.docs, 'kolekce'), { recursive: true, force: true });
  for (const dir of ['collections', 'groups', 'f']) {
    const full = path.join(PATHS.docs, dir);
    let entries = [];
    try { entries = await fs.readdir(full, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory() && !pages.has(`${dir}/${e.name}/`)) await fs.rm(path.join(full, e.name), { recursive: true, force: true });
    }
  }
  for (const [rel, html] of pages) await writeIfChanged(path.join(PATHS.docs, rel, 'index.html'), html);

  // 404 page for GitHub Pages: send visitors back to the gallery home.
  const home = siteUrl || '/';
  await writeIfChanged(path.join(PATHS.docs, '404.html'),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title>` +
    `<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#111}a{color:inherit}</style>` +
    `<p>This page does not exist. <a href="${esc(home)}">Back to the gallery →</a></p>`);

  return { pages: pages.size, photos: pub.photos.length, version: v };
}
