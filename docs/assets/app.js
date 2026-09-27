// Public gallery front-end. No dependencies.
// Views: all photos, collections list, single collection, photo lightbox (own URL f/<id>/).

(() => {
  'use strict';

  const body = document.body;
  const ROOT = new URL(body.dataset.root, location.href);          // absolute base URL of the gallery
  const V = body.dataset.v;
  const $ = id => document.getElementById(id);

  const els = {
    profile: $('profile'), chips: $('chips'), grid: $('grid'), sentinel: $('sentinel'),
    collections: $('collections'), empty: $('empty'), collHead: $('coll-head'), foot: $('foot'),
    lb: $('lb'), lbImg: $('lb-img'), lbInfo: $('lb-info'), lbCount: $('lb-count'),
    lbPrev: $('lb-prev'), lbNext: $('lb-next'), lbStage: $('lb-stage'), toast: $('toast'),
  };

  let DATA = null;
  let bySlug = {};
  let byId = {};
  let byGroup = {};
  let view = { view: 'photos' };  // current background view
  let list = [];                  // photos shown in the current view (lightbox navigates within this)
  let lbIndex = -1;

  // ---------- helpers ----------

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const url = rel => new URL(rel, ROOT).href;
  const photosLabel = n => `${n} photo${n === 1 ? '' : 's'}`;

  function srcset(p) {
    return p.widths.map(w => `${url(`img/${p.id}/${w}.${p.format}?v=${p.v}`)} ${w}w`).join(', ');
  }
  function src(p, maxW) {
    const w = p.widths.find(x => x >= maxW) || p.widths[p.widths.length - 1];
    return url(`img/${p.id}/${w}.${p.format}?v=${p.v}`);
  }
  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (els.toast.hidden = true), 2200);
  }

  // ---------- routing ----------

  function viewFromPath(pathname) {
    const rel = decodeURIComponent(pathname).slice(decodeURIComponent(ROOT.pathname).length).replace(/index\.html$/, '');
    let m;
    if (rel === '' ) return { view: 'photos' };
    if (rel === 'collections/' || rel === 'collections') return { view: 'collections' };
    if ((m = rel.match(/^collections\/([^/]+)\/?$/))) return { view: 'collection', slug: m[1] };
    if ((m = rel.match(/^groups\/([^/]+)\/?$/))) return { view: 'group', slug: m[1] };
    if ((m = rel.match(/^f\/([^/]+)\/?$/))) return { view: 'photo', id: m[1] };
    return { view: 'photos' };
  }
  function pathFor(v) {
    if (v.view === 'collections') return url('collections/');
    if (v.view === 'collection') return url(`collections/${v.slug}/`);
    if (v.view === 'group') return url(`groups/${v.slug}/`);
    if (v.view === 'photo') return url(`f/${v.id}/`);
    return ROOT.href;
  }

  function navigate(href) {
    const target = viewFromPath(new URL(href, location.href).pathname);
    if (target.view === 'photo') { openPhoto(target.id, true); return; }
    history.pushState({ v: target }, '', pathFor(target));
    closeLightbox(false);
    showView(target);
    window.scrollTo({ top: Math.min(window.scrollY, els.profile.offsetHeight), behavior: 'instant' });
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-nav]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(a.href);
  });

  window.addEventListener('popstate', e => {
    const target = viewFromPath(location.pathname);
    if (target.view === 'photo') {
      const behind = e.state?.behind || { view: 'photos' };
      if (!sameView(behind, view)) showView(behind);
      openPhoto(target.id, false);
    } else {
      closeLightbox(false);
      if (!sameView(target, view)) showView(target);
    }
  });

  const sameView = (a, b) => a.view === b.view && a.slug === b.slug;

  // ---------- rendering: header, tabs, chips ----------

  const LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a1 1 0 0 1 0-1.4l3.6-3.6a3 3 0 1 1 4.2 4.2l-2 2-1.4-1.4 2-2a1 1 0 1 0-1.4-1.4l-3.6 3.6a1 1 0 0 1-1.4 0Zm2.8-2.8a1 1 0 0 1 0 1.4l-3.6 3.6a3 3 0 1 1-4.2-4.2l2-2 1.4 1.4-2 2a1 1 0 1 0 1.4 1.4l3.6-3.6a1 1 0 0 1 1.4 0Z"/></svg>';

  function renderStatic() {
    const s = DATA.settings;
    els.profile.innerHTML = `
      ${s.avatar ? `<img class="avatar" src="${esc(url(s.avatar))}" alt="${esc(s.name)}" width="150" height="150">` : ''}
      <div class="profile-text">
        <h1>${esc(s.name)}</h1>
        ${s.bio ? `<p class="bio">${esc(s.bio)}</p>` : ''}
        ${s.links.length ? `<ul class="links">${s.links.map(l =>
          `<li><a href="${esc(l.url)}" rel="noopener">${LINK_ICON}${esc(l.label || l.url.replace(/^https?:\/\/(www\.)?/, ''))}</a></li>`).join('')}</ul>` : ''}
      </div>`;
    // Tab links are relative in the HTML; make them absolute so they work after pushState navigation.
    document.querySelector('[data-tab=photos]').href = ROOT.href;
    document.querySelector('[data-tab=collections]').href = url('collections/');
    $('count-photos').textContent = DATA.photos.length;
    $('count-collections').textContent = DATA.collections.length;
    // Chips (D27): starred collections, then groups only (a group page lists its collections),
    // then collections without a group, which could not be reached from the row otherwise.
    // Thin separators between the three parts.
    const chip = c => `<a class="chip${c.starred ? ' starred' : ''}" data-nav data-slug="${esc(c.slug)}" href="${esc(url(`collections/${c.slug}/`))}">${collTitle(c)}<span class="n">${c.count}</span></a>`;
    const sep = '<span class="chip-sep" aria-hidden="true"></span>';
    const parts = [
      DATA.collections.filter(c => c.starred).map(chip).join(''),
      DATA.groups.map(g => `<a class="chip group" data-nav data-group="${esc(g.slug)}" href="${esc(url(`groups/${g.slug}/`))}">${esc(g.name)}<span class="n">${g.count}</span></a>`).join(''),
      DATA.collections.filter(c => !c.starred && !c.groupSlug).map(chip).join(''),
    ].filter(Boolean);
    els.chips.innerHTML = parts.join(sep);
    updateChipEdges();
    const year = new Date().getFullYear();
    els.foot.innerHTML = `© ${year} ${esc(s.name)}${s.links[0] ? ` · <a href="${esc(s.links[0].url)}">${esc(s.links[0].label || s.links[0].url)}</a>` : ''}`;
  }

  // The chip row with a mouse (touch just swipes): arrows at the ends that still hide chips,
  // dragging, and the wheel. `more-left` / `more-right` on the wrapper drive the arrows and the
  // edge fades in CSS.
  const chipsWrap = $('chips-wrap');
  function updateChipEdges() {
    const max = els.chips.scrollWidth - els.chips.clientWidth;
    chipsWrap.classList.toggle('more-left', els.chips.scrollLeft > 2);
    chipsWrap.classList.toggle('more-right', els.chips.scrollLeft < max - 2);
  }
  els.chips.addEventListener('scroll', updateChipEdges, { passive: true });
  window.addEventListener('resize', updateChipEdges);
  const page = dir => els.chips.scrollBy({ left: dir * Math.max(120, els.chips.clientWidth * 0.7), behavior: 'smooth' });
  $('chips-prev').addEventListener('click', () => page(-1));
  $('chips-next').addEventListener('click', () => page(1));

  // Drag to scroll. A press that moves less than 5 px is still a click on the chip; after a
  // real drag the click that follows the release is swallowed so it does not open a collection.
  let drag = null, swallowClick = false;
  els.chips.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button === 0) drag = { x: e.clientX, left: els.chips.scrollLeft, moved: false };
  });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 5) return;
    drag.moved = true;
    chipsWrap.classList.add('dragging');
    els.chips.scrollLeft = drag.left - dx;
    updateChipEdges();
  });
  const endDrag = () => {
    if (drag?.moved) { swallowClick = true; setTimeout(() => { swallowClick = false; }, 0); }
    drag = null;
    chipsWrap.classList.remove('dragging');
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  els.chips.addEventListener('click', e => { if (swallowClick) { e.preventDefault(); e.stopPropagation(); } }, true);
  els.chips.addEventListener('dragstart', e => e.preventDefault()); // links would start a native drag

  // A mouse wheel only scrolls vertically, so the chip row could be moved only with a touchpad.
  // Over the row the wheel moves it sideways while it still can; at either end the page scrolls.
  els.chips.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // touchpad: already sideways
    const max = els.chips.scrollWidth - els.chips.clientWidth;
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // lines -> px (Firefox)
    if (max <= 0 || (d < 0 && els.chips.scrollLeft <= 0) || (d > 0 && els.chips.scrollLeft >= max - 1)) return;
    e.preventDefault();
    els.chips.scrollLeft += d;
  }, { passive: false });

  function showView(v) {
    view = v.view === 'photo' ? { view: 'photos' } : v;
    const coll = view.view === 'collection' ? bySlug[view.slug] : null;
    const group = view.view === 'group' ? byGroup[view.slug] : null;
    if ((view.view === 'collection' && !coll) || (view.view === 'group' && !group)) view = { view: 'photos' };

    // tabs + chips state
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active',
      (t.dataset.tab === 'photos' && view.view === 'photos') || (t.dataset.tab === 'collections' && view.view === 'collections')));
    let activeChip = null;
    // A collection whose own chip is not in the row (grouped, not starred) lights up its group.
    const ownChip = coll && [...els.chips.querySelectorAll('.chip')].some(c => c.dataset.slug === coll.slug);
    const activeGroup = group ? group.slug : coll && !ownChip ? coll.groupSlug : '';
    els.chips.querySelectorAll('.chip').forEach(c => {
      const on = (ownChip && c.dataset.slug === coll.slug) || (!!activeGroup && c.dataset.group === activeGroup);
      c.classList.toggle('active', on);
      if (on) activeChip = c;
    });
    if (activeChip) {
      const box = els.chips.getBoundingClientRect(), r = activeChip.getBoundingClientRect();
      if (r.left < box.left || r.right > box.right - 40) els.chips.scrollBy({ left: r.left - box.left - 40, behavior: 'smooth' });
    }

    setViewTitle();

    if (view.view === 'collections') {
      els.collHead.hidden = true;
      els.grid.hidden = true;
      els.collections.hidden = false;
      els.empty.hidden = DATA.collections.length > 0;
      els.empty.textContent = 'No collections yet.';
      renderCollections();
      list = DATA.photos;
      return;
    }

    els.collections.hidden = true;
    els.grid.hidden = false;
    // A collection has its own order (coll.photos = ids), independent of the main one.
    const ids = coll ? coll.photos : group ? group.photos : null;
    list = ids ? ids.map(id => byId[id]).filter(Boolean) : DATA.photos;
    els.empty.hidden = list.length > 0;
    els.empty.textContent = 'No photos yet.';
    if (coll) {
      els.collHead.hidden = false;
      const g = coll.groupSlug && byGroup[coll.groupSlug];
      els.collHead.innerHTML = (g ? `<a class="crumb" data-nav href="${esc(url(`groups/${g.slug}/`))}">${esc(g.name)}</a>` : '')
        + `<h2>${esc(coll.title)}</h2>${coll.description ? `<p>${esc(coll.description)}</p>` : ''}<div class="meta">${photosLabel(coll.count)}</div>`;
    } else if (group) {
      els.collHead.hidden = false;
      const members = group.collections.map(s => bySlug[s]).filter(Boolean);
      els.collHead.innerHTML = `<h2>${esc(group.name)}</h2><div class="meta">${photosLabel(group.count)} · ${members.length} collection${members.length === 1 ? '' : 's'}</div>`
        + `<div class="group-colls">${members.map(c => `<a class="chip${c.starred ? ' starred' : ''}" data-nav href="${esc(url(`collections/${c.slug}/`))}">${collTitle(c)}<span class="n">${c.count}</span></a>`).join('')}</div>`;
    } else {
      els.collHead.hidden = true;
    }
    renderGrid(true);
  }

  function setViewTitle() {
    const name = DATA.settings.name;
    const coll = view.view === 'collection' ? bySlug[view.slug] : null;
    const group = view.view === 'group' ? byGroup[view.slug] : null;
    document.title = view.view === 'collections' ? `Collections · ${name}` : coll ? `${coll.title} · ${name}` : group ? `${group.name} · ${name}` : name;
  }

  // ---------- masonry grid ----------
  // Photos are placed row by row into the currently shortest column (like Unsplash),
  // so reading order stays left-to-right and the layout never jumps while images load.

  const BATCH = 24;
  let rendered = 0;
  let cols = [];
  let heights = [];
  let colCount = 0;
  let colWidth = 0;
  let gapPx = 0;

  function columnsFor(width) { return width >= 1000 ? 3 : width >= 560 ? 2 : 1; }

  function renderGrid(reset) {
    const width = els.grid.clientWidth || document.documentElement.clientWidth;
    const n = columnsFor(width);
    if (reset || n !== colCount) {
      const keep = reset ? BATCH : Math.max(rendered, BATCH);
      colCount = n;
      els.grid.innerHTML = '';
      cols = Array.from({ length: n }, () => {
        const c = document.createElement('div');
        c.className = 'col';
        els.grid.appendChild(c);
        return c;
      });
      heights = new Array(n).fill(0);
      rendered = 0;
      gapPx = parseFloat(getComputedStyle(els.grid).columnGap) || 0; // same gap between rows (.col)
      colWidth = (width - gapPx * (n - 1)) / n;
      appendTiles(keep);
    }
  }

  function appendTiles(count) {
    const end = Math.min(list.length, rendered + count);
    const sizes = `${Math.ceil(colWidth)}px`;
    for (; rendered < end; rendered++) {
      const p = list[rendered];
      // Heights in pixels incl. the gap under each tile; the 1 px tolerance keeps left-to-right
      // order on ties. (It used to add aspect ratios but compare with 1, i.e. a whole square
      // photo of tolerance, so a column had to be a full photo shorter before it got the next one.)
      let ci = 0;
      for (let i = 1; i < colCount; i++) if (heights[i] < heights[ci] - 1) ci = i;
      heights[ci] += colWidth * p.h / p.w + gapPx;

      const a = document.createElement('a');
      a.className = 'tile';
      a.href = url(`f/${p.id}/`);
      a.dataset.id = p.id;
      a.style.aspectRatio = `${p.w} / ${p.h}`;
      a.style.backgroundColor = p.color;
      const alt = p.title || p.description || p.location || 'Photo';
      const cap = [p.title, p.location].filter(Boolean);
      a.innerHTML = `<img alt="${esc(alt)}" loading="lazy" decoding="async" sizes="${sizes}" srcset="${srcset(p)}" src="${src(p, colWidth)}">` +
        (cap.length ? `<div class="cap">${p.title ? `<b>${esc(p.title)}</b>` : ''}${p.location ? esc(p.location) : ''}</div>` : '');
      const img = a.firstChild;
      if (img.complete) img.classList.add('loaded');
      else img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
      cols[ci].appendChild(a);
    }
  }

  els.grid.addEventListener('click', e => {
    const a = e.target.closest('.tile');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    openPhoto(a.dataset.id, true);
  });

  new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && !els.grid.hidden && rendered < list.length) appendTiles(BATCH);
  }, { rootMargin: '1200px 0px' }).observe(els.sentinel);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (els.grid.hidden) return;
      const width = els.grid.clientWidth;
      if (columnsFor(width) !== colCount) renderGrid(false);
    }, 120);
  });

  // ---------- collections list ----------

  // Starred collections (highlighted by the owner, listed first) carry a small star.
  const collTitle = c => (c.starred ? '<span class="star" aria-label="Featured collection">★</span>' : '') + esc(c.title);

  // Without groups the page is one grid of cards, as before. With groups it has sections:
  // Featured (starred), one per group (heading links to the group page), then Other.
  function renderCollections() {
    const grouped = DATA.groups.length > 0;
    els.collections.classList.toggle('grouped', grouped);
    if (!grouped) { els.collections.innerHTML = DATA.collections.map(card).join(''); return; }
    const section = (title, cards, meta = '') => cards.length
      ? `<section class="coll-section"><h2>${title}${meta ? ` <span class="meta">${meta}</span>` : ''}</h2><div class="coll-grid">${cards.map(card).join('')}</div></section>` : '';
    els.collections.innerHTML =
      section('Featured', DATA.collections.filter(c => c.starred))
      + DATA.groups.map(g => section(`<a data-nav href="${esc(url(`groups/${g.slug}/`))}">${esc(g.name)} →</a>`,
        g.collections.map(s => bySlug[s]).filter(Boolean), photosLabel(g.count))).join('')
      + section('Other', DATA.collections.filter(c => !c.starred && !c.groupSlug));
  }

  function card(c) {
    const imgs = c.preview.map(id => byId[id]).filter(Boolean);
    return `<a class="card" data-nav href="${esc(url(`collections/${c.slug}/`))}">
      <div class="collage n${imgs.length}">${imgs.map((p, i) =>
        `<div style="background-color:${p.color};background-image:url('${src(p, i === 0 ? 960 : 480)}')"></div>`).join('')}</div>
      <h3>${collTitle(c)}</h3>
      <div class="meta">${photosLabel(c.count)}</div>
    </a>`;
  }

  // ---------- lightbox ----------

  let lbPushed = false;

  function openPhoto(id, push) {
    const p = byId[id];
    if (!p) { closeLightbox(false); return; }
    let idx = list.findIndex(x => x.id === id);
    if (idx < 0) { list = DATA.photos; idx = list.findIndex(x => x.id === id); }
    if (push) {
      const target = pathFor({ view: 'photo', id });
      if (!els.lb.hidden) history.replaceState({ behind: view, lb: true }, '', target);
      else { history.pushState({ behind: view, lb: true }, '', target); lbPushed = true; }
    }
    lbIndex = idx;
    els.lb.hidden = false;
    body.classList.add('lb-open');
    renderLightbox();
  }

  function renderLightbox() {
    const p = list[lbIndex];
    if (!p) return;
    // A fresh <img> per photo. Swapping src on the same element kept the previous photo on screen
    // until the new one loaded, and a late load/decode of the previous one cleared the dimming of
    // the new one (seen when swiping quickly on a phone).
    const img = document.createElement('img');
    img.id = 'lb-img';
    img.className = 'loading';
    img.alt = p.title || p.description || p.location || 'Photo';
    img.sizes = '100vw';
    img.srcset = srcset(p);
    img.src = src(p, 1600);
    const shown = () => { if (els.lbImg === img) img.classList.remove('loading'); };
    img.addEventListener('load', shown, { once: true });
    img.decode?.().then(shown, () => {});
    els.lbImg.replaceWith(img);
    els.lbImg = img;

    els.lbCount.textContent = `${lbIndex + 1} / ${list.length}`;
    els.lbPrev.disabled = lbIndex <= 0;
    els.lbNext.disabled = lbIndex >= list.length - 1;

    const meta = [formatDate(p.takenAt), p.location, p.exif.camera, p.exif.lens,
      [p.exif.focal, p.exif.aperture, p.exif.shutter, p.exif.iso].filter(Boolean).join('  ')].filter(Boolean);
    const colls = DATA.collections.filter(c => p.collections.includes(c.slug)); // alphabetical, like everywhere
    els.lbInfo.innerHTML =
      (p.title ? `<h2>${esc(p.title)}</h2>` : '') +
      (p.description ? `<p>${esc(p.description)}</p>` : '') +
      (meta.length ? `<div class="meta">${meta.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : '') +
      (colls.length ? `<div class="lb-chips">${colls.map(c =>
        `<a data-nav href="${esc(url(`collections/${c.slug}/`))}">${collTitle(c)}</a>`).join('')}</div>` : '');

    document.title = `${p.title || p.location || 'Photo'} · ${DATA.settings.name}`; // untitled photos go by their place

    // Preload neighbours for instant paging.
    for (const n of [list[lbIndex + 1], list[lbIndex - 1]]) if (n) new Image().src = src(n, Math.min(1600, window.innerWidth * devicePixelRatio));
  }

  function step(d) {
    const next = lbIndex + d;
    if (next < 0 || next >= list.length) return;
    lbIndex = next;
    history.replaceState({ behind: view, lb: true }, '', pathFor({ view: 'photo', id: list[lbIndex].id }));
    renderLightbox();
  }

  function closeLightbox(updateHistory = true) {
    if (els.lb.hidden) return;
    const current = list[lbIndex];
    if (isFull()) setFull(false);
    els.lb.hidden = true;
    body.classList.remove('lb-open');
    els.lbImg.removeAttribute('src');
    els.lbImg.removeAttribute('srcset');
    if (updateHistory) {
      if (lbPushed && history.state?.lb) history.back();
      else history.pushState({ v: view }, '', pathFor(view));
    }
    lbPushed = false;
    setViewTitle();
    if (current) {
      const tile = els.grid.querySelector(`.tile[data-id="${CSS.escape(current.id)}"]`);
      if (tile) {
        const r = tile.getBoundingClientRect();
        if (r.bottom < 60 || r.top > window.innerHeight) tile.scrollIntoView({ block: 'center' });
      }
    }
  }

  // ---------- more room for the photo ----------
  // ⓘ / I hides the caption panel (remembered in this browser). ⛶ / F shows only the photo on
  // black, with the controls fading out while the pointer rests. iPhone Safari cannot put the
  // lightbox into real fullscreen, so there the same view is made inside the page.

  const remember = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  const infoBtn = $('lb-info-btn');
  function setInfo(hidden) {
    els.lb.classList.toggle('no-info', hidden);
    infoBtn.setAttribute('aria-pressed', String(!hidden));
    remember.set('lb-info', hidden ? 'off' : 'on');
  }
  setInfo(remember.get('lb-info') === 'off');
  infoBtn.addEventListener('click', () => setInfo(!els.lb.classList.contains('no-info')));

  const realFullscreen = !!(els.lb.requestFullscreen && document.fullscreenEnabled);
  const isFull = () => els.lb.classList.contains('full');
  let idleTimer;
  function wake() {
    els.lb.classList.remove('idle');
    clearTimeout(idleTimer);
    if (isFull()) idleTimer = setTimeout(() => els.lb.classList.add('idle'), 2500);
  }
  function setFull(on) {
    if (realFullscreen) {
      if (on && !document.fullscreenElement) els.lb.requestFullscreen().catch(() => { els.lb.classList.add('full'); wake(); });
      if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
    els.lb.classList.toggle('full', on); // fullscreenchange keeps it in sync with Esc etc.
    wake();
  }
  document.addEventListener('fullscreenchange', () => { els.lb.classList.toggle('full', document.fullscreenElement === els.lb); wake(); });
  $('lb-full').addEventListener('click', () => setFull(!isFull()));
  els.lb.addEventListener('mousemove', wake);
  els.lb.addEventListener('touchstart', wake, { passive: true });

  $('lb-close').addEventListener('click', () => closeLightbox());
  els.lbPrev.addEventListener('click', () => step(-1));
  els.lbNext.addEventListener('click', () => step(1));
  els.lbStage.addEventListener('click', e => {
    if (e.target !== els.lbStage) return;
    if (isFull()) wake(); // in fullscreen a tap next to the photo brings the controls back
    else closeLightbox();
  });
  $('lb-share').addEventListener('click', async () => {
    const p = list[lbIndex];
    const link = pathFor({ view: 'photo', id: p.id });
    if (navigator.share && matchMedia('(hover: none)').matches) {
      try { await navigator.share({ title: p.title || p.location || DATA.settings.name, url: link }); } catch { /* cancelled */ }
    } else {
      try { await navigator.clipboard.writeText(link); toast('Link copied'); }
      catch { prompt('Link to this photo:', link); }
    }
  });

  document.addEventListener('keydown', e => {
    if (els.lb.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { if (isFull()) setFull(false); else closeLightbox(); } // real fullscreen eats Esc itself
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'f' || e.key === 'F') setFull(!isFull());
    else if (e.key === 'i' || e.key === 'I') setInfo(!els.lb.classList.contains('no-info'));
  });

  let touchX = null, touchY = null;
  els.lbStage.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
  els.lbStage.addEventListener('touchend', e => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) closeLightbox();
  });

  // ---------- boot ----------

  fetch(url(`data.json?v=${V}`))
    .then(r => r.json())
    .then(d => {
      DATA = d;
      bySlug = Object.fromEntries(d.collections.map(c => [c.slug, c]));
      byGroup = Object.fromEntries((d.groups || []).map(g => [g.slug, g]));
      byId = Object.fromEntries(d.photos.map(p => [p.id, p]));
      renderStatic();
      const start = viewFromPath(location.pathname);
      const initial = start.view === 'photo' ? { view: 'photos' } : start;
      history.replaceState(start.view === 'photo' ? { behind: initial, lb: true } : { v: start }, '', location.href);
      showView(initial);
      if (start.view === 'photo') openPhoto(start.id, false);
    })
    .catch(err => {
      els.empty.hidden = false;
      els.empty.textContent = 'The gallery could not be loaded.';
      console.error(err);
    });
})();
