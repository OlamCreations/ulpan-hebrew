/* chords-ui-check.mjs — drives a real browser over the real song pages.
 *
 * The Node suite (tools/chords-test.mjs) proves the harmony. This proves the page:
 * that the shared module loads at the right path from one folder deep, that the
 * shuffle button rewrites the grid, that every chord it produces gets a diagram,
 * that a tuning change is honoured, and that one song's grid no longer overwrites
 * another's.
 *
 * Needs the dev server:  node tools/serve.mjs 8912
 * Usage:                 node tools/chords-ui-check.mjs [--base http://localhost:8912]
 */
import { chromium } from 'playwright-core';

const baseArg = process.argv.indexOf('--base');
const BASE = baseArg >= 0 ? process.argv[baseArg + 1] : 'http://localhost:8912';

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const jsErrors = [];
const badResponses = [];
page.on('pageerror', e => jsErrors.push(e.message));
// The message text of a failed-resource error names no URL, so keep the location:
// without it the only way to ignore the favicon would be to ignore every 404.
page.on('console', m => {
  if (m.type() !== 'error') return;
  const where = (m.location() && m.location().url) || '';
  jsErrors.push('console: ' + m.text() + (where ? ' @ ' + where : ''));
});
// A bare "404 (Not Found)" in the console names nothing, so record the URL too.
page.on('response', r => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url()); });

async function open(file) {
  await page.goto(`${BASE}/liturgy/${file}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cx-shuffle', { timeout: 8000 });
}

// The chord popup opens on hover and closes only on × or an outside click, which
// is the behaviour the pages have always had. Left open it covers the shuffle bar
// and swallows the clicks below it.
async function dismissPopup() {
  const tt = page.locator('.chord-tooltip');
  if (await tt.count()) {
    await tt.locator('.tt-close').first().click().catch(() => {});
    await page.mouse.move(5, 5);
    await page.mouse.click(5, 5);
    await page.waitForTimeout(80);
  }
}

console.log('\n1. The page builds its chart');
await open('songs-001-hatikvah-en.html');

check('shuffle bar is present', await page.locator('#cx-shuffle').isVisible());
check('play button is present', await page.locator('#cx-play').isVisible());

const grid0 = (await page.locator('#progression-display').innerText()).trim();
check('grid shows this song\'s own progression', /Dm/.test(grid0) && /Gm/.test(grid0) && !/Em/.test(grid0), grid0);

const cards0 = await page.locator('#active-voicings-grid .voicing-card').count();
check(`voicing panel rendered (${cards0} cards)`, cards0 >= 3);
check('no card says "no playable shape"', (await page.locator('.voicing-empty').count()) === 0);
check('diagrams are drawn as SVG', (await page.locator('#active-voicings-grid svg').count()) >= 3);

console.log('\n2. Nothing on screen is still in French');
{
  // Scoped to the chord chart and the popup, which is what was translated.
  await page.locator('#progression-display .chord').first().hover();
  await page.waitForSelector('.chord-tooltip', { timeout: 4000 });
  await page.locator('.tt-action-btn[data-mode="harmonic"]').click();
  await page.waitForTimeout(150);
  const text = (await page.locator('.t-chord').innerText()) + ' ' + (await page.locator('.chord-tooltip').innerText());
  const french = ['doigté', 'accord', 'harmonique', 'Diatonique', 'Quintes', 'barré', 'Aucun', 'annuler',
    'ajouter', 'remplacer', 'vider', 'supprimer', 'voisins', 'accordage', 'Épingler', 'Retirer', 'couleur'];
  const found = french.filter(w => text.toLowerCase().includes(w.toLowerCase()));
  check('chord chart and popup carry no French', found.length === 0, found.join(', '));
  check('popup shows harmonic neighbours', (await page.locator('.tt-harm-item').count()) > 0);
  // The popup opens on hover and closes only on × or an outside click. Left open
  // it sits over the shuffle bar and eats the clicks below, so dismiss it here.
  await dismissPopup();
}

console.log('\n3. Shuffle');
for (let i = 0; i < 6; i++) {
  const before = (await page.locator('#progression-display').innerText()).trim();
  await page.locator('#cx-shuffle').click();
  await page.waitForTimeout(120);
  const after = (await page.locator('#progression-display').innerText()).trim();
  if (i === 0) {
    check('shuffle rewrites the grid', before !== after, `${before} -> ${after}`);
    check('shuffle explains itself', await page.locator('#cx-note').isVisible());
    const note = await page.locator('#cx-note').innerText();
    check('explanation names a key and a strategy', /·/.test(note) && note.length > 60, note.slice(0, 80));
  }
  const empty = await page.locator('.voicing-empty').count();
  if (empty > 0) { check(`shuffle ${i + 1}: every chord is drawable`, false, after); break; }
  if (i === 5) check('6 shuffles: every chord drawable each time', true);
}

{
  const r = await page.evaluate(() => window.ChordChart.shuffleResult());
  check('shuffle result exposes mode + strategy + explanation',
    !!(r && r.mode && r.strategy && r.explain && r.degreeLine),
    r ? `${r.mode}/${r.strategy}` : 'null');
}

console.log('\n4. Forcing a mode');
{
  const modeValues = await page.$$eval('#cx-mode option', els => els.map(e => e.value));
  check('Jewish modes are offered on a minor-key song',
    modeValues.includes('ahava-rabbah') && modeValues.includes('mi-sheberach'), modeValues.join(','));
  await page.selectOption('#cx-mode', 'ahava-rabbah');
  await page.waitForTimeout(80);
  const opts = await page.locator('#cx-strategy option').allInnerTexts();
  check('strategy list narrows to the chosen mode', opts.some(o => /Yiddish|Freygish/i.test(o)), opts.join(','));
  await page.locator('#cx-shuffle').click();
  await page.waitForTimeout(120);
  const r = await page.evaluate(() => window.ChordChart.shuffleResult());
  check('forced mode is honoured', r && r.mode === 'ahava-rabbah', r && r.mode);

  // The bII chord is what makes freygish audible, but only the strategies built on
  // it are obliged to use it: an Andalusian cadence in freygish is I-bvii-bVI+-V
  // and contains no bII, which is correct. So pin the strategy before asserting.
  await page.selectOption('#cx-strategy', 'yiddish-cadence');
  await page.locator('#cx-shuffle').click();
  await page.waitForTimeout(120);
  const grid = await page.locator('#progression-display').innerText();
  check('the Yiddish cadence really lands on the bII chord (Eb in D freygish)', /Eb/.test(grid), grid);
}

console.log('\n5. Undo');
{
  await page.locator('#cx-keep').click();
  await page.waitForTimeout(100);
  check('undo restores the previous grid', !(await page.locator('#cx-note').isVisible()));
  await page.locator('#prog-reset').click();
  await page.waitForTimeout(100);
  const back = (await page.locator('#progression-display').innerText()).trim();
  check('restore default brings back the song grid', /Dm/.test(back) && /Gm/.test(back), back);
}

console.log('\n6. Tuning');
{
  await page.selectOption('#tuning-preset', 'dadgad');
  await page.waitForTimeout(300);
  check('a non-standard tuning is flagged', await page.locator('#cx-tuning-note').isVisible());
  const note = await page.locator('#cx-tuning-note').innerText();
  check('the flag names the tuning', /D A D G A D/.test(note), note);
  check('diagrams still render in DADGAD', (await page.locator('#active-voicings-grid svg').count()) >= 3);
  // The string labels under each diagram must be the new tuning, not EADGBE.
  const labels = await page.$$eval('#active-voicings-grid svg text', els => els.map(e => e.textContent));
  check('string labels follow the tuning', labels.includes('D') && !labels.includes('B'),
    'labels: ' + [...new Set(labels)].join(' '));
  await page.selectOption('#tuning-preset', 'standard');
  await page.waitForTimeout(250);
  check('standard tuning clears the flag', !(await page.locator('#cx-tuning-note').isVisible()));
}

console.log('\n7. One song no longer overwrites another');
{
  await open('songs-001-hatikvah-en.html');
  await page.locator('#cx-shuffle').click();
  await page.waitForTimeout(150);
  const hatikvah = (await page.locator('#progression-display').innerText()).trim();

  await open('songs-004-hava-nagila-en.html');
  const nagila = (await page.locator('#progression-display').innerText()).trim();
  check('Hava Nagila keeps its own grid after Hatikvah was shuffled',
    nagila !== hatikvah && /Dm/.test(nagila), `hatikvah="${hatikvah}" nagila="${nagila}"`);

  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('chords:prog')));
  check('progressions are stored per song', keys.length >= 1 && keys.every(k => k !== 'chords:prog:'),
    keys.join(','));
  check('the old shared key is not written', !(await page.evaluate(() => localStorage.getItem('tehilim-progression'))));
}

console.log('\n8. All seven song pages');
for (const f of [
  'songs-001-hatikvah-en.html', 'songs-002-yerushalayim-shel-zahav-en.html',
  'songs-003-shalom-aleichem-en.html', 'songs-004-hava-nagila-en.html',
  'songs-005-al-hanissim-en.html', 'songs-006-az-yashir-en.html',
  'songs-007-sharei-shomayim-en.html'
]) {
  await open(f);
  await dismissPopup();
  const cards = await page.locator('#active-voicings-grid .voicing-card').count();
  const empty = await page.locator('.voicing-empty').count();
  const cfg = await page.evaluate(() => window.SONG_CHORDS);
  await page.locator('#cx-shuffle').click();
  await page.waitForTimeout(120);
  const emptyAfter = await page.locator('.voicing-empty').count();
  check(`${f.replace('songs-', '').replace('-en.html', '')}: ${cards} chords, key ${cfg.key}, shuffle clean`,
    cards >= 2 && empty === 0 && emptyAfter === 0, `empty ${empty}/${emptyAfter}`);
}

console.log('\n9. Playback wiring');
{
  await open('songs-001-hatikvah-en.html');
  const ok = await page.evaluate(() => {
    try {
      const a = window.ChordChart.audio;
      const ctx = a.context();
      if (!ctx) return 'no AudioContext';
      const buf = a.buffer(45);                       // open A string
      if (!buf || buf.length < 1000) return 'empty buffer';
      const d = buf.getChannelData(0);
      let energy = 0;
      for (let i = 0; i < 2000; i++) energy += Math.abs(d[i]);
      if (energy < 1) return 'buffer is silent';
      let tail = 0;
      for (let i = d.length - 3000; i < d.length; i++) tail += Math.abs(d[i]);
      if (tail > energy) return 'note does not decay';
      return true;
    } catch (e) { return e.message; }
  });
  check('plucked-string synthesis produces a decaying tone', ok === true, String(ok));
}

console.log('\n11. The chart speaks the language of its page');
{
  // Ten copies of the psalms are French pages (lang="fr") and used to carry a
  // French copy of the engine. Shipping one shared English module to them would
  // just mirror the mismatch this work set out to remove.
  await open('tehilim-001.html');
  const lang = await page.evaluate(() => document.documentElement.lang);
  check('tehilim-001.html is a French page', lang === 'fr', lang);

  const bar = await page.locator('.cx-bar').innerText();
  check('shuffle bar is in French on a French page', /mélanger/.test(bar) && /écouter/.test(bar), bar.replace(/\n/g, ' '));

  await page.locator('#cx-shuffle').click();
  await page.waitForTimeout(150);
  const note = await page.locator('#cx-note').innerText();
  check('the explanation is in French too', /tonique|accord|cadence|mode|mineur|majeur/i.test(note), note.slice(0, 90));

  await page.locator('#progression-display .chord').first().hover();
  await page.waitForSelector('.chord-tooltip', { timeout: 4000 });
  const tip = await page.locator('.chord-tooltip').innerText();
  check('the chord popup is in French', /doigté|voisins|remplacer/i.test(tip), tip.replace(/\n/g, ' ').slice(0, 90));
  await dismissPopup();

  // And the English page must not have become French in the process.
  await open('tehilim-001-en.html');
  const enBar = await page.locator('.cx-bar').innerText();
  check('the English copy of the same psalm stays English',
    /shuffle/.test(enBar) && !/mélanger/.test(enBar), enBar.replace(/\n/g, ' '));
}

console.log('\n10. Console');
// Chrome asks for /favicon.ico on its own and the site does not ship one. That
// 404 predates this work and has nothing to do with the chord chart, so it is
// the ONLY thing excluded here; anything else still fails the run.
const isFavicon = s => /favicon\.ico/.test(s);
const realBad = badResponses.filter(s => !isFavicon(s));
const realErrors = jsErrors.filter(s => !isFavicon(s));
check('every request succeeded (favicon.ico excluded)', realBad.length === 0, realBad.slice(0, 4).join(' | '));
check('no JavaScript errors across the run', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`);
if (fail > 0) { console.log('\nFailures:\n  - ' + failures.join('\n  - ')); process.exit(1); }
