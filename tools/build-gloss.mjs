#!/usr/bin/env node
/*
 * build-gloss.mjs — compile a verified word-gloss dictionary from our own corpus.
 *
 * The breakdown glossed each word by asking Google to translate it ALONE. Out of context that
 * is a coin flip on Hebrew homographs, and it lost badly: שְׁמִי -> "Semitic" (my name),
 * אֶקְנֶה -> "acne" (I will buy), הַאִם -> "the mother" (the yes/no question particle),
 * עוֹבֵר -> "fetus" (passes), אֶת -> "you" (the accusative marker).
 *
 * Measured first, so the fix targets the real cause:
 *   - sending the VOCALIZED form instead of the bare one changes nothing (Google returns the
 *     identical gloss for שמי and שְׁמִי) — the problem is isolation, not vocalization
 *   - glossing Dicta's lemma trades one set of errors for another (שם -> "name" but
 *     קני -> "Kenny", עבר -> "past")
 *
 * What we do have is 7000+ hand-verified vocalized words across the phrasebook and 465 lessons,
 * each already carrying its meaning. Those are exactly the high-frequency words and function
 * words Google mangles worst. So: look them up before asking anyone.
 *
 * Keys are the FULLY VOCALIZED form, and ONLY that.
 *
 * A consonantal-skeleton fallback was built first and then removed, because the test caught it
 * lying: it emitted בשוק -> "in shock" as if unambiguous. The rule had been "keep a skeleton
 * when it has exactly one vocalization in the corpus" — but that measures ambiguity in OUR 7000
 * words, not in Hebrew. Our corpus happens to contain בְּשׁוֹק and not בַּשּׁוּק ("in the market"),
 * so the skeleton looked settled purely by absence. At this corpus size almost every skeleton
 * looks unambiguous, which makes the guard confidently wrong exactly where homographs live —
 * the failure this whole file exists to fix. Dicta hands us the vocalized form, so exact
 * matching is available and is the only safe key.
 *
 *   node tools/build-gloss.mjs [--max-len 60]
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, dataPath, cfg } from './paths.mjs';

const argMax = process.argv.indexOf('--max-len');
const MAX_LEN = argMax >= 0 ? Number(process.argv[argMax + 1]) : 60;

const strip = (s) => (s || '').replace(/[֑-ׇ]/g, '');
const hasNiqqud = (s) => /[֑-ׇ]/.test(s || '');

/** vocalized form -> Set of glosses */
const byVoc = new Map();
/** consonantal skeleton -> Set of vocalized forms (used only to detect ambiguity) */
const bySkel = new Map();

/* bare consonants of a whole phrase -> Set of "vocalized\0gloss" */
const byPhrase = new Map();
const bareKey = (x) => strip(x).replace(/[\s,.?!;:'"״׳()־-]/g, '');

/* Multi-word entries, which add() drops on purpose (a phrase is not a word gloss).
 *
 * Added 2026-08-25 for a different job: resolving a whole Hebrew phrase the learner types,
 * offline, instead of spending 3 to 9 upstream calls on it. Measured that day, one query costs
 * 6.4 external calls on average, and ten people behind one ulpan wifi share a single IP and so
 * a single quota. A phrase already verified in a lesson should not cost a request at all.
 *
 * Keyed on the BARE consonants of the WHOLE phrase, which is safe here in a way it is not for a
 * single word. The single-word skeleton fallback was removed from this file because our corpus
 * made almost every skeleton look unambiguous purely by absence (it emitted the market as "in
 * shock"). A phrase is a far longer string, and the claim is measured rather than assumed:
 * across the 465 lessons, 14225 distinct bare phrases, of which 2.9% carry more than one
 * vocalization and 7.8% more than one meaning. Those are DROPPED, never merged. */
function addPhrase(he, en) {
  if (!he || !en) return;
  he = he.trim();
  en = en.trim();
  if (!he || !en) return;
  if (!hasNiqqud(he)) return;
  if (strip(he).split(/\s+/).length < 2) return;   // single words are add()'s job
  if (en.length > MAX_LEN) return;
  const k = bareKey(he);
  if (!k) return;
  if (!byPhrase.has(k)) byPhrase.set(k, new Set());
  byPhrase.get(k).add(he + '\u0000' + en);
}

function add(he, en) {
  if (!he || !en) return;
  he = he.trim();
  en = en.trim();
  if (!he || !en) return;
  if (!hasNiqqud(he)) return;                       // unvocalized entries cannot be keyed safely
  if (strip(he).split(/\s+/).length > 1) return;    // single words only; phrases are not glosses
  if (en.length > MAX_LEN) return;                  // long lesson notes are commentary, not a gloss
  if (!byVoc.has(he)) byVoc.set(he, new Set());
  byVoc.get(he).add(en);
  const k = strip(he);
  if (!bySkel.has(k)) bySkel.set(k, new Set());
  bySkel.get(k).add(he);
}

/* ---------- sources: everything we have already verified by hand ---------- */
const pb = JSON.parse(await readFile(dataPath('phrasebook.json'), 'utf8'));
for (const p of pb.phrases) { add(p.he, p.en); addPhrase(p.he, p.en); }

try {
  const ex = JSON.parse(await readFile(dataPath('expressions.json'), 'utf8'));
  for (const e of ex.expressions || []) { add(e.he, e.en || e.literal); addPhrase(e.he, e.en || e.literal); }
} catch { /* generated file; fine if absent */ }

/* Corpus EXTERNES déclarés dans layout.config.json. Aujourd'hui : kita10, le journal de classe
 * de Jonas.
 *
 * Pourquoi une app en lit une autre : mesuré le 2026-08-27, le corpus vérifié d'ici ne couvrait
 * que 33 % (702/2149) des mots réellement vus en cours. Les 465 leçons sont un programme
 * générique ; kita10 est ce que son prof a écrit au tableau cette semaine. Chacun rate ce que
 * l'autre a.
 *
 * Source OPTIONNELLE, et le dire est la moitié du travail : sur une machine sans le dépôt
 * frère, le générateur continue avec un corpus plus petit — qui a exactement l'air d'un corpus
 * normal. Un manque silencieux ne se verrait qu'en production, sous la forme d'un mot connu
 * parti chercher le réseau. Donc on l'écrit.
 */
for (const src of cfg.externalCorpora || []) {
  const dir = join(ROOT, src.path);
  let files;
  try {
    files = (await readdir(dir)).filter((x) => x.endsWith('.json')).sort();
  } catch {
    console.log(`corpus externe "${src.id}" ABSENT de cette machine (${src.path}) — corpus réduit d'autant.`);
    continue;
  }
  let n = 0;
  const walk = (o) => {
    if (!o) return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o !== 'object') return;
    /* On ne prend QUE les entrées qui portent un sens. Une entrée sans glose n'apprend rien à ce
       corpus-ci (dont l'objet est le sens) mais créerait de l'ambiguïté de squelette, donc
       supprimerait de vraies entrées : elle coûterait sans rien rendre. */
    const gl = (o.en || o.fr || '').trim();
    if (typeof o.he === 'string' && gl) { add(o.he.trim(), gl); addPhrase(o.he.trim(), gl); n++; }
    Object.values(o).forEach(walk);
  };
  for (const f of files) walk(JSON.parse(await readFile(join(dir, f), 'utf8')));
  console.log(`corpus externe "${src.id}" : ${n} entrées glosées lues depuis ${files.length} fichiers`);
}

const lessonsDir = join(ROOT, cfg.toolScopes.lessons[0]);
for (const f of (await readdir(lessonsDir)).filter((x) => x.endsWith('.html'))) {
  const s = await readFile(join(lessonsDir, f), 'utf8');
  // Lesson word rows are object literals; pull he together with the meaning in the SAME object,
  // so a gloss can never be paired with a neighbouring word's Hebrew.
  /* Les deux motifs acceptent les guillemets ÉCHAPPÉS à l'intérieur de la chaîne, et c'est un
     correctif, pas une précaution.
     Mesuré le 2026-08-27 : 94 clés de gloss.json portaient un antislash littéral et étaient
     tronquées à cet endroit — צֶ\ pour « check », גִּ\ pour « gin », גְּ\ pour le jachnoun,
     וַה\ pour un verset entier. Le point commun n'était pas le hasard : ce sont tous des mots
     à GUÉRESH (ג׳ = j, צ׳ = tch, ז׳ = zh), plus l'abréviation ה׳ du Nom.
     Dans une leçon, ce guéresh est un apostrophe à l'intérieur d'une chaîne JavaScript entre
     apostrophes, donc écrit \'. L'ancien motif [^']+ s'arrêtait sur cet antislash-apostrophe et
     capturait le début du mot. Autrement dit : le corpus perdait exactement les emprunts dont un
     olé se sert tous les jours, et il les perdait silencieusement, en les remplaçant par un
     fragment qui avait l'air d'un mot. */
  const unescape = s2 => s2.replace(/\\(['"\\])/g, '$1');
  for (const m of s.matchAll(/\{[^{}]*?"he"\s*:\s*"((?:[^"\\]|\\.)+)"[^{}]*?\}/g)) {
    const en = (m[0].match(/"(?:en|fr)"\s*:\s*"((?:[^"\\]|\\.)+)"/) || [])[1];
    add(unescape(m[1]), en && unescape(en));
    addPhrase(unescape(m[1]), en && unescape(en));
  }
  for (const m of s.matchAll(/\{[^{}]*?he:\s*'((?:[^'\\]|\\.)+)'[^{}]*?\}/g)) {
    const en = (m[0].match(/(?:en|fr):\s*'((?:[^'\\]|\\.)+)'/) || [])[1];
    add(unescape(m[1]), en && unescape(en));
    addPhrase(unescape(m[1]), en && unescape(en));
  }
}

/* ---------- emit ---------- */
/* Several lessons gloss the same word slightly differently. Prefer the shortest: it is the
   dictionary sense rather than a sentence-specific paraphrase. */
const pick = (set) => [...set].sort((a, b) => a.length - b.length)[0];

const v = {};
for (const [he, glosses] of byVoc) v[he] = pick(glosses);

/* How many skeletons carry more than one reading even inside this small corpus — reported as a
   reminder of why there is no skeleton fallback, not used for lookup. */
const ambiguous = [...bySkel.values()].filter((forms) => forms.size > 1).length;

const out = {
  _note: 'Verified word glosses compiled from the phrasebook, the expressions and the lessons. '
       + 'Keys are FULLY VOCALIZED forms — there is deliberately no consonantal-skeleton fallback, '
       + 'see the header of tools/build-gloss.mjs. Generated; do not edit.',
  // Deliberately no build timestamp: it would make every regeneration produce a diff even when
  // not a single gloss changed, so a real content change could not be told from a rebuild.
  v,
};
await writeFile(dataPath('gloss.json'), JSON.stringify(out) + '\n', 'utf8');

/* ---------- phrases: a separate file, fetched only when a phrase is typed ---------- */
let kept = 0;
let droppedVoc = 0;
let droppedGloss = 0;
const ph = {};
for (const [k, set] of byPhrase) {
  const pairs = [...set].map((x) => x.split('\u0000'));
  const vocs = new Set(pairs.map((x) => x[0]));
  const glosses = new Set(pairs.map((x) => x[1].toLowerCase()));
  // Disagreement inside our own corpus is a signal, not noise to average away.
  if (vocs.size > 1) { droppedVoc++; continue; }
  if (glosses.size > 1) { droppedGloss++; continue; }
  ph[k] = { h: pairs[0][0], g: pairs[0][1] };
  kept++;
}
const phOut = {
  _note: 'Verified multi-word phrases from the phrasebook, the expressions and the lessons, keyed '
       + 'on the BARE consonants of the whole phrase. An entry whose bare form carries more than one '
       + 'vocalization or more than one meaning inside the corpus is dropped, never merged. See the '
       + 'addPhrase header in tools/build-gloss.mjs. Generated; do not edit.',
  p: ph,
};
await writeFile(dataPath('phrases.json'), JSON.stringify(phOut) + '\n', 'utf8');
console.log(`phrases.json: ${kept} verified phrases (dropped ${droppedVoc} ambiguous vocalization, ${droppedGloss} ambiguous meaning)`);
console.log(`size: ${(JSON.stringify(phOut).length / 1024).toFixed(0)} KB -> ${dataPath('phrases.json')}`);

const bytes = JSON.stringify(out).length;
console.log(`gloss.json: ${Object.keys(v).length} vocalized entries (no skeleton fallback, by design)`);
console.log(`skeletons ambiguous even within this corpus: ${ambiguous}`);
console.log(`size: ${(bytes / 1024).toFixed(0)} KB -> ${dataPath('gloss.json')}`);
