#!/usr/bin/env node
// Turns the XMLTV files written by the iptv-org/epg grabber into small JSON files the app
// can load one channel at a time:
//
//   guide/index.json        { updated, channels: { "<tvg-id>": "<file>.json" } }
//   guide/<file>.json       { id, updated, programmes: [{ s, e, t, st?, d?, c? }] }
//
// s / e are start / end times in Unix seconds, t the title, st the episode title,
// d a short description and c the first category.
//
// Usage: node scripts/build-guide.mjs <xmltv dir> <output dir> [--previous <site url>]
//
// The grabber writes one XMLTV file per site. When a channel comes from several sites, the
// one with the most upcoming programmes wins. With --previous, channels that came back
// empty this time keep the schedule from the live site while it still has upcoming shows,
// so one failed download doesn't wipe a channel's guide.

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const KEEP_PAST_S = 60 * 60;           // keep the show that's on now, even if it started earlier
const KEEP_AHEAD_S = 3 * 24 * 60 * 60; // and up to three days ahead
const MIN_AHEAD_S = 2 * 60 * 60;       // an old schedule is only reused while it covers the next 2 hours
const MAX_DESC = 280;

const args = process.argv.slice(2);
const prevIdx = args.indexOf('--previous');
const previous = prevIdx >= 0 ? args.splice(prevIdx, 2)[1] : '';
const [inDir, outDir] = args;
if (!inDir || !outDir) {
  console.error('Usage: node scripts/build-guide.mjs <xmltv dir> <output dir> [--previous <site url>]');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// XMLTV time: "20261007183000 +0300" (the offset may be missing, meaning UTC).
function parseTime(s) {
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-])?(\d\d)?(\d\d)?/.exec(s || '');
  if (!m) return NaN;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
  const offset = m[7] ? (m[7] === '-' ? -1 : 1) * ((+m[8] || 0) * 3600 + (+m[9] || 0) * 60) : 0;
  return utc - offset;
}

function child(body, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(body);
  return m ? decode(m[1]) : '';
}

function parseXMLTV(xml) {
  const byChannel = new Map();
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = decode(a[2]);
    const s = parseTime(attrs.start);
    const e = parseTime(attrs.stop);
    const t = child(m[2], 'title');
    if (!attrs.channel || !t || !(s < e) || e < now - KEEP_PAST_S || s > now + KEEP_AHEAD_S) continue;
    const p = { s, e, t };
    const st = child(m[2], 'sub-title');
    if (st && st !== t) p.st = st;
    let d = child(m[2], 'desc');
    if (d.length > MAX_DESC) d = d.slice(0, MAX_DESC - 1).replace(/\s+\S*$/, '') + '…';
    if (d) p.d = d;
    const c = child(m[2], 'category');
    if (c) p.c = c;
    if (!byChannel.has(attrs.channel)) byChannel.set(attrs.channel, []);
    byChannel.get(attrs.channel).push(p);
  }
  return byChannel;
}

function tidy(list) {
  // Sort and drop duplicates / overlaps (some sources repeat a show across day boundaries).
  list.sort((a, b) => a.s - b.s || a.e - b.e);
  const out = [];
  for (const p of list) {
    const last = out[out.length - 1];
    if (last && p.s < last.e) {
      if (p.s === last.s) continue;
      last.e = p.s;
    }
    out.push(p);
  }
  return out;
}

const upcoming = (list) => list.filter((p) => p.e > now).length;
const fileName = (id) => id.replace(/[^\w.-]+/g, '_') + '.json';

async function loadPrevious(base) {
  const prev = new Map();
  if (!base) return prev;
  base = base.replace(/\/?$/, '/') + 'guide/';
  try {
    const res = await fetch(base + 'index.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const index = await res.json();
    for (const [id, file] of Object.entries(index.channels || {})) {
      try {
        const r = await fetch(base + encodeURIComponent(file));
        if (r.ok) prev.set(id, (await r.json()).programmes || []);
      } catch { /* skip this channel */ }
    }
  } catch (err) {
    console.log(`No previous guide at ${base} (${err.message})`);
  }
  return prev;
}

const best = new Map(); // id -> { site, programmes }
let files = [];
try {
  files = (await readdir(inDir)).filter((f) => f.endsWith('.xml'));
} catch (err) {
  console.log(`No grabber output in ${inDir} (${err.message})`);
}
for (const f of files) {
  const site = path.basename(f, '.xml');
  for (const [id, list] of parseXMLTV(await readFile(path.join(inDir, f), 'utf8'))) {
    const programmes = tidy(list);
    const n = upcoming(programmes);
    console.log(`${site}: ${id} (${n} upcoming)`);
    if (n && (!best.has(id) || n > upcoming(best.get(id).programmes))) best.set(id, { site, programmes });
  }
}

for (const [id, list] of await loadPrevious(previous)) {
  if (best.has(id)) continue;
  const programmes = list.filter((p) => p.e > now);
  if (programmes.length && programmes[programmes.length - 1].e > now + MIN_AHEAD_S) {
    console.log(`previous: ${id} (${programmes.length} upcoming, kept from the live site)`);
    best.set(id, { site: 'previous', programmes });
  }
}

await mkdir(outDir, { recursive: true });
const index = { updated: now, channels: {} };
for (const [id, { programmes }] of [...best].sort(([a], [b]) => a.localeCompare(b))) {
  const file = fileName(id);
  index.channels[id] = file;
  await writeFile(path.join(outDir, file), JSON.stringify({ id, updated: now, programmes }));
}
await writeFile(path.join(outDir, 'index.json'), JSON.stringify(index));
console.log(`Wrote a guide for ${best.size} channel(s) to ${outDir}`);
