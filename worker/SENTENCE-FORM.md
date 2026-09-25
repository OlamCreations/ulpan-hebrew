# Sentence form v1

`POST /sentence-form` implements separate analyze/transform operations. `/form` remains unchanged. Existing device/IP AI quota buckets apply before cache access and fail closed, with bounded waits on this route. Disallowed browser origins get 403; direct callers without Origin remain allowed as on existing routes. CORS is not authentication.

## External contract

1. Analyze request: `{version:1,op:"analyze",base,lang:"fr"|"en"}`. Success: `{version,status:"ok",subjects,mainSubjectId,provenance:"generated"}`. Each subject has `id,label,anchor,person,number,gender,tense`; detected features can be null. Main ID is null or an existing subject ID.
2. Transform request: `{version:1,op:"transform",base,lang,subject,target,temporalChoice}`. Subject is the complete analyzed subject. Target explicitly supplies person (`1/2/3` strings), number (`sg/pl`), gender (`m/f`) and tense (`past/present/future`). Temporal choice is null, `preserve`, or `remove`.
3. Transform success: `{version,status:"ok",he,meaning,applied,subjectId,edits,provenance:"generated"}`. Each edit has `start,end,before,after,kind,note`; kinds are agreement/person/tense/temporal. Source-ordered nonoverlapping edits reconstruct exactly `he`. Applied target and subject ID equal the request. Meaning covers the whole resulting sentence. Empty edits are allowed for unchanged forms.
4. Abstention: `{version,status:"unsupported",reason,provenance}`. Temporal choice: `{version,status:"needs-choice",reason,choices:[{id:"preserve",label},{id:"remove",label}],provenance}`. Neither contains `he`.

Both operations optionally accept `sourceMeaning`, a string bounded by maxTextLength (1,200 UTF-16 units). It is forwarded unchanged as data and included in cache identity; absence stays backward compatible. It supplies the original sentence sense, not a prior variant or instructions. The prompt preserves finite actions rather than reinterpreting them as occupations, but this instruction is not a semantic guarantee.

Base is immutable: never trimmed, normalized or depointed. Anchors are UTF-16 `[start,end)` indices into that exact base, with complete grapheme boundaries and exact source slices. Subject anchors must additionally begin and end at whole source-word boundaries. Request anchors and cached output are never repaired. IDs identify occurrences, not a global text replacement.

## Internal provider protocol, cache namespace v10

The provider no longer computes numeric offsets, echoes external metadata or reconstructs final Hebrew. The server segments the source into complete words and punctuation, omits whitespace tokens, and assigns stable `t0,t1,...` IDs. Exact UTF-16 ranges stay server-side; original whitespace between spans is retained. Separate external-config prompts handle each operation. All user strings are data, never instructions.

1. Analyze input contains `base,lang,sourceTokens:[{id,text}]`. Provider success is `{status:"ok",subjects:[{id,label,from,to,person,number,gender,tense}],mainSubjectId}`. Inclusive from/to token IDs become exact external source anchors. Punctuation-only subjects, unknown/reversed token IDs and extra fields are rejected.
2. Transform input adds selected subject with from/to token IDs, target, temporalChoice and token-based temporalReferences. Provider success is `{status:"ok",meaning,edits:[{from,to,after,kind}]}`. An optional provider note is type/size checked if present, but external notes are always server-generated. The adapter derives before, offsets and final he from immutable base, attaches requested identity/target and generated provenance, then runs the same strict external validator. An edit can expand one or more source words into multiple words when grammar requires it. Overlapping edits are rejected, not repaired.
3. Unsupported provider output is `{status:"unsupported",reason}`. An additional ambiguous temporal reference requires `{status:"needs-choice",reason,reference:{from,to}}` with valid actual source tokens; free-floating choice responses are rejected. A null temporalChoice alone is explicitly not a reason to ask. The model must determine that the referenced words are genuinely temporal; token existence is not semantic proof.

For a selected standalone canonical personal pronoun, `lockedPronoun` fixes the replacement deterministically from the external JSON lexicon copied from Kita `display.personTags`. Recognition compares the entire source word without pointing; no prefix peeling or compound-subject guessing. The target uses explicit person/number/gender. If the same bare pronoun remains, original source pointing is preserved byte-exactly. Otherwise the server inserts the verified canonical pronoun. An exact redundant canonical echo on the identical token range with kind person is discarded: its after must be NFC-equal to the lock, or wholly unpointed and exactly equal to the bare lock. Duplicate safe echoes still contribute only the one server-owned edit. Wrong spelling, different pointing, wrong kind and larger overlapping spans are rejected; predicate-token expansion remains possible. Non-pronoun subjects stay model-controlled. Edit notes are deterministic localized labels selected by kind and temporal choice, not model boilerplate.

`X-Sentence-Form-Version` identifies the serving acceptance revision on responses generated inside the sentence-form handler, including its validation/provider failures. Its name is external-configured. This proves rollout at the responding colo; a deployment receipt alone does not. Earlier common origin/quota/body-header guards run outside this handler and do not carry this diagnostic header.

The sentence route alone uses `@cf/qwen/qwen3-30b-a3b-fp8` with thinking retained (no `/no_think` suffix), a 30-second deadline and 4,000 output tokens, following the principal's approved test profile. Existing `/form`, `/tr`, `/nat` and other model routes are unchanged. A single `choices[0].message.content` is accepted only as fallback when no response/result exists; reasoning channels are never parsed as output. `finish_reason:length` rejects even a parseable partial object.

Workers AI JSON mode is configured through `responseFormat:{type:"json_object"}`. Bounded object responses and unfenced JSON strings are accepted, both through strict provider and external schemas. No retries, fence stripping, fuzzy alignment or automatic correction calls. Numeric-offset provider compatibility was intentionally retired after observed partial-word output; no client API change.

## Foreign-letter protection

The resulting Hebrew cannot introduce or duplicate foreign-letter runs absent from the immutable source. The configured Unicode pattern covers letters and combining marks across non-Hebrew scripts, not just ASCII. Exact original foreign names such as David or Éli remain allowed, as do original numbers; no transliteration or normalization is used to invent an allowance. This check applies to fresh and cached external outputs. The prompt reinforces that edits.after is Hebrew, while only meaning uses requested lang. This prevents the observed French predicate leaking into the Hebrew field; it is not a complete semantic validator.

## Temporal protection

The local guard catches configured explicit date/time/duration patterns, complete ISO dates and temporal words, including pointed variants. Bare integer/decimal quantities and quantity ranges do not trigger it. Protected references require preserve/remove before inference. Other ambiguity remains a model responsibility, with an explicit source reference required.

Clear yesterday/today/tomorrow adaptations require temporal edit disclosure. Protected and relative spans are detected independently of provider edit kinds. Preserve requires byte-exact no-op temporal edits with notes covering every identified reference. Remove requires anchored temporal deletions covering every reference, never replacement dates. Adjacent replacements and boundary extensions count as touching protected spans. The provider receives these references mapped to source tokens and can combine overlapping spans into disjoint edits.

## Limits, errors and cache

All new prompts, schemas, labels, model parameters and limits live in `src/sentence-form.config.json`. Defaults: 600 UTF-16 base units; 10,000 actual request bytes; 24,000 provider-output bytes; 12 subjects; 48 edits; provider deadline 30 seconds; individual quota/body/cache deadline 1.5 seconds. Errors: 400 invalid request, 413 oversized, 429 quota unavailable/denied, 502 provider/validation failure, 504 deadline. Provider diagnostics are not exposed.

Only validated external `ok` payloads enter Workers Cache API, with a one-day TTL and no in-isolate unbounded map. Hashed keys include acceptance version, model, operation, exact base, language, complete subject/anchor, target and temporal choice. Cache reads are strictly revalidated, never adapted. Cache faults become misses; write failures are contained. CORS is applied per caller. Response timeout cannot guarantee cancellation of an already-started Workers AI inference, but late results are not cached.

## Verification and evidence boundary

Run synchronously:

`node --test D:/dev/projects/ulpan-hebrew/worker/test/sentence-form-test.mjs`

`node D:/dev/projects/ulpan-hebrew/worker/test/tr-route-test.mjs`

`node D:/dev/projects/ulpan-hebrew/worker/test/dicta-headers-test.mjs`

These run the real Worker fetch route with mocked AI, limiter and cache; outgoing fetch is forbidden. Fixtures include the exact partial-word analysis and unreferenced temporal-choice failures captured by the principal in `D:/dev/.scratch/kita10-sentence-forms/live-results.json`. Structural mocks prove transport, reconstruction and safeguards, not Hebrew quality, semantic preservation or complete temporal recognition. Real calls and deployment are owned by the principal, not these tests. No client-side transliteration is generated here.
