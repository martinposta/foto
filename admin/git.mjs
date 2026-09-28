// Git for the admin: status, publishing and keeping this copy in step with GitHub (D25).
//
// GitHub is the central copy. Every admin instance (Mac, later Proxmox) syncs with it:
//   - on start: fetch, and fast-forward when this copy has nothing unpublished;
//   - on demand / every few minutes from the UI: fetch and report "behind by N";
//   - when publishing: commit, fetch, rebase onto GitHub, push. Never a force-push.
// Conflicts in generated docs/ are settled by rebuilding the site from the merged data (Q15);
// a conflict in data/ (or code) aborts the rebase, nothing is sent, the local commit stays.
// Drafts are outside git (D24) and therefore never synced: every instance has its own.

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_ROOT } from '../lib/config.mjs';
import { UserError } from '../lib/gallery.mjs';
import { mergeGallery } from '../lib/merge.mjs';

let hooks = { buildNow: async () => {}, reload: async () => {} };
/** buildNow: regenerate docs/ now; reload: re-read data files into memory after git changed them. */
export function configureGit(h) { hooks = { ...hooks, ...h }; }

export function git(args, { allowFail = false, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    // Do not set GIT_TERMINAL_PROMPT=0: Git Credential Manager treats it as "no interaction"
    // and would suppress the GitHub sign-in window on the first push. GIT_EDITOR=true lets
    // `rebase --continue` finish without opening an editor.
    const p = spawn('git', args, { cwd: DATA_ROOT, windowsHide: true, env: { ...process.env, GIT_EDITOR: 'true' } });
    let out = '', err = '', timer;
    if (timeout) timer = setTimeout(() => { err += `\n(přerušeno po ${timeout / 1000} s)`; p.kill(); }, timeout);
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', e => (allowFail ? resolve({ code: -1, out, err: e.message }) : reject(new UserError(
      'Git není nainstalovaný nebo není v PATH. Na Macu spusť v Terminálu „xcode-select --install“, na Windows nainstaluj Git for Windows (git-scm.com). Pak spusť admin znovu.'))));
    p.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 && !allowFail) reject(new UserError(`git ${args.join(' ')} selhal:\n${(err || out).trim()}`));
      else resolve({ code, out: out.trim(), err: err.trim() });
    });
  });
}

// ---------- status ----------

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

// Drafts must never reach git (D24). .gitignore keeps them out of `git add -A`, but publishing
// does not rely on it alone: whatever of them got staged anyway is unstaged again, and a last
// check stops the publish before a commit exists if one is still there. (The tests run in a repo
// without the project's .gitignore, which is how the gap showed.) Do NOT name these paths in the
// `git add` pathspec, not even as `:(exclude)`: with .gitignore present git then refuses the whole
// add ("paths are ignored by one of your .gitignore files") — that broke real publishing once.
const PRIVATE_PATHS = ['drafts', 'data/drafts.json'];
export const isPrivate = f => PRIVATE_PATHS.some(p => f === p || f.startsWith(p + '/'));

// What the last contact with GitHub said; the UI shows it next to the publish state.
const sync = { fetchedAt: null, fetchError: '', restartNeeded: false };

export async function gitStatus() {
  const repo = await git(['rev-parse', '--is-inside-work-tree'], { allowFail: true });
  if (repo.code !== 0 || repo.out !== 'true') return { repo: false, changes: 0, error: repo.code === -1 ? repo.err : '' };
  const [st, remote, upstream] = await Promise.all([
    git(['status', '--porcelain=v1', '--untracked-files=all'], { allowFail: true }),
    git(['remote', 'get-url', 'origin'], { allowFail: true }),
    git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { allowFail: true }),
  ]);
  let ahead = 0, behind = 0;
  if (upstream.code === 0) {
    const c = await git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], { allowFail: true });
    [ahead, behind] = c.out.split(/\s+/).map(Number).map(n => n || 0);
  }
  return {
    repo: true,
    size: await repoSize(st.out),
    changes: st.out ? st.out.split('\n').filter(l => !isPrivate(l.slice(3))).length : 0,
    remote: remote.code === 0 ? remote.out : '',
    upstream: upstream.code === 0 ? upstream.out : '',
    ahead,
    behind, // commits on GitHub this copy does not have yet (as of the last fetch)
    ...sync,
  };
}

// ---------- one git operation at a time ----------

let busy = null;
export const gitBusy = () => !!busy;

async function exclusive(fn) {
  if (busy) throw new UserError('Právě probíhá synchronizace nebo publikování, zkus to za chvíli.');
  busy = fn();
  try { return await busy; } finally { busy = null; }
}

// ---------- fetching and pulling ----------

/** Ask GitHub what is new. Offline or without a remote this only records the error. */
export async function fetchRemote() {
  const remote = await git(['remote', 'get-url', 'origin'], { allowFail: true });
  if (remote.code !== 0) return false;
  const r = await git(['fetch', '--quiet', 'origin'], { allowFail: true, timeout: 30000 });
  sync.fetchedAt = new Date().toISOString();
  sync.fetchError = r.code === 0 ? '' : (r.err || 'GitHub není dostupný').split('\n')[0];
  return r.code === 0;
}

// Code (not content) arriving from GitHub needs a restart of the admin to take effect (7b adds a
// button for it). site/ is read on every build, so a rebuild is enough for it.
const needsRestart = files => files.some(f => /^(admin\/|lib\/|package(-lock)?\.json$)/.test(f));

async function incomingFiles(fromRef, toRef) {
  const r = await git(['diff', '--name-only', fromRef, toRef], { allowFail: true });
  return r.out ? r.out.split('\n') : [];
}

async function fastForward() {
  const files = await incomingFiles('HEAD', '@{u}');
  await git(['merge', '--ff-only', '--quiet', '@{u}']);
  if (needsRestart(files)) sync.restartNeeded = true;
  await hooks.reload();
  await hooks.buildNow();
}

/**
 * Bring this copy up to GitHub. Only when it has nothing unpublished: then it is a plain
 * fast-forward. With local changes it refuses and says to publish, which merges both sides.
 */
export function syncPull() {
  return exclusive(async () => {
    await hooks.buildNow(); // a build scheduled by the last edit must not run in the middle of the merge
    await fetchRemote();
    if (sync.fetchError) throw new UserError(`GitHub teď není dostupný: ${sync.fetchError}`);
    const st = await gitStatus();
    if (!st.upstream || !st.behind) return { pulled: 0, status: st };
    if (st.changes || st.ahead) {
      throw new UserError(`Na GitHubu je ${st.behind === 1 ? '1 novější změna' : `${st.behind} novějších změn`} a ty máš nepublikované úpravy. `
        + 'Klikni na Publikovat: nejdřív stáhne změny z GitHubu, spojí je s tvými a teprve pak odešle.');
    }
    await fastForward();
    return { pulled: st.behind, status: await gitStatus() };
  });
}

/** On admin start: fetch and fast-forward when safe. Never throws, the admin must start offline too. */
export async function startupSync() {
  try {
    if (!(await fetchRemote())) return { pulled: 0 };
    const st = await gitStatus();
    if (!st.upstream || !st.behind || st.changes || st.ahead) return { pulled: 0, behind: st.behind || 0 };
    const files = await incomingFiles('HEAD', '@{u}');
    await git(['merge', '--ff-only', '--quiet', '@{u}']);
    if (needsRestart(files)) sync.restartNeeded = true; // this process already loaded the old code
    return { pulled: st.behind };
  } catch (e) {
    return { pulled: 0, error: e.message };
  }
}

// ---------- publishing ----------

async function stageAndCommit(message, run) {
  await run(['add', '-A']);
  await git(['rm', '-r', '--cached', '--ignore-unmatch', '--quiet', '--', ...PRIVATE_PATHS], { allowFail: true });
  const leaked = (await git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])).out.split('\n').filter(isPrivate);
  if (leaked.length) {
    await git(['reset', '--quiet'], { allowFail: true });
    throw new UserError(`Publikování zastaveno: do commitu by se dostal koncept (${leaked.slice(0, 3).join(', ')}). Nic se neodeslalo.`);
  }
  const staged = await git(['diff', '--cached', '--quiet'], { allowFail: true });
  if (staged.code !== 1) return false;
  try {
    await run(['commit', '-m', message]);
  } catch (e) {
    if (/user\.email|Please tell me who you are/i.test(e.message)) {
      throw new UserError('Git nezná tvé jméno a e-mail. Ve složce galerie spusť jednou:\n  git config user.name "Martin Porter"\n  git config user.email "<noreply adresa z GitHubu>"');
    }
    throw e;
  }
  return true;
}

const GALLERY = 'data/gallery.json';

// git's line merge sees two edits of neighbouring fields of one photo as a conflict. Merge the
// file by meaning instead (lib/merge.mjs): only the same field changed differently on both sides
// is a real conflict. Stage 1 = common ancestor, 2 = GitHub ("ours" during a rebase), 3 = local.
async function resolveGalleryConflict() {
  const stage = async n => { const r = await git(['show', `:${n}:${GALLERY}`], { allowFail: true }); return r.code === 0 ? JSON.parse(r.out) : null; };
  const [base, ours, theirs] = [await stage(1), await stage(2), await stage(3)];
  if (!ours || !theirs) return ['data/gallery.json je na jedné straně smazaný'];
  const { merged, conflicts } = mergeGallery(base || {}, ours, theirs);
  if (conflicts.length) return conflicts;
  await fsp.writeFile(path.join(DATA_ROOT, GALLERY), JSON.stringify(merged, null, 2) + '\n', 'utf8');
  await git(['add', '--', GALLERY]);
  return [];
}

// Replay this copy's commits on top of GitHub's. data/gallery.json conflicts are merged by
// meaning; generated docs/ conflicts are taken from GitHub's side for the moment (the site is
// rebuilt from the merged data right after, Q15); anything else, or a real data conflict, aborts
// the rebase with the local commits untouched.
async function rebaseOntoUpstream(run) {
  let r = await git(['rebase', '@{u}'], { allowFail: true });
  for (let guard = 0; r.code !== 0 && guard < 50; guard++) {
    const conflicted = (await git(['diff', '--name-only', '--diff-filter=U'], { allowFail: true })).out.split('\n').filter(Boolean);
    const other = conflicted.filter(f => !f.startsWith('docs/') && f !== GALLERY);
    const dataConflicts = conflicted.includes(GALLERY) && !other.length ? await resolveGalleryConflict() : [];
    if (!conflicted.length || other.length || dataConflicts.length) {
      await git(['rebase', '--abort'], { allowFail: true });
      if (!conflicted.length) throw new UserError(`Spojení se změnami z GitHubu selhalo:\n${r.err || r.out}`);
      const what = dataConflicts.length ? dataConflicts.slice(0, 5).join('; ') : other.slice(0, 3).join(', ');
      throw new UserError(`Na GitHubu se mezitím změnilo totéž co u tebe (${what}). `
        + 'Nic se neodeslalo a tvoje změny zůstaly jen tady (uložené v lokálním commitu). '
        + 'Typicky to znamená, že stejnou fotku nebo kolekci upravily dvě kopie adminu. Vyřešíme to v Claude Code.');
    }
    if (conflicted.includes(GALLERY)) run.log.push('Data spojena po jednotlivých polích (každá strana měnila něco jiného).');
    for (const f of conflicted.filter(x => x.startsWith('docs/'))) {
      const took = await git(['checkout', '--ours', '--', f], { allowFail: true }); // "ours" = GitHub during a rebase
      if (took.code === 0) await git(['add', '--', f]);
      else await git(['rm', '--quiet', '--', f], { allowFail: true }); // deleted on one side
    }
    run.log.push(`Konflikt ve vygenerovaném webu (${conflicted.length} souborů), web se přestaví z výsledných dat.`);
    r = await git(['rebase', '--continue'], { allowFail: true });
  }
  if (r.code !== 0) { await git(['rebase', '--abort'], { allowFail: true }); throw new UserError('Spojení se změnami z GitHubu se nepodařilo dokončit. Nic se neodeslalo.'); }
}

export function publish(message) {
  return exclusive(async () => {
    await hooks.buildNow();
    const log = [];
    const run = async args => { const r = await git(args); log.push(`$ git ${args.join(' ')}`, r.out, r.err); return r; };
    run.log = log;
    const status = await gitStatus();
    if (!status.repo) throw new UserError('Složka není git repozitář. Postup je v README (fáze 2).');
    if (!status.remote) throw new UserError('Repozitář nemá nastavený remote "origin". Postup je v README (fáze 2).');

    const stamp = new Date().toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' });
    if (!(await stageAndCommit(message?.trim() || `Aktualizace galerie ${stamp}`, run))) log.push('Žádné nové změny k uložení.');

    // Someone (another admin instance) may have published in the meantime: take that first.
    if (status.upstream && (await fetchRemote())) {
      const st = await gitStatus();
      if (st.behind) {
        const files = await incomingFiles('HEAD', '@{u}');
        log.push(`Na GitHubu ${st.behind === 1 ? 'je 1 novější změna' : `je ${st.behind} novějších změn`}, spojuji je s tvými.`);
        await rebaseOntoUpstream(run);
        if (needsRestart(files)) sync.restartNeeded = true;
        await hooks.reload();
        await hooks.buildNow();
        if (await stageAndCommit(`Přestavění webu po spojení se změnami z GitHubu`, run)) log.push('Web přestavěn z výsledných dat.');
      }
    }

    const st = await gitStatus();
    if (st.upstream && !st.ahead) { log.push('Na GitHubu už všechno je, není co odeslat.'); return { log: log.filter(Boolean).join('\n'), status: st }; }
    try {
      if (status.upstream) await run(['push']);
      else await run(['push', '-u', 'origin', 'HEAD']);
    } catch (e) {
      if (/rejected|fetch first|non-fast-forward/i.test(e.message)) {
        throw new UserError('GitHub mezitím dostal další změny (třeba z jiné kopie adminu). Klikni na Publikovat ještě jednou, stáhne je a spojí s tvými.');
      }
      throw e;
    }
    return { log: log.filter(Boolean).join('\n'), status: await gitStatus() };
  });
}
