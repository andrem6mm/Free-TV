#!/usr/bin/env node
// Smoke-test / screenshot tool shared by the tester and ui-designer agents.
// Serves the repo, loads it in headless Chromium with the fixture playlist, and prints a
// compact result so agents don't burn tokens writing Playwright boilerplate.
//
//   node .claude/tools/smoke.mjs [--widths 390,1280] [--live] [--eval "<js expr>"] [--click "<css>"]
//
// --live       use the real iptv-org playlist instead of tests/fixtures/sample.m3u
// --eval       evaluate an expression in the page after load and print the result
// --click      click a selector after load (repeatable), before screenshots
// Screenshots go to .orchestration/shots/<width>.png. Exit code 1 if the page logged errors.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const all = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const widths = opt('--widths', '390,1280').split(',').map(Number);
const live = args.includes('--live');
const evalExpr = opt('--eval');
const clicks = all('--click');

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch {
  try { playwright = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch {
    console.error('playwright not found: npm i -g playwright (or npx playwright install chromium)');
    process.exit(2);
  }
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.m3u': 'audio/x-mpegurl' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = p.endsWith(path.sep) ? path.join(p, 'index.html') : p;
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const outDir = path.join(root, '.orchestration/shots');
fs.mkdirSync(outDir, { recursive: true });
const browser = await playwright.chromium.launch();
const errors = [];
try {
  for (const width of widths) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 800 }, serviceWorkers: 'block', isMobile: width < 600, hasTouch: width < 600 });
    if (!live) await ctx.route(/\.m3u(\?|$)/, (r) => r.fulfill({ path: path.join(root, 'tests/fixtures/sample.m3u'), contentType: 'audio/x-mpegurl' }));
    await ctx.route(/\.m3u8(\?|$)/, (r) => r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[${width}] pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/m3u8|ERR_FAILED|example\.invalid/.test(m.text())) errors.push(`[${width}] console: ${m.text()}`); });
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => !/Loading|Downloading/.test(document.getElementById('count')?.textContent || ''), null, { timeout: live ? 90000 : 10000 }).catch(() => errors.push(`[${width}] channel list never finished loading`));
    for (const sel of clicks) await page.click(sel, { timeout: 3000 }).catch((e) => errors.push(`[${width}] click ${sel}: ${e.message.split('\n')[0]}`));
    const count = await page.textContent('#count').catch(() => '?');
    const items = await page.locator('#channels > *').count();
    const shot = path.join(outDir, `${width}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    let evalOut = '';
    if (evalExpr) evalOut = ' eval=' + JSON.stringify(await page.evaluate(evalExpr).catch((e) => 'ERROR ' + e.message));
    console.log(`width=${width} count="${count.trim()}" listItems=${items} shot=${path.relative(root, shot)}${evalOut}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.log('ERRORS:\n' + errors.slice(0, 20).join('\n')); process.exit(1); }
console.log('OK: no page errors');
