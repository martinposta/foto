// Local admin UI. Talks to admin/server.mjs over /api/*. No dependencies.

(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n > 1 && n < 5 ? few : many}`;
  const photosLabel = n => plural(n, 'fotka', 'fotky', 'fotek');

  const S = {
    data: null,
    git: null,
    image: { format: 'webp', accepted: [] },
    filter: 'all',          // 'all' | 'none' | 'settings' | <collectionId>
    panel: 'auto',          // 'auto' | 'collection' | 'settings'
    selected: new Set(),
    lastIndex: -1,
  };

  // ---------- api ----------

  async function api(method, path, body, raw) {
    const opts = { method, headers: {} };
    if (raw) opts.body = raw;
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), isErr ? 6000 : 2400);
  }
  const fail = e => { console.error(e); toast(e.message, true); };

  let savingCount = 0;
  function saving(on) {
    savingCount += on ? 1 : -1;
    $('save-state').textContent = savingCount > 0 ? 'Ukládám…' : 'Uloženo';
    if (savingCount <= 0) { clearTimeout(saving.t); saving.t = setTimeout(() => ($('save-state').textContent = ''), 1800); }
  }

  let gitTimer;
  function refreshGitSoon(delay = 900) {
    clearTimeout(gitTimer);
    gitTimer = setTimeout(async () => { try { S.git = await api('GET', '/api/git'); renderGit(); } catch (e) { console.warn(e); } }, delay);
  }

  // ---------- helpers ----------

  const photos = () => S.data.photos;
  const collById = id => S.data.collections.find(c => c.id === id);
  // Same order as the server keeps (lib/store.mjs byTitle): alphabetical, Czech collation.
  const cs = (a, b) => a.localeCompare(b, 'cs', { sensitivity: 'base', numeric: true });
  const sortCollections = () => S.data.collections.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0)
    || (a.starred ? 0 : (a.group ? 0 : 1) - (b.group ? 0 : 1) || cs(a.group || '', b.group || ''))
    || cs(a.title, b.title)); // mirror of store.mjs collectionOrder
  const groupNames = () => [...new Set(S.data.collections.map(c => c.group).filter(Boolean))].sort(cs);
  const photoById = id => S.data.photos.find(p => p.id === id);
  const thumbUrl = (p, w = 480) => `/${p.draft ? 'drafts-img' : 'preview/img'}/${p.id}/${p.widths.find(x => x >= w) || p.widths[p.widths.length - 1]}.${p.format}?v=${p.version || 1}`;

  // Mirror of lib/order.mjs orderedPhotos(): automatic until a list has a stored order; photos
  // missing from a stored order (new uploads, newly added to the collection) come first.
  function orderedPhotos(list, stored) {
    const mode = S.data.settings.sort;
    const key = p => (mode === 'added' ? p.addedAt : (p.takenAt || p.addedAt)) || '';
    const auto = [...list].sort((a, b) => key(b).localeCompare(key(a)));
    if (!Array.isArray(stored)) return auto;
    const byId = new Map(list.map(p => [p.id, p]));
    const listed = new Set(stored);
    return [...auto.filter(p => !listed.has(p.id)), ...stored.filter(id => byId.has(id)).map(id => byId.get(id))];
  }

  // Published photos in their order; drafts (D24) have no place in an order until published.
  function sortedPhotos() {
    return orderedPhotos(photos().filter(p => !p.draft), S.data.settings.order);
  }
  const drafts = () => photos().filter(p => p.draft).sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  const draftCount = () => photos().filter(p => p.draft).length;

  // Every view shows its drafts first (newest upload first, Q14), then the published photos.
  function visiblePhotos() {
    if (S.filter === 'drafts') return drafts();
    if (S.filter === 'all' || S.filter === 'settings') return [...drafts(), ...sortedPhotos()];
    if (S.filter === 'none') return [...drafts(), ...sortedPhotos()].filter(p => !p.collections.length);
    const c = collById(S.filter);
    if (!c) return [];
    const inC = p => p.collections.includes(c.id);
    return [...drafts().filter(inC), ...orderedPhotos(photos().filter(p => !p.draft && inC(p)), c.order)];
  }

  // The list whose order the current view shows: 'all', a collection id, or null ("Bez kolekce"
  // is just a filter and has no order of its own).
  function orderList() {
    if (S.filter === 'drafts') return null;
    if (S.filter === 'all' || S.filter === 'settings') return 'all';
    return collById(S.filter) ? S.filter : null;
  }
  const storedOrder = list => (list === 'all' ? S.data.settings.order : collById(list)?.order);

  async function changeOrder(action, ids = [], before = null) {
    const list = orderList();
    if (!list) return;
    saving(true);
    try {
      const r = await api('POST', '/api/order', { list, action, ids, before });
      if (list === 'all') S.data.settings.order = r.order; else collById(list).order = r.order;
      renderMain();
      if (action !== 'move') toast(action === 'reset' ? 'Řazení vráceno podle data' : 'Pořadí upraveno');
      refreshGitSoon();
    } catch (e) { fail(e); }
    finally { saving(false); }
  }

  // Order buttons shared by the single-photo editor and the multi-select panel.
  function orderControls(n) {
    if (!orderList()) return '';
    const where = orderList() === 'all' ? 've Všech fotkách' : `v kolekci „${esc(collById(orderList()).title)}“`;
    return `<div class="field"><div class="label">Pořadí ${where}</div>
      <div class="row" style="margin-top:0">
        <button class="btn small" data-order="start">Na začátek</button>
        <button class="btn small" data-order="end">Na konec</button>
        <button class="btn small" data-order="bydate" title="Přesune ${n > 1 ? 'vybrané fotky' : 'fotku'} tam, kam patří podle data pořízení. Zbytek pořadí zůstane.">Zařadit podle data</button>
      </div>
      <div class="hint">Fotky můžeš i přetahovat v mřížce.</div></div>`;
  }
  function bindOrderControls(root, ids) {
    root.querySelectorAll('[data-order]').forEach(b => b.addEventListener('click', () => changeOrder(b.dataset.order, ids)));
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // ---------- rendering ----------

  function renderGit() {
    const g = S.git, el = $('git-state');
    if (!g) { el.textContent = ''; return; }
    if (!g.repo) { el.className = 'git-state dirty'; el.textContent = 'Není propojeno s GitHubem'; el.title = 'Viz README, fáze 2'; return; }
    const dirty = g.changes > 0 || g.ahead > 0;
    el.className = 'git-state ' + (dirty ? 'dirty' : 'clean');
    el.textContent = dirty ? '● Nepublikované změny' : '✓ Vše publikováno';
    el.title = g.remote || '';
    renderRepoSize(g.size);
  }

  const fmtBytes = b => b >= 1e9 ? `${(b / 1024 ** 3).toFixed(2).replace('.', ',')} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`;

  // Repository size incl. history against GitHub's 1 GB, with what the next publish will add.
  function renderRepoSize(size) {
    const el = $('repo-size');
    if (!size) { el.hidden = true; return; }
    const total = size.stored + size.pending, share = total / size.limit;
    el.hidden = false;
    el.className = 'repo-size' + (share >= 0.9 ? ' danger' : share >= 0.7 ? ' warn' : '');
    el.textContent = `${fmtBytes(total)} z 1 GB`;
    el.title = `Velikost repozitáře na GitHubu včetně historie: ${fmtBytes(size.stored)}`
      + (size.pending ? `\nNepublikované fotky přidají zhruba ${fmtBytes(size.pending)}.` : '')
      + `\nGitHub doporučuje repozitář do 1 GB. Smazané a nahrazené fotky v historii zůstávají.`
      + (share >= 0.7 ? `\nJe čas řešit další kroky (README → Limity a údržba).` : '');
  }

  function renderSide() {
    const all = photos();
    $('n-all').textContent = all.length;
    $('n-none').textContent = all.filter(p => !p.collections.length).length;
    $('n-drafts').textContent = draftCount() || '';
    renderConfirm();
    const item = c => {
      const inC = all.filter(p => p.collections.includes(c.id));
      const pub = inC.filter(p => !p.draft).length, dr = inC.length - pub;
      // A collection with nothing published is itself a draft (Q13): not on the site, not in git.
      const n = `${pub}${dr ? ` <i class="n-draft" title="${dr} v konceptech">+${dr}</i>` : ''}`;
      const isDraft = !pub;
      return `<button class="side-item${isDraft ? ' is-draft' : ''}" data-filter="${c.id}"${isDraft ? ' title="Na webu se ukáže až se zveřejněním první fotky"' : ''}>${c.starred ? '<span class="star" title="Zvýrazněná">★</span>' : ''}${esc(c.title)}<span class="n">${n}</span></button>`;
    };
    // Starred ones on top (as on the site), then every group with ALL its collections, starred
    // included: a group whose only collection is starred used to lose its heading here, and with
    // it the only way to rename it. A starred collection therefore shows twice; both open it.
    const colls = S.data.collections, groups = groupNames();
    const starred = colls.filter(c => c.starred);
    const html = (starred.length ? `<div class="side-group">Zvýrazněné</div>${starred.map(item).join('')}` : '')
      + groups.map(g => `<button class="side-group" data-group="${esc(g)}" title="Přejmenovat skupinu">${esc(g)}<span class="edit">✎</span></button>`
        + colls.filter(c => c.group === g).sort((a, b) => cs(a.title, b.title)).map(item).join('')).join('')
      + (() => {
        const rest = colls.filter(c => !c.group && !c.starred);
        return rest.length ? (groups.length || starred.length ? '<div class="side-group">Bez skupiny</div>' : '') + rest.map(item).join('') : '';
      })();
    $('coll-list').innerHTML = html || '<div class="help" style="padding:4px 10px">Zatím žádné kolekce.</div>';
    document.querySelectorAll('.side-item').forEach(b => b.classList.toggle('active', b.dataset.filter === S.filter));
  }

  function renderMain() {
    const list = visiblePhotos();
    const coll = collById(S.filter);
    $('view-title').textContent = S.filter === 'drafts' ? 'Koncepty' : S.filter === 'none' ? 'Fotky bez kolekce'
      : coll ? coll.title : 'Všechny fotky';
    $('view-sub').textContent = photosLabel(list.length) + (S.selected.size ? ` · vybráno ${S.selected.size}` : '');
    const ol = orderList(), custom = ol && Array.isArray(storedOrder(ol));
    $('order-state').innerHTML = !ol || !list.length ? ''
      : custom ? `Vlastní pořadí · <button class="linkish" id="order-reset">vrátit podle ${S.data.settings.sort === 'added' ? 'nahrání' : 'data'}</button>`
      : `Řazeno podle ${S.data.settings.sort === 'added' ? 'nahrání' : 'data pořízení'} · přetažením fotky vytvoříš vlastní pořadí`;
    $('order-reset')?.addEventListener('click', () => changeOrder('reset'));
    $('edit-collection').hidden = !coll;
    $('drop-hint').innerHTML = coll
      ? `Nahrané fotky se rovnou přidají do kolekce <b>${esc(coll.title)}</b>`
      : 'JPG, PNG, WebP, TIFF · nahrané fotky jsou nejdřív koncepty, na web jdou až po potvrzení';

    $('thumbs').innerHTML = list.map((p, i) => {
      const badges = [];
      if (p.draft) badges.push('koncept');
      if (S.data.settings.coverPhotoId === p.id) badges.push('náhled webu');
      if (S.data.collections.some(c => c.coverId === p.id)) badges.push('obal');
      return `<button class="thumb${S.selected.has(p.id) ? ' sel' : ''}${p.draft ? ' is-draft' : ''}" data-id="${p.id}" data-i="${i}" draggable="true" style="background:${p.color}">
        <img src="${thumbUrl(p, 300)}" alt="" loading="lazy">
        ${badges.length ? `<div class="badges">${badges.map(b => `<span class="badge${b === 'koncept' ? ' draft' : ''}">${b}</span>`).join('')}</div>` : ''}
        ${p.title ? `<div class="t">${esc(p.title)}</div>` : ''}
      </button>`;
    }).join('');
    const empty = $('empty');
    empty.hidden = list.length > 0;
    empty.textContent = S.filter === 'all' ? 'Zatím žádné fotky. Přetáhni je do pole nahoře.' : 'V tomhle výběru nejsou žádné fotky.';
  }

  let lastPanelKey = '';
  function renderPanel() {
    const panel = $('panel');
    const key = `${S.panel}|${S.filter}|${[...S.selected].join(',')}`;
    if (key !== lastPanelKey) { panel.scrollTop = 0; lastPanelKey = key; }
    if (S.panel === 'settings') return renderSettings(panel);
    if (S.panel === 'collection' && collById(S.filter)) return renderCollectionEditor(panel, collById(S.filter));
    if (S.selected.size === 1) return renderPhotoEditor(panel, photoById([...S.selected][0]));
    if (S.selected.size > 1) return renderMulti(panel);
    renderHelp(panel);
  }

  // Cheap update when only the selection changed (keeps thumbnails in place).
  function renderSelection() {
    document.querySelectorAll('#thumbs .thumb').forEach(t => t.classList.toggle('sel', S.selected.has(t.dataset.id)));
    const n = visiblePhotos().length;
    $('view-sub').textContent = photosLabel(n) + (S.selected.size ? ` · vybráno ${S.selected.size}` : '');
  }

  function renderAll() {
    renderSide();
    renderMain();
    renderPanel();
    renderGit();
  }

  // ---------- panel: help ----------

  function renderHelp(panel) {
    panel.innerHTML = `
      <h2>Jak na to</h2>
      <div class="help">
        <ol>
          <li><b>Nahraj fotky</b> přetažením do pole. Název a popis se načtou z metadat (Lightroom, Fotky, Windows…), pokud tam jsou.</li>
          <li><b>Klikni na fotku</b> a doplň název, popis, místo a kolekce. Ukládá se samo.</li>
          <li><b>Ctrl/Shift + klik</b> vybere víc fotek naráz. Vybrané fotky jde i přetáhnout na kolekci vlevo.</li>
          <li><b>Náhled webu</b> ukáže galerii přesně tak, jak bude vypadat online.</li>
          <li><b>Publikovat na GitHub</b> pošle změny na web. Za minutu jsou online.</li>
        </ol>
        <p>Klávesy: <b>Ctrl+A</b> vybrat vše · <b>Esc</b> zrušit výběr · <b>Delete</b> smazat vybrané</p>
      </div>`;
  }

  // ---------- panel: single photo ----------

  function collectionChecks(p) {
    return S.data.collections.map(c => {
      const on = p.collections.includes(c.id);
      return `<div class="check">
        <label><input type="checkbox" data-coll="${c.id}" ${on ? 'checked' : ''}> ${esc(c.title)}</label>
        <button class="star${c.coverId === p.id ? ' on' : ''}" data-cover="${c.id}" title="Obal kolekce" ${on ? '' : 'disabled'}>★</button>
      </div>`;
    }).join('') || '<div class="help" style="padding:6px">Zatím žádné kolekce.</div>';
  }

  function renderPhotoEditor(panel, p) {
    if (!p) { renderHelp(panel); return; }
    const ex = p.exif || {};
    const exifRows = [['Fotoaparát', ex.camera], ['Objektiv', ex.lens], ['Expozice', [ex.focal, ex.aperture, ex.shutter, ex.iso].filter(Boolean).join(' · ')],
      ['Rozměr', `${p.width} × ${p.height}`], ['Na webu', `${Math.round((p.bytes || 0) / 1024)} kB`], ['Soubor', p.originalName]]
      .filter(r => r[1]);
    const isCover = S.data.settings.coverPhotoId === p.id;
    panel.innerHTML = `
      <img class="preview" data-replace="${p.id}" src="${thumbUrl(p, 960)}" alt="" style="aspect-ratio:${p.width}/${p.height};background:${p.color}" title="Přetáhni sem upravenou verzi a nahradíš jí tuhle fotku">
      <div class="field"><label for="f-title">Název</label><input type="text" id="f-title" value="${esc(p.title)}" placeholder="např. Ráno na Šumavě"></div>
      <div class="field"><label for="f-desc">Popis</label><textarea id="f-desc" placeholder="Krátký příběh k fotce (nepovinné)">${esc(p.description)}</textarea></div>
      <div class="field"><label for="f-loc">Místo</label><input type="text" id="f-loc" value="${esc(p.location)}" placeholder="např. Lenora, Šumava"></div>
      <div class="field"><label for="f-date">Datum pořízení</label><input type="datetime-local" step="1" id="f-date" value="${esc(p.takenAt)}">
        <div class="hint">Z EXIFu. Podle data se fotky řadí.</div></div>
      <div class="field"><div class="label">Kolekce <span class="hint">(★ = obal kolekce)</span></div>
        <div class="checks" id="f-colls">${collectionChecks(p)}</div>
        <div class="row"><input type="text" id="f-newcoll" placeholder="Nová kolekce…" style="flex:1;padding:6px 8px;border:1px solid var(--line);border-radius:7px;background:var(--bg)">
          <button class="btn small" id="f-newcoll-btn">Přidat</button></div>
      </div>
      ${exifRows.length ? `<div class="exif">${exifRows.map(r => `<div><span>${r[0]}</span><span>${esc(r[1])}</span></div>`).join('')}</div>` : ''}
      ${p.draft ? '' : orderControls(1)}
      ${p.draft
        ? `<div class="draft-box"><b>Koncept.</b> Na webu ani na GitHubu zatím není. <button class="btn small confirm" id="f-publish">Zveřejnit</button></div>`
        : ''}
      <div class="row">
        ${p.draft ? '' : `<button class="btn small" id="f-cover">${isCover ? '✓ Náhledová fotka webu' : 'Použít jako náhled webu'}</button>
        <a class="btn small ghost" href="/preview/f/${p.id}/" target="gallery-preview">Na webu ↗</a>
        <button class="btn small ghost" id="f-unpublish">Vrátit do konceptů</button>`}
        <label class="btn small">Nahradit soubor…<input type="file" id="f-replace" accept="image/jpeg,image/png,image/webp,image/tiff" hidden></label>
        <button class="btn small danger" id="f-delete">Smazat</button>
      </div>
      <div class="hint help" style="margin-top:8px">Náhled webu = obrázek, který se ukáže při sdílení odkazu na galerii.<br>
        Nahradit soubor = nahrát upravenou verzi (barvy, ořez). Název, popis, kolekce i odkaz zůstanou. Soubor můžeš i přetáhnout na náhled nahoře.</div>`;

    const save = debounce(async patch => {
      saving(true);
      try { Object.assign(p, await api('PATCH', `/api/photos/${p.id}`, patch)); renderMain(); refreshGitSoon(); }
      catch (e) { fail(e); }
      finally { saving(false); }
    }, 450);
    const pending = {};
    const queue = (k, v) => { pending[k] = v; save({ ...pending }); };

    $('f-title').addEventListener('input', e => queue('title', e.target.value));
    $('f-desc').addEventListener('input', e => queue('description', e.target.value));
    $('f-loc').addEventListener('input', e => queue('location', e.target.value));
    $('f-date').addEventListener('change', e => queue('takenAt', e.target.value.length === 16 ? e.target.value + ':00' : e.target.value));

    $('f-colls').addEventListener('change', async e => {
      const id = e.target.dataset.coll;
      if (!id) return;
      const next = e.target.checked ? [...p.collections, id] : p.collections.filter(c => c !== id);
      await updatePhotoNow(p, { collections: next });
      e.target.closest('.check').querySelector('.star').disabled = !e.target.checked;
    });
    $('f-colls').addEventListener('click', async e => {
      const b = e.target.closest('[data-cover]');
      if (!b) return;
      const c = collById(b.dataset.cover);
      await updateCollectionNow(c, { coverId: c.coverId === p.id ? '' : p.id });
      renderPanel();
    });
    const addNew = async () => {
      const title = $('f-newcoll').value.trim();
      if (!title) return;
      try {
        const c = await api('POST', '/api/collections', { title });
        S.data.collections.push(c); sortCollections();
        await updatePhotoNow(p, { collections: [...p.collections, c.id] });
        renderPanel();
      } catch (e) { fail(e); }
    };
    $('f-newcoll-btn').addEventListener('click', addNew);
    $('f-newcoll').addEventListener('keydown', e => { if (e.key === 'Enter') addNew(); });
    $('f-publish')?.addEventListener('click', () => confirmDrafts([p.id]));
    $('f-unpublish')?.addEventListener('click', () => unpublish([p.id]));
    $('f-cover')?.addEventListener('click', async () => {
      await saveSettingsNow({ coverPhotoId: isCover ? '' : p.id });
      renderMain(); renderPanel();
    });
    $('f-delete').addEventListener('click', () => confirmDelete([p.id]));
    bindOrderControls(panel, [p.id]);
    $('f-replace').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) replaceFile(p, f); });
  }

  async function replaceFile(p, file) {
    saving(true);
    toast('Zpracovávám novou verzi…');
    try {
      const updated = await api('POST', `/api/photos/${p.id}/replace?${new URLSearchParams({ name: file.name })}`, undefined, file);
      Object.assign(p, updated);
      renderMain(); renderPanel();
      toast('Fotka nahrazena novou verzí');
      refreshGitSoon(1500);
    } catch (e) { fail(e); }
    finally { saving(false); }
  }

  async function updatePhotoNow(p, patch) {
    saving(true);
    try { Object.assign(p, await api('PATCH', `/api/photos/${p.id}`, patch)); renderSide(); renderMain(); refreshGitSoon(); }
    catch (e) { fail(e); }
    finally { saving(false); }
  }
  async function updateCollectionNow(c, patch) {
    saving(true);
    try { Object.assign(c, await api('PATCH', `/api/collections/${c.id}`, patch)); sortCollections(); renderSide(); renderMain(); refreshGitSoon(); }
    catch (e) { fail(e); }
    finally { saving(false); }
  }
  async function saveSettingsNow(patch) {
    saving(true);
    try { S.data.settings = await api('PATCH', '/api/settings', patch); refreshGitSoon(); }
    catch (e) { fail(e); }
    finally { saving(false); }
  }

  // ---------- panel: multiple photos ----------

  function renderMulti(panel) {
    const ids = [...S.selected];
    const coll = collById(S.filter);
    // Existing collections grouped like the sidebar (optgroup per group), ungrouped ones last.
    const option = c => `<option value="${c.id}">${c.starred ? '★ ' : ''}${esc(c.title)}</option>`;
    const opts = groupNames().length
      ? groupNames().map(g => `<optgroup label="${esc(g)}">${S.data.collections.filter(c => c.group === g).map(option).join('')}</optgroup>`).join('')
        + (S.data.collections.some(c => !c.group) ? `<optgroup label="Bez skupiny">${S.data.collections.filter(c => !c.group).map(option).join('')}</optgroup>` : '')
      : S.data.collections.map(option).join('');
    const sel = ids.map(photoById).filter(Boolean);
    // Prefill a field only when every selected photo has the same value; otherwise say they differ.
    const common = k => { const v = new Set(sel.map(p => p[k] || '')); return v.size === 1 ? [...v][0] : null; };
    const textField = (k, id, label, ph, area) => {
      const v = common(k);
      const attrs = `id="${id}" data-bulk="${k}" data-ph="${ph}" placeholder="${v === null ? 'různé hodnoty' : ph}"`;
      return `<div class="field"><label for="${id}">${label}</label><div class="clearable">${area
        ? `<textarea ${attrs}>${esc(v || '')}</textarea>` : `<input type="text" ${attrs} value="${esc(v || '')}">`}
        <button type="button" class="clear-btn" data-clear="${k}" title="Vymazat u všech vybraných" aria-label="Vymazat ${label.toLowerCase()} u všech vybraných">×</button></div></div>`;
    };
    // Date inputs show no placeholder, so differing dates are described under the field.
    const dateField = () => {
      const v = common('takenAt');
      const dates = sel.map(p => p.takenAt).filter(Boolean).sort();
      const fmt = d => new Date(d).toLocaleDateString('cs-CZ');
      const hint = v !== null ? 'Podle data se fotky řadí.'
        : `Různá data${dates.length ? ` (${fmt(dates[0])} – ${fmt(dates.at(-1))})` : ''}. Nové datum dostanou všechny vybrané.`;
      return `<div class="field"><label for="m-date">Datum pořízení</label><div class="clearable">
        <input type="datetime-local" step="1" id="m-date" data-bulk="takenAt" data-ph="" value="${esc(v || '')}">
        <button type="button" class="clear-btn" data-clear="takenAt" title="Vymazat u všech vybraných" aria-label="Vymazat datum u všech vybraných">×</button></div>
        <div class="hint">${hint}</div></div>`;
    };
    panel.innerHTML = `
      <h2>Vybráno: ${photosLabel(ids.length)}</h2>
      <div id="m-bulk">
      <div class="section-title">Vyplnit u všech vybraných</div>
      ${textField('title', 'm-title', 'Název', 'např. Ráno na Šumavě')}
      ${textField('description', 'm-desc', 'Popis', 'Krátký příběh k fotkám (nepovinné)', true)}
      ${textField('location', 'm-loc', 'Místo', 'např. Lenora, Šumava')}
      ${dateField()}
      <label class="inline-check"><input type="checkbox" id="m-only-empty"> Jen u fotek, kde je pole prázdné</label>
      <div class="hint help" style="margin-top:6px">Ukládá se po kliknutí vedle nebo Enteru, pro všechny vybrané fotky. × pole u všech vymaže. Každou fotku pak můžeš upravit zvlášť.</div>
      </div>
      <hr class="sep">
      ${sel.some(p => !p.draft) ? orderControls(ids.length) : ''}
      <div class="field"><label for="m-coll">Přidat do kolekce</label>
        <div class="row" style="margin-top:0"><select id="m-coll" style="flex:1">${opts || '<option value="">(žádné kolekce)</option>'}</select>
        <button class="btn small" id="m-add" ${opts ? '' : 'disabled'}>Přidat</button></div></div>
      <div class="field"><label for="m-new">…nebo do nové kolekce</label>
        <div class="row" style="margin-top:0"><input type="text" id="m-new" placeholder="Název kolekce" style="flex:1">
        <button class="btn small" id="m-new-btn">Vytvořit</button></div>
        <input type="text" id="m-new-group" list="m-groups" placeholder="Skupina (nepovinné), např. Czech Republic" style="margin-top:6px">
        <datalist id="m-groups">${groupNames().map(g => `<option value="${esc(g)}">`).join('')}</datalist></div>
      <hr class="sep">
      ${sel.some(p => p.draft) || sel.some(p => !p.draft) ? `<div class="row">
        ${sel.some(p => p.draft) ? `<button class="btn small confirm" id="m-publish">Zveřejnit koncepty (${sel.filter(p => p.draft).length})</button>` : ''}
        ${sel.some(p => !p.draft) ? `<button class="btn small ghost" id="m-unpublish">Vrátit do konceptů (${sel.filter(p => !p.draft).length})</button>` : ''}
      </div>` : ''}
      <div class="row">
        ${coll ? `<button class="btn small" id="m-remove">Odebrat z kolekce „${esc(coll.title)}“</button>` : ''}
        <button class="btn small danger" id="m-delete">Smazat vybrané</button>
        <button class="btn small ghost" id="m-clear">Zrušit výběr</button>
      </div>`;
    // Same rule as everywhere in the admin: a change is saved when you leave the field (or press
    // Enter). Not on every keystroke like the single-photo editor: with "only empty" ticked, saving
    // "Šu" would fill the photos and the finished "Šumava" would then skip them as no longer empty.
    // Leaving a field empty clears it; × clears it too, which is the only way when values differ
    // (the field then starts empty, so there is nothing to delete).
    const box = $('m-bulk'); // re-created on every render, unlike `panel`, so listeners never pile up
    const saveField = (k, value) => {
      const v = value.trim();
      const input = box.querySelector(`[data-bulk="${k}"]`);
      input.placeholder = input.dataset.ph;
      return bulk(v ? { ids, set: { [k]: v }, onlyEmpty: $('m-only-empty').checked } : { ids, clear: [k] },
        v ? `Uloženo (${photosLabel(ids.length)})` : `Vymazáno (${photosLabel(ids.length)})`, { keepPanel: true });
    };
    box.addEventListener('change', e => { const k = e.target.dataset?.bulk; if (k) saveField(k, e.target.value); });
    box.addEventListener('click', e => {
      const k = e.target.closest('[data-clear]')?.dataset.clear;
      if (!k) return;
      box.querySelector(`[data-bulk="${k}"]`).value = '';
      saveField(k, '');
    });
    bindOrderControls(panel, ids);
    $('m-publish')?.addEventListener('click', () => confirmDrafts(sel.filter(p => p.draft).map(p => p.id)));
    $('m-unpublish')?.addEventListener('click', () => unpublish(sel.filter(p => !p.draft).map(p => p.id)));
    $('m-add').addEventListener('click', () => bulk({ ids, addCollection: $('m-coll').value }, 'Přidáno do kolekce'));
    const createAndAdd = async () => {
      const title = $('m-new').value.trim();
      if (!title) return;
      try {
        const c = await api('POST', '/api/collections', { title, group: $('m-new-group').value });
        S.data.collections.push(c); sortCollections();
        await bulk({ ids, addCollection: c.id }, `Vytvořena kolekce „${c.title}“${c.group ? ` ve skupině ${c.group}` : ''}`);
      } catch (e) { fail(e); }
    };
    $('m-new-btn').addEventListener('click', createAndAdd);
    $('m-new').addEventListener('keydown', e => { if (e.key === 'Enter') createAndAdd(); });
    $('m-new-group').addEventListener('keydown', e => { if (e.key === 'Enter') createAndAdd(); });
    if (coll) $('m-remove').addEventListener('click', () => bulk({ ids, removeCollection: coll.id }, 'Odebráno z kolekce'));
    $('m-delete').addEventListener('click', () => confirmDelete(ids));
    $('m-clear').addEventListener('click', () => { S.selected.clear(); renderSelection(); renderPanel(); });
  }

  // keepPanel: text fields in the multi-select panel save on blur; re-rendering the panel then
  // would steal focus from the field the user just clicked into.
  async function bulk(payload, okMsg, { keepPanel = false } = {}) {
    saving(true);
    try {
      const res = await api('POST', '/api/photos/bulk', payload);
      const set = new Set(payload.ids);
      if (res.photos) {
        for (const u of res.photos) Object.assign(photoById(u.id) || {}, u);
      } else if (payload.remove) {
        S.data.photos = S.data.photos.filter(p => !set.has(p.id));
        S.selected.clear();
      } else {
        for (const p of S.data.photos) {
          if (!set.has(p.id)) continue;
          if (payload.addCollection && !p.collections.includes(payload.addCollection)) p.collections.push(payload.addCollection);
          if (payload.removeCollection) p.collections = p.collections.filter(c => c !== payload.removeCollection);
        }
      }
      if (okMsg) toast(okMsg);
      if (keepPanel) { renderSide(); renderMain(); renderGit(); } else renderAll();
      refreshGitSoon();
    } catch (e) { fail(e); }
    finally { saving(false); }
  }

  function confirmDelete(ids) {
    modal(`Smazat ${photosLabel(ids.length)}?`,
      '<p class="help">Fotky zmizí z galerie i z webu (po publikování). Tvoje originály na disku zůstanou nedotčené.</p>',
      [['Zrušit', 'ghost'], ['Smazat', 'primary', async () => { await bulk({ ids, remove: true }, 'Smazáno'); }]]);
  }

  // ---------- panel: collection ----------

  function renderCollectionEditor(panel, c) {
    const n = photos().filter(p => p.collections.includes(c.id)).length;
    const cover = photoById(c.coverId) || sortedPhotos().find(p => p.collections.includes(c.id));
    panel.innerHTML = `
      <h2>Kolekce</h2>
      ${cover ? `<img class="preview" src="${thumbUrl(cover, 960)}" alt="" style="aspect-ratio:${cover.width}/${cover.height}">` : ''}
      <div class="field"><label for="c-title">Název</label><input type="text" id="c-title" value="${esc(c.title)}"></div>
      <div class="field"><label for="c-group">Skupina</label>
        <input type="text" id="c-group" value="${esc(c.group || '')}" list="c-groups" placeholder="např. Czech Republic, Slovakia">
        <datalist id="c-groups">${groupNames().map(g => `<option value="${esc(g)}">`).join('')}</datalist>
        <div class="hint">Kolekce se stejnou skupinou se řadí k sobě a na webu mají společnou stránku se všemi jejich fotkami. Prázdné = bez skupiny.</div></div>
      <label class="inline-check coll-star" title="Zvýrazněné kolekce jsou první (mezi sebou abecedně) a na webu mají hvězdičku a rámeček"><input type="checkbox" id="c-starred" ${c.starred ? 'checked' : ''}> ★ Zvýraznit (řadit na začátek)</label>
      <div class="field"><label for="c-desc">Popis</label><textarea id="c-desc" placeholder="Pár vět o kolekci (nepovinné)">${esc(c.description)}</textarea></div>
      <div class="field"><label for="c-slug">Adresa</label><input type="text" id="c-slug" value="${esc(c.slug)}">
        <div class="hint">…/collections/<b>${esc(c.slug)}</b>/ — po změně se stará adresa sama přesměruje na novou, poslané odkazy fungují dál.</div></div>
      <div class="help">${photosLabel(n)} · obal vybereš hvězdičkou u fotky</div>
      <div class="row">
        <a class="btn small ghost" href="/preview/collections/${esc(c.slug)}/" target="gallery-preview">Na webu ↗</a>
      </div>
      <hr class="sep">
      <div class="row"><button class="btn small danger" id="c-delete">Smazat kolekci</button> <button class="btn small ghost" id="c-close">Hotovo</button></div>
      <div class="hint help" style="margin-top:8px">Smazáním kolekce se fotky nesmažou.</div>`;

    const save = debounce(patch => updateCollectionNow(c, patch), 500);
    $('c-title').addEventListener('input', e => save({ title: e.target.value }));
    $('c-desc').addEventListener('input', e => save({ description: e.target.value }));
    $('c-starred').addEventListener('change', e => updateCollectionNow(c, { starred: e.target.checked }));
    $('c-group').addEventListener('change', e => updateCollectionNow(c, { group: e.target.value }));
    $('c-slug').addEventListener('change', async e => { await updateCollectionNow(c, { slug: e.target.value }); renderPanel(); });
    $('c-close').addEventListener('click', () => { S.panel = 'auto'; renderPanel(); });
    $('c-delete').addEventListener('click', () => modal(`Smazat kolekci „${c.title}“?`,
      '<p class="help">Fotky v ní zůstanou v galerii, jen už nebudou v této kolekci.</p>',
      [['Zrušit', 'ghost'], ['Smazat kolekci', 'primary', async () => {
        try {
          await api('DELETE', `/api/collections/${c.id}`);
          S.data.collections = S.data.collections.filter(x => x.id !== c.id);
          for (const p of S.data.photos) p.collections = p.collections.filter(x => x !== c.id);
          setFilter('all');
          refreshGitSoon();
        } catch (e) { fail(e); }
      }]]));
  }

  // ---------- panel: settings ----------

  function renderSettings(panel) {
    const s = S.data.settings;
    const links = s.links?.length ? s.links : [{ label: '', url: '' }];
    panel.innerHTML = `
      <h2>Profil a nastavení</h2>
      <div class="field"><div class="label">Profilová fotka</div>
        <div class="avatar-row">
          <img src="${s.avatar ? `/preview/${s.avatar}?v=${s.avatarVersion || 0}` : 'data:,'}" alt="">
          <label class="btn small">Nahrát…<input type="file" id="s-avatar" accept="image/*" hidden></label>
        </div></div>
      <div class="field"><label for="s-name">Jméno</label><input type="text" id="s-name" value="${esc(s.name)}"></div>
      <div class="field"><label for="s-bio">Krátký popis</label><textarea id="s-bio">${esc(s.bio)}</textarea></div>
      <div class="field"><label for="s-copyright">Copyright v souborech</label>
        <input type="text" id="s-copyright" value="${esc(s.copyright)}" placeholder="© Martin Pošta">
        <div class="hint">Zapíše se do každé fotky na webu spolu se jménem (autor), takže kdo si fotku stáhne, uvidí, čí je. Nic jiného z originálu se nezapisuje. Platí pro nově nahrané fotky. Formát EXIF neumí diakritiku, v souboru bude „Posta“ a „(C)“. Prázdné pole = nezapisovat nic.</div>
        ${S.data.photos.length ? `<button class="btn small" id="s-rewrite" style="margin-top:8px">Použít jméno a copyright i u nahraných fotek (${S.data.photos.length})</button>` : ''}</div>
      <div class="field"><div class="label">Odkazy (text · adresa)</div>
        <div id="s-links">${links.map(l => linkRow(l)).join('')}</div>
        <button class="btn small ghost" id="s-addlink">+ odkaz</button></div>
      <hr class="sep">
      <div class="field"><label for="s-sort">Řazení fotek</label>
        <select id="s-sort">
          <option value="taken" ${s.sort !== 'added' ? 'selected' : ''}>Podle data pořízení (nejnovější první)</option>
          <option value="added" ${s.sort === 'added' ? 'selected' : ''}>Podle nahrání (nejnovější první)</option>
        </select>
        <div class="hint">Automatické řazení. Platí pro Všechny fotky i pro každou kolekci, dokud v nich fotky ručně nepřeskládáš. Pak si seznam drží vlastní pořadí.</div></div>
      <div class="field"><label for="s-url">Veřejná adresa galerie</label>
        <input type="url" id="s-url" value="${esc(s.siteUrl)}" placeholder="https://www.martinposta.com/foto/">
        <div class="hint">Potřeba pro náhledy při sdílení odkazu (Messenger, WhatsApp…).</div></div>
      <div class="field"><label for="s-domain">Vlastní subdoména (jen pro variantu foto.martinposta.com)</label>
        <input type="text" id="s-domain" value="${esc(s.customDomain)}" placeholder="nech prázdné pro martinposta.com/foto">
        <div class="hint">Vyplň jen když galerie běží na subdoméně. Zapíše se do souboru CNAME.</div></div>
      <div class="field"><label for="s-analytics">Statistika návštěv (Cloudflare Web Analytics)</label>
        <input type="text" id="s-analytics" value="${esc(s.analyticsToken || '')}" placeholder="token, nebo celý skript z Cloudflare">
        <div class="hint">Cloudflare → Analytics &amp; Logs → Web Analytics → Add a site → foto.martinposta.com. Zkopíruj token (nebo celý nabídnutý skript) sem. Bez cookies. Náhled v adminu se nepočítá. Prázdné = žádná statistika.</div></div>
      <div class="field"><label for="s-contact">Kontaktní e-mail</label>
        <input type="email" id="s-contact" value="${esc(s.contact ? `${s.contact.user}@${s.contact.domain}` : '')}" placeholder="foto@martinposta.com">
        <div class="hint">Na webu se zobrazí jako odkaz <b>Email</b> u odkazů v profilu. Adresa se ukládá rozdělená a skládá se až v prohlížeči, takže ji roboti sbírající e-maily ze stránek ani z repa nenajdou. Prázdné = bez kontaktu.</div></div>`;

    const save = debounce(patch => saveSettingsNow(patch), 500);
    $('s-name').addEventListener('input', e => save({ name: e.target.value }));
    $('s-bio').addEventListener('input', e => save({ bio: e.target.value }));
    $('s-copyright').addEventListener('change', e => saveSettingsNow({ copyright: e.target.value }));
    $('s-rewrite')?.addEventListener('click', () => {
      const mb = S.data.photos.reduce((a, p) => a + (p.bytes || 0), 0) / 1e6;
      modal('Přepsat autora a copyright u nahraných fotek?',
        `<p>Do souborů všech ${photosLabel(S.data.photos.length)} na webu se zapíše autor <b>${esc(S.data.settings.name)}</b> a copyright <b>${esc(S.data.settings.copyright || '(nic)')}</b>. Obrázky se znovu nekomprimují, kvalita zůstane stejná.</p>
         <p class="hint">Git si pamatuje každou verzi souboru, takže po publikování se repozitář zvětší asi o ${mb.toFixed(0)} MB. Nedělej to proto zbytečně často.</p>`,
        [['Zrušit', 'ghost'], ['Přepsat', 'primary', async () => {
          saving(true);
          try { const r = await api('POST', '/api/photos/rewrite-author', {}); toast(`Hotovo: ${photosLabel(r.photos)}, změněno souborů: ${r.files}`); refreshGitSoon(); }
          catch (e) { fail(e); }
          finally { saving(false); }
        }]]);
    });
    $('s-url').addEventListener('change', e => saveSettingsNow({ siteUrl: e.target.value }));
    $('s-domain').addEventListener('change', e => saveSettingsNow({ customDomain: e.target.value }));
    $('s-contact').addEventListener('change', async e => { await saveSettingsNow({ contactEmail: e.target.value }); const c = S.data.settings.contact; e.target.value = c ? `${c.user}@${c.domain}` : ''; });
    $('s-analytics').addEventListener('change', async e => { await saveSettingsNow({ analyticsToken: e.target.value }); e.target.value = S.data.settings.analyticsToken || ''; });
    $('s-sort').addEventListener('change', async e => { await saveSettingsNow({ sort: e.target.value }); renderMain(); });
    const saveLinks = debounce(() => {
      const rows = [...document.querySelectorAll('#s-links .link-row')].map(r => ({ label: r.children[0].value, url: r.children[1].value }));
      saveSettingsNow({ links: rows });
    }, 500);
    $('s-links').addEventListener('input', saveLinks);
    $('s-links').addEventListener('click', e => { if (e.target.dataset.rm !== undefined) { e.target.parentElement.remove(); saveLinks(); } });
    $('s-addlink').addEventListener('click', () => $('s-links').insertAdjacentHTML('beforeend', linkRow({ label: '', url: '' })));
    $('s-avatar').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      saving(true);
      try { S.data.settings = await api('POST', '/api/avatar', undefined, f); renderPanel(); refreshGitSoon(); }
      catch (err) { fail(err); }
      finally { saving(false); }
    });
  }
  const linkRow = l => `<div class="link-row"><input type="text" placeholder="Portfolio" value="${esc(l.label)}"><input type="url" placeholder="https://…" value="${esc(l.url)}"><button class="btn small ghost" data-rm title="Odebrat">×</button></div>`;

  // ---------- modal ----------

  function modal(title, bodyHtml, actions) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHtml;
    const box = $('modal-actions');
    box.innerHTML = '';
    for (const [label, kind, fn] of actions) {
      const b = document.createElement('button');
      b.className = `btn ${kind || ''}`;
      b.textContent = label;
      b.addEventListener('click', async () => {
        if (fn) { b.disabled = true; const keep = await fn(); b.disabled = false; if (keep === 'keep') return; }
        $('modal').hidden = true;
      });
      box.appendChild(b);
    }
    $('modal').hidden = false;
    box.lastChild?.focus();
  }
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') $('modal').hidden = true; });

  // ---------- selection & filters ----------

  function setFilter(f) {
    S.filter = f;
    S.panel = f === 'settings' ? 'settings' : 'auto';
    if (f === 'settings') S.filter = 'all';
    S.selected.clear();
    S.lastIndex = -1;
    renderAll();
    if (f === 'settings') document.querySelectorAll('.side-item').forEach(b => b.classList.toggle('active', b.dataset.filter === 'settings'));
  }

  document.querySelector('.side').addEventListener('click', e => {
    const b = e.target.closest('[data-filter]');
    if (b) setFilter(b.dataset.filter);
  });

  // Rename a group: all its collections at once; the old group page keeps redirecting (D21).
  $('coll-list').addEventListener('click', e => {
    const from = e.target.closest('[data-group]')?.dataset.group;
    if (!from) return;
    const n = S.data.collections.filter(c => c.group === from).length;
    modal('Přejmenovat skupinu', `<div class="field"><label for="rg-name">Název skupiny</label><input type="text" id="rg-name" value="${esc(from)}">
      <div class="hint">Změní se u ${n === 1 ? '1 kolekce' : `${n} kolekcí`}. Stará adresa skupiny se přesměruje na novou. Když zadáš název jiné existující skupiny, obě se sloučí.</div></div>`,
      [['Zrušit', 'ghost'], ['Přejmenovat', 'primary', async () => {
        const to = $('rg-name').value.trim();
        if (!to) return 'keep';
        if (to === from) return;
        try {
          const r = await api('POST', '/api/groups/rename', { from, to });
          const key = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          for (const c of S.data.collections) if (c.group && key(c.group) === key(from)) c.group = r.group;
          sortCollections(); renderSide(); renderPanel(); refreshGitSoon();
          toast(`Skupina přejmenována na „${r.group}“`);
        } catch (err) { fail(err); return 'keep'; }
      }]]);
    setTimeout(() => { $('rg-name')?.focus(); $('rg-name')?.select(); }, 30);
    $('rg-name').addEventListener('keydown', ev => { if (ev.key === 'Enter') $('modal-actions').lastChild.click(); });
  });

  $('add-collection').addEventListener('click', () => {
    modal('Nová kolekce', '<div class="field"><label for="nc-title">Název</label><input type="text" id="nc-title" placeholder="např. Šumava 2025"></div>'
      + `<div class="field"><label for="nc-group">Skupina (nepovinné)</label><input type="text" id="nc-group" list="nc-groups" placeholder="např. Czech Republic">
         <datalist id="nc-groups">${groupNames().map(g => `<option value="${esc(g)}">`).join('')}</datalist></div>`,
      [['Zrušit', 'ghost'], ['Vytvořit', 'primary', async () => {
        const title = $('nc-title').value.trim();
        if (!title) return 'keep';
        try {
          const c = await api('POST', '/api/collections', { title, group: $('nc-group').value });
          S.data.collections.push(c); sortCollections();
          setFilter(c.id);
          refreshGitSoon();
        } catch (e) { fail(e); return 'keep'; }
      }]]);
    setTimeout(() => $('nc-title')?.focus(), 30);
    for (const id of ['nc-title', 'nc-group']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('modal-actions').lastChild.click(); });
  });

  $('edit-collection').addEventListener('click', () => { S.panel = 'collection'; S.selected.clear(); renderMain(); renderPanel(); });

  $('select-all').addEventListener('click', () => selectAll());
  function selectAll() {
    visiblePhotos().forEach(p => S.selected.add(p.id));
    S.panel = 'auto';
    renderSelection(); renderPanel();
  }

  $('thumbs').addEventListener('click', e => {
    const t = e.target.closest('.thumb');
    if (!t) return;
    const id = t.dataset.id, i = Number(t.dataset.i);
    const list = visiblePhotos();
    if (e.shiftKey && S.lastIndex >= 0) {
      const [a, b] = [Math.min(S.lastIndex, i), Math.max(S.lastIndex, i)];
      for (let k = a; k <= b; k++) S.selected.add(list[k].id);
    } else if (e.ctrlKey || e.metaKey) {
      S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id);
      S.lastIndex = i;
    } else {
      S.selected.clear();
      S.selected.add(id);
      S.lastIndex = i;
    }
    S.panel = 'auto';
    document.querySelectorAll('.side-item[data-filter=settings]').forEach(b => b.classList.remove('active'));
    renderSelection(); renderPanel();
  });

  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (e.key === 'Escape') {
      if (!$('modal').hidden) { $('modal').hidden = true; return; }
      if (!typing && S.selected.size) { S.selected.clear(); renderSelection(); renderPanel(); }
    }
    if (typing || !$('modal').hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected.size) { e.preventDefault(); confirmDelete([...S.selected]); }
  });

  // Drag selected thumbnails onto a collection in the sidebar.
  $('thumbs').addEventListener('dragstart', e => {
    const t = e.target.closest('.thumb');
    if (!t) return;
    const ids = S.selected.has(t.dataset.id) ? [...S.selected] : [t.dataset.id];
    e.dataTransfer.setData('application/x-photo-ids', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'copyMove'; // copy onto a collection, move within the grid
  });

  // Drag thumbnails within the grid to reorder the current list. The marker shows on which side
  // of the photo under the pointer the dragged ones will land.
  let dropMark = null;
  const clearMark = () => { dropMark?.el.classList.remove('drop-before', 'drop-after'); dropMark = null; };
  $('thumbs').addEventListener('dragover', e => {
    if (!orderList() || !e.dataTransfer.types.includes('application/x-photo-ids')) return;
    const t = e.target.closest('.thumb');
    if (!t) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = t.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    if (dropMark?.el !== t || dropMark.after !== after) {
      clearMark();
      dropMark = { el: t, after };
      t.classList.add(after ? 'drop-after' : 'drop-before');
    }
  });
  $('thumbs').addEventListener('dragleave', e => { if (!e.currentTarget.contains(e.relatedTarget)) clearMark(); });
  $('thumbs').addEventListener('drop', e => {
    if (!dropMark) return;
    e.preventDefault();
    const ids = JSON.parse(e.dataTransfer.getData('application/x-photo-ids') || '[]').filter(id => !photoById(id)?.draft);
    const { el, after } = dropMark;
    clearMark();
    if (!ids.length) { toast('Koncepty se řadí až po zveřejnění'); return; }
    let target = after ? el.nextElementSibling : el;
    // Next to itself, or onto the drafts at the top (they have no place in the order yet).
    while (target && (ids.includes(target.dataset.id) || photoById(target.dataset.id)?.draft)) target = target.nextElementSibling;
    changeOrder('move', ids, target?.dataset.id || null);
  });
  $('thumbs').addEventListener('dragend', clearMark);
  const side = document.querySelector('.side');
  side.addEventListener('dragover', e => {
    const item = e.target.closest('#coll-list [data-filter]');
    if (!item || !e.dataTransfer.types.includes('application/x-photo-ids')) return;
    e.preventDefault();
    side.querySelectorAll('.drop-target').forEach(x => x !== item && x.classList.remove('drop-target'));
    item.classList.add('drop-target');
  });
  side.addEventListener('dragleave', e => e.target.closest?.('[data-filter]')?.classList.remove('drop-target'));
  side.addEventListener('drop', e => {
    const item = e.target.closest('#coll-list [data-filter]');
    side.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
    if (!item) return;
    const raw = e.dataTransfer.getData('application/x-photo-ids');
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    const c = collById(item.dataset.filter);
    bulk({ ids: JSON.parse(raw), addCollection: c.id }, `Přidáno do kolekce „${c.title}“`);
  });

  // ---------- upload ----------

  const queue = { items: [], active: 0, done: 0, total: 0, errors: 0 };
  const CONCURRENCY = 2;

  function renderQueue() {
    const el = $('queue');
    if (!queue.total) { el.hidden = true; return; }
    el.hidden = false;
    const finished = queue.done + queue.errors === queue.total;
    const pct = Math.round(((queue.done + queue.errors) / queue.total) * 100);
    const rows = queue.items.filter(i => i.status !== 'done').slice(0, 6);
    el.innerHTML = `
      <div class="q-head"><span>${finished ? `Hotovo: nahráno ${queue.done} z ${queue.total}` : `Nahrávám ${queue.done + queue.errors + 1} z ${queue.total}…`}</span>
        ${finished ? '<button class="mini" id="q-close">Zavřít</button>' : ''}</div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      ${rows.map(i => `<div class="q-item${i.status === 'error' ? ' err' : ''}"><span>${esc(i.file.name)}</span><span>${esc(i.label)}</span></div>`).join('')}`;
    $('q-close')?.addEventListener('click', () => { Object.assign(queue, { items: [], done: 0, total: 0, errors: 0 }); renderQueue(); });
  }

  function enqueue(files) {
    const accepted = S.image.accepted;
    const collection = collById(S.filter) ? S.filter : '';
    if (queue.done + queue.errors === queue.total) Object.assign(queue, { items: [], done: 0, total: 0, errors: 0 });
    for (const file of files) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const item = { file, collection, status: 'waiting', label: 'čeká' };
      if (!accepted.includes(ext)) { item.status = 'error'; item.label = 'nepodporovaný formát'; queue.errors++; }
      queue.items.push(item);
      queue.total++;
    }
    renderQueue();
    pump();
  }

  function pump() {
    while (queue.active < CONCURRENCY) {
      const item = queue.items.find(i => i.status === 'waiting');
      if (!item) break;
      queue.active++;
      upload(item).finally(() => { queue.active--; renderQueue(); pump(); });
    }
  }

  function upload(item) {
    item.status = 'uploading';
    return new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      const qs = new URLSearchParams({ name: item.file.name, collection: item.collection });
      xhr.open('POST', `/api/upload?${qs}`);
      xhr.upload.onprogress = e => { item.label = `${Math.round((e.loaded / e.total) * 100)} %`; renderQueue(); };
      xhr.upload.onload = () => { item.label = 'zpracovávám…'; renderQueue(); };
      xhr.onload = () => {
        let res = {};
        try { res = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status === 200) {
          item.status = 'done';
          queue.done++;
          const existing = photoById(res.photo.id);
          if (existing) Object.assign(existing, res.photo);
          else S.data.photos.push(res.photo);
          renderSide(); renderMain();
          refreshGitSoon(1500);
        } else {
          item.status = 'error';
          item.label = res.error || `chyba ${xhr.status}`;
          queue.errors++;
        }
        resolve();
      };
      xhr.onerror = () => { item.status = 'error'; item.label = 'spojení selhalo'; queue.errors++; resolve(); };
      xhr.send(item.file);
    });
  }

  $('file-input').addEventListener('change', e => { enqueue([...e.target.files]); e.target.value = ''; });

  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer?.types?.includes('Files');
  window.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    $('drop').classList.toggle('over', !!e.target.closest?.('#drop'));
    document.querySelectorAll('[data-replace]').forEach(el => el.classList.toggle('over', el.contains(e.target)));
  });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    $('drop').classList.remove('over');
    const target = e.target.closest?.('[data-replace]');
    if (target) {
      target.classList.remove('over');
      const p = photoById(target.dataset.replace), f = e.dataTransfer.files[0];
      if (p && f) replaceFile(p, f);
      return;
    }
    if (e.target.closest?.('.main, .drop')) enqueue([...e.dataTransfer.files]);
  });

  // ---------- publish ----------

  $('publish-btn').addEventListener('click', () => {
    const g = S.git || {};
    const warn = !S.data.settings.siteUrl
      ? '<p class="help">Tip: v <b>Profil a nastavení</b> vyplň veřejnou adresu galerie, ať mají sdílené odkazy náhledový obrázek.</p>' : '';
    if (!g.repo) {
      modal('Složka zatím není propojená s GitHubem', `<p class="help">Postup je v README ve fázi 2 (git init, remote, první push). Pak stačí klikat tady.</p>${g.error ? `<div class="log">${esc(g.error)}</div>` : ''}`, [['OK', 'primary']]);
      return;
    }
    const nd = draftCount();
    const run = confirmFirst => async () => {
        const btn = document.activeElement?.closest('#modal-actions button') || $('modal-actions').lastChild; // the one clicked
        btn.textContent = 'Publikuji…';
        $('publish-btn').disabled = true;
        try {
          if (confirmFirst) await confirmDrafts(null, { quiet: true });
          const r = await api('POST', '/api/publish', { message: $('p-msg').value });
          S.git = r.status;
          renderGit();
          $('p-log').innerHTML = `<p><b>Hotovo.</b> Web se na GitHubu aktualizuje zhruba do minuty.</p><div class="log">${esc(r.log)}</div>`;
          [...$('modal-actions').children].slice(1).forEach(b => b.remove()); // only "Zavřít" stays
        } catch (e) {
          $('p-log').innerHTML = `<p style="color:var(--danger)"><b>Publikování selhalo.</b></p><div class="log">${esc(e.message)}</div>`;
          btn.textContent = 'Zkusit znovu';
        } finally {
          $('publish-btn').disabled = false;
        }
        return 'keep';
      };
    modal('Publikovat na GitHub', `
      <div class="field"><label for="p-msg">Popis změny (nepovinné)</label><input type="text" id="p-msg" placeholder="např. Nové fotky ze Šumavy"></div>
      ${nd ? `<p class="help">Máš <b>${photosLabel(nd)} v konceptech</b>. Ty se bez potvrzení na GitHub nepošlou.</p>` : ''}
      ${warn}<div id="p-log"></div>`,
      nd ? [['Zavřít', 'ghost'], ['Publikovat bez konceptů', '', run(false)], [`Potvrdit ${photosLabel(nd)} a publikovat`, 'primary', run(true)]]
         : [['Zavřít', 'ghost'], ['Publikovat', 'primary', run(false)]]);
  });

  // ---------- drafts ----------

  function renderConfirm() {
    const n = draftCount();
    $('confirm-btn').hidden = !n;
    $('n-confirm').textContent = n;
  }
  $('confirm-btn').addEventListener('click', () => confirmDrafts(null));

  // Publish drafts (all when ids is null). Files move into docs/; GitHub gets them with Publikovat.
  async function confirmDrafts(ids, { quiet = false } = {}) {
    saving(true);
    try {
      const r = await api('POST', '/api/drafts/publish', ids ? { ids } : {});
      for (const u of r.photos) { const p = photoById(u.id); if (p) { Object.assign(p, u); delete p.draft; } }
      if (!quiet) toast(`Zveřejněno: ${photosLabel(r.published)}. Na GitHub je pošle Publikovat.`);
      renderAll(); refreshGitSoon();
    } catch (e) { fail(e); if (quiet) throw e; }
    finally { saving(false); }
  }

  function unpublish(ids) {
    modal(`Vrátit ${photosLabel(ids.length)} do konceptů?`,
      '<p>Zmizí z webu a z příštího publikování. <b>Verze, která už na GitHubu je, ale zůstane v historii gitu</b> a kdo ví kde hledat, ji najde.</p>',
      [['Zrušit', 'ghost'], ['Vrátit do konceptů', 'primary', async () => {
        try {
          const r = await api('POST', '/api/photos/unpublish', { ids });
          for (const u of r.photos) Object.assign(photoById(u.id) || {}, u, { draft: true });
          for (const c of S.data.collections) if (Array.isArray(c.order)) c.order = c.order.filter(id => !ids.includes(id));
          if (Array.isArray(S.data.settings.order)) S.data.settings.order = S.data.settings.order.filter(id => !ids.includes(id));
          toast('Vráceno do konceptů'); renderAll(); refreshGitSoon();
        } catch (e) { fail(e); }
      }]]);
  }

  // ---------- boot ----------

  api('GET', '/api/state').then(r => {
    S.data = r.data;
    S.git = r.git;
    S.image = r.image;
    renderAll();
  }).catch(fail);
})();
