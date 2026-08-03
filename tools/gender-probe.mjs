/* Measures the accuracy of the single-word grammar chip in the live translator (quicksay.js
 * wireGnp) against hand-written ground truth.
 *
 * The chip states a word's gender to someone learning the language. A wrong gender is worse than
 * no gender: the learner repeats it aloud, and every adjective and verb they build on it inherits
 * the error. So the number that matters here is not accuracy — it is WRONG, which must stay 0.
 * Abstention (the Worker declining to guess on a Fem,Masc token) is a pass, not a miss.
 *
 * The truth list below is held out: it was written before any Worker output was inspected, and it
 * is nouns only, which is the population single-word lookups actually hit.
 *
 * Run: node tools/gender-probe.mjs
 */
const WORKER = 'https://ulpan-morph.olamcreations.workers.dev';

const TRUTH = [
  ['שולחן', 'm', 'table'],   ['דלת', 'f', 'door'],       ['ספר', 'm', 'book'],
  ['מיטה', 'f', 'bed'],      ['כוס', 'f', 'glass'],      ['בית', 'm', 'house'],
  ['עיר', 'f', 'city'],      ['ילד', 'm', 'boy'],        ['ילדה', 'f', 'girl'],
  ['מכונית', 'f', 'car'],    ['אוטובוס', 'm', 'bus'],    ['שמש', 'f', 'sun'],
  ['ארץ', 'f', 'country'],   ['לחם', 'm', 'bread'],      ['עוגה', 'f', 'cake'],
  ['חלון', 'm', 'window'],   ['רגל', 'f', 'leg'],        ['יד', 'f', 'hand'],
  ['ראש', 'm', 'head'],      ['כלב', 'm', 'dog'],        ['דרך', 'f', 'road'],
  ['אבן', 'f', 'stone'],     ['עץ', 'm', 'tree'],        ['שנה', 'f', 'year'],
  ['יום', 'm', 'day'],       ['אמא', 'f', 'mother'],     ['אבא', 'm', 'father'],
  ['חתול', 'm', 'cat'],      ['מפתח', 'm', 'key'],       ['תמונה', 'f', 'picture'],
];

const rows = [];
for (const [he, want, en] of TRUTH) {
  let got = '', pos = '', err = '';
  try {
    const r = await fetch(WORKER, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: he })
    });
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    const t = (j.tokens || []).find(x => x && !x.sep);
    if (!t) err = 'no token';
    else { pos = t.pos || ''; const m = /(^|\s)([mf])\./.exec(t.gnp || ''); got = m ? m[2] : ''; }
  } catch (e) { err = e.message; }
  rows.push({ he, en, want, got: got || '-', pos, err });
  await new Promise(r => setTimeout(r, 250));   // be a polite neighbour to the Worker
}

const reachable = rows.filter(r => !r.err);
const wrong = reachable.filter(r => r.got !== '-' && r.got !== r.want);
const right = reachable.filter(r => r.got === r.want);
const silent = reachable.filter(r => r.got === '-');

console.table(rows);
console.log(`\nreachable ${reachable.length}/${rows.length} · correct ${right.length} · `
  + `abstained ${silent.length} · WRONG ${wrong.length}`);
if (silent.length) console.log('abstained on: ' + silent.map(r => r.he).join(', '));

if (!reachable.length) { console.error('\nFAIL — Worker unreachable, nothing measured.'); process.exit(1); }
if (wrong.length) {
  console.error('\nFAIL — a wrong gender is shipped to a learner:\n'
    + wrong.map(r => `  ${r.he} (${r.en}): said ${r.got}, is ${r.want}`).join('\n'));
  process.exit(1);
}
console.log('\nPASS — 0 wrong. Every miss is an abstention, which shows no chip at all.');
