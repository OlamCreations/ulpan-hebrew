/* liturgy-pixel-check.mjs — prove a CSS refactor changed nothing on screen.
 *
 * Renders a sample of liturgy pages in both themes at three widths and stores
 * full-page PNGs. Run once BEFORE the refactor with --save, once AFTER with
 * --compare; the second run fails on any pixel that moved.
 *
 * A CSS extraction is exactly the kind of change that looks clean in a diff and
 * shifts a margin on 51 pages, so "the tests pass" is not evidence here. Pixels are.
 *
 * Needs the dev server:  node tools/serve.mjs 8912
 * Usage:
 *   node tools/liturgy-pixel-check.mjs --save      # write the baseline
 *   node tools/liturgy-pixel-check.mjs --compare   # fail on any difference
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SHOTS = join(ROOT, 'tools', 'reports', 'pixel');
const MODE = process.argv.includes('--compare') ? 'compare' : 'save';
const BASE = 'http://localhost:8912';

// One page per distinct <style> variant, plus a couple of extras. Chosen by
// tools/liturgy-css-groups.json so the sample cannot silently stop covering a
// variant when the grouping changes.
const SAMPLE = JSON.parse(readFileSync(join(ROOT, 'tools', 'liturgy-css-groups.json'), 'utf8')).sample;

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'tablet', width: 900, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
];

if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let shots = 0, diffs = [];

for (const theme of ['dark', 'light']) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await ctx.addInitScript(t => localStorage.setItem('theme', t), theme);
    const page = await ctx.newPage();
    for (const file of SAMPLE) {
      await page.goto(`${BASE}/liturgy/${file}`, { waitUntil: 'domcontentloaded' });
      // The chart draws after the vocabulary fetch; wait for it or for the
      // page to prove it has no chart at all.
      await page.waitForTimeout(900);
      // Freeze anything that animates, or the baseline compares noise.
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
      await page.waitForTimeout(150);
      const buf = await page.screenshot({ fullPage: true });
      const key = `${file.replace(/\.html$/, '')}__${theme}__${vp.name}.png`;
      const path = join(SHOTS, key);
      if (MODE === 'save') {
        writeFileSync(path, buf);
      } else {
        if (!existsSync(path)) { diffs.push(`${key}: no baseline`); continue; }
        const before = readFileSync(path);
        const same = before.length === buf.length &&
          createHash('sha1').update(before).digest('hex') === createHash('sha1').update(buf).digest('hex');
        if (!same) {
          writeFileSync(join(SHOTS, 'AFTER__' + key), buf);
          diffs.push(`${key}: ${before.length} -> ${buf.length} bytes`);
        }
      }
      shots++;
    }
    await ctx.close();
  }
}
await browser.close();

if (MODE === 'save') {
  console.log(`baseline written: ${shots} screenshots in tools/reports/pixel/`);
} else if (diffs.length) {
  console.log(`FAIL  ${diffs.length}/${shots} screenshots differ:`);
  for (const d of diffs.slice(0, 20)) console.log('  ' + d);
  console.log('\nAFTER__*.png written next to each baseline for eyeballing.');
  process.exit(1);
} else {
  console.log(`PASS  ${shots} screenshots pixel-identical to the baseline`);
}
