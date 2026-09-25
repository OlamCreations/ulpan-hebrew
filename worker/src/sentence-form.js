import config from './sentence-form.config.json' with { type: 'json' };

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) && value.isWellFormed();
const hebrew = value => /[א-ת]/u.test(value);
const bytes = value => new TextEncoder().encode(value).length;
class Failure extends Error { constructor(status, message) { super(message); this.status = status; } }
const demand = (condition, status = 502) => { if (!condition) throw new Failure(status, status === 400 ? 'invalid request' : 'invalid provider response'); };

function sourceMap(base) {
  return [...new Intl.Segmenter('he', { granularity: 'grapheme' }).segment(base)]
    .map(part => ({ start: part.index, end: part.index + part.segment.length, text: part.segment }));
}
function boundaries(base) {
  return new Set(sourceMap(base).map(part => part.start).concat(base.length));
}
function range(value, base, points, allowEmpty = false) {
  return Number.isInteger(value.start) && Number.isInteger(value.end) && value.start >= 0 && value.end <= base.length && (allowEmpty ? value.start <= value.end : value.start < value.end) && points.has(value.start) && points.has(value.end);
}
function features(value, nullable = false) {
  return Object.entries(config.features).every(([key, values]) => values.includes(value[key]) || (nullable && value[key] === null));
}
function sourceTokens(base) {
  return [...new Intl.Segmenter('he', { granularity: 'word' }).segment(base)]
    .filter(part => part.segment.trim())
    .map((part, index) => ({ id: config.tokenPrefix + index, text: part.segment, start: part.index, end: part.index + part.segment.length, word: !!part.isWordLike }));
}
function wholeSubject(anchor, base) {
  const tokens = sourceTokens(base);
  return tokens.some(token => token.word && token.start === anchor.start) && tokens.some(token => token.word && token.end === anchor.end) && hebrew(anchor.text);
}
function validSubject(subject, base, points) {
  return exact(subject, config.schema.subject) && text(subject.id, config.maxIdLength) && text(subject.label, config.maxLabelLength) && features(subject, true) && exact(subject.anchor, config.schema.anchor) && range(subject.anchor, base, points) && subject.anchor.text === base.slice(subject.anchor.start, subject.anchor.end) && wholeSubject(subject.anchor, base);
}
function validateRequest(value) {
  demand(record(value) && config.operations.includes(value.op), 400);
  const schema = value.op === 'analyze' ? 'analyzeRequest' : 'transformRequest';
  const withMeaning = Object.hasOwn(value, 'sourceMeaning');
  demand(exact(value, config.schema[withMeaning ? schema + 'WithMeaning' : schema]), 400);
  if (withMeaning) {
    demand(typeof value.sourceMeaning === 'string', 400);
    if (value.sourceMeaning.length > config.maxTextLength) throw new Failure(413, 'too large');
    demand(text(value.sourceMeaning, config.maxTextLength, true), 400);
  }
  demand(value.version === config.version && config.languages.includes(value.lang) && typeof value.base === 'string', 400);
  if (value.base.length > config.maxBaseLength) throw new Failure(413, 'too large');
  demand(text(value.base, config.maxBaseLength) && hebrew(value.base), 400);
  if (value.op === 'transform') {
    demand(validSubject(value.subject, value.base, boundaries(value.base)), 400);
    demand(exact(value.target, Object.keys(config.features)) && features(value.target), 400);
    demand(value.temporalChoice === null || config.temporalChoices.includes(value.temporalChoice), 400);
  }
  return value;
}

// A conservative lexical backstop, NOT a complete temporal parser. The provider must
// abstain on additional ambiguous references; structured validity cannot prove semantics.
const depoint = value => value.replace(/[֑-ֽֿ-ׇ]/gu, '');
const protectedSpans = base => temporalSpans(base, config.protectedTemporalPattern);
const relativeSpans = base => temporalSpans(base, config.relativeTemporal.join('|'));
function temporalSpans(base, pattern) {
  const units = [...new Intl.Segmenter('he', { granularity: 'grapheme' }).segment(base)];
  const projected = units.flatMap(unit => [...depoint(unit.segment)].map(char => ({ char, start: unit.index, end: unit.index + unit.segment.length })));
  const bare = projected.map(unit => unit.char).join('');
  // Mapping is UTF16 too, including astral characters before a temporal reference.
  const mapping = projected.flatMap(unit => Array.from({ length: unit.char.length }, () => unit));
  return [...bare.matchAll(new RegExp(pattern, 'gu'))]
    .filter(match => !hebrew(match[0]) || (!hebrew(bare.slice(match.index - 1, match.index)) && !hebrew(bare.slice(match.index + match[0].length, match.index + match[0].length + 1))))
    .map(match => ({ start: mapping[match.index].start, end: mapping[match.index + match[0].length - 1].end }));
}
function choice(req) {
  const labels = config.messages[req.lang];
  return { version: config.version, status: 'needs-choice', reason: labels.reason, choices: config.temporalChoices.map(id => ({ id, label: labels[id] })), provenance: 'generated' };
}
function preservesForeignRuns(base, result) {
  const runs = value => value.match(new RegExp(config.foreignLetterRunPattern, 'gu')) || [];
  const source = runs(base), output = runs(result);
  // Keep exact original names across scripts, but never introduce or duplicate
  // a foreign-letter run (including accented Latin and non-Latin alphabets).
  return [...new Set(output)].every(run => output.filter(value => value === run).length <= source.filter(value => value === run).length);
}
function validateOutput(out, req) {
  demand(record(out) && out.version === config.version && out.provenance === 'generated');
  if (out.status === 'unsupported') {
    demand(exact(out, config.schema.unsupported) && text(out.reason, config.maxTextLength)); return out;
  }
  if (out.status === 'needs-choice') {
    demand(req.op === 'transform' && req.temporalChoice === null && exact(out, config.schema.needsChoice) && text(out.reason, config.maxTextLength));
    demand(Array.isArray(out.choices) && out.choices.length === config.temporalChoices.length && config.temporalChoices.every(id => out.choices.filter(c => exact(c, config.schema.choice) && c.id === id && text(c.label, config.maxLabelLength)).length === 1));
    return out;
  }
  demand(out.status === 'ok');
  const points = boundaries(req.base);
  if (req.op === 'analyze') {
    demand(exact(out, config.schema.analysis) && Array.isArray(out.subjects) && out.subjects.length > 0 && out.subjects.length <= config.maxSubjects);
    demand(out.subjects.every(s => validSubject(s, req.base, points)) && new Set(out.subjects.map(s => s.id)).size === out.subjects.length);
    demand(out.mainSubjectId === null || out.subjects.some(s => s.id === out.mainSubjectId));
    return out;
  }
  demand(exact(out, config.schema.transformation) && text(out.he, config.maxTextLength) && hebrew(out.he) && text(out.meaning, config.maxTextLength));
  demand(preservesForeignRuns(req.base, out.he));
  demand(out.subjectId === req.subject.id && exact(out.applied, Object.keys(config.features)) && Object.keys(config.features).every(key => out.applied[key] === req.target[key]));
  demand(Array.isArray(out.edits) && out.edits.length <= config.maxEdits);
  demand(out.edits.every(e => exact(e, config.schema.edit) && range(e, req.base, points, true) && e.before === req.base.slice(e.start, e.end) && text(e.after, config.maxTextLength, true) && text(e.note, config.maxTextLength) && config.editKinds.includes(e.kind)));
  const edits = [...out.edits].sort((a, b) => a.start - b.start || a.end - b.end);
  demand(edits.every((e, i) => !i || (e.start >= edits[i - 1].end && e.start !== edits[i - 1].start)));
  const rebuilt = edits.reduce((acc, e, i) => acc + req.base.slice(i ? edits[i - 1].end : 0, e.start) + e.after, '') + req.base.slice(edits.length ? edits.at(-1).end : 0);
  demand(rebuilt === out.he);
  const spans = protectedSpans(req.base);
  const relatives = relativeSpans(req.base);
  for (const e of edits) {
    // Include both boundaries: an insertion/adjacent replacement can extend a date
    // without overlapping its old digits (2026 -> 20267).
    const touches = spans.some(span => e.start <= span.end && e.end >= span.start);
    if (touches && e.before !== e.after) demand(req.temporalChoice === 'remove' && e.kind === 'temporal' && e.after === '');
    const touchesRelative = relatives.some(span => e.start <= span.end && e.end >= span.start);
    if ((touchesRelative || relativeSpans(e.after).length) && e.before !== e.after) demand(e.kind === 'temporal');
    if (e.kind === 'temporal' && e.before !== e.after) {
      if (req.temporalChoice === 'preserve') demand(false);
      else if (req.temporalChoice === 'remove') demand(e.after === '');
      else demand(config.relativeTemporal.includes(depoint(e.before)) && config.relativeTemporal.includes(depoint(e.after)));
    }
  }
  const references = [...spans, ...relatives];
  if (req.temporalChoice === 'remove') demand(references.every(span => edits.some(e => e.kind === 'temporal' && e.after === '' && e.start <= span.start && e.end >= span.end)));
  if (req.temporalChoice === 'preserve') demand(references.every(span => edits.some(e => e.kind === 'temporal' && e.before === e.after && e.start <= span.start && e.end >= span.end)));
  return out;
}
async function bounded(task, ms) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(task), new Promise((_, reject) => { timer = setTimeout(() => reject(new Failure(504, 'timeout')), ms); })]); }
  finally { clearTimeout(timer); }
}
async function readBody(request) {
  if (!(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase().includes('application/json')) throw new Failure(400, 'invalid request');
  const reader = request.body?.getReader();
  if (!reader) throw new Failure(400, 'invalid request');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let length = 0, value = '';
  try {
    await bounded(async () => {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > config.maxBodyBytes) throw new Failure(413, 'too large');
        value += decoder.decode(chunk.value, { stream: true });
      }
      value += decoder.decode();
    }, config.ioTimeoutMs);
    return JSON.parse(value);
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error instanceof Failure ? error : new Failure(400, 'invalid request');
  } finally { reader.releaseLock(); }
}
async function cacheKey(req) {
  // Stable positional key includes every accepted source/scope/target/decision field.
  const subject = req.subject ? config.schema.subject.map(key => key === 'anchor' ? config.schema.anchor.map(k => req.subject.anchor[k]) : req.subject[key]) : null;
  const identity = JSON.stringify([config.cacheVersion, config.model, req.version, req.op, req.base, req.lang, subject, req.target ? Object.keys(config.features).map(key => req.target[key]) : null, req.temporalChoice ?? null, req.sourceMeaning ?? null]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  const hex = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
  return new Request(config.cacheOrigin + config.cacheVersion + '/' + hex);
}
// Provider transport uses stable WHOLE-token IDs, never model character arithmetic.
// This adapter is applied only to fresh provider output; cached/client contracts stay exact.
function tokenSpan(value, tokens, base) {
  demand(record(value));
  const first = tokens.find(token => token.id === value.from);
  const last = tokens.find(token => token.id === value.to);
  demand(first && last && first.start <= last.start);
  return { start: first.start, end: last.end, text: base.slice(first.start, last.end) };
}
function tokenReference(span, tokens, base) {
  const covered = tokens.filter(token => token.start < span.end && token.end > span.start);
  demand(covered.length > 0);
  return { from: covered[0].id, to: covered.at(-1).id, text: base.slice(covered[0].start, covered.at(-1).end) };
}
function lockedPronoun(req, tokens) {
  if (req.op !== 'transform') return null;
  const bare = depoint(req.subject.anchor.text);
  if (!config.pronouns.some(pronoun => depoint(pronoun.he) === bare)) return null;
  const token = tokens.find(value => value.word && value.start === req.subject.anchor.start && value.end === req.subject.anchor.end);
  if (!token) return null;
  const target = config.pronouns.find(pronoun => pronoun.person === req.target.person && pronoun.number === req.target.number && (pronoun.gender === null || pronoun.gender === req.target.gender));
  demand(target);
  return { from: token.id, to: token.id, before: token.text, after: depoint(target.he) === bare ? token.text : target.he };
}
function editNote(kind, req) {
  const key = kind === 'temporal' && req.temporalChoice !== null ? req.temporalChoice : kind;
  return config.editNotes[req.lang][key];
}
function providerInput(req) {
  const tokens = sourceTokens(req.base);
  const input = { base: req.base, lang: req.lang, sourceTokens: tokens.map(({ id, text }) => ({ id, text })), ...(Object.hasOwn(req, 'sourceMeaning') ? { sourceMeaning: req.sourceMeaning } : {}) };
  if (req.op === 'analyze') return input;
  const ref = tokenReference(req.subject.anchor, tokens, req.base);
  return { ...input,
    subject: { id: req.subject.id, label: req.subject.label, from: ref.from, to: ref.to, ...Object.fromEntries(Object.keys(config.features).map(key => [key, req.subject[key]])) },
    target: req.target, temporalChoice: req.temporalChoice, lockedPronoun: lockedPronoun(req, tokens),
    temporalReferences: {
      protected: protectedSpans(req.base).map(span => tokenReference(span, tokens, req.base)),
      relative: relativeSpans(req.base).map(span => tokenReference(span, tokens, req.base)),
    },
  };
}
function adaptProvider(out, req) {
  demand(record(out));
  const meta = { version: config.version, status: out.status, provenance: 'generated' };
  if (out.status === 'unsupported') {
    demand(exact(out, config.providerSchema.unsupported)); return { ...meta, reason: out.reason };
  }
  const tokens = sourceTokens(req.base);
  if (out.status === 'needs-choice') {
    demand(req.op === 'transform' && req.temporalChoice === null && exact(out, config.providerSchema.needsChoice) && exact(out.reference, config.providerSchema.reference));
    const reference = tokenSpan(out.reference, tokens, req.base);
    demand(text(reference.text, config.maxBaseLength) && /[\p{L}\p{N}]/u.test(reference.text));
    return { ...choice(req), reason: out.reason };
  }
  demand(out.status === 'ok');
  if (req.op === 'analyze') {
    demand(exact(out, config.providerSchema.analysis) && Array.isArray(out.subjects) && out.subjects.length <= config.maxSubjects);
    const subjects = out.subjects.map(subject => {
      demand(exact(subject, config.providerSchema.subject));
      return { id: subject.id, label: subject.label, anchor: tokenSpan(subject, tokens, req.base), ...Object.fromEntries(Object.keys(config.features).map(key => [key, subject[key]])) };
    });
    return { ...meta, subjects, mainSubjectId: out.mainSubjectId };
  }
  demand(exact(out, config.providerSchema.transformation) && Array.isArray(out.edits) && out.edits.length <= config.maxEdits);
  const lock = lockedPronoun(req, tokens);
  const lockedSpan = lock ? tokenSpan(lock, tokens, req.base) : null;
  const automatic = lock && lock.before !== lock.after
    ? [{ start: lockedSpan.start, end: lockedSpan.end, before: lock.before, after: lock.after, kind: 'person', note: editNote('person', req) }]
    : [];
  const edits = [...automatic, ...out.edits.flatMap(edit => {
    demand((exact(edit, config.providerSchema.edit) || (exact(edit, config.providerSchema.editWithNote) && text(edit.note, config.maxTextLength))) && config.editKinds.includes(edit.kind));
    const span = tokenSpan(edit, tokens, req.base);
    // Drop only a redundant exact canonical echo. The server still owns the ONE
    // pronoun edit. Different pointing, kind, scope or spelling is never repaired.
    const canonicalEcho = lock && edit.from === lock.from && edit.to === lock.to && edit.kind === 'person' && typeof edit.after === 'string'
      && (edit.after.normalize('NFC') === lock.after.normalize('NFC') || edit.after === depoint(lock.after));
    if (canonicalEcho) return [];
    demand(!lockedSpan || span.end <= lockedSpan.start || span.start >= lockedSpan.end);
    return [{ start: span.start, end: span.end, before: span.text, after: edit.after, kind: edit.kind, note: editNote(edit.kind, req) }];
  })].sort((a, b) => a.start - b.start || a.end - b.end);
  demand(edits.every((edit, i) => !i || edit.start >= edits[i - 1].end));
  const he = edits.reduce((value, edit, i) => value + req.base.slice(i ? edits[i - 1].end : 0, edit.start) + edit.after, '') + req.base.slice(edits.length ? edits.at(-1).end : 0);
  return { ...meta, he, meaning: out.meaning, applied: { ...req.target }, subjectId: req.subject.id, edits };
}
function parseOutput(raw, req, freshProvider = false) {
  demand(typeof raw === 'string' || record(raw));
  const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw);
  demand(typeof serialized === 'string' && bytes(serialized) <= config.maxOutputBytes);
  const out = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return validateOutput(freshProvider ? adaptProvider(out, req) : out, req);
}
function providerPayload(result) {
  demand(record(result));
  // A parseable partial object is still a truncated generation. Never use the
  // reasoning channel as answer content, regardless of the wrapper supplied.
  demand(!Array.isArray(result.choices) || !result.choices.some(choice => choice?.finish_reason === 'length'));
  if (result.response !== undefined && result.response !== null) return result.response;
  if (result.result !== undefined && result.result !== null) return result.result;
  demand(Array.isArray(result.choices) && result.choices.length === 1);
  const content = result.choices[0]?.message?.content;
  demand(typeof content === 'string');
  return content;
}
export async function sentenceFormQuota(check) {
  try { return await bounded(check, config.ioTimeoutMs); } catch { return false; }
}
export async function sentenceForm(request, env, ctx, responder) {
  const respond = (body, status) => {
    const response = responder(body, status);
    const headers = new Headers(response.headers);
    headers.set(config.versionHeader, config.cacheVersion);
    return new Response(response.body, { status: response.status, headers });
  };
  try {
    const req = validateRequest(await readBody(request));
    if (req.op === 'transform' && req.temporalChoice === null && protectedSpans(req.base).length) return respond(choice(req), 200);
    const cache = globalThis.caches?.default;
    const key = await cacheKey(req);
    try {
      const hit = cache && await bounded(() => cache.match(key), config.ioTimeoutMs);
      if (hit) {
        const out = parseOutput(await bounded(() => hit.text(), config.ioTimeoutMs), req);
        if (out.status === 'ok') return respond(out, 200);
      }
    } catch { /* An unavailable or corrupt cache is a miss, never trusted output. */ }
    const result = await bounded(() => env.AI.run(config.model, {
      messages: [
        { role: 'system', content: req.op === 'analyze' ? config.analyzePrompt : config.transformPrompt },
        { role: 'user', content: JSON.stringify(providerInput(req)) },
      ],
      response_format: config.responseFormat,
      temperature: config.temperature, max_tokens: config.maxTokens,
    }), config.timeoutMs);
    const out = parseOutput(providerPayload(result), req, true);
    if (out.status === 'ok' && cache && ctx?.waitUntil) ctx.waitUntil(bounded(() => cache.put(key, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + config.cacheTtlSeconds } })), config.ioTimeoutMs).catch(() => {}));
    return respond(out, 200);
  } catch (error) {
    return respond({ error: error instanceof Failure ? error.message : 'provider unavailable' }, error instanceof Failure ? error.status : 502);
  }
}
