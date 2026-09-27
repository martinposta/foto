# CLAUDE.md

Personal photo gallery for Martin Pošta, Unsplash-style, hosted free on **GitHub Pages** (served from `docs/` on `main`). Photos are managed in a **local admin** (Node, `localhost` only) that resizes uploads, edits titles/collections, regenerates the static site and publishes with `git commit` + `git push`.

- **Plan, decisions, backlog:** `PLAN.md`. Read it before starting work, and update it when you finish a task (tick the box, add a line to the log).
- **User setup / daily use:** `README.md` (Czech, for the user).
- Planning happens in a separate claude.ai conversation. If a task needs a product decision that `PLAN.md` doesn't answer, ask the user instead of guessing, and record the answer in `PLAN.md`.

## Communication and conventions

- Talk to the user in **Czech**. Code, comments, commit messages about code and identifiers are in **English**.
- The **admin** is **Czech** (correct plurals `fotka / fotky / fotek`, helper `plural()` in admin.js). The **public site** is **English** since 2026-09-27 (PLAN D19): texts, `lang="en"`, dates `en-GB`, `N photo(s)`, URLs `collections/`. The owner writes titles/descriptions in English.
- The user works on **macOS** (zsh/Terminal). Give commands for the macOS Terminal. Keep the code cross-platform (`node:path`, no shell-specific npm scripts): the Windows launcher is kept as a fallback. Launchers: `Galerie.command` (macOS, must stay **LF** and executable) and `Galerie.cmd` (Windows, must stay **CRLF**). Line endings are enforced by `.gitattributes`.
- Preferences: minimal dependencies, free/open-source, no frameworks, no build step. **Ask before adding any npm dependency.** Runtime deps today: `sharp`, `exifr`. Front-ends are plain JS/CSS with no CDN.
- Work in small, verifiable phases. Run `npm test` after every change.

## Commands

```bash
npm install          # first time only
npm run admin        # admin at http://localhost:4321, preview at /preview/  (NO_OPEN=1 skips opening a browser)
npm run rebuild      # regenerate docs/ from data/gallery.json + site/ (after editing site/ by hand)
npm test             # end-to-end tests (node:test), about 15 s, uses a temp data root, safe to run anytime
```

`PORT=5000 npm run admin` changes the admin port. `GALLERY_DATA_ROOT` points `data/` + `docs/` + git to another folder (the tests use this).

## Architecture

```
admin/server.mjs      node:http server, 127.0.0.1 only. Static admin UI + /preview/ (serves docs/) + JSON /api/*
admin/public/         admin UI (index.html, admin.js, admin.css). Single IIFE, no deps
lib/config.mjs        paths (ROOT_DIR = code, DATA_ROOT = data/docs/git), IMAGE settings, admin port
lib/store.mjs         load/save data/gallery.json (atomic write via .tmp + rename, serialized), slugify
lib/images.mjs        sharp pipeline + exifr metadata extraction
lib/gallery.mjs       all mutations (photos, collections, settings, avatar). UserError = 400 with Czech message
lib/order.mjs         photo order of a list (automatic vs stored), reorder actions; admin.js mirrors orderedPhotos()
lib/build.mjs         data/gallery.json + site/ template → docs/ (HTML pages, data.json, assets, CNAME, 404)
site/                 public site SOURCE: index.html template + app.js + style.css + fonts/ (Inter, self-hosted, OFL)
docs/                 GENERATED public site (committed, served by GitHub Pages). Never edit by hand
data/gallery.json     source of truth (committed, doubles as a backup on GitHub)
tests/                node:test end-to-end suite
```

**Flow:** upload (raw body, `?name=&collection=`) → `hashBuffer` (sha1, 12 hex chars = photo id, dedupes re-uploads) → `readMetadata` (EXIF/IPTC/XMP; Czech mojibake repair; Windows XP* tags) → `processImage` (auto-orient, widths `[480, 960, 1600, 2400]` capped at long edge 2400, WebP q82, plus `og.jpg` 1200 px for link previews, average colour placeholder) → record saved → debounced `buildSite()` (300 ms) → preview updates. Publish = `buildNow()` → `git add -A` → commit (if staged changes) → `push` (`-u origin HEAD` the first time).

**Public site:** static HTML shells, one per URL, all rendered from `site/index.html` with tokens `{{ROOT}} {{V}} {{TITLE}} {{META}} {{PAGE}}`:
- `docs/index.html` (all photos), `docs/collections/index.html` (collections list), `docs/collections/<slug>/index.html`, `docs/f/<photoId>/index.html`. (Until 2026-09-27 the Czech `kolekce/`; `buildSite()` deletes that folder, nothing had been shared.)
- **Groups** (D20) have no record of their own: a group exists while a collection names it (`collection.group`), keyed by `slugify(name)`. `data.json.groups` = `{ slug, name, collections: [slugs], photos: [ids], count, preview }`; a group's photos are its collections (alphabetical) concatenated in their own orders, deduped. Pages `docs/groups/<slug>/`. Chip row (D27): starred collections, then **groups only**, then ungrouped collections, split by thin separators; a grouped collection's page highlights its group chip. With a mouse the row scrolls by wheel (sideways until either end), by dragging (5 px threshold; the click after a drag is swallowed in capture phase) and by ‹ › arrows shown only on a side that hides chips (`more-left`/`more-right` on `#chips-wrap`, also driving the edge fades; hidden on `hover:none`). The collections page switches to sections (Featured / groups / Other) only when some group exists.
- **Redirects** (D21): `data.redirects` maps old page paths to current ones. `updateCollection` adds one when a collection's `slug` changes, `renameGroup` (`POST /api/groups/rename`, matched by group slug, can merge groups) when a group's slug changes. No chains; a path that becomes a live page again drops its redirect. `buildSite()` writes a small page at every old path (meta refresh + `location.replace`, `noindex`, the target's OG tags) only while the target exists. A title rename never changes a collection's slug.
- **Contact e-mail** (D26): the admin input `contactEmail` is write-only; `settings.contact = { user, domain }` is what gets stored, `data.json` carries `settings.contact = { u, d }`, and `app.js` joins them into the `mailto:` of the profile's *Email* link. The whole address must never appear in `data/` or `docs/` (a test greps every file). Mail itself is Cloudflare Email Routing → the owner's Gmail.
- Optional **Cloudflare Web Analytics** (D18): `settings.analyticsToken` → `{{ANALYTICS}}` in the template becomes a loader that skips localhost/127.0.0.1, so the admin preview is never counted. Cookieless. The only third-party script on the site, by the owner's decision.
- Each shell has its own Open Graph tags (absolute URLs only when `settings.siteUrl` is set). `app.js` fetches `data.json?v=<hash>` and renders client-side. Navigation uses `pushState` between URLs that exist as real files, so deep links work on GitHub Pages without SPA 404 tricks.
- Masonry grid: JS puts each photo into the shortest column (keeps left-to-right order, no layout shift thanks to known aspect ratios). 3/2/1 columns at ≥1000/≥560/<560 px. Batches of 24 via IntersectionObserver.
- Lightbox has its own URL (`f/<id>/`), keyboard/swipe navigation, share button (Web Share on touch, clipboard otherwise).

### Data model (`data/gallery.json`)

```jsonc
{
  "settings": { "name", "bio", "links": [{ "label", "url" }], "siteUrl", "customDomain",
                "coverPhotoId", "avatar", "avatarVersion", "sort": "taken" | "added", "copyright",
                "order": null | ["<photoId>"] },                                  // custom order of "Vše"
  "collections": [{ "id", "slug", "title", "description", "coverId",
                    "starred": bool, "group": "", "order": null | ["<photoId>"] }],   // kept sorted (store.mjs collectionOrder): starred first, then by group, ungrouped last, title within; `order` = photos inside
  "photos": [{ "id", "originalName", "addedAt", "takenAt", "title", "description", "location",
               "keywords", "collections": ["<collectionId>"], "exif": { "camera", "lens", "focal", "aperture", "shutter", "iso" },
               "width", "height", "widths": [..], "format", "color", "bytes",
               "sourceHash", "version", "replacedAt" }]   // last three only after a replace (see invariant 8)
}
```

**Photo order** (PLAN phase 4): every list (`settings.order` for "Vše", `collection.order` per collection) is automatic by `settings.sort` while `null`, and a stored id array after the first manual move. Photos missing from a stored array (new uploads, newly added to the collection) come **first**. Stored arrays are pruned when a photo is deleted or leaves a collection. `data.json` carries the main order as the order of `photos` and each collection's order as `collections[].photos` (ids); `app.js` must not re-derive a collection by filtering the main list.

`docs/data.json` is the public projection (`publicData()` in `build.mjs`). It uses collection **slugs** instead of ids and drops `originalName`, `keywords`, `bytes`, `addedAt`. Only fields in the `*_EDITABLE` whitelists in `gallery.mjs` can be changed through the API.

## Invariants (do not break)

1. **Originals never enter the repo.** Only derivatives in `docs/img/<id>/`. The repo is public and GitHub Pages recommends ≤ 1 GB.
2. **Published images carry no metadata from the original. Never GPS.** sharp strips everything by default. Never add `keepMetadata()`, `keepExif()` or `withMetadata()` to the web outputs. The only allowed tags are `IFD0.Artist` and `IFD0.Copyright`, written explicitly with `withExif()` (PLAN.md D11, phase 1b). Values come from `settings.name` / `settings.copyright`; empty copyright = no EXIF at all. EXIF text is ASCII, so libvips transliterates ("Posta", "(C)"). libvips also adds harmless structural tags (Orientation 1, resolution, pixel dimensions). After a name/copyright change, `rewriteAuthor()` swaps only the EXIF block of existing files (WebP RIFF chunk / JPEG APP1) without re-encoding; the block comes from libvips so it matches new uploads. Every rewrite adds all images to git history again, so it is an explicit, confirmed action. GPS must not appear anywhere public: files, `data.json` or pages (D12). Tests check this.
3. **`docs/` is generated.** Change `site/` or `lib/build.mjs`, then rebuild. `buildSite()` deletes pages of removed photos/collections.
4. **All public URLs are relative to `{{ROOT}}`.** The site must work both at `www.martinposta.com/foto/` (subpath) and `foto.martinposta.com/` (root). Never use absolute `/…` paths in `site/`.
5. **Admin stays local-only:** bind `127.0.0.1`, Host allow-list, Origin check on non-GET. No auth exists, so none of this may be relaxed.
6. **Do not set `GIT_TERMINAL_PROMPT=0`** when spawning git. Git Credential Manager (Windows and macOS) would suppress the GitHub sign-in window. On macOS, how git authenticates to GitHub (SSH key, or GCM) is decided in PLAN.md phase 1.
7. **Changing `IMAGE` settings only affects new uploads.** Originals aren't stored, so existing photos can't be re-rendered at a larger size. Downsizing or format conversion from the existing 2400 px derivative is possible but lossy. Warn the user before such changes.
8. Photo ids are the content hash of the **first** upload and never change afterwards: `/f/<id>/` links get shared. Uploading the same file again returns `duplicate: true` and only adds the collection. **Replacing** a photo's file (`POST /api/photos/:id/replace`, PLAN phase 2b) keeps the id and every owner-written field, stores the new file's hash in `sourceHash` (duplicate detection checks `id` and `sourceHash`) and bumps `version`. Derivatives keep their file names, so every image URL carries `?v=<version>` (`v` in `data.json`, `og.jpg?v=` in OG tags, admin thumbnails) — drop it and browsers/Pages CDN keep showing the old version. New files are generated under `<id>.new` and moved in only on success.
9. Keep `data/gallery.json` human-readable (2-space JSON). The user may edit or back it up by hand.

## Testing

- `npm test` starts the real admin server on port 4399 against a temp `GALLERY_DATA_ROOT` with its own git repo and a bare "origin". It covers upload/metadata/orientation/dedupe, collections and slugs, page generation, OG tags, CNAME, security checks, publish, and delete. Add a test for every new API behaviour.
- Visual checks: `npm run admin`, then open `/preview/`. For screenshots use Playwright if it is available (not a project dependency). Check desktop 1440 px and mobile 390 px, the lightbox, and collection pages.
- The front-ends have no unit tests. Keep logic that needs testing in `lib/`.

## Git

- The user's repo has `origin` = their GitHub repo. The admin's Publish button is the normal way to commit/push content. Commit **code** changes only when the user asks. Commit messages about code are in English.
- Don't commit `node_modules/`, `data/*.tmp`, or anything outside the project.
