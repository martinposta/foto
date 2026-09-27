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
import { loadData } from '../lib/store.mjs';
import { buildSite } from '../lib/build.mjs';
import * as G from '../lib/gallery.mjs';

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

// ---------- git ----------

function git(args, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    // Do not set GIT_TERMINAL_PROMPT=0: Git Credential Manager treats it as "no interaction"
    // and would suppress the GitHub sign-in window on the first push.
    const p = spawn('git', args, { cwd: DATA_ROOT, windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', e => (allowFail ? resolve({ code: -1, out, err: e.message }) : reject(new G.UserError(
      'Git není nainstalovaný nebo není v PATH. Na Macu spusť v Terminálu „xcode-select --install“, na Windows nainstaluj Git for Windows (git-scm.com). Pak spusť admin znovu.'))));
    p.on('close', code => {
      if (code !== 0 && !allowFail) reject(new G.UserError(`git ${args.join(' ')} selhal:\n${(err || out).trim()}`));
      else resolve({ code, out: out.trim(), err: err.trim() });
    });
  });
}

// GitHub recommends repositories under 1 GB (the Pages site limit is 1 GB too). History counts:
// deleted or replaced photos stay in it, so the size is measured from git, not from docs/.
const REPO_LIMIT = 1024 ** 3;

async function repoSize(porcelain) {
  const r = await git(['count-objects', '-v'], { allowFail: true });
  const kib = key => Number(r.out.match(new RegExp(`^${key}: (\\d+)`, 'm'))?.[1] || 0);
  const stored = (kib('size') + kib('size-pack')) * 1024;
  // Uploads not committed yet: the next publish adds them (WebP/JPEG barely compress further).
  let pending = 0;
  for (const line of porcelain ? porcelain.split('\n') : []) {
    const file = line.slice(3);
    if (!file.startsWith('docs/img/') || line.startsWith(' D') || line.startsWith('D ')) continue;
    try { pending += (await fsp.stat(path.join(DATA_ROOT, file))).size; } catch { /* vanished meanwhile */ }
  }
  return { stored, pending, limit: REPO_LIMIT };
}

async function gitStatus() {
  const repo = await git(['rev-parse', '--is-inside-work-tree'], { allowFail: true });
  if (repo.code !== 0 || repo.out !== 'true') return { repo: false, changes: 0, error: repo.code === -1 ? repo.err : '' };
  const [st, remote, upstream] = await Promise.all([
    git(['status', '--porcelain=v1', '--untracked-files=all'], { allowFail: true }),
    git(['remote', 'get-url', 'origin'], { allowFail: true }),
    git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { allowFail: true }),
  ]);
  let ahead = 0;
  if (upstream.code === 0) {
    const a = await git(['rev-list', '--count', '@{u}..HEAD'], { allowFail: true });
    ahead = Number(a.out) || 0;
  }
  return {
    repo: true,
    size: await repoSize(st.out),
    changes: st.out ? st.out.split('\n').filter(l => !isPrivate(l.slice(3))).length : 0,
    remote: remote.code === 0 ? remote.out : '',
    upstream: upstream.code === 0 ? upstream.out : '',
    ahead,
  };
}

// Drafts must never reach git (D24). .gitignore keeps them out of `git add -A`, but publishing
// does not rely on it alone: whatever of them got staged anyway is unstaged again, and a last
// check stops the publish before a commit exists if one is still there. (The tests run in a repo
// without the project's .gitignore, which is how the gap showed.) Do NOT name these paths in the
// `git add` pathspec, not even as `:(exclude)`: with .gitignore present git then refuses the whole
// add ("paths are ignored by one of your .gitignore files") — that broke real publishing once.
const PRIVATE_PATHS = ['drafts', 'data/drafts.json'];
const isPrivate = f => PRIVATE_PATHS.some(p => f === p || f.startsWith(p + '/'));

async function publish(message) {
  await buildNow();
  const log = [];
  const run = async args => { const r = await git(args); log.push(`$ git ${args.join(' ')}`, r.out, r.err); return r; };
  const status = await gitStatus();
  if (!status.repo) throw new G.UserError('Složka není git repozitář. Postup je v README (fáze 2).');
  if (!status.remote) throw new G.UserError('Repozitář nemá nastavený remote "origin". Postup je v README (fáze 2).');

  await run(['add', '-A']);
  await git(['rm', '-r', '--cached', '--ignore-unmatch', '--quiet', '--', ...PRIVATE_PATHS], { allowFail: true });
  const leaked = (await git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])).out.split('\n').filter(isPrivate);
  if (leaked.length) {
    await git(['reset', '--quiet'], { allowFail: true });
    throw new G.UserError(`Publikování zastaveno: do commitu by se dostal koncept (${leaked.slice(0, 3).join(', ')}). Nic se neodeslalo.`);
  }
  const staged = await git(['diff', '--cached', '--quiet'], { allowFail: true });
  if (staged.code === 1) {
    const stamp = new Date().toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' });
    try {
      await run(['commit', '-m', message?.trim() || `Aktualizace galerie ${stamp}`]);
    } catch (e) {
      if (/user\.email|Please tell me who you are/i.test(e.message)) {
        throw new G.UserError('Git nezná tvé jméno a e-mail. Spusť jednou v PowerShellu:\n  git config --global user.name "Tvoje Jméno"\n  git config --global user.email "tvuj@email.cz"');
      }
      throw e;
    }
  } else {
    log.push('Žádné nové změny k uložení, jen odesílám.');
  }
  if (status.upstream) await run(['push']);
  else await run(['push', '-u', 'origin', 'HEAD']);
  return { log: log.filter(Boolean).join('\n'), status: await gitStatus() };
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
  else if (m === 'POST' && p === '/api/publish') return send(res, 200, await publish((await readJson(req)).message));
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
