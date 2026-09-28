// Image processing: turns an uploaded original (JPEG/PNG/...) into web-optimized
// derivatives in docs/img/<id>/ and extracts metadata for the photo record.
// Originals are never stored — only the resized, metadata-stripped copies.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';
import { IMAGE, PATHS } from './config.mjs';

sharp.cache(false); // keep memory flat when processing many large files

// ---------- metadata ----------

const JUNK_TEXT = /^(olympus digital camera|sony dsc|digital camera|default|untitled|image|\s*)$/i;

// exifr decodes IPTC as latin1; photo apps usually write UTF-8. Repair mojibake like "Å umava".
function fixMojibake(str) {
  if (typeof str !== 'string' || !/[À-ß][\u0080-¿]/.test(str)) return str;
  const fixed = Buffer.from(str, 'latin1').toString('utf8');
  return fixed.includes('�') ? str : fixed;
}

function textValue(v) {
  if (v == null) return '';
  // Windows XP* tags (XPTitle, XPComment...) come as UTF-16LE byte arrays.
  if ((Array.isArray(v) || v instanceof Uint8Array) && v.length && typeof v[0] === 'number') {
    return textValue(Buffer.from(v).toString('utf16le').replace(/\u0000+$/, ''));
  }
  if (Array.isArray(v)) return textValue(v[0]);
  if (typeof v === 'object') return textValue(v.value ?? v['x-default'] ?? Object.values(v)[0]);
  const s = fixMojibake(String(v)).replace(/\u0000/g, '').trim();
  return JUNK_TEXT.test(s) ? '' : s;
}

function firstText(meta, keys) {
  for (const k of keys) {
    const t = textValue(meta[k]);
    if (t) return t;
  }
  return '';
}

function listValue(v) {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[;,]/);
  return [...new Set(arr.map(textValue).filter(Boolean))];
}

// "2025:01:03 10:20:00" -> "2025-01-03T10:20:00" (naive local time, no timezone games)
function exifDate(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m || m[1] === '0000') return '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`;
}

function formatShutter(t) {
  if (!t) return '';
  if (t >= 1) return `${Math.round(t * 10) / 10} s`;
  return `1/${Math.round(1 / t)} s`;
}

// Files that passed through another app can carry its name instead of the camera's
// (an iPhone photo edited via Photoshop/TIFF: Make "Adobe Systems Inc.", Model "Tiff File").
const SOFTWARE_CAMERA = /^(adobe|tiff file|capture one|photoshop|lightroom)\b/i;

function formatCamera(make, model) {
  make = textValue(make); model = textValue(model);
  if (SOFTWARE_CAMERA.test(make)) make = '';
  if (SOFTWARE_CAMERA.test(model)) model = '';
  if (!model) return make;
  // Avoid "Canon Canon EOS R6" / "NIKON CORPORATION NIKON Z 6"
  const brand = make.split(/\s+/)[0] || '';
  if (brand && model.toLowerCase().startsWith(brand.toLowerCase())) return model;
  const niceBrand = brand.length > 3 && brand === brand.toUpperCase()
    ? brand[0] + brand.slice(1).toLowerCase() : brand;
  return `${niceBrand} ${model}`.trim();
}

export async function readMetadata(buf) {
  let meta = {};
  try {
    meta = await exifr.parse(buf, {
      tiff: true, exif: true, iptc: true, xmp: true,
      gps: false, icc: false, jfif: false, ihdr: false, interop: false,
      reviveValues: false, translateValues: false, mergeOutput: true,
    }) || {};
  } catch { /* files without metadata are fine */ }

  // Phones without lens data get a placeholder from the editor ("-- mm f/--" from Capture One).
  const lens = [meta.LensModel, meta.Lens].map(textValue).find(v => v && /[A-Za-z0-9]/.test(v.replace(/\bmm\b|\bf\//g, ''))) || '';
  // Phones name the device in the lens ("iPhone 11 back dual wide camera 4.25mm f/1.8"),
  // which is all that is left when the camera tags were overwritten by an editor.
  const phone = lens.match(/^(iPhone.*?)\s+(back|front)\b/i)?.[1] || '';
  const focal = Number(meta.FocalLength) || 0;
  const aperture = Number(meta.FNumber) || 0;
  return {
    title: firstText(meta, ['title', 'ObjectName', 'Headline', 'XPTitle']),
    description: firstText(meta, ['description', 'Caption', 'Caption-Abstract', 'ImageDescription', 'XPComment', 'XPSubject']),
    keywords: listValue(meta.subject || meta.Keywords || meta.XPKeywords),
    // Sublocation first: it is the specific place ("Boubín"). Capture One and Lightroom write it
    // as Iptc4xmpCore:Location (XMP) and Sub-location (IPTC).
    location: [...new Set([
      textValue(meta.Location || meta['Sub-location']),
      textValue(meta.City || meta.city),
      textValue(meta.Country || meta.country || meta['Country-PrimaryLocationName']),
    ].filter(Boolean))].join(', '),
    takenAt: exifDate(meta.DateTimeOriginal || meta.CreateDate || meta.DateTimeDigitized || meta.ModifyDate),
    exif: {
      camera: formatCamera(meta.Make, meta.Model) || phone,
      lens,
      focal: focal ? `${Math.round(focal)} mm` : '',
      aperture: aperture ? `f/${Math.round(aperture * 10) / 10}` : '',
      shutter: formatShutter(Number(meta.ExposureTime)),
      iso: meta.ISO ? `ISO ${Array.isArray(meta.ISO) ? meta.ISO[0] : meta.ISO}` : '',
    },
  };
}

// ---------- derivatives ----------

// A draft's derivatives live in drafts/img/ (outside git and docs/, D24), a published photo's in
// docs/img/. Publishing or taking a photo back moves the folder, nothing is re-encoded.
export function photoDir(id, draft = false) {
  return path.join(draft ? PATHS.draftImg : PATHS.img, id);
}

export async function movePhotoBetween(id, toDraft) {
  const to = photoDir(id, toDraft);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rm(to, { recursive: true, force: true });
  await fs.rename(photoDir(id, !toDraft), to);
}

export function hashBuffer(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
}

export function targetWidths(w, h) {
  // Cap the long edge; portrait photos therefore get narrower largest width.
  const maxW = Math.min(w, h > w ? Math.round(IMAGE.maxLongEdge * w / h) : IMAGE.maxLongEdge);
  // A standard width within 15 % of the largest adds a near-copy (1600 next to 1619), not a useful step.
  const widths = IMAGE.widths.filter(tw => tw < maxW * 0.85);
  widths.push(maxW);
  return [...new Set(widths)].sort((a, b) => a - b);
}

async function averageColor(pipeline) {
  const { data } = await pipeline.clone().resize(1, 1, { fit: 'fill' }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return '#' + [...data.subarray(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// The only metadata a web copy may carry (D11): author and copyright, set explicitly.
// withExif() replaces the EXIF block, so nothing from the original (GPS, serial numbers,
// software) comes along. Never switch to keepExif()/withMetadata(), they copy the original's.
// EXIF text is ASCII: libvips transliterates, so "Pošta" is stored as "Posta" and "©" as "(C)".
function authorExif({ artist = '', copyright = '' } = {}) {
  if (!copyright) return null;
  return { IFD0: { Copyright: copyright, ...(artist ? { Artist: artist } : {}) } };
}

/**
 * Process an original image buffer into docs/img/<id>/.
 * `author` = { artist, copyright }; empty copyright = no metadata at all.
 * Returns the fields needed for the photo record (without user-edited fields).
 */
export async function processImage(buf, id, author, { draft = false } = {}) {
  const exif = authorExif(author);
  const tag = pipeline => (exif ? pipeline.withExif(exif) : pipeline);
  // .rotate() with no args applies EXIF orientation; output is stripped of all metadata (incl. GPS).
  const base = sharp(buf, { failOn: 'none', limitInputPixels: 300e6 }).rotate();
  const m = await sharp(buf, { failOn: 'none' }).metadata();
  const swap = (m.orientation || 1) >= 5;
  const W = m.autoOrient?.width ?? (swap ? m.height : m.width);
  const H = m.autoOrient?.height ?? (swap ? m.width : m.height);

  const dir = photoDir(id, draft);
  await fs.mkdir(dir, { recursive: true });

  const widths = targetWidths(W, H);
  const fmt = IMAGE.format;
  let bytes = 0;
  for (const w of widths) {
    const out = path.join(dir, `${w}.${fmt}`);
    const res = await tag(base.clone())
      .resize({ width: w, withoutEnlargement: true })
      .toFormat(fmt, fmt === 'avif' ? { quality: IMAGE.quality - 22, effort: 4 } : { quality: IMAGE.quality, effort: 5, smartSubsample: true })
      .toFile(out);
    bytes += res.size;
  }
  if (IMAGE.og.enabled) {
    const res = await tag(base.clone())
      .resize({ width: Math.min(IMAGE.og.width, W), height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: IMAGE.og.quality, mozjpeg: true })
      .toFile(path.join(dir, 'og.jpg'));
    bytes += res.size;
  }

  return {
    width: W,
    height: H,
    widths,
    format: fmt,
    color: await averageColor(base),
    bytes,
  };
}

export async function processAvatar(buf) {
  const file = path.join(PATHS.img, 'avatar.webp');
  await fs.mkdir(PATHS.img, { recursive: true });
  await sharp(buf, { failOn: 'none' }).rotate()
    .resize(IMAGE.avatarSize, IMAGE.avatarSize, { fit: 'cover', position: 'attention' })
    .webp({ quality: 85 })
    .toFile(file);
  return 'img/avatar.webp';
}

export async function removePhotoFiles(id) {
  // Both places: a photo is in exactly one, and a leftover in the other would be an orphan.
  await fs.rm(photoDir(id, false), { recursive: true, force: true });
  await fs.rm(photoDir(id, true), { recursive: true, force: true });
}

// ---------- rewriting author metadata without re-encoding ----------
// When the name or copyright changes, existing web copies are fixed by swapping only their
// EXIF block: the compressed image data stays byte for byte the same (no quality loss, no
// originals needed). The block is produced by libvips exactly as processImage() would write it.

async function authorExifBlock(author, w, h) {
  const exif = authorExif(author);
  if (!exif) return null;
  const probe = await sharp({ create: { width: w, height: h, channels: 3, background: '#000' } })
    .withExif(exif).jpeg({ quality: 10 }).toBuffer();
  return (await sharp(probe).metadata()).exif; // "Exif\0\0" + TIFF, as libvips stores it in WebP and JPEG
}

function webpWithExif(buf, exif, w, h) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error('Not a WebP file');
  const chunks = [];
  for (let o = 12; o + 8 <= buf.length;) {
    const size = buf.readUInt32LE(o + 4);
    chunks.push({ id: buf.toString('latin1', o, o + 4), data: buf.subarray(o + 8, o + 8 + size) });
    o += 8 + size + (size & 1);
  }
  let vp8x = chunks.find(c => c.id === 'VP8X');
  if (!vp8x && !exif) return buf;
  if (!vp8x) { // simple WebP (written without metadata): EXIF needs the extended header
    const d = Buffer.alloc(10);
    d.writeUIntLE(w - 1, 4, 3); d.writeUIntLE(h - 1, 7, 3);
    vp8x = { id: 'VP8X', data: d };
    chunks.unshift(vp8x);
  }
  vp8x.data = Buffer.from(vp8x.data);
  vp8x.data[0] = exif ? vp8x.data[0] | 0x08 : vp8x.data[0] & ~0x08;
  const out = chunks.filter(c => c.id !== 'EXIF');
  if (exif) out.push({ id: 'EXIF', data: exif }); // metadata goes after the image data
  const parts = out.flatMap(c => {
    const head = Buffer.alloc(8);
    head.write(c.id, 0, 'latin1'); head.writeUInt32LE(c.data.length, 4);
    return c.data.length & 1 ? [head, c.data, Buffer.alloc(1)] : [head, c.data];
  });
  const body = Buffer.concat(parts);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1'); riff.writeUInt32LE(4 + body.length, 4); riff.write('WEBP', 8, 'latin1');
  return Buffer.concat([riff, body]);
}

function jpegWithExif(buf, exif) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Not a JPEG file');
  const segs = [];
  let o = 2;
  while (buf[o] === 0xff && buf[o + 1] !== 0xda) {
    const len = buf.readUInt16BE(o + 2);
    segs.push({ marker: buf[o + 1], bytes: buf.subarray(o, o + 2 + len) });
    o += 2 + len;
  }
  const isExif = s => s.marker === 0xe1 && s.bytes.toString('latin1', 4, 10) === 'Exif\0\0';
  const kept = segs.filter(s => !isExif(s)).map(s => s.bytes);
  if (exif) {
    const head = Buffer.from([0xff, 0xe1, 0, 0]);
    head.writeUInt16BE(exif.length + 2, 2);
    kept.splice(segs[0]?.marker === 0xe0 ? 1 : 0, 0, head, exif); // after a JFIF header, if any
  }
  return Buffer.concat([buf.subarray(0, 2), ...kept, buf.subarray(o)]);
}

/** Rewrite Artist/Copyright in every web copy of a photo. Returns the number of files changed. */
export async function rewriteAuthor(id, author, { draft = false } = {}) {
  const dir = photoDir(id, draft);
  const blocks = new Map(); // one libvips probe per image size
  let changed = 0;
  for (const name of await fs.readdir(dir)) {
    const ext = path.extname(name).toLowerCase();
    if (!['.webp', '.jpg'].includes(ext)) continue;
    const file = path.join(dir, name);
    const buf = await fs.readFile(file);
    const { width: w, height: h } = await sharp(buf).metadata();
    if (!blocks.has(`${w}x${h}`)) blocks.set(`${w}x${h}`, await authorExifBlock(author, w, h));
    const exif = blocks.get(`${w}x${h}`);
    const out = ext === '.webp' ? webpWithExif(buf, exif, w, h) : jpegWithExif(buf, exif);
    if (out.equals(buf)) continue;
    await fs.writeFile(file + '.tmp', out);
    await fs.rename(file + '.tmp', file);
    changed++;
  }
  return changed;
}

// Put derivatives generated under a temporary id in place of a photo's current ones.
// Old files go entirely: a new crop can have a different set of widths.
export async function movePhotoFiles(fromId, toId, { draft = false } = {}) {
  await removePhotoFiles(toId);
  await fs.rename(photoDir(fromId, draft), photoDir(toId, draft));
}
