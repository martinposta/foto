// Local admin server — runs only on your computer (127.0.0.1), never on GitHub.
// Start with:  npm run admin   → opens http://localhost:4321
//
//   /              admin UI (admin/public)
//   /preview/      the generated public site (docs/), exactly as it will look online
//   /api/*         JSON API used by the admin UI

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ADMIN, IMAGE, PATHS, DATA_ROOT } from '../lib/config.mjs';
import { loadData, reloadData } from '../lib/store.mjs';
import { buildSite } from '../lib/build.mjs';
import * as G from '../lib/gallery.mjs';
import { configureGit, gitStatus, gitBusy, fetchRemote, syncPull, startupSync, publish } from './git.mjs';

const MAX_UPLOAD = 120 * 1024 * 1024;
const ORIGINS = new Set([`http://localhost:${ADMIN.port}`, `http://127.0.0.1:${ADMIN.port}`]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.avif': 'image/avif', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

// ---------- build scheduling ----------

let buildTimer = null;
let buildPromise = Promise.resolve();
function scheduleBuild() {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(() => { buildPromise = buildPromise.then(buildSite).catch(err => console.error('Build failed:', err)); }, 300);
}
async function buildNow() {
  clearTimeout(buildTimer);
  buildPromise = buildPromise.then(buildSite);
  return buildPromise;
}

// ---------- http helpers ----------

function send(res, code, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req, limit = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new G.UserError('Soubor je příliš velký')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, 5 * 1024 * 1024);
  return buf.length ? JSON.parse(buf.toString('utf8')) : {};
}

async function serveStatic(res, baseDir, relPath) {
  let file = path.normalize(path.join(baseDir, decodeURIComponent(relPath)));
  if (!file.startsWith(baseDir)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const st = await fsp.stat(file);
    if (st.isDirectory()) file = path.join(file, 'index.html');
    await fsp.access(file);
  } catch {
    const nf = path.join(baseDir, '404.html');
    if (fs.existsSync(nf)) { res.writeHead(404, { 'Content-Type': MIME['.html'] }); return fs.createReadStream(nf).pipe(res); }
    return send(res, 404, 'Not found', 'text/plain');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ---------- routes ----------

async function api(req, res, url) {
  const m = req.method;
  const p = url.pathname;
  let r;

  if (m === 'GET' && p === '/api/state') {
    await buildPromise;
    return send(res, 200, { data: await loadData(), git: await gitStatus(), image: { format: IMAGE.format, accepted: IMAGE.acceptedExt } });
  }
  if (m === 'GET' && p === '/api/git') {
    await buildPromise;
    return send(res, 200, await gitStatus());
  }
  // Sync with GitHub (D25). check = fetch only; sync = fast-forward when nothing is unpublished.
  if (m === 'POST' && p === '/api/sync/check') {
    if (!gitBusy()) await fetchRemote();
    return send(res, 200, await gitStatus());
  }
  if (m === 'POST' && p === '/api/sync') return send(res, 200, await syncPull());
  if (m === 'POST' && p === '/api/publish') return send(res, 200, await publish((await readJson(req)).message));
  // While git rewrites the data files (pull, rebase), an edit would be written into the middle of
  // it and lost or mixed in. The UI waits; a stray request gets a readable refusal.
  if (m !== 'GET' && gitBusy()) return send(res, 409, { error: 'Právě probíhá synchronizace s GitHubem, zkus to za chvíli.' });
  const uploadName = () => {
    const name = url.searchParams.get('name') || 'foto.jpg';
    if (!IMAGE.acceptedExt.includes(path.extname(name).toLowerCase())) {
      throw new G.UserError(`Nepodporovaný formát (${path.extname(name) || '?'}). Podporované: ${IMAGE.acceptedExt.join(', ')}`);
    }
    return name;
  };

  if (m === 'POST' && p === '/api/upload') {
    const name = uploadName();
    r = await G.addPhoto(await readBody(req), name, url.searchParams.get('collection') || '');
  }
  else if (m === 'POST' && p === '/api/photos/rewrite-author') r = await G.rewriteAuthorInFiles();
  else if (m === 'POST' && p === '/api/order') r = await G.reorderPhotos(await readJson(req));
  else if (m === 'POST' && p === '/api/drafts/publish') r = await G.publishDrafts(await readJson(req));
  else if (m === 'POST' && p === '/api/photos/unpublish') r = await G.unpublishPhotos(await readJson(req));
  else if (m === 'POST' && p === '/api/groups/rename') r = await G.renameGroup(await readJson(req));
  else if (m === 'POST' && (r = p.match(/^\/api\/photos\/([\w-]+)\/replace$/))) {
    const id = r[1], name = uploadName();
    r = await G.replacePhoto(id, await readBody(req), name);
  }
  else if (m === 'PATCH' && (r = p.match(/^\/api\/photos\/([\w-]+)$/))) r = await G.updatePhoto(r[1], await readJson(req));
  else if (m === 'POST' && p === '/api/photos/bulk') r = await G.bulkPhotos(await readJson(req));
  else if (m === 'POST' && p === '/api/collections') r = await G.createCollection(await readJson(req));
  else if (m === 'PATCH' && (r = p.match(/^\/api\/collections\/([\w-]+)$/))) r = await G.updateCollection(r[1], await readJson(req));
  else if (m === 'DELETE' && (r = p.match(/^\/api\/collections\/([\w-]+)$/))) r = await G.deleteCollection(r[1]);
  else if (m === 'PATCH' && p === '/api/settings') r = await G.updateSettings(await readJson(req));
  else if (m === 'POST' && p === '/api/avatar') r = await G.setAvatar(await readBody(req));
  else return send(res, 404, { error: 'Neznámý požadavek' });

  scheduleBuild();
  return send(res, 200, r);
}

const server = http.createServer(async (req, res) => {
  try {
    // Only accept requests addressed to this local server (blocks DNS-rebinding and cross-site posts).
    const host = req.headers.host || '';
    if (!ORIGINS.has(`http://${host}`)) return send(res, 403, 'Forbidden host', 'text/plain');
    if (req.method !== 'GET' && req.headers.origin && !ORIGINS.has(req.headers.origin)) return send(res, 403, { error: 'Forbidden origin' });

    const url = new URL(req.url, `http://${host}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/preview') { res.writeHead(302, { Location: '/preview/' }); return res.end(); }
    if (url.pathname.startsWith('/preview/')) return await serveStatic(res, PATHS.docs, url.pathname.slice('/preview/'.length));
    // Drafts' images for the admin's thumbnails; they are not in docs/, so /preview/ cannot serve them.
    if (url.pathname.startsWith('/drafts-img/')) return await serveStatic(res, PATHS.draftImg, url.pathname.slice('/drafts-img/'.length));
    return await serveStatic(res, PATHS.adminPublic, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  } catch (err) {
    const user = err instanceof G.UserError;
    if (!user) console.error(err);
    send(res, user ? 400 : 500, { error: user ? err.message : `Chyba serveru: ${err.message}` });
  }
});

configureGit({ buildNow, reload: reloadData });
// Catch up with GitHub before anything is loaded (D25): another instance may have published.
const started = await startupSync();
if (started.pulled) console.log(`\n  Staženo z GitHubu: ${started.pulled} ${started.pulled === 1 ? 'změna' : 'změn'}.`);
else if (started.behind) console.log(`\n  Na GitHubu jsou novější změny (${started.behind}), ale máš nepublikované úpravy. Publikuj, spojí se.`);
await loadData();
await buildSite();

server.listen(ADMIN.port, ADMIN.host, () => {
  const link = `http://localhost:${ADMIN.port}`;
  console.log(`\n  Galerie admin běží na ${link}`);
  console.log(`  Náhled webu:          ${link}/preview/`);
  console.log(`  Ukončení:             Ctrl+C\n`);
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', link]]
      : process.platform === 'darwin' ? ['open', [link]] : ['xdg-open', [link]];
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`\n  Port ${ADMIN.port} je obsazený — admin už možná běží. Otevři http://localhost:${ADMIN.port}\n`);
  else console.error(err);
  process.exit(1);
});
