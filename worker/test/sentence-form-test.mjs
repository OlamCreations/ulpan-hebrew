// Real route, mocked bindings. Structural/transport proofs, not Hebrew quality proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test, beforeEach } from 'node:test';
import { setTimeout as realDelay } from 'node:timers/promises';
import worker from '../src/index.js';
const base = 'אֲנִי לוֹמֵד.';
const subject = { id: 'S1', label: 'le sujet', anchor: { start: 0, end: 5, text: 'אֲנִי' }, person: '1', number: 'sg', gender: null, tense: 'present' };
const target = { person: '1', number: 'pl', gender: 'm', tense: 'past' };
const analyze = { version: 1, op: 'analyze', base, lang: 'fr' };
const transform = { ...analyze, op: 'transform', subject, target, temporalChoice: null };
const providerSubject = { id: 'S1', label: 'le sujet', from: 't0', to: 't0', person: '1', number: 'sg', gender: null, tense: 'present' };
const analysis = { status: 'ok', subjects: [providerSubject], mainSubjectId: 'S1' };
const externalAnalysis = { version: 1, status: 'ok', subjects: [subject], mainSubjectId: 'S1', provenance: 'generated' };
const transformed = { status: 'ok', meaning: 'Nous avons étudié.', edits: [
  { from: 't1', to: 't1', after: 'למדנו', kind: 'tense', note: 'Passé' },
] };
let store, calls, quotas, pending;
beforeEach(() => {
  store = new Map(); calls = []; quotas = []; pending = [];
  globalThis.fetch = async () => { throw new Error('Unexpected network'); };
  globalThis.caches = { default: {
    match: async key => store.has(key.url) ? new Response(store.get(key.url)) : undefined,
    put: async (key, value) => { store.set(key.url, await value.text()); },
  } };
});
const envFor = (reply = analysis, guard = '1') => ({
  LIMITER: { idFromName: key => key, get: key => ({ fetch: async url => { quotas.push([key, url]); if (guard instanceof Error) throw guard; return new Response(guard); } }) },
  AI: { run: async (model, input) => { calls.push({ model, input }); if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply() : { response: reply }; } },
});
async function route(body = analyze, env = envFor(), origin = 'https://ulpan-etzion.pages.dev', path = '/sentence-form') {
  const response = await worker.fetch(new Request('https://w.example' + path + '?d=device', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': 'test-ip' }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env, { waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  return { response, body: await response.json() };
}
test('token analysis derives whole pointed word anchor and server-owned metadata', async () => {
  const got = await route(); assert.equal(got.response.status, 200); assert.deepEqual(got.body, externalAnalysis);
  assert.deepEqual(calls[0].input.response_format, { type: 'json_object' });
  assert.equal(calls[0].model, '@cf/qwen/qwen3-30b-a3b-fp8');
  const data = JSON.parse(calls[0].input.messages[1].content);
  assert.deepEqual(data.sourceTokens, [{ id: 't0', text: 'אֲנִי' }, { id: 't1', text: 'לוֹמֵד' }, { id: 't2', text: '.' }]);
  assert.equal(data.base, base); assert.equal(data.sourceMap, undefined);
  assert.match(calls[0].input.messages[0].content, /data.*not.*instructions/is);
});
test('transform derives edits before offsets he target and selected subject', async () => {
  const got = await route(transform, envFor(transformed)); assert.equal(got.response.status, 200);
  assert.deepEqual(got.body, { version: 1, status: 'ok', he: 'אֲנַחְנוּ למדנו.', meaning: transformed.meaning, subjectId: 'S1', applied: target, edits: [
    { start: 0, end: 5, before: 'אֲנִי', after: 'אֲנַחְנוּ', kind: 'person', note: 'Personne modifiée.' },
    { start: 6, end: 12, before: 'לוֹמֵד', after: 'למדנו', kind: 'tense', note: 'Temps modifié.' },
  ], provenance: 'generated' });
  const data = JSON.parse(calls[0].input.messages[1].content);
  assert.equal(data.subject.from, 't0'); assert.equal(data.subject.to, 't0'); assert.equal(data.subject.anchor, undefined);
  assert.match(calls[0].input.messages[0].content, /null.*NOT.*reason to ask/is);
});
// Exact observed call6 partial-word result: legal grapheme, not a valid subject token.
const capturedPartial = { mainSubjectId: 'S1', provenance: 'generated', status: 'ok', subjects: [{ anchor: { end: 2, start: 0, text: 'אֲ' }, gender: null, id: 'S1', label: 'le sujet', number: 'sg', person: '1', tense: 'present' }], version: 1 };
test('captured partial-word provider subject is rejected instead of accepted as a subject', async () => { assert.equal((await route(analyze, envFor(capturedPartial))).response.status, 502); });
test('captured partial-word subject cannot reenter as a transform request', async () => { assert.equal((await route({ ...transform, subject: capturedPartial.subjects[0] }, envFor(transformed))).response.status, 400); assert.equal(calls.length, 0); });
// Exact observed call7 choice, without a real temporal reference.
test('captured free-floating needs-choice on basic study sentence is rejected', async () => {
  const raw = { choices: [{ id: 'preserve', label: 'Conserver la référence temporelle' }, { id: 'remove', label: 'Supprimer la référence temporelle' }], provenance: 'generated', reason: 'Le choix temporel est requis pour traiter la référence temporelle', status: 'needs-choice', version: 1 };
  assert.equal((await route(transform, envFor(raw))).response.status, 502);
});
test('repeated text token IDs identify second occurrence, never first match', async () => {
  const req = { ...analyze, base: 'אֲנִי אֲנִי' }; const got = await route(req, envFor({ ...analysis, subjects: [{ ...providerSubject, from: 't1', to: 't1' }] }));
  assert.equal(got.response.status, 200); assert.deepEqual(got.body.subjects[0].anchor, { start: 6, end: 11, text: 'אֲנִי' });
});
test('astral prefix and niqqud keep exact UTF16 token offsets', async () => {
  const req = { ...analyze, base: '😀 אֲנִי לוֹמֵד.' }; const got = await route(req, envFor({ ...analysis, subjects: [{ ...providerSubject, from: 't1', to: 't1' }] }));
  assert.equal(got.response.status, 200); assert.deepEqual(got.body.subjects[0].anchor, { start: 3, end: 8, text: 'אֲנִי' });
});
test('multi-token edit expands word span while retaining punctuation and source whitespace', async () => {
  const req = { ...transform, base: 'אֲנִי  לוֹמֵד.', subject: { ...subject, anchor: { start: 0, end: 13, text: 'אֲנִי  לוֹמֵד' } } };
  const out = { status: 'ok', meaning: 'Nous avons étudié.', edits: [{ from: 't0', to: 't1', after: 'אֲנַחְנוּ למדנו', kind: 'tense', note: 'Phrase' }] };
  const got = await route(req, envFor(out)); assert.equal(got.body.he, 'אֲנַחְנוּ למדנו.'); assert.equal(got.body.edits[0].before, 'אֲנִי  לוֹמֵד');
});
test('syncretic unchanged sentence keeps exact base', async () => { const req = { ...transform, target: { ...target, number: 'sg' } }; const got = await route(req, envFor({ ...transformed, edits: [] })); assert.equal(got.body.he, base); assert.deepEqual(got.body.applied, req.target); });
for (const [name, bad] of Object.entries({ version: { ...analyze, version: 2 }, operation: { ...analyze, op: 'other' }, language: { ...analyze, lang: 'es' }, empty: { ...analyze, base: ' ' }, type: { ...analyze, base: 42 }, extra: { ...analyze, prompt: 'override' }, missing: { op: 'analyze', base, lang: 'fr' }, null: null, broken: '{' })) {
  test('rejects request ' + name, async () => { assert.equal((await route(bad)).response.status, 400); assert.equal(calls.length, 0); });
}
test('unknown source gender still requires explicit target gender', async () => { assert.equal((await route({ ...transform, target: { ...target, gender: null } })).response.status, 400); assert.equal(calls.length, 0); });
test('request anchors remain exact and unaligned', async () => { assert.equal((await route({ ...transform, subject: { ...subject, anchor: { ...subject.anchor, end: 3 } } })).response.status, 400); assert.equal(calls.length, 0); });
test('actual request bytes and base length rejected without truncation', async () => { for (const length of [601, 12000]) assert.equal((await route({ ...analyze, base: 'א'.repeat(length) })).response.status, 413); assert.equal(calls.length, 0); });
for (const [name, out] of Object.entries({ truncated: '{"status":', fenced: '```json\n{}\n```', extra: { ...transformed, tr: 'ani' }, forgedIdentity: { ...transformed, subjectId: 'other' }, forgedTarget: { ...transformed, applied: target }, forgedHe: { ...transformed, he: 'other' }, missingId: { ...transformed, edits: [{ ...transformed.edits[0], from: 't999' }] }, reversed: { ...transformed, edits: [{ ...transformed.edits[0], from: 't1', to: 't0' }] }, overlap: { ...transformed, edits: [transformed.edits[0], transformed.edits[0]] }, badKind: { ...transformed, edits: [{ ...transformed.edits[0], kind: 'rewrite' }] }, badNote: { ...transformed, edits: [{ ...transformed.edits[0], note: '' }] }, provenance: { ...transformed, provenance: 'verified' }, noMeaning: { ...transformed, meaning: '' } })) {
  test('provider rejects ' + name + ' without cache or retry', async () => { const env = envFor(out); for (let i = 0; i < 2; i++) assert.equal((await route(transform, env)).response.status, 502); assert.equal(calls.length, 2); assert.equal(store.size, 0); });
}
test('analysis rejects duplicate IDs invalid main ID partial protocol and punctuation subject', async () => {
  for (const out of [{ ...analysis, subjects: [providerSubject, providerSubject] }, { ...analysis, mainSubjectId: 'missing' }, { ...analysis, subjects: [{ ...providerSubject, from: 't2', to: 't2' }] }, { ...analysis, subjects: [{ ...providerSubject, anchor: subject.anchor }] }]) assert.equal((await route(analyze, envFor(out))).response.status, 502);
});
test('unsupported provider response is adapted but never cached', async () => { const env = envFor({ status: 'unsupported', reason: 'Construction ambiguë' }); for (let i = 0; i < 2; i++) assert.deepEqual((await route(analyze, env)).body, { version: 1, status: 'unsupported', reason: 'Construction ambiguë', provenance: 'generated' }); assert.equal(calls.length, 2); assert.equal(store.size, 0); });
test('provider additional temporal choice must identify an exact source token span', async () => {
  const req = { ...transform, base: base + ' אז' };
  const got = await route(req, envFor({ status: 'needs-choice', reason: 'Repère ambigu', reference: { from: 't3', to: 't3' } }));
  assert.equal(got.body.status, 'needs-choice'); assert.deepEqual(got.body.choices.map(c => c.id), ['preserve', 'remove']);
  for (const reference of [undefined, { from: 't999', to: 't999' }]) assert.equal((await route(req, envFor({ status: 'needs-choice', reason: 'Repère', ...(reference ? { reference } : {}) }))).response.status, 502);
});
test('absolute dates require choice before AI including entire ISO date', async () => {
  for (const suffix of [' ב-2026', ' 2026-09-24', ' ב-24/09/2026', ' בשעה 14:30', ' במשך 2 ימים']) assert.equal((await route({ ...transform, base: base + suffix })).body.status, 'needs-choice');
  assert.equal(calls.length, 0);
});
test('ordinary quantity and word negative controls reach provider', async () => {
  for (const suffix of [' 2 ספרים', ' 2026 ספרים', ' 2.5 קילו אורז', ' 2-3 ספרים', ' מועדון']) {
    const req = { ...transform, base: base + suffix, target: { ...target, number: 'sg' } }; assert.equal((await route(req, envFor({ ...transformed, edits: [] }))).body.he, req.base);
  }
  assert.equal(calls.length, 5);
});
test('relative adaptation requires temporal disclosure irrespective of edit label', async () => {
  const req = { ...transform, base: base + ' מָחָר' };
  const e = { from: 't3', to: 't3', after: 'אֶתְמוֹל', kind: 'temporal', note: 'Repère adapté' };
  assert.equal((await route(req, envFor({ ...transformed, edits: [...transformed.edits, { ...e, kind: 'tense' }] }))).response.status, 502);
  assert.equal((await route(req, envFor({ ...transformed, edits: [...transformed.edits, e] }))).body.he, 'אֲנַחְנוּ למדנו. אֶתְמוֹל');
});
test('explicit preserve protects marker and requires no-op disclosure', async () => {
  const req = { ...transform, base: base + ' מחר', temporalChoice: 'preserve' };
  const keep = { from: 't3', to: 't3', after: 'מחר', kind: 'temporal', note: 'Repère conservé' };
  assert.equal((await route(req, envFor({ ...transformed, edits: [...transformed.edits, { ...keep, after: 'אתמול', kind: 'tense' }] }))).response.status, 502);
  assert.equal((await route(req, envFor(transformed))).response.status, 502);
  assert.equal((await route(req, envFor({ ...transformed, edits: [...transformed.edits, keep] }))).body.he, 'אֲנַחְנוּ למדנו. מחר');
});
test('date preserve/remove operate on supplied token reference metadata', async () => {
  const req = { ...transform, base: base + ' ב-2026', temporalChoice: 'preserve' };
  await route(req, envFor({ status: 'unsupported', reason: 'Fixture' }));
  const data = JSON.parse(calls[0].input.messages[1].content); const ref = data.temporalReferences.protected[0];
  assert.ok(ref.from); assert.ok(ref.to); assert.equal(ref.start, undefined);
  const keep = { from: ref.from, to: ref.to, after: ref.text, kind: 'temporal', note: 'Date conservée' };
  assert.equal((await route(req, envFor({ ...transformed, edits: [...transformed.edits, { ...keep, after: ref.text + '7', kind: 'agreement' }] }))).response.status, 502);
  assert.equal((await route(req, envFor({ ...transformed, edits: [...transformed.edits, keep] }))).response.status, 200);
  assert.equal((await route({ ...req, temporalChoice: 'remove' }, envFor({ ...transformed, edits: [...transformed.edits, { ...keep, after: '' }] }))).response.status, 200);
});
test('cache hit uses strict external payload fresh CORS and still quota checks', async () => {
  const env = envFor(); await route(analyze, env); const got = await route(analyze, env, 'https://olamcreations.github.io');
  assert.deepEqual(got.body, externalAnalysis); assert.equal(calls.length, 1); assert.equal(quotas.length, 4);
  assert.match(quotas[0][0], /\|ai$/); assert.match(quotas[0][1], /limit=12/); assert.match(quotas[1][1], /limit=60/);
  assert.equal(got.response.headers.get('Access-Control-Allow-Origin'), 'https://olamcreations.github.io');
  assert.equal((await route(analyze, envFor(analysis, '0'))).response.status, 429);
});
test('cache identity separates target scope language exact base and temporal choice', async () => {
  const variants = [transform, { ...transform, lang: 'en' }, ...Object.keys(target).map(key => ({ ...transform, target: { ...target, [key]: { person: '2', number: 'sg', gender: 'f', tense: 'future' }[key] } })), { ...transform, temporalChoice: 'preserve' }, { ...transform, temporalChoice: 'remove' }, { ...transform, subject: { ...subject, id: 'S2' } }, { ...transform, base: base + ' ' }];
  for (const req of variants) assert.equal((await route(req, envFor({ ...transformed, edits: [] }))).response.status, 200);
  assert.equal(calls.length, variants.length); assert.equal(store.size, variants.length);
});
test('bad cached offsets never get adapted and cache faults are harmless', async () => {
  const env = envFor(); await route(analyze, env);
  for (const key of store.keys()) store.set(key, JSON.stringify(capturedPartial));
  assert.deepEqual((await route(analyze, env)).body, externalAnalysis); assert.equal(calls.length, 2);
  globalThis.caches.default.match = async () => { throw new Error('cache'); }; globalThis.caches.default.put = async () => { throw new Error('cache'); };
  assert.deepEqual((await route(analyze, env)).body, externalAnalysis);
});
test('AI quota fails closed when unavailable missing or denied', async () => { for (const env of [{ AI: envFor().AI }, envFor(analysis, '0'), envFor(analysis, new Error('down'))]) assert.equal((await route(analyze, env)).response.status, 429); assert.equal(calls.length, 0); });
test('untrusted origin blocked before provider', async () => { assert.equal((await route(analyze, envFor(), 'https://pirate.example')).response.status, 403); assert.equal(calls.length, 0); });
test('provider exceptions sanitized and not retried', async () => { const got = await route(analyze, envFor(new Error('SECRET diagnostic'))); assert.equal(got.response.status, 502); assert.doesNotMatch(JSON.stringify(got.body), /SECRET/); assert.equal(calls.length, 1); });
test('provider output size bounded and plain JSON strings accepted', async () => { assert.equal((await route(analyze, envFor({ ...analysis, subjects: 'א'.repeat(24001) }))).response.status, 502); assert.deepEqual((await route(analyze, envFor(JSON.stringify(analysis)))).body, externalAnalysis); });
test('provider timeout returns 504 no retry no cache', async t => {
  let started; const ready = new Promise(resolve => { started = resolve; }); t.mock.timers.enable({ apis: ['setTimeout'] });
  const work = route(analyze, envFor(() => { started(); return new Promise(() => {}); })); await ready; t.mock.timers.tick(30001);
  assert.equal((await work).response.status, 504); assert.equal(calls.length, 1); assert.equal(store.size, 0);
});
test('hung quota fails closed within deadline', async t => {
  let started; const ready = new Promise(resolve => { started = resolve; }); t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = { ...envFor(), LIMITER: { idFromName: k => k, get: () => ({ fetch: () => { started(); return new Promise(() => {}); } }) } };
  const work = route(analyze, env); await ready; t.mock.timers.tick(1501);
  assert.equal((await Promise.race([work, realDelay(100).then(() => ({ response: { status: 'unsettled' } }))])).response.status, 429); assert.equal(calls.length, 0);
});
test('captured nu pronoun mutation is rejected by lock, not silently accepted', async () => {
  const captured = { status: 'ok', meaning: 'nous avons appris', edits: [
    { from: 't0', to: 't0', after: 'נוּ', kind: 'person', note: 'Changed to first person plural' },
    { from: 't1', to: 't1', after: 'לָמַדְנוּ', kind: 'agreement', note: 'Changed verb to first person plural past tense' },
  ] };
  assert.equal((await route(transform, envFor(captured))).response.status, 502); assert.equal(store.size, 0);
});
test('canonical verified pronoun is server-owned and notes are localized', async () => {
  const out = { status: 'ok', meaning: 'Nous avons appris.', edits: [{ from: 't1', to: 't1', after: 'לָמַדְנוּ', kind: 'agreement', note: 'English model boilerplate' }] };
  const got = await route(transform, envFor(out));
  assert.equal(got.body.he, 'אֲנַחְנוּ לָמַדְנוּ.');
  assert.deepEqual(JSON.parse(calls[0].input.messages[1].content).lockedPronoun, { from: 't0', to: 't0', before: 'אֲנִי', after: 'אֲנַחְנוּ' });
  assert.deepEqual(got.body.edits.map(e => e.note), ['Personne modifiée.', 'Accord adapté.']);
});
test('lock rejects larger overlapping span but not predicate expansion', async () => {
  const bad = { status: 'ok', meaning: 'Nous avons étudié.', edits: [{ from: 't0', to: 't1', after: 'נו למדנו', kind: 'tense', note: 'change' }] };
  assert.equal((await route(transform, envFor(bad))).response.status, 502);
  const good = { ...bad, edits: [{ from: 't1', to: 't1', after: 'היינו לומדים', kind: 'tense', note: 'change' }] };
  assert.equal((await route(transform, envFor(good))).body.he, 'אֲנַחְנוּ היינו לומדים.');
});
test('same canonical pronoun preserves exact caller pointing and emits no person edit', async () => {
  const req = { ...transform, base: 'אֲנִי לוֹמֵד.', target: { ...target, number: 'sg' } };
  const out = { status: 'ok', meaning: 'J’ai étudié.', edits: [{ from: 't1', to: 't1', after: 'למדתי', kind: 'tense', note: 'past' }] };
  const got = await route(req, envFor(out)); assert.equal(got.body.he, 'אֲנִי למדתי.'); assert.equal(got.body.edits.length, 1);
  assert.equal(JSON.parse(calls[0].input.messages[1].content).lockedPronoun.after, 'אֲנִי');
});
test('noncanonical compound or prefixed subjects are not pronoun-peeled', async () => {
  for (const value of ['ואני', 'אני והיא']) {
    const req = { ...transform, base: value + ' לומד', subject: { ...subject, anchor: { start: 0, end: value.length, text: value } } };
    await route(req, envFor({ status: 'unsupported', reason: 'Fixture' }));
    assert.equal(JSON.parse(calls.at(-1).input.messages[1].content).lockedPronoun, null);
  }
});
test('route success and validation failure advertise serving revision', async () => {
  const ok = await route(); const bad = await route({ ...analyze, version: 99 });
  assert.equal(ok.response.headers.get('X-Sentence-Form-Version'), 'v10');
  assert.equal(bad.response.headers.get('X-Sentence-Form-Version'), 'v10');
});
test('pronoun lexicon is copied exactly from existing verified Kita personTags', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../src/sentence-form.config.json', import.meta.url), 'utf8'));
  const source = JSON.parse(fs.readFileSync(new URL('../../../ulpan-etzion/config.json', import.meta.url), 'utf8'));
  assert.equal(cfg.pronouns.length, 10);
  for (const pronoun of cfg.pronouns) assert.equal(pronoun.he, source.display.personTags[pronoun.sourceKey].he);
});
test('captured call14 exact canonical echo is redundant and contributes one server-owned edit', async () => {
  const out = { status: 'ok', meaning: 'Nous avons appris.', edits: [
    { from: 't0', to: 't0', after: 'אֲנַחְנוּ', kind: 'person', note: 'Remplacement du pronom personnel pour le sujet' },
    { from: 't1', to: 't1', after: 'לָמַדְנוּ', kind: 'agreement', note: 'Conjugaison du verbe pour s’accorder avec le sujet' },
  ] };
  for (const edits of [out.edits, [out.edits[0], ...out.edits], [{ ...out.edits[0], after: 'אנחנו' }, out.edits[1]]]) {
    store.clear(); const got = await route(transform, envFor({ ...out, edits }));
    assert.equal(got.response.status, 200); assert.equal(got.body.he, 'אֲנַחְנוּ לָמַדְנוּ.');
    assert.equal(got.body.edits.filter(e => e.kind === 'person').length, 1);
    assert.equal(got.body.edits[0].note, 'Personne modifiée.');
  }
});
test('wrong-pointed or wrong-kind pronoun echoes still reject', async () => {
  for (const edit of [
    { from: 't0', to: 't0', after: 'אֲנַחְנוֹ', kind: 'person', note: 'wrong pointing' },
    { from: 't0', to: 't0', after: 'אֲנַחְנוּ', kind: 'agreement', note: 'wrong kind' },
  ]) assert.equal((await route(transform, envFor({ ...transformed, edits: [edit, ...transformed.edits] }))).response.status, 502);
});
test('captured call19 accepts absent provider notes while external notes remain server-owned', async () => {
  const req = { ...transform, target: { person: '3', number: 'sg', gender: 'f', tense: 'future' } };
  const raw = { status: 'ok', meaning: 'Elle apprendra.', edits: [
    { from: 't0', to: 't0', after: 'הִיא', kind: 'person' },
    { from: 't1', to: 't1', after: 'תִּלְמֵד', kind: 'agreement' },
  ] };
  const got = await route(req, envFor(raw)); assert.equal(got.response.status, 200);
  assert.deepEqual(got.body.edits.map(e => e.note), ['Personne modifiée.', 'Accord adapté.']);
  // Provider vowels are transported, not asserted linguistically correct by this test.
  assert.equal(got.body.he, 'הִיא תִּלְמֵד.');
});
test('optional provider notes remain bounded when present', async () => {
  for (const note of [42, null, 'x'.repeat(1201)]) assert.equal((await route(transform, envFor({ ...transformed, edits: [{ ...transformed.edits[0], note }] }))).response.status, 502);
});
test('optional sourceMeaning is exact bounded data forwarded for both operations', async () => {
  for (const req of [{ ...analyze, sourceMeaning: 'I study.' }, { ...transform, sourceMeaning: 'I study.' }]) {
    const got = await route(req, envFor(req.op === 'analyze' ? analysis : transformed)); assert.equal(got.response.status, 200);
    assert.equal(JSON.parse(calls.at(-1).input.messages[1].content).sourceMeaning, 'I study.');
    assert.match(calls.at(-1).input.messages[0].content, /sourceMeaning/);
  }
});
test('sourceMeaning rejects wrong types and oversize without provider work', async () => {
  for (const sourceMeaning of [42, null, {}]) assert.equal((await route({ ...analyze, sourceMeaning })).response.status, 400);
  assert.equal((await route({ ...transform, sourceMeaning: 'x'.repeat(1201) })).response.status, 413);
  assert.equal((await route({ ...analyze, sourceMeaning: 'I study.', unexpected: true })).response.status, 400);
  assert.equal(calls.length, 0);
});
test('sourceMeaning partitions cache including absent versus present', async () => {
  for (const req of [analyze, { ...analyze, sourceMeaning: 'I study.' }, { ...analyze, sourceMeaning: 'I am a student.' }]) await route(req, envFor());
  assert.equal(calls.length, 3); assert.equal(store.size, 3);
  await route({ ...analyze, sourceMeaning: 'I study.' }, envFor()); assert.equal(calls.length, 3);
});
test('transform prompt preserves unselected clause tense without narrative harmonization', async () => {
  await route(transform, envFor(transformed));
  const prompt = calls[0].input.messages[0].content;
  assert.match(prompt, /other protagonists' tense EXACTLY/);
  assert.match(prompt, /no narrative harmonization/i);
  assert.match(prompt, /no-op non-temporal edits/i);
});
test('sentence-only Qwen thinking profile requests JSON mode with approved budgets', async () => {
  await route();
  assert.equal(calls[0].model, '@cf/qwen/qwen3-30b-a3b-fp8');
  assert.equal(calls[0].input.max_tokens, 4000);
  assert.deepEqual(calls[0].input.response_format, { type: 'json_object' });
  for (const message of calls[0].input.messages) assert.doesNotMatch(message.content, /\/no_think/);
});
test('single Qwen choices content fallback is parsed without weakening validation', async () => {
  const raw = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis) } }] };
  assert.deepEqual((await route(analyze, envFor(() => raw))).body, externalAnalysis);
});
test('Qwen length truncation rejects even with a parseable response', async () => {
  for (const raw of [
    { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(analysis) } }] },
    { response: analysis, choices: [{ finish_reason: 'length', message: { content: JSON.stringify(analysis) } }] },
    { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis) } }, { finish_reason: 'stop', message: { content: JSON.stringify(analysis) } }] },
  ]) { store.clear(); assert.equal((await route(analyze, envFor(() => raw))).response.status, 502); assert.equal(store.size, 0); }
});
test('thinking provider can finish after old 12s deadline but before approved 30s', async t => {
  let started, finish; const ready = new Promise(resolve => { started = resolve; }); t.mock.timers.enable({ apis: ['setTimeout'] });
  const work = route(analyze, envFor(() => { started(); return new Promise(resolve => { finish = resolve; }); }));
  await ready; t.mock.timers.tick(15000); finish({ response: analysis });
  const got = await work; assert.equal(got.response.status, 200); assert.deepEqual(got.body, externalAnalysis);
});
test('captured Qwen response object preserves untouched second-clause Hebrew', async () => {
  const req = { ...transform, base: 'אֲנִי לוֹמֵד עִבְרִית, וְהַמּוֹרָה מְלַמֶּדֶת.', sourceMeaning: 'J’étudie l’hébreu, et le professeur enseigne.' };
  const response = { status: 'ok', meaning: "Nous avons étudié l'hébreu, et le professeur enseigne.", edits: [{ from: 't1', to: 't1', after: 'לָמַדְנוּ', kind: 'person' }] };
  const got = await route(req, envFor(() => ({ response, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }] })));
  assert.equal(got.response.status, 200); assert.equal(got.body.he, 'אֲנַחְנוּ לָמַדְנוּ עִבְרִית, וְהַמּוֹרָה מְלַמֶּדֶת.'); assert.equal(got.body.meaning, response.meaning);
});
test('captured call32 introduced French predicate rejects and is never cached', async () => {
  const raw = { status: 'ok', meaning: 'Nous étudiions.', edits: [{ from: 't1', to: 't1', after: 'étudiions', kind: 'tense' }] };
  const env = envFor(raw);
  for (let i = 0; i < 2; i++) assert.equal((await route(transform, env)).response.status, 502);
  assert.equal(calls.length, 2); assert.equal(store.size, 0);
});
test('mixed Hebrew original Latin name and digits remain allowed unchanged', async () => {
  const req = { ...transform, base: base + ' David 2026' };
  const got = await route(req, envFor(transformed)); assert.equal(got.response.status, 200);
  assert.equal(got.body.he, 'אֲנַחְנוּ למדנו. David 2026');
});
test('new foreign Unicode runs reject but original foreign spelling is preserved', async () => {
  for (const after of ['étudiions', 'учились', 'למדנוDavid']) {
    const req = { ...transform, base: base + ' David' };
    assert.equal((await route(req, envFor({ ...transformed, edits: [{ from: 't1', to: 't1', after, kind: 'tense' }] }))).response.status, 502);
  }
  const req = { ...transform, base: base + ' Éli' };
  assert.equal((await route(req, envFor({ ...transformed, edits: [{ from: 't1', to: 't3', after: 'למדנו. Éli', kind: 'tense' }] }))).response.status, 200);
});
test('legacy form remains compatible with unchanged Llama model', async () => { const got = await route({ base, gender: 'f', number: 'sg' }, envFor('אני לומדת | femme qui parle'), undefined, '/form'); assert.equal(got.response.status, 200); assert.ok(Array.isArray(got.body.options)); assert.equal(calls[0].model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast'); });
