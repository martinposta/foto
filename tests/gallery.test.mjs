// End-to-end tests for the admin server + site build. No extra dependencies:
//   npm test
// Runs the real admin server against a throw-away data root (GALLERY_DATA_ROOT) with its own
// git repo and a local bare "GitHub" remote, so your real data/ and docs/ are never touched.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import exifr from 'exifr';
import { readMetadata, targetWidths } from '../lib/images.mjs';
import { orderedPhotos, reorder } from '../lib/order.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4399;
const BASE = `http://localhost:${PORT}`;
const HEADERS = { Origin: BASE };

let tmp, dataRoot, remote, server;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

async function api(method, p, body, raw) {
  const opts = { method, headers: { ...HEADERS } };
  if (raw) opts.body = raw;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(BASE + p, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

// Wait for the debounced site build to run and finish.
async function settle() { await sleep(450); await api('GET', '/api/git'); }

const docs = (...p) => path.join(dataRoot, 'docs', ...p);

// EXIF of a published file as a plain object (exifr cannot open WebP, so read the block via sharp).
async function publishedExif(file) {
  const m = await sharp(file).metadata();
  if (!m.exif) return { xmp: m.xmp, exif: null };
  const tiff = m.exif.subarray(m.exif.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0);
  const exif = await exifr.parse(tiff, { tiff: true, exif: true, gps: true, interop: true, ifd1: true, translateValues: false });
  return { xmp: m.xmp, exif };
}

const FORBIDDEN_EXIF = ['GPSLatitude', 'GPSLongitude', 'latitude', 'longitude', 'Make', 'Model', 'Software', 'BodySerialNumber', 'DateTimeOriginal'];

function xmp(title, description) {
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>
<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${description}</rdf:li></rdf:Alt></dc:description>
</rdf:Description></rdf:RDF></x:xmpmeta>`;
}

async function makeJpeg({ w, h, color, orientation, title, description, noise = false }) {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: color } });
  if (noise) {
    const n = await sharp({ create: { width: w, height: h, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 30 } } }).png().toBuffer();
    img = sharp(await img.composite([{ input: n, blend: 'overlay' }]).png().toBuffer());
  }
  // Everything a camera/editor leaves behind that must NOT reach the web copies.
  img = img.withExif({
    IFD0: { Make: 'FUJIFILM', Model: 'X-T5', Software: 'Capture One 23 Macintosh', Artist: 'Someone Else' },
    IFD2: { DateTimeOriginal: '2025:01:03 10:20:00', BodySerialNumber: '9SB12345' },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '49/1 1/1 30/1', GPSLongitudeRef: 'E', GPSLongitude: '13/1 45/1 10/1' },
  });
  if (orientation) img = img.withMetadata({ orientation });
  if (title) img = img.withXmp(xmp(title, description || ''));
  return img.jpeg({ quality: 92 }).toBuffer();
}

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'foto-galerie-test-'));
  dataRoot = path.join(tmp, 'site');
  remote = path.join(tmp, 'remote.git');
  await fs.mkdir(dataRoot);
  git(tmp, 'init', '-q', '--bare', '-b', 'main', remote);
  git(dataRoot, 'init', '-q', '-b', 'main');
  git(dataRoot, 'config', 'user.name', 'Test');
  git(dataRoot, 'config', 'user.email', 'test@example.com');
  git(dataRoot, 'remote', 'add', 'origin', remote);

  server = spawn(process.execPath, [path.join(ROOT, 'admin', 'server.mjs')], {
    env: { ...process.env, PORT: String(PORT), NO_OPEN: '1', GALLERY_DATA_ROOT: dataRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => (log += d));
  server.stderr.on('data', d => (log += d));
  for (let i = 0; i < 100 && !log.includes(String(PORT)); i++) await sleep(100);
  if (!log.includes(String(PORT))) throw new Error('Admin server did not start:\n' + log);
});

after(async () => {
  server?.kill();
  await sleep(200);
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

let photoA, photoB, collection;

test('fresh start creates data file and an empty site', async () => {
  const { status, json } = await api('GET', '/api/state');
  assert.equal(status, 200);
  assert.deepEqual(json.data.photos, []);
  assert.ok(existsSync(path.join(dataRoot, 'data', 'gallery.json')));
  assert.ok(existsSync(docs('index.html')));
  assert.ok(existsSync(docs('.nojekyll')));
  assert.equal(json.git.repo, true);
});

test('upload: metadata is read, derivatives are written, metadata is stripped', async () => {
  const buf = await makeJpeg({ w: 3000, h: 2000, color: '#3b5b8c', title: 'Šumava ráno', description: 'Mlha nad Vltavou.', noise: true });
  const { status, json } = await api('POST', '/api/upload?name=DSCF0001.jpg', undefined, buf);
  assert.equal(status, 200, JSON.stringify(json));
  photoA = json.photo;
  assert.equal(json.duplicate, false);
  assert.equal(photoA.title, 'Šumava ráno');
  assert.equal(photoA.description, 'Mlha nad Vltavou.');
  assert.equal(photoA.takenAt, '2025-01-03T10:20:00');
  assert.equal(photoA.exif.camera, 'Fujifilm X-T5');
  assert.deepEqual([photoA.width, photoA.height], [3000, 2000]);
  assert.deepEqual(photoA.widths, [480, 960, 1600, 2400]);

  for (const w of photoA.widths) assert.ok(existsSync(docs('img', photoA.id, `${w}.${photoA.format}`)), `missing ${w}`);
  assert.ok(existsSync(docs('img', photoA.id, 'og.jpg')));
  assert.equal((await sharp(docs('img', photoA.id, `2400.${photoA.format}`)).metadata()).width, 2400);
  assert.equal(photoA.exif.camera, 'Fujifilm X-T5', 'camera is read from the original before stripping');

  // D11: every web copy carries exactly author + copyright, nothing from the original (D5, D12).
  for (const f of [...photoA.widths.map(w => `${w}.${photoA.format}`), 'og.jpg']) {
    const { exif, xmp } = await publishedExif(docs('img', photoA.id, f));
    assert.equal(xmp, undefined, `${f}: XMP must not be published`);
    assert.ok(exif, `${f}: author EXIF missing`);
    assert.equal(exif.Artist, 'Martin Posta', `${f}: Artist (ASCII-transliterated settings.name)`);
    assert.equal(exif.Copyright, '(C) Martin Posta', `${f}: Copyright`);
    for (const k of FORBIDDEN_EXIF) assert.equal(exif[k], undefined, `${f}: ${k} must not be published`);
  }
});

test('copyright: empty setting publishes files with no metadata at all', async () => {
  let r = await api('PATCH', '/api/settings', { copyright: '' });
  assert.equal(r.json.copyright, '');
  const buf = await makeJpeg({ w: 1200, h: 800, color: '#2a9d8f' });
  const { json } = await api('POST', '/api/upload?name=nocopy.jpg', undefined, buf);
  for (const f of [`${json.photo.widths.at(-1)}.${json.photo.format}`, 'og.jpg']) {
    const m = await sharp(docs('img', json.photo.id, f)).metadata();
    assert.equal(m.exif, undefined, `${f}: EXIF must be absent`);
    assert.equal(m.xmp, undefined, `${f}: XMP must be absent`);
  }
  await api('POST', '/api/photos/bulk', { ids: [json.photo.id], remove: true });
  r = await api('PATCH', '/api/settings', { copyright: '© Martin Pošta' });
  assert.equal(r.json.copyright, '© Martin Pošta');
});

test('upload: EXIF orientation is applied (portrait from rotated landscape)', async () => {
  const buf = await makeJpeg({ w: 3000, h: 2000, color: '#e76f51', orientation: 6 });
  const { status, json } = await api('POST', '/api/upload?name=DSCF0002.jpg', undefined, buf);
  assert.equal(status, 200);
  photoB = json.photo;
  assert.deepEqual([photoB.width, photoB.height], [2000, 3000]);
  // Long edge capped at 2400 -> largest width 1600 for a 2:3 portrait.
  assert.equal(photoB.widths.at(-1), 1600);
  const m = await sharp(docs('img', photoB.id, '1600.' + photoB.format)).metadata();
  assert.deepEqual([m.width, m.height], [1600, 2400]);
});

test('upload: same file twice is detected as duplicate', async () => {
  const buf = await makeJpeg({ w: 3000, h: 2000, color: '#e76f51', orientation: 6 });
  const { json } = await api('POST', '/api/upload?name=copy.jpg', undefined, buf);
  assert.equal(json.duplicate, true);
  assert.equal(json.photo.id, photoB.id);
  const { json: st } = await api('GET', '/api/state');
  assert.equal(st.data.photos.length, 2);
});

test('upload: unsupported format is rejected with a readable error', async () => {
  const { status, json } = await api('POST', '/api/upload?name=IMG_0001.HEIC', undefined, Buffer.from('x'));
  assert.equal(status, 400);
  assert.match(json.error, /Nepodporovaný formát/);
});

test('collections: Czech titles become unique ASCII slugs', async () => {
  const a = await api('POST', '/api/collections', { title: 'Černobílé' });
  const b = await api('POST', '/api/collections', { title: 'Černobílé' });
  assert.equal(a.json.slug, 'cernobile');
  assert.equal(b.json.slug, 'cernobile-2');
  collection = a.json;
  const del = await api('DELETE', `/api/collections/${b.json.id}`);
  assert.equal(del.status, 200);
});

test('editing photo + collection regenerates collection and photo pages', async () => {
  await api('PATCH', `/api/photos/${photoB.id}`, { title: 'Věž', location: 'Praha', collections: [collection.id, 'nonexistent'] });
  await api('POST', '/api/photos/bulk', { ids: [photoA.id], addCollection: collection.id });
  await api('PATCH', `/api/collections/${collection.id}`, { description: 'Bez barev.', coverId: photoB.id });
  await settle();

  const { json: st } = await api('GET', '/api/state');
  const b = st.data.photos.find(p => p.id === photoB.id);
  assert.deepEqual(b.collections, [collection.id], 'unknown collection ids are dropped');

  const pub = JSON.parse(await fs.readFile(docs('data.json'), 'utf8'));
  const c = pub.collections.find(x => x.slug === 'cernobile');
  assert.equal(c.count, 2);
  assert.equal(c.preview[0], photoB.id, 'cover goes first');
  assert.ok(existsSync(docs('collections', 'cernobile', 'index.html')));
  assert.ok(existsSync(docs('f', photoB.id, 'index.html')));
  assert.ok(!existsSync(docs('collections', 'cernobile-2')), 'deleted collection page removed');
});

test('siteUrl produces absolute link-preview (Open Graph) tags', async () => {
  await api('PATCH', '/api/settings', { siteUrl: 'https://www.martinposta.com/foto' });
  await settle();
  const html = await fs.readFile(docs('collections', 'cernobile', 'index.html'), 'utf8');
  assert.match(html, /<meta property="og:url" content="https:\/\/www\.martinposta\.com\/foto\/collections\/cernobile\/">/);
  assert.match(html, new RegExp(`og:image" content="https://www\\.martinposta\\.com/foto/img/${photoB.id}/og\\.jpg\\?v=1"`));
  assert.match(html, /<title>Černobílé · /);
  // Relative asset paths so the site works under /foto/ and on a subdomain root.
  assert.match(html, /href="\.\.\/\.\.\/assets\/style\.css\?v=/);
});

test('customDomain writes docs/CNAME, clearing it removes the file', async () => {
  await api('PATCH', '/api/settings', { customDomain: 'foto.martinposta.com' });
  await settle();
  assert.equal((await fs.readFile(docs('CNAME'), 'utf8')).trim(), 'foto.martinposta.com');
  await api('PATCH', '/api/settings', { customDomain: '' });
  await settle();
  assert.ok(!existsSync(docs('CNAME')));
});

test('security: foreign Host header and cross-site Origin are refused', async () => {
  // fetch() silently ignores a custom Host header, so use node:http for the DNS-rebinding case.
  const hostStatus = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/api/state', headers: { Host: `evil.example:${PORT}` } },
      res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  const r2 = await fetch(BASE + '/api/settings', { method: 'PATCH', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{"name":"x"}' });
  assert.equal(r2.status, 403);
  const r3 = await fetch(BASE + '/preview/..%2f..%2fpackage.json');
  assert.notEqual(r3.status, 200, 'path traversal out of docs/ must fail');
});

test('publish: commits and pushes to origin, second publish is a no-op', async () => {
  const first = await api('POST', '/api/publish', { message: 'Test publish' });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.status.changes, 0);
  assert.equal(first.json.status.upstream, 'origin/main');
  assert.match(git(remote, 'log', '--oneline', 'main'), /Test publish/);
  assert.equal(git(remote, 'ls-tree', '-r', '--name-only', 'main').includes('docs/index.html'), true);

  const second = await api('POST', '/api/publish', {});
  assert.equal(second.status, 200);
  assert.match(second.json.log, /Žádné nové změny/);
});

test('delete: removes images and pages, clears cover references', async () => {
  await api('PATCH', '/api/settings', { coverPhotoId: photoB.id });
  await api('POST', '/api/photos/bulk', { ids: [photoB.id], remove: true });
  await settle();
  assert.ok(!existsSync(docs('img', photoB.id)));
  assert.ok(!existsSync(docs('f', photoB.id)));
  const { json: st } = await api('GET', '/api/state');
  assert.equal(st.data.settings.coverPhotoId, '');
  assert.equal(st.data.collections.find(c => c.id === collection.id).coverId, '');
  assert.ok(st.git.changes > 0, 'deletion shows up as unpublished change');
});

test('metadata: Capture One location fields and a phone photo re-saved through Adobe', async () => {
  // Capture One / Lightroom write the IPTC location block into XMP; Sublocation is the specific place.
  const loc = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
 Iptc4xmpCore:Location="Boubín" photoshop:City="Kvilda" photoshop:State="Jihočeský kraj" photoshop:Country="Česko"/>
</rdf:RDF></x:xmpmeta>`;
  // Real case from the owner's exports: iPhone photo whose camera tags became "Adobe Systems Inc." / "Tiff File".
  const buf = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#888' } })
    .withExif({ IFD0: { Make: 'Adobe Systems Inc.', Model: 'Tiff File' }, IFD2: { LensModel: 'iPhone 11 back dual wide camera 4.25mm f/1.8' } })
    .withXmp(loc).jpeg().toBuffer();
  const m = await readMetadata(buf);
  assert.equal(m.location, 'Boubín, Kvilda, Česko');
  assert.equal(m.exif.camera, 'iPhone 11');
  assert.equal(m.exif.lens, 'iPhone 11 back dual wide camera 4.25mm f/1.8');
});

test('widths: no near-duplicate step next to the largest width', () => {
  assert.deepEqual(targetWidths(6000, 4000), [480, 960, 1600, 2400]);
  assert.deepEqual(targetWidths(4160, 6240), [480, 960, 1600]);   // portrait capped by the long edge
  assert.deepEqual(targetWidths(2504, 3713), [480, 960, 1619]);   // 1600 would be a second copy of 1619
  assert.deepEqual(targetWidths(400, 300), [400]);                // never upscaled
});

test('replace: new version keeps id, texts and collections; files, size and version change', async () => {
  const first = await makeJpeg({ w: 3000, h: 2000, color: '#264653', title: 'Původní název' });
  const { json: up } = await api('POST', '/api/upload?name=DSCF0100.jpg', undefined, first);
  const id = up.photo.id;
  const { json: coll } = await api('POST', '/api/collections', { title: 'Nahrazení' });
  await api('PATCH', `/api/photos/${id}`, { title: 'Můj název', location: 'Kvilda', collections: [coll.id] });
  await api('PATCH', `/api/collections/${coll.id}`, { coverId: id });
  assert.ok(existsSync(docs('img', id, `2400.${up.photo.format}`)));

  // Re-edited in Capture One and cropped to portrait.
  const second = await makeJpeg({ w: 2000, h: 3000, color: '#e9c46a', title: 'Název z nového exportu' });
  const { status, json: p } = await api('POST', `/api/photos/${id}/replace?name=DSCF0100-v2.jpg`, undefined, second);
  assert.equal(status, 200, JSON.stringify(p));
  assert.equal(p.id, id, 'id (and so the shared URL) stays');
  assert.equal(p.title, 'Můj název', 'owner-written title is kept');
  assert.equal(p.location, 'Kvilda');
  assert.deepEqual(p.collections, [coll.id]);
  assert.deepEqual([p.width, p.height], [2000, 3000]);
  assert.deepEqual(p.widths, [480, 960, 1600]);
  assert.equal(p.version, 2);
  assert.equal(p.originalName, 'DSCF0100-v2.jpg');
  assert.ok(!existsSync(docs('img', id, `2400.${p.format}`)), 'widths of the old crop are removed');
  assert.ok(!existsSync(docs('img', `${id}.new`)), 'no temporary folder left behind');
  const { exif } = await publishedExif(docs('img', id, `1600.${p.format}`));
  assert.equal(exif.Copyright, '(C) Martin Posta', 'replaced files carry the author too');
  assert.equal(exif.GPSLatitude, undefined);

  await settle();
  const pub = JSON.parse(await fs.readFile(docs('data.json'), 'utf8'));
  assert.equal(pub.photos.find(x => x.id === id).v, 2, 'cache-buster reaches the public data');
  assert.ok(existsSync(docs('f', id, 'index.html')), 'photo page stays at the same URL');
  const { json: st } = await api('GET', '/api/state');
  assert.equal(st.data.collections.find(c => c.id === coll.id).coverId, id, 'collection cover is kept');

  // Uploading either version again is recognised as already in the gallery.
  for (const buf of [second, first]) {
    const { json } = await api('POST', '/api/upload?name=again.jpg', undefined, buf);
    assert.equal(json.duplicate, true);
    assert.equal(json.photo.id, id);
  }
  // Same file again, another photo's file, unknown photo, wrong format: readable 400s.
  let r = await api('POST', `/api/photos/${id}/replace?name=x.jpg`, undefined, second);
  assert.equal(r.status, 400); assert.match(r.json.error, /stejný soubor/);
  const { json: other } = await api('POST', '/api/upload?name=other.jpg', undefined, await makeJpeg({ w: 800, h: 600, color: '#f4a261' }));
  r = await api('POST', `/api/photos/${id}/replace?name=x.jpg`, undefined, await makeJpeg({ w: 800, h: 600, color: '#f4a261' }));
  assert.equal(r.status, 400); assert.match(r.json.error, /jiná fotka/);
  r = await api('POST', '/api/photos/neexistuje/replace?name=x.jpg', undefined, second);
  assert.equal(r.status, 400);
  r = await api('POST', `/api/photos/${id}/replace?name=x.heic`, undefined, second);
  assert.equal(r.status, 400); assert.match(r.json.error, /Nepodporovaný formát/);

  await api('POST', '/api/photos/bulk', { ids: [id, other.photo.id], remove: true });
  await api('DELETE', `/api/collections/${coll.id}`);
});

test('bulk: title, description and location for many photos; empty = unchanged; onlyEmpty fills gaps', async () => {
  const ids = [];
  for (const color of ['#101010', '#202020', '#303030']) {
    const { json } = await api('POST', `/api/upload?name=${color.slice(1)}.jpg`, undefined, await makeJpeg({ w: 900, h: 600, color }));
    ids.push(json.photo.id);
  }
  await api('PATCH', `/api/photos/${ids[0]}`, { location: 'Kvilda', description: 'Vlastní popis' });

  let r = await api('POST', '/api/photos/bulk', { ids, set: { title: 'Šumava 2022', description: '', location: 'Šumava' }, onlyEmpty: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const byId = Object.fromEntries(r.json.photos.map(p => [p.id, p]));
  assert.equal(r.json.photos.length, 3);
  for (const id of ids) assert.equal(byId[id].title, 'Šumava 2022');
  assert.equal(byId[ids[0]].location, 'Kvilda', 'onlyEmpty keeps a filled field');
  assert.equal(byId[ids[1]].location, 'Šumava', 'onlyEmpty fills an empty one');
  assert.equal(byId[ids[0]].description, 'Vlastní popis', 'empty input leaves the field alone');

  r = await api('POST', '/api/photos/bulk', { ids: ids.slice(0, 2), set: { location: '  Boubín ' } });
  assert.deepEqual(r.json.photos.map(p => p.location), ['Boubín', 'Boubín'], 'overwrites and trims by default');
  const { json: st } = await api('GET', '/api/state');
  assert.equal(st.data.photos.find(p => p.id === ids[2]).location, 'Šumava', 'photos outside the selection are untouched');

  r = await api('POST', '/api/photos/bulk', { ids, set: { title: ' ', keywords: 'x', exif: {} } });
  assert.equal(r.status, 400, 'nothing to write (and non-whitelisted keys ignored) is a readable error');

  await settle();
  const pub = JSON.parse(await fs.readFile(docs('data.json'), 'utf8'));
  assert.equal(pub.photos.find(p => p.id === ids[1]).title, 'Šumava 2022', 'reaches the public site');

  // Wiping is explicit: `clear` empties a field even though an empty input means "unchanged".
  r = await api('POST', '/api/photos/bulk', { ids: ids.slice(0, 2), set: { title: '', location: 'Lenora' }, clear: ['title', 'exif'] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.photos.map(p => [p.title, p.location]), [['', 'Lenora'], ['', 'Lenora']]);
  r = await api('POST', '/api/photos/bulk', { ids: [ids[0]], set: { description: 'ignorováno' }, clear: ['description'] });
  assert.equal(r.json.photos[0].description, '', 'clear wins over a value for the same field');
  const { json: st2 } = await api('GET', '/api/state');
  assert.equal(st2.data.photos.find(p => p.id === ids[2]).title, 'Šumava 2022', 'clear touches only the selection');
  await api('POST', '/api/photos/bulk', { ids, remove: true });
});

test('untitled photo: page title and link preview use the location, without repeating it', async () => {
  const { json } = await api('POST', '/api/upload?name=untitled.jpg', undefined, await makeJpeg({ w: 900, h: 600, color: '#556b2f' }));
  const id = json.photo.id;
  await api('PATCH', `/api/photos/${id}`, { location: 'Kvilda, Šumava' });
  await settle();
  let html = await fs.readFile(docs('f', id, 'index.html'), 'utf8');
  assert.match(html, /<title>Kvilda, Šumava · /);
  assert.match(html, /og:title" content="Kvilda, Šumava · /);
  assert.match(html, /og:description" content="Fujifilm X-T5"/, 'location is not repeated in the description');
  await api('PATCH', `/api/photos/${id}`, { title: 'Ráno' });
  await settle();
  html = await fs.readFile(docs('f', id, 'index.html'), 'utf8');
  assert.match(html, /og:title" content="Ráno · /);
  assert.match(html, /og:description" content="Kvilda, Šumava · Fujifilm X-T5"/);
  await api('POST', '/api/photos/bulk', { ids: [id], remove: true });
});

test('rewrite-author: new name/copyright reach existing files without re-encoding', async () => {
  const { json } = await api('POST', '/api/upload?name=rewrite.jpg', undefined, await makeJpeg({ w: 1800, h: 1200, color: '#8d99ae', noise: true }));
  const p = json.photo;
  const files = [...p.widths.map(w => `${w}.${p.format}`), 'og.jpg'];
  const pixels = async f => (await sharp(docs('img', p.id, f)).raw().toBuffer()).toString('base64');
  const before = Object.fromEntries(await Promise.all(files.map(async f => [f, await pixels(f)])));

  await api('PATCH', '/api/settings', { name: 'Martin Porter', copyright: '© Martin Porter' });
  let r = await api('POST', '/api/photos/rewrite-author', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.files >= files.length);
  for (const f of files) {
    const { exif, xmp } = await publishedExif(docs('img', p.id, f));
    assert.equal(exif.Artist, 'Martin Porter', f);
    assert.equal(exif.Copyright, '(C) Martin Porter', f);
    for (const k of FORBIDDEN_EXIF) assert.equal(exif[k], undefined, `${f}: ${k}`);
    assert.equal(xmp, undefined);
    assert.equal(await pixels(f), before[f], `${f}: image data must be unchanged`);
  }
  r = await api('POST', '/api/photos/rewrite-author', {});
  assert.equal(r.json.files, 0, 'second run changes nothing');

  // Empty copyright removes EXIF entirely; setting it again adds it back (also to a simple WebP).
  await api('PATCH', '/api/settings', { copyright: '' });
  await api('POST', '/api/photos/rewrite-author', {});
  for (const f of files) assert.equal((await sharp(docs('img', p.id, f)).metadata()).exif, undefined, f);
  const { json: bare } = await api('POST', '/api/upload?name=bare.jpg', undefined, await makeJpeg({ w: 700, h: 500, color: '#2b2d42' }));
  await api('PATCH', '/api/settings', { name: 'Martin Pošta', copyright: '© Martin Pošta' });
  await api('POST', '/api/photos/rewrite-author', {});
  for (const f of [`${bare.photo.widths.at(-1)}.${bare.photo.format}`, 'og.jpg', files[0]]) {
    const id = f === files[0] ? p.id : bare.photo.id;
    const { exif } = await publishedExif(docs('img', id, f));
    assert.equal(exif?.Copyright, '(C) Martin Posta', `${id}/${f}`);
    assert.ok((await sharp(docs('img', id, f)).metadata()).width > 0, 'still decodes');
  }
  await api('POST', '/api/photos/bulk', { ids: [p.id, bare.photo.id], remove: true });
});

test('repo size: git history size plus what the next publish adds, against 1 GB', async () => {
  let { json: g } = await api('GET', '/api/git');
  assert.equal(g.size.limit, 1024 ** 3);
  const stored0 = g.size.stored;
  assert.ok(stored0 > 0, 'test repo already has commits');

  const { json } = await api('POST', '/api/upload?name=size.jpg', undefined, await makeJpeg({ w: 2000, h: 1400, color: '#6d597a', noise: true }));
  await settle();
  ({ json: g } = await api('GET', '/api/git'));
  assert.ok(g.size.pending >= json.photo.bytes * 0.9, `pending ${g.size.pending} covers the new files (${json.photo.bytes})`);

  const pub = await api('POST', '/api/publish', {});
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  ({ json: g } = await api('GET', '/api/git'));
  assert.equal(g.size.pending, 0, 'nothing pending after publish');
  assert.ok(g.size.stored > stored0 + json.photo.bytes * 0.5, 'published images now count in history');
  await api('POST', '/api/photos/bulk', { ids: [json.photo.id], remove: true });
});

test('order (lib): automatic until moved, newcomers first, move/start/end/bydate', () => {
  const ph = [
    { id: 'a', takenAt: '2024-05-01T10:00:00', addedAt: '2026-01-01' },
    { id: 'b', takenAt: '2023-05-01T10:00:00', addedAt: '2026-01-02' },
    { id: 'c', takenAt: '2025-05-01T10:00:00', addedAt: '2026-01-03' },
    { id: 'd', takenAt: '2021-05-01T10:00:00', addedAt: '2026-01-04' },
  ];
  const ids = list => list.map(p => p.id);
  assert.deepEqual(ids(orderedPhotos(ph, null, 'taken')), ['c', 'a', 'b', 'd']);
  assert.deepEqual(ids(orderedPhotos(ph, null, 'added')), ['d', 'c', 'b', 'a']);
  // Stored order wins; unknown ids are ignored; photos missing from it come first (automatic order).
  assert.deepEqual(ids(orderedPhotos(ph, ['b', 'x', 'a'], 'taken')), ['c', 'd', 'b', 'a']);

  const cur = ['c', 'a', 'b', 'd'];
  assert.deepEqual(reorder(ph, cur, ['b'], 'start'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(reorder(ph, cur, ['c', 'd'], 'end'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(reorder(ph, cur, ['d', 'c'], 'move', 'b'), ['a', 'c', 'd', 'b'], 'keeps relative order of moved');
  assert.deepEqual(reorder(ph, cur, ['a'], 'move', null), ['c', 'b', 'd', 'a']);
  assert.deepEqual(reorder(ph, cur, ['a'], 'move', 'a'), ['c', 'b', 'd', 'a'], 'dropping on itself = end, never lost');
  // Custom order c, d, a, b with d (2021) and b (2023) moved into their dated places.
  assert.deepEqual(reorder(ph, ['d', 'b', 'c', 'a'], ['d', 'b'], 'bydate'), ['c', 'a', 'b', 'd']);
  // bydate leaves the rest of a custom order untouched: a stays before c.
  assert.deepEqual(reorder(ph, ['a', 'c', 'd'], ['d'], 'bydate'), ['a', 'c', 'd']);
});

test('order (API): each list keeps its own order, newcomers first, reset, site data follows', async () => {
  const made = [];
  for (const [i, date] of ['2022:03:01', '2023:03:01', '2024:03:01'].entries()) {
    let img = sharp({ create: { width: 600, height: 400, channels: 3, background: ['#111', '#222', '#333'][i] } })
      .withExif({ IFD2: { DateTimeOriginal: `${date} 12:00:00` } });
    const { json } = await api('POST', `/api/upload?name=o${i}.jpg`, undefined, await img.jpeg().toBuffer());
    made.push(json.photo.id);
  }
  const [y22, y23, y24] = made;
  const { json: coll } = await api('POST', '/api/collections', { title: 'Pořadí' });
  await api('POST', '/api/photos/bulk', { ids: made, addCollection: coll.id });
  const { json: s0 } = await api('GET', '/api/state');
  const mode = s0.data.settings.sort;
  const mainIds = st => orderedPhotos(st.data.photos, st.data.settings.order, mode).map(p => p.id);

  // Collection: move the 2022 photo first. The main list stays automatic.
  let r = await api('POST', '/api/order', { list: coll.id, action: 'start', ids: [y22] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.order, [y22, y24, y23]);
  let { json: st } = await api('GET', '/api/state');
  assert.equal(st.data.settings.order, null, 'main list untouched');

  // Main list: drag the 2024 photo to the end.
  r = await api('POST', '/api/order', { list: 'all', action: 'move', ids: [y24], before: null });
  ({ json: st } = await api('GET', '/api/state'));
  assert.equal(mainIds(st).at(-1), y24);
  assert.deepEqual(st.data.collections.find(c => c.id === coll.id).order, [y22, y24, y23], 'collection keeps its own');

  // A newcomer shows up first in both custom lists.
  const { json: fresh } = await api('POST', `/api/upload?name=new.jpg&collection=${coll.id}`, undefined, await makeJpeg({ w: 600, h: 400, color: '#444' }));
  await settle();
  const pub = JSON.parse(await fs.readFile(docs('data.json'), 'utf8'));
  assert.equal(pub.photos[0].id, fresh.photo.id, 'new photo first on the main page');
  assert.equal(pub.photos.at(-1).id, y24, 'main custom order published');
  const pc = pub.collections.find(c => c.slug === coll.slug);
  assert.deepEqual(pc.photos, [fresh.photo.id, y22, y24, y23], 'collection order published as ids');
  assert.equal(pc.preview[0], fresh.photo.id, 'collage starts with the first photo when no cover is set');

  // Leaving the collection prunes it from the stored order; re-adding puts it first again.
  await api('PATCH', `/api/photos/${y23}`, { collections: [] });
  ({ json: st } = await api('GET', '/api/state'));
  assert.ok(!st.data.collections.find(c => c.id === coll.id).order.includes(y23));

  r = await api('POST', '/api/order', { list: coll.id, action: 'move', ids: ['neexistuje'] });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/order', { list: coll.id, action: 'shuffle', ids: [y22] });
  assert.equal(r.status, 400);

  r = await api('POST', '/api/order', { list: 'all', action: 'reset' });
  assert.equal(r.json.order, null);
  await api('POST', '/api/photos/bulk', { ids: [...made, fresh.photo.id], remove: true });
  ({ json: st } = await api('GET', '/api/state'));
  assert.deepEqual(st.data.collections.find(c => c.id === coll.id).order, [], 'deleted photos pruned');
  await api('DELETE', `/api/collections/${coll.id}`);
});

test('collections: always alphabetical (Czech collation, numbers by value), also after a rename', async () => {
  const titles = ['Šumava', 'alpy', 'Česko', 'Cesta 10', 'Cesta 9', 'Hory'];
  const made = [];
  for (const title of titles) made.push((await api('POST', '/api/collections', { title })).json);
  const { json: photo } = await api('POST', '/api/upload?name=abc.jpg', undefined, await makeJpeg({ w: 600, h: 400, color: '#777' }));
  await api('PATCH', `/api/photos/${photo.photo.id}`, { collections: made.map(c => c.id).reverse() });
  const mine = list => list.filter(t => titles.includes(t) || t === 'Zlín');
  let { json: st } = await api('GET', '/api/state');
  assert.deepEqual(mine(st.data.collections.map(c => c.title)), ['alpy', 'Cesta 9', 'Cesta 10', 'Česko', 'Hory', 'Šumava']);

  await api('PATCH', `/api/collections/${made[1].id}`, { title: 'Zlín' });
  ({ json: st } = await api('GET', '/api/state'));
  assert.deepEqual(mine(st.data.collections.map(c => c.title)), ['Cesta 9', 'Cesta 10', 'Česko', 'Hory', 'Šumava', 'Zlín']);
  await settle();
  const pub = JSON.parse(await fs.readFile(docs('data.json'), 'utf8'));
  assert.deepEqual(mine(pub.collections.map(c => c.title)), ['Cesta 9', 'Cesta 10', 'Česko', 'Hory', 'Šumava', 'Zlín'], 'site gets the same order');
  const r = await api('POST', '/api/collections/reorder', { ids: [] });
  assert.equal(r.status, 404, 'manual collection order is gone');

  await api('POST', '/api/photos/bulk', { ids: [photo.photo.id], remove: true });
  for (const c of made) await api('DELETE', `/api/collections/${c.id}`);
});

test('collections: starred ones first (alphabetical among themselves), flag reaches the site', async () => {
  const titles = ['Alpy', 'Brno', 'Výlet 2026', 'Oblíbené', 'Česko'];
  const made = {};
  for (const title of titles) made[title] = (await api('POST', '/api/collections', { title })).json;
  const { json: ph } = await api('POST', '/api/upload?name=star.jpg', undefined, await makeJpeg({ w: 600, h: 400, color: '#999' }));
  await api('PATCH', `/api/photos/${ph.photo.id}`, { collections: Object.values(made).map(c => c.id) });
  const mine = list => list.map(c => c.title).filter(t => titles.includes(t));

  let r = await api('PATCH', `/api/collections/${made['Výlet 2026'].id}`, { starred: true });
  assert.equal(r.json.starred, true);
  await api('PATCH', `/api/collections/${made['Oblíbené'].id}`, { starred: true });
  let { json: st } = await api('GET', '/api/state');
  assert.deepEqual(mine(st.data.collections), ['Oblíbené', 'Výlet 2026', 'Alpy', 'Brno', 'Česko']);

  await settle();
  const pub = JSON.parse(await fs.readFile(docs('data.json'), 'utf8'));
  assert.deepEqual(mine(pub.collections), ['Oblíbené', 'Výlet 2026', 'Alpy', 'Brno', 'Česko']);
  assert.equal(pub.collections.find(c => c.title === 'Oblíbené').starred, true);
  assert.equal(pub.collections.find(c => c.title === 'Alpy').starred, false);

  r = await api('PATCH', `/api/collections/${made['Oblíbené'].id}`, { starred: 'yes' });
  assert.equal(r.json.starred, false, 'only a real true stars');
  ({ json: st } = await api('GET', '/api/state'));
  assert.deepEqual(mine(st.data.collections), ['Výlet 2026', 'Alpy', 'Brno', 'Česko', 'Oblíbené']);

  await api('POST', '/api/photos/bulk', { ids: [ph.photo.id], remove: true });
  for (const c of Object.values(made)) await api('DELETE', `/api/collections/${c.id}`);
});

test('bulk: date taken for many photos (validated, seconds added, clearable)', async () => {
  const ids = [];
  for (const color of ['#123456', '#654321']) {
    const { json } = await api('POST', `/api/upload?name=d${color.slice(1)}.jpg`, undefined, await makeJpeg({ w: 600, h: 400, color }));
    ids.push(json.photo.id);
  }
  let r = await api('POST', '/api/photos/bulk', { ids, set: { takenAt: '2022-05-01T10:30' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.photos.map(p => p.takenAt), ['2022-05-01T10:30:00', '2022-05-01T10:30:00']);
  r = await api('POST', '/api/photos/bulk', { ids, set: { takenAt: '1. 5. 2022' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /RRRR-MM-DD/);
  r = await api('POST', '/api/photos/bulk', { ids: [ids[0]], clear: ['takenAt'] });
  assert.equal(r.json.photos[0].takenAt, '');
  await api('POST', '/api/photos/bulk', { ids, remove: true });
});

test('public site is English and lives under collections/', async () => {
  const { json: c } = await api('POST', '/api/collections', { title: 'Hory' });
  const { json: ph } = await api('POST', `/api/upload?name=en.jpg&collection=${c.id}`, undefined, await makeJpeg({ w: 600, h: 400, color: '#335' }));
  await settle();
  const page = await fs.readFile(docs('collections', c.slug, 'index.html'), 'utf8');
  assert.match(page, /<html lang="en">/);
  assert.match(page, /og:description" content="1 photo"/);
  assert.match(page, /href="\.\.\/\.\.\/collections\/"/, 'tab links to collections/');
  assert.ok(!existsSync(docs('kolekce')), 'old Czech folder is gone');
  assert.match(await fs.readFile(docs('404.html'), 'utf8'), /This page does not exist/);
  const untitled = await fs.readFile(docs('f', ph.photo.id, 'index.html'), 'utf8');
  assert.match(untitled, /<title>Photo · /);
  await api('POST', '/api/photos/bulk', { ids: [ph.photo.id], remove: true });
  await api('DELETE', `/api/collections/${c.id}`);
});

test('analytics: Cloudflare beacon only with a valid token, never on localhost', async () => {
  const token = '0123456789abcdef0123456789ABCDEF';
  const snippet = `<!-- Cloudflare Web Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${token}"}'></script>`;
  let r = await api('PATCH', '/api/settings', { analyticsToken: snippet });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.analyticsToken, token.toLowerCase(), 'token extracted from the pasted snippet');
  await settle();
  let html = await fs.readFile(docs('index.html'), 'utf8');
  assert.ok(html.includes('static.cloudflareinsights.com/beacon.min.js'));
  assert.ok(html.includes(token.toLowerCase()));
  assert.match(html, /localhost\|127\\\.\|\\\[::1\\\]/, 'local preview is excluded');
  assert.ok(html.includes('\\"spa\\":true'), 'navigation between photos counts');

  r = await api('PATCH', '/api/settings', { analyticsToken: 'nesmysl' });
  assert.equal(r.status, 400);
  r = await api('PATCH', '/api/settings', { analyticsToken: '' });
  assert.equal(r.json.analyticsToken, '');
  await settle();
  html = await fs.readFile(docs('index.html'), 'utf8');
  assert.ok(!html.includes('cloudflareinsights'), 'no analytics without a token');
  assert.ok(!html.includes('{{ANALYTICS}}'));
});

test('groups: collections sort by group, starred stay on top, group pages list all their photos', async () => {
  const mk = async (title, group) => (await api('POST', '/api/collections', { title })).json;
  const zr = await mk('Zlatá řeka'), sz = await mk('Sázava'), nt = await mk('Nízké Tatry'), lone = await mk('Alpy');
  await api('PATCH', `/api/collections/${zr.id}`, { group: 'Czech Republic' });
  await api('PATCH', `/api/collections/${sz.id}`, { group: '  Czech   Republic ' });
  await api('PATCH', `/api/collections/${nt.id}`, { group: 'Slovakia' });
  const up = async (color, colls) => {
    const { json } = await api('POST', `/api/upload?name=g${color.slice(1)}.jpg`, undefined, await makeJpeg({ w: 600, h: 400, color }));
    await api('PATCH', `/api/photos/${json.photo.id}`, { collections: colls });
    return json.photo.id;
  };
  const a = await up('#a11', [zr.id]), b = await up('#b22', [sz.id, zr.id]), c = await up('#c33', [nt.id]), d = await up('#d44', [lone.id]);
  const mine = t => ['Zlatá řeka', 'Sázava', 'Nízké Tatry', 'Alpy'].includes(t);

  let { json: st } = await api('GET', '/api/state');
  assert.equal(st.data.collections.find(x => x.id === sz.id).group, 'Czech Republic', 'whitespace normalised');
  assert.deepEqual(st.data.collections.map(x => x.title).filter(mine), ['Sázava', 'Zlatá řeka', 'Nízké Tatry', 'Alpy'], 'by group, ungrouped last');

  // Starred jumps to the top, out of its group; unstarred it falls back into place.
  await api('PATCH', `/api/collections/${nt.id}`, { starred: true });
  ({ json: st } = await api('GET', '/api/state'));
  assert.deepEqual(st.data.collections.map(x => x.title).filter(mine), ['Nízké Tatry', 'Sázava', 'Zlatá řeka', 'Alpy']);

  await settle();
  const pub = JSON.parse(await fs.readFile(docs('data.json'), 'utf8'));
  const cz = pub.groups.find(g => g.slug === 'czech-republic');
  assert.deepEqual(cz.collections, ['sazava', 'zlata-reka']);
  assert.equal(cz.count, 2, 'a photo in two collections of the group counts once');
  assert.deepEqual(new Set(cz.photos), new Set([a, b]));
  assert.deepEqual(pub.groups.find(g => g.slug === 'slovakia').photos, [c], 'starred collection still belongs to its group');
  assert.equal(pub.collections.find(x => x.slug === 'zlata-reka').groupSlug, 'czech-republic');
  const html = await fs.readFile(docs('groups', 'czech-republic', 'index.html'), 'utf8');
  assert.match(html, /<title>Czech Republic · /);
  assert.match(html, /og:description" content="2 photos · 2 collections"/);

  await api('PATCH', `/api/collections/${nt.id}`, { starred: false, group: '' });
  await settle();
  assert.ok(!existsSync(docs('groups', 'slovakia')), 'emptied group page is removed');
  ({ json: st } = await api('GET', '/api/state'));
  assert.deepEqual(st.data.collections.map(x => x.title).filter(mine), ['Sázava', 'Zlatá řeka', 'Alpy', 'Nízké Tatry']);

  await api('POST', '/api/photos/bulk', { ids: [a, b, c, d], remove: true });
  for (const x of [zr, sz, nt, lone]) await api('DELETE', `/api/collections/${x.id}`);
});

test('collections: can be created straight into a group', async () => {
  const { json: c } = await api('POST', '/api/collections', { title: 'Kvilda', group: ' Czech  Republic ' });
  assert.equal(c.group, 'Czech Republic');
  const { json: plain } = await api('POST', '/api/collections', { title: 'Bez' });
  assert.equal(plain.group, '');
  await api('DELETE', `/api/collections/${c.id}`);
  await api('DELETE', `/api/collections/${plain.id}`);
});

test('redirects: renamed group and changed collection address keep old links working', async () => {
  const { json: a } = await api('POST', '/api/collections', { title: 'Zlatá řeka', group: 'Czech Rep' });
  const { json: b } = await api('POST', '/api/collections', { title: 'Sázava', group: 'Czech Rep' });
  const { json: ph } = await api('POST', `/api/upload?name=rd.jpg&collection=${a.id}`, undefined, await makeJpeg({ w: 600, h: 400, color: '#468' }));
  await api('PATCH', `/api/photos/${ph.photo.id}`, { collections: [a.id, b.id] });

  // Rename the group (a typo fix): every member moves, the old page redirects.
  let r = await api('POST', '/api/groups/rename', { from: 'Czech Rep', to: 'Czech Republic' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { group: 'Czech Republic', collections: 2 });
  let { json: st } = await api('GET', '/api/state');
  assert.deepEqual(st.data.collections.filter(c => [a.id, b.id].includes(c.id)).map(c => c.group), ['Czech Republic', 'Czech Republic']);
  await settle();
  let old = await fs.readFile(docs('groups', 'czech-rep', 'index.html'), 'utf8');
  assert.match(old, /http-equiv="refresh" content="0; url=\.\.\/\.\.\/groups\/czech-republic\/"/);
  assert.match(old, /location\.replace\("\.\.\/\.\.\/groups\/czech-republic\/"/);
  assert.match(old, /og:title" content="Czech Republic · /, 'link preview of the target');
  assert.ok(existsSync(docs('groups', 'czech-republic', 'index.html')));

  // Renaming again: no chain, the first old address goes straight to the newest one.
  await api('POST', '/api/groups/rename', { from: 'Czech Republic', to: 'Czechia' });
  await settle();
  old = await fs.readFile(docs('groups', 'czech-rep', 'index.html'), 'utf8');
  assert.match(old, /url=\.\.\/\.\.\/groups\/czechia\//);
  assert.match(await fs.readFile(docs('groups', 'czech-republic', 'index.html'), 'utf8'), /url=\.\.\/\.\.\/groups\/czechia\//);

  // Collection address change redirects too; a title rename alone does not change the address.
  await api('PATCH', `/api/collections/${a.id}`, { title: 'Zlatá řeka (Sázava)' });
  ({ json: st } = await api('GET', '/api/state'));
  assert.equal(st.data.collections.find(c => c.id === a.id).slug, 'zlata-reka');
  await api('PATCH', `/api/collections/${a.id}`, { slug: 'zlata-reka-sazava' });
  await settle();
  assert.match(await fs.readFile(docs('collections', 'zlata-reka', 'index.html'), 'utf8'), /url=\.\.\/\.\.\/collections\/zlata-reka-sazava\//);

  // A new collection taking the old address makes it a real page again.
  const { json: again } = await api('POST', '/api/collections', { title: 'Zlatá řeka' });
  await api('PATCH', `/api/photos/${ph.photo.id}`, { collections: [a.id, b.id, again.id] });
  await settle();
  assert.equal(again.slug, 'zlata-reka');
  assert.doesNotMatch(await fs.readFile(docs('collections', 'zlata-reka', 'index.html'), 'utf8'), /http-equiv="refresh"/);

  r = await api('POST', '/api/groups/rename', { from: 'Neexistuje', to: 'X' });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/groups/rename', { from: 'Czechia', to: '  ' });
  assert.equal(r.status, 400);

  await api('POST', '/api/photos/bulk', { ids: [ph.photo.id], remove: true });
  for (const c of [a, b, again]) await api('DELETE', `/api/collections/${c.id}`);
  await settle();
  assert.ok(!existsSync(docs('groups', 'czech-rep')), 'redirect disappears when its target is gone');
});

test('contact e-mail: stored split, never whole in any file, joined only in the browser', async () => {
  let r = await api('PATCH', '/api/settings', { contactEmail: 'Foto@MartinPosta.com' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.contact, { user: 'Foto', domain: 'martinposta.com' });
  assert.equal(r.json.contactEmail, undefined, 'the whole address is not stored');
  await settle();
  const pub = JSON.parse(await fs.readFile(docs('data.json'), 'utf8'));
  assert.deepEqual(pub.settings.contact, { u: 'Foto', d: 'martinposta.com' });

  // Every generated and stored file: no "user@domain" anywhere (any case).
  const files = [path.join(dataRoot, 'data', 'gallery.json')];
  const walk = async dir => { for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) await walk(f); else if (/\.(html|json|js|css|txt)$/.test(e.name)) files.push(f);
  } };
  await walk(docs());
  for (const f of files) assert.doesNotMatch(await fs.readFile(f, 'utf8'), /foto@martinposta\.com/i, f);

  r = await api('PATCH', '/api/settings', { contactEmail: 'foto(at)martinposta' });
  assert.equal(r.status, 400);
  r = await api('PATCH', '/api/settings', { contactEmail: '' });
  assert.equal(r.json.contact, null);
});
