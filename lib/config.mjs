// Central paths and processing settings for the gallery.
// Tweak IMAGE settings here if you want different sizes or quality.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ROOT_DIR  = where the code lives (site/ template, admin/ UI).
// DATA_ROOT = where data/ and docs/ live and where git runs. Same folder in normal use;
//             tests point it at a temp dir via GALLERY_DATA_ROOT so real data is never touched.
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_ROOT = process.env.GALLERY_DATA_ROOT ? path.resolve(process.env.GALLERY_DATA_ROOT) : ROOT_DIR;

export const PATHS = {
  data: path.join(DATA_ROOT, 'data', 'gallery.json'), // source of truth (committed)
  siteSrc: path.join(ROOT_DIR, 'site'),               // public site template + assets
  docs: path.join(DATA_ROOT, 'docs'),                 // generated output served by GitHub Pages
  img: path.join(DATA_ROOT, 'docs', 'img'),
  drafts: path.join(DATA_ROOT, 'data', 'drafts.json'), // drafts' records, outside git (D24)
  draftImg: path.join(DATA_ROOT, 'drafts', 'img'),      // drafts' derivatives, outside git and outside docs/
  adminPublic: path.join(ROOT_DIR, 'admin', 'public'),
};

export const IMAGE = {
  // Widths generated for srcset. Portrait photos are capped by MAX_LONG_EDGE instead.
  widths: [480, 960, 1600, 2400],
  maxLongEdge: 2400,
  format: 'webp',        // 'webp' (safest) or 'avif' (smaller, slower to encode)
  quality: 82,
  // Small JPEG used for link previews (Messenger, WhatsApp, iMessage...).
  og: { enabled: true, width: 1200, quality: 80 },
  avatarSize: 256,
  acceptedExt: ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'],
};

export const ADMIN = {
  host: '127.0.0.1',     // bound to localhost only, never exposed to the network
  port: Number(process.env.PORT) || 4321,
};
