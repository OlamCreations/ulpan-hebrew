/* Where the site lives, derived from this script's own URL rather than from the document.
   Pages sit one level deep (lessons/, roots/, liturgy/, reference/) while the home sits at the
   root, so anything resolved against location.href breaks on one of the two. app.js is served
   from the assets folder, so its own directory IS the asset base and its parent IS the site root.
   Nothing here needs to know what those folders are called. */
window.ULPAN_ASSETS = (function () {
  var s = document.currentScript;
  if (!s) {
    s = Array.prototype.filter.call(document.scripts, function (x) {
      return /\/app\.js(\?|$)/.test(x.src || '');
    }).pop();
  }
  return s && s.src ? new URL('./', s.src).href : new URL('./', location.href).href;
})();
window.ULPAN_BASE = new URL('../', window.ULPAN_ASSETS).href;

const HEBREW_VOICE_PREFS = ['Microsoft Asaf', 'Carmit', 'Asaf', 'he-IL'];
const MALE_PATTERNS = /asaf|male|david|microsoft.*hebrew.*male/i;
const FEMALE_PATTERNS = /carmit|hila|female|microsoft.*hebrew.*female|רינה|riny|stella/i;

let cachedVoice = null;
let voiceCheckDone = false;

function getVoiceGenderPref() {
  try { return localStorage.getItem('voice-gender') || 'auto'; }
  catch (e) { return 'auto'; }
}

function setVoiceGenderPref(pref) {
  try { localStorage.setItem('voice-gender', pref); } catch (e) {}
  cachedVoice = null;  // force re-pick on next call
}

function pickHebrewVoice() {
  if (cachedVoice) return cachedVoice;
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  const heVoices = voices.filter(v => v.lang && v.lang.startsWith('he'));
  if (!heVoices.length) return null;

  const pref = getVoiceGenderPref();
  if (pref === 'male') {
    const male = heVoices.find(v => MALE_PATTERNS.test(v.name));
    if (male) { cachedVoice = male; return male; }
  } else if (pref === 'female') {
    const female = heVoices.find(v => FEMALE_PATTERNS.test(v.name));
    if (female) { cachedVoice = female; return female; }
  }
  // Auto / fallback
  for (const p of HEBREW_VOICE_PREFS) {
    const v = heVoices.find(v => v.name.includes(p));
    if (v) { cachedVoice = v; return v; }
  }
  cachedVoice = heVoices[0];
  return cachedVoice;
}

function hasHebrewVoice() {
  return pickHebrewVoice() !== null;
}

// Try Web Speech API first regardless of getVoices(), Chrome can speak via
// the OS Hebrew engine (Microsoft Asaf, Carmit) even when the voice isn't yet
// listed in getVoices(). We detect silent failure via a 600ms watchdog and
// fall back to cloud TTS only when the engine truly didn't speak.
// Track if web speech actually started so we don't double-up with cloud TTS.
let webSpeechStartedRecently = false;
function tryWebSpeech(text, rate) {
  webSpeechStartedRecently = false;
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) return reject(new Error('no-api'));
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'he-IL';
    u.rate = rate;
    const v = pickHebrewVoice();
    if (v) u.voice = v;

    let settled = false;
    const finish = (ok, why) => {
      if (settled) return;
      settled = true;
      if (ok) resolve();
      else { console.warn('[ulpan-hebrew] webspeech failed:', why); reject(new Error(why)); }
    };
    u.onend = () => finish(true);
    u.onerror = e => finish(false, 'error:' + (e && e.error));
    u.onstart = () => { webSpeechStartedRecently = true; /* engine producing audio */ };

    speechSynthesis.speak(u);

    // Watchdog: if after 600ms nothing started, the engine failed silently
    setTimeout(() => {
      if (!settled && !speechSynthesis.speaking && !speechSynthesis.pending) {
        finish(false, 'silent');
      }
    }, 600);
  });
}

let cloudWarned = false;
function speak(text, rate = 0.85) {
  // Always cancel any prior audio + speech to avoid doubled voices
  if (cloudAudio) { try { cloudAudio.pause(); } catch (e) {} cloudAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();

  return tryWebSpeech(text, rate).catch(() => {
    // If web speech actually started speaking before erroring, DO NOT fall back
    // to cloud TTS, that's the cause of the doubled (male+female) playback.
    if (webSpeechStartedRecently) return Promise.resolve();

    const voices = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
    const hasHe = voices.some(v => v.lang && v.lang.startsWith('he'));
    if (!hasHe) {
      if (!cloudWarned) {
        cloudWarned = true;
        flashHint('No Hebrew voice loaded in Chrome. Fully quit Chrome (kill all chrome.exe in Task Manager) and reopen, Microsoft Asaf will then be detected.');
      }
      return Promise.resolve();
    }
    return speakViaCloudTTS(text);
  });
}

let cloudAudio = null;
let audioPrimed = false;

// Prime the HTML5 Audio context on the very first user gesture anywhere on the
// page. Without this, browsers (Chrome strict autoplay, Safari, Firefox)
// reject audio.play() promises silently when called from a deeper async path.
function primeAudioContext() {
  if (audioPrimed) return;
  audioPrimed = true;
  try {
    const silent = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
    silent.volume = 0.01;
    const p = silent.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
  if ('speechSynthesis' in window) {
    try {
      const u = new SpeechSynthesisUtterance('');
      speechSynthesis.speak(u);
    } catch (e) {}
  }
}
document.addEventListener('pointerdown', primeAudioContext, { capture: true });
document.addEventListener('keydown', primeAudioContext, { capture: true });

// Global delegated handler for word-row play buttons.
// Catches both app.js-rendered and lesson-inline-rendered (mastery lessons)
// buttons that aren't wired up by their lesson's own scripts.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.word-row button.icon-btn, .tb-row button.icon-btn');
  if (!btn) return;
  if (btn.classList.contains('srs-btn')) return;
  // Don't fire twice if the lesson already wired its own handler, but since
  // most lesson handlers stopPropagation, we'd already be skipped by then.
  e.preventDefault();
  e.stopPropagation();
  let text = btn.getAttribute('data-text') || btn.dataset.text;
  if (!text) {
    const row = btn.closest('.word-row, .tb-row');
    const heEl = row && row.querySelector('.he, .tb-he');
    text = (heEl && (heEl.dataset.he || heEl.textContent || '')).trim();
  }
  if (text) {
    btn.classList.add('playing');
    const clear = () => btn.classList.remove('playing');
    try { speak(text, 0.85); } finally {
      // Heuristic timeout: speak() is async; ~180ms per Hebrew word is a safe upper bound
      const ms = Math.max(900, Math.min(4500, text.length * 110));
      setTimeout(clear, ms);
    }
  }
}, { capture: true });  // capture phase so we win over inline handlers that stopPropagation
function speakViaCloudTTS(text) {
  const cleaned = stripNiqqud(text).trim();
  if (!cleaned) return Promise.resolve();
  if (cloudAudio) { cloudAudio.pause(); cloudAudio = null; }
  const chunks = chunkText(cleaned, 180);
  return playCloudChunks(chunks);
}
function chunkText(text, max) {
  if (text.length <= max) return [text];
  const out = []; let cur = '';
  text.split(/([,\.\?\!]\s*|\s+)/).forEach(part => {
    if ((cur + part).length > max) { if (cur) out.push(cur); cur = part; }
    else cur += part;
  });
  if (cur) out.push(cur);
  return out;
}
// StreamElements TTS, free, supports Carmit (Hebrew, he-IL). Reuses a single
// Audio element across calls; a fresh `new Audio()` per click breaks the
// user-gesture context on Safari/iOS and triggers autoplay-policy rejection.
// No `crossOrigin`, plain <audio> playback doesn't need CORS, and setting
// it forces a preflight that the StreamElements CDN rejects.
function getCloudAudio() {
  if (!cloudAudio) {
    cloudAudio = new Audio();
    cloudAudio.preload = 'auto';
  }
  return cloudAudio;
}

function ttsURL(text) {
  // Google Translate TTS, public, supports Hebrew (tl=iw), no auth.
  // No CORS headers but plain <audio> playback doesn't need CORS.
  return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=iw&client=tw-ob`;
}

function loadAndPlay(audio, url, label) {
  return new Promise(resolve => {
    audio.onended = null;
    audio.onerror = null;
    audio.src = url;
    audio.onended = resolve;
    audio.onerror = () => {
      console.warn('[ulpan-hebrew] tts onerror', label, audio.error);
      flashHint('Hebrew audio unavailable. Install an OS voice (banner) or click the 🔊 Forvo link.');
      resolve();
    };
    try {
      const p = audio.play();
      if (p && p.catch) {
        p.catch(err => {
          console.warn('[ulpan-hebrew] play() rejected', label, err && err.name, err && err.message);
          flashHint('Browser blocked audio. Tap ▶ once and then again, gesture context now armed.');
          resolve();
        });
      }
    } catch (e) {
      console.warn('[ulpan-hebrew] play() threw', e);
      resolve();
    }
  });
}

// Plays cloud TTS. The first chunk MUST execute synchronously inside the
// user-gesture call stack, wrapping it in chunks.reduce(...).then() defers
// the first play() to a microtask and modern browsers reject it as autoplay.
function playCloudChunks(chunks) {
  primeAudioContext();
  const audio = getCloudAudio();
  if (chunks.length === 0) return Promise.resolve();
  // First chunk: synchronous, preserves the click gesture
  let chain = loadAndPlay(audio, ttsURL(chunks[0]), 'chunk0');
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i];
    chain = chain.then(() => loadAndPlay(audio, ttsURL(c), 'chunk' + i));
  }
  return chain;
}

function stripNiqqud(text) {
  return (text || '').replace(/[֑-ׇ]/g, '');
}
window.stripNiqqud = stripNiqqud;

function forvoLink(hebrewText) {
  const cleaned = stripNiqqud(hebrewText).split(/\s+/)[0];
  return `https://forvo.com/word/${encodeURIComponent(cleaned)}/#he`;
}

function detectOS() {
  const ua = navigator.userAgent;
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  // iPadOS 13+ reports as "Mac" but has touch, disambiguate before desktop Mac.
  const iPadOS = /Mac/i.test(platform) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Mac/i.test(ua) || /Mac/i.test(platform)) return 'mac';
  if (/Windows|Win32|Win64/.test(ua) || /Win/i.test(platform)) return 'windows';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
}

function showVoiceBanner(force) {
  if (force) localStorage.removeItem('voice-banner-dismissed');
  const existing = document.getElementById('voice-banner');
  if (existing) { existing.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const os = detectOS();
  const winOpen = os === 'windows' ? ' open' : '';
  const macOpen = os === 'mac' ? ' open' : '';
  const iosOpen = os === 'ios' ? ' open' : '';
  const androidOpen = os === 'android' ? ' open' : '';
  const banner = document.createElement('div');
  banner.id = 'voice-banner';
  banner.className = 'voice-banner';
  banner.innerHTML = `
    <div class="voice-banner-inner">
      <div class="voice-banner-head">
        <div class="voice-banner-title">🔊 Install a Hebrew voice for instant offline audio</div>
        <button class="voice-banner-close" aria-label="Dismiss">×</button>
      </div>
      <div class="voice-banner-sub">
        Without a system voice, the page uses a slow online fallback that some browsers block.
        Install once, the page detects it automatically on next refresh.
      </div>

      <details class="voice-banner-os"${winOpen}>
        <summary><span class="os-icon">🪟</span> Windows 10 / 11, Microsoft Asaf voice</summary>
        <ol class="voice-banner-steps">
          <li>Open <strong>Settings</strong> (Win + I) → <strong>Time &amp; language</strong> → <strong>Language &amp; region</strong>.</li>
          <li>Click <strong>Add a language</strong>, type <em>Hebrew</em>, select <strong>עברית (Hebrew)</strong>, click <strong>Next</strong>.</li>
          <li>In <em>Optional language features</em>, tick <strong>Speech</strong>. (You can untick the others.) Click <strong>Install</strong>.</li>
          <li>Wait ~50 MB download. Then go to <strong>Settings → Accessibility → Narrator → Add natural voices</strong> and add <strong>Microsoft Asaf</strong> if shown.</li>
          <li>Restart your browser, then hard-refresh this page (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>).</li>
        </ol>
        <div class="voice-banner-verify">
          Verify in PowerShell:
          <pre>Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | % { $_.VoiceInfo.Name + ', ' + $_.VoiceInfo.Culture }</pre>
          You should see <code>Microsoft Asaf, he-IL</code>.
        </div>
        <a class="voice-banner-link" href="https://support.microsoft.com/en-us/windows/download-languages-and-voices-for-narrator-tts-and-speech-recognition-d2503ad3-ad42-4d3b-b3d2-0ae599cc939e" target="_blank" rel="noopener">Microsoft documentation →</a>
      </details>

      <details class="voice-banner-os"${macOpen}>
        <summary><span class="os-icon"></span> macOS, Carmit voice</summary>
        <ol class="voice-banner-steps">
          <li>Open <strong>System Settings</strong> → <strong>Accessibility</strong> → <strong>Spoken Content</strong>.</li>
          <li>Click the <strong>System voice</strong> dropdown → <strong>Manage Voices…</strong></li>
          <li>Scroll to <strong>Hebrew</strong> → tick <strong>Carmit</strong> (or <strong>Carmit (Premium)</strong> for the high-quality version, ~50 MB).</li>
          <li>Wait for download to finish. Set system voice back to your usual one (Carmit only needs to be installed, not active).</li>
          <li>Restart your browser, then hard-refresh this page (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>).</li>
        </ol>
        <div class="voice-banner-verify">
          Verify in Terminal: <pre>say -v '?' | grep -i hebrew</pre>
          You should see <code>Carmit  he_IL</code>.
        </div>
        <a class="voice-banner-link" href="https://support.apple.com/guide/mac-help/change-the-voice-your-mac-uses-to-speak-text-mchlp2290/mac" target="_blank" rel="noopener">Apple documentation →</a>
      </details>

      <details class="voice-banner-os"${iosOpen}>
        <summary><span class="os-icon"></span> iPhone / iPad, Carmit voice</summary>
        <ol class="voice-banner-steps">
          <li>Open <strong>Settings</strong> → <strong>Accessibility</strong> → <strong>Spoken Content</strong>.</li>
          <li>Tap <strong>Voices</strong> → <strong>Hebrew</strong> → <strong>Carmit</strong>, then tap the cloud icon to download (~30 MB).</li>
          <li>Wait for the download to finish (Wi-Fi recommended).</li>
          <li>Fully close your browser (swipe it away in the app switcher) and reopen this page.</li>
        </ol>
        <div class="voice-banner-verify">
          Tip: on iOS, audio only plays after you tap a <strong>▶</strong> button once, Safari blocks autoplay until you interact.
        </div>
        <a class="voice-banner-link" href="https://support.apple.com/en-us/HT211135" target="_blank" rel="noopener">Apple documentation →</a>
      </details>

      <details class="voice-banner-os"${androidOpen}>
        <summary><span class="os-icon">🤖</span> Android, Google Hebrew voice</summary>
        <ol class="voice-banner-steps">
          <li>Open <strong>Settings</strong> → <strong>Accessibility</strong> → <strong>Text-to-speech output</strong> (or search <em>text-to-speech</em>).</li>
          <li>Make sure the engine is <strong>Speech Services by Google</strong>, then tap its <strong>⚙ gear</strong> → <strong>Install voice data</strong>.</li>
          <li>Pick <strong>עברית (Hebrew)</strong> and download a voice.</li>
          <li>Restart Chrome, then reopen this page.</li>
        </ol>
        <div class="voice-banner-verify">
          If you have no Google TTS engine, install <strong>Speech Services by Google</strong> from the Play Store first.
        </div>
        <a class="voice-banner-link" href="https://support.google.com/accessibility/android/answer/6006983" target="_blank" rel="noopener">Google documentation →</a>
      </details>

      <div class="voice-banner-foot">
        Skip install? The <span class="forvo-icon">🔊</span> next to each word opens Forvo (real native recordings), works on every browser without setup.
      </div>
    </div>
  `;
  document.body.insertBefore(banner, document.body.firstChild);
  banner.querySelector('.voice-banner-close').addEventListener('click', () => {
    banner.remove();
    localStorage.setItem('voice-banner-dismissed', '1');
  });
}

function setupAudioButtons() {
  voiceCheckDone = true;
  const hasVoice = hasHebrewVoice();
  if (!hasVoice && !localStorage.getItem('voice-banner-dismissed')) {
    showVoiceBanner();
  }
  // Cloud TTS works without local voice, buttons stay functional.
  // Add a small Forvo extra-link next to each row's button as backup for tricky words.
  if (!hasVoice) {
    document.querySelectorAll('.word-row').forEach(row => {
      if (row.querySelector('.forvo-link')) return;
      const heEl = row.querySelector('.he');
      const heText = heEl?.textContent || '';
      if (!heText) return;
      const link = document.createElement('a');
      link.className = 'forvo-link';
      link.href = forvoLink(heText);
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = 'Native recording on Forvo';
      link.textContent = '🔊';
      link.style.cssText = 'margin-left:6px;text-decoration:none;font-size:14px;opacity:0.5;';
      const btn = row.querySelector('button.icon-btn');
      if (btn) btn.parentElement.appendChild(link);
    });
  }
}

if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => {
    cachedVoice = null;
    pickHebrewVoice();
    if (!voiceCheckDone && hasHebrewVoice()) voiceCheckDone = true;
  };
  setTimeout(() => pickHebrewVoice(), 200);
}

window.addEventListener('DOMContentLoaded', () => {
  // Run synchronously so there is no window where the baked-in ▶ buttons expose the raw glyph as
  // their name, and Hebrew nodes are tagged lang/dir before the first screen-reader pass.
  a11yIconButtons();
  a11yLangDir();
  setupNiqqudToggle();
  setupCursiveToggle();
  setTimeout(() => { if (!voiceCheckDone) setupAudioButtons(); }, 1000);
  setTimeout(() => { autoInjectExercises(); recordDailyStreak(); injectFloatingControls(); enableTextBlockAutoPlay(); setupRevealToggle(); enhanceIndexNavTooltips(); a11yIconButtons(); }, 250);
});

// Lesson play buttons are baked into ~500 HTML files as `<button class="icon-btn">▶</button>`
// (CSS paints the triangle via a mask, font-size:0). The raw ▶ text node becomes the screen-
// reader name, beating the title. Fix at runtime for every page instead of editing 500 files:
// give a real aria-label and hide the glyph from assistive tech.
function a11yIconButtons() {
  document.querySelectorAll('.icon-btn').forEach(b => {
    if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', b.title || 'Listen');
    if (b.textContent.trim() === '▶' && !b.querySelector('span')) b.innerHTML = '<span aria-hidden="true">▶</span>';
  });
}

// Hebrew text carries its direction only via CSS `direction:rtl` (which assistive tech ignores)
// and inherits lang="en" from <html>. Tag every Hebrew node at runtime — same approach as the
// icon-button fix — so screen readers switch to a Hebrew voice and expose RTL, without editing
// the ~500 baked HTML files.
function a11yLangDir() {
  document.querySelectorAll('.he, .tb-he, .title-he, .hd-he, .stich-words .he').forEach(el => {
    if (!el.getAttribute('lang')) el.setAttribute('lang', 'he');
    if (!el.getAttribute('dir')) el.setAttribute('dir', 'rtl');
  });
}

/* ---------- Index nav tooltips (matrix of lesson numbers) ---------- */
function enhanceIndexNavTooltips() {
  // Run only on index, detected by presence of multiple `.lesson-card` and a top nav matrix
  const cards = document.querySelectorAll('a.lesson-card[href$=".html"]');
  if (cards.length < 5) return;
  const map = {};
  cards.forEach(card => {
    const href = card.getAttribute('href');
    const titleFr = card.querySelector('.title-fr')?.textContent.trim() || '';
    const titleHe = card.querySelector('.title-he')?.textContent.trim() || '';
    const meta = card.querySelector('.meta')?.textContent.trim() || '';
    if (href) map[href] = { titleFr, titleHe, meta };
  });
  document.querySelectorAll('a[href$=".html"]').forEach(a => {
    if (a.classList.contains('lesson-card')) return;
    const href = a.getAttribute('href');
    if (!map[href]) return;
    const { titleFr, titleHe, meta } = map[href];
    const tip = [titleFr, titleHe, meta].filter(Boolean).join(' · ');
    if (tip) a.setAttribute('title', tip);
  });
}

/* ---------- Click-to-reveal translit and translation ---------- */
function revealAll(state) {
  document.querySelectorAll('.word-row .translit, .word-row .fr, .tb-translit, .tb-fr').forEach(el => {
    setReveal(el, !!state);
  });
}

function wrapRevealCards() {
  const targets = document.querySelectorAll('.word-row .translit, .word-row .fr, .tb-translit, .tb-fr');
  targets.forEach(el => {
    if (el.querySelector(':scope > .reveal-inner')) return;
    const original = el.innerHTML;
    if (!original.trim()) return;
    // The answer (.reveal-front) starts hidden from assistive tech too — otherwise a screen-reader
    // user hears it while it is visually concealed, defeating the study mechanic. Toggled in lockstep
    // with the `.revealed` class (see setReveal).
    el.innerHTML = `<span class="reveal-inner"><span class="reveal-front" aria-hidden="true">${original}</span><span class="reveal-back" aria-hidden="true">•••</span></span>`;
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'Reveal answer');
  });
}

// Keep the visual, ARIA-pressed, hidden-from-AT, and label states of a reveal cell consistent.
function setReveal(card, shown) {
  card.classList.toggle('revealed', shown);
  card.setAttribute('aria-pressed', shown ? 'true' : 'false');
  card.setAttribute('aria-label', shown ? 'Hide answer' : 'Reveal answer');
  const front = card.querySelector('.reveal-front');
  if (front) front.setAttribute('aria-hidden', shown ? 'false' : 'true');
}

function setupRevealToggle() {
  wrapRevealCards();
  injectPerCardSRS();
  // Re-wrap when DOM changes (lessons inject content after R() runs). Coalesce bursts into one
  // rAF pass — otherwise every flashcard flip and every translator keystroke triggers three
  // full-document scans, which janks long lesson pages on a phone.
  let rescanPending = false;
  const rescan = () => { rescanPending = false; wrapRevealCards(); injectPerCardSRS(); a11yIconButtons(); a11yLangDir(); };
  const obs = new MutationObserver(() => { if (rescanPending) return; rescanPending = true; requestAnimationFrame(rescan); });
  obs.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => {
    if (e.target.closest('.srs-btn')) return;
    const card = e.target.closest('.word-row .translit, .word-row .fr, .tb-translit, .tb-fr');
    if (!card) return;
    setReveal(card, !card.classList.contains('revealed'));
    e.stopPropagation();
  });
  // Keyboard parity: Enter/Space reveals the focused cell. stopPropagation so Space does not also
  // reach the floating-controls handler and flip the flashcard on the same press.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const card = e.target.closest && e.target.closest('.word-row .translit, .word-row .fr, .tb-translit, .tb-fr');
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    setReveal(card, !card.classList.contains('revealed'));
  });
}

function getCurrentLessonId() {
  return location.pathname.split(/[\\/]/).pop().replace('.html', '');
}

function isInSRS(he) {
  const lessonId = getCurrentLessonId();
  const all = JSON.parse(localStorage.getItem('hebrew-sr') || '{}');
  return !!all[lessonId + '|' + he];
}

function injectPerCardSRS() {
  const lessonId = getCurrentLessonId();
  if (lessonId === 'index') return;
  document.querySelectorAll('.word-row').forEach(row => {
    if (row.querySelector('.srs-btn')) {
      // refresh state
      const heEl = row.querySelector('.he');
      if (heEl) {
        const btn = row.querySelector('.srs-btn');
        const inSet = isInSRS(heEl.textContent);
        btn.classList.toggle('active', inSet);
        btn.title = inSet ? 'Already in spaced-repetition' : 'Add to spaced-repetition';
        btn.setAttribute('aria-label', btn.title);
      }
      return;
    }
    const heEl = row.querySelector('.he');
    const translitEl = row.querySelector('.translit .reveal-front, .translit');
    const frEl = row.querySelector('.fr .reveal-front, .fr');
    if (!heEl) return;
    const he = heEl.textContent.trim();
    const translit = (translitEl ? translitEl.textContent : '').trim();
    const fr = (frEl ? frEl.textContent : '').trim();
    const btn = document.createElement('button');
    btn.className = 'srs-btn';
    btn.type = 'button';
    const inSet = isInSRS(he);
    btn.classList.toggle('active', inSet);
    btn.title = inSet ? 'Already in spaced-repetition' : 'Add to spaced-repetition';
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      srAddCard({ he, translit, fr }, lessonId);
      btn.classList.add('active');
      btn.title = 'Already in spaced-repetition';
      btn.setAttribute('aria-label', btn.title);
    });
    // place before the play button if any, else append
    const play = row.querySelector('button.icon-btn');
    if (play) row.insertBefore(btn, play);
    else row.appendChild(btn);
  });
}

/* ---------- Daily Streak Tracker ---------- */
function recordDailyStreak() {
  const today = new Date().toISOString().slice(0, 10);
  const data = JSON.parse(localStorage.getItem('hebrew-streak') || '{}');
  if (data.last === today) return;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (data.last === yesterday) data.streak = (data.streak || 0) + 1;
  else data.streak = 1;
  data.last = today;
  data.history = data.history || [];
  if (!data.history.includes(today)) data.history.push(today);
  data.history = data.history.slice(-90);
  if ((data.best || 0) < data.streak) data.best = data.streak;
  localStorage.setItem('hebrew-streak', JSON.stringify(data));
}
function getStreak() {
  const data = JSON.parse(localStorage.getItem('hebrew-streak') || '{}');
  return { current: data.streak || 0, best: data.best || 0, history: data.history || [] };
}

/* ---------- Spaced Repetition (SM-2 simplified) ---------- */
function srGetCard(key) {
  const all = JSON.parse(localStorage.getItem('hebrew-sr') || '{}');
  return all[key] || { ease: 2.5, interval: 0, due: 0, reps: 0 };
}
function srUpdate(key, quality) {
  const all = JSON.parse(localStorage.getItem('hebrew-sr') || '{}');
  const card = all[key] || { ease: 2.5, interval: 0, due: 0, reps: 0 };
  if (quality < 3) {
    card.reps = 0;
    card.interval = 1;
  } else {
    if (card.reps === 0) card.interval = 1;
    else if (card.reps === 1) card.interval = 6;
    else card.interval = Math.round(card.interval * card.ease);
    card.reps++;
    card.ease = Math.max(1.3, card.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  }
  card.due = Date.now() + card.interval * 86400000;
  all[key] = card;
  localStorage.setItem('hebrew-sr', JSON.stringify(all));
}
function srGetDue() {
  const all = JSON.parse(localStorage.getItem('hebrew-sr') || '{}');
  const now = Date.now();
  return Object.entries(all).filter(([k, v]) => v.due <= now).map(([k, v]) => ({ key: k, ...v }));
}
function srAddCard(item, lessonId) {
  const key = (lessonId || '') + '|' + item.he;
  const all = JSON.parse(localStorage.getItem('hebrew-sr') || '{}');
  if (!all[key]) {
    all[key] = { ease: 2.5, interval: 0, due: Date.now(), reps: 0, he: item.he, translit: item.translit, fr: item.fr, lesson: lessonId };
    localStorage.setItem('hebrew-sr', JSON.stringify(all));
  }
}

function srAllCount() {
  return Object.keys(JSON.parse(localStorage.getItem('hebrew-sr') || '{}')).length;
}

function refreshSRSCount() {
  const badge = document.getElementById('fc-srs-count');
  if (!badge) return;
  const due = srGetDue().length;
  const total = srAllCount();
  if (total === 0) { badge.textContent = ''; badge.style.display = 'none'; return; }
  badge.style.display = '';
  badge.textContent = due > 0 ? ` ${due}` : ` 0/${total}`;
  badge.className = 'fc-badge' + (due > 0 ? ' fc-badge-due' : '');
}

// Make an overlay modal keyboard-accessible: focus in, trap Tab, Escape to close,
// restore focus on close. Shared by SRS, shortcuts and the home quiz overlays.
function makeModalAccessible(modal, dialog) {
  dialog = dialog || modal.querySelector('[role="dialog"]') || modal.firstElementChild || modal;
  try {
    if (!dialog.getAttribute('role')) dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
  } catch (e) {}
  const prev = document.activeElement;
  const focusables = () => Array.from(dialog.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'
  )).filter(el => el.offsetParent !== null);
  setTimeout(() => { const f = focusables(); (f[0] || dialog).focus(); }, 0);
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); modal.remove(); return; }
    if (e.key === 'Tab') {
      const items = focusables(); if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  const origRemove = modal.remove.bind(modal);
  modal.remove = function () { origRemove(); try { prev && prev.focus && prev.focus(); } catch (e) {} };
  return modal;
}

// Escape any field interpolated into innerHTML. The SRS/review data comes from localStorage
// (developer-authored lesson text today), but a future "save this translation to SRS" feature
// would feed third-party API text straight in — escape now so that can never become stored XSS.
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
window.escHtml = escHtml;
function openSRSReview() {
  const existing = document.getElementById('srs-modal');
  if (existing) existing.remove();
  const due = srGetDue();
  if (window.track) track('srs_review', 'due', (due && due.length) || 0);
  const totalAll = srAllCount();
  const modal = document.createElement('div');
  modal.id = 'srs-modal';
  modal.innerHTML = `<div class="srs-overlay"></div><div class="srs-card" role="dialog" aria-label="SRS review"></div>`;
  document.body.appendChild(modal);
  makeModalAccessible(modal, modal.querySelector('.srs-card'));
  modal.querySelector('.srs-overlay').addEventListener('click', () => modal.remove());

  const cardEl = modal.querySelector('.srs-card');
  if (totalAll === 0) {
    cardEl.innerHTML = `<button class="srs-close" aria-label="Close">×</button>
      <h2 style="margin:0 0 12px;font-size:22px;">No cards yet</h2>
      <p style="color:var(--text-dim);margin:0 0 20px;">Click the <strong>+</strong> button on any word to add it to your review queue.</p>`;
    cardEl.querySelector('.srs-close').addEventListener('click', () => modal.remove());
    return;
  }
  if (due.length === 0) {
    const all = JSON.parse(localStorage.getItem('hebrew-sr') || '{}');
    const next = Object.values(all).sort((a,b) => a.due - b.due)[0];
    const wait = Math.max(0, Math.round((next.due - Date.now()) / 60000));
    const waitTxt = wait < 60 ? `${wait} min` : wait < 1440 ? `${Math.round(wait/60)} h` : `${Math.round(wait/1440)} days`;
    cardEl.innerHTML = `<button class="srs-close" aria-label="Close">×</button>
      <h2 style="margin:0 0 12px;font-size:22px;">All caught up</h2>
      <p style="color:var(--text-dim);margin:0 0 8px;">${totalAll} card${totalAll>1?'s':''} in your deck.</p>
      <p style="color:var(--text-dim);margin:0 0 20px;">Next review in <strong>${waitTxt}</strong>.</p>`;
    cardEl.querySelector('.srs-close').addEventListener('click', () => modal.remove());
    return;
  }
  let queue = [...due];
  let current = null;
  let revealed = false;

  function getSrsNiqqud() {
    return localStorage.getItem('srs-niqqud') !== 'off';
  }
  function setSrsNiqqud(on) {
    localStorage.setItem('srs-niqqud', on ? 'on' : 'off');
  }
  function applySrsNiqqud() {
    const heEl = cardEl.querySelector('.srs-he');
    const trEl = cardEl.querySelector('.srs-translit');
    if (heEl && current) heEl.textContent = getSrsNiqqud() ? current.he : stripNiqqud(current.he);
    const tog = cardEl.querySelector('.srs-niqqud-toggle');
    if (tog) {
      tog.setAttribute('aria-pressed', getSrsNiqqud() ? 'true' : 'false');
      tog.querySelector('.label').textContent = getSrsNiqqud() ? 'Niqqud on' : 'Niqqud off';
    }
  }

  function renderNext() {
    if (queue.length === 0) {
      cardEl.innerHTML = `<button class="srs-close" aria-label="Close">×</button>
        <h2 style="margin:0 0 12px;font-size:22px;">Session complete</h2>
        <p style="color:var(--text-dim);margin:0 0 20px;">Reviewed ${due.length} card${due.length>1?'s':''}.</p>`;
      cardEl.querySelector('.srs-close').addEventListener('click', () => { modal.remove(); refreshSRSCount(); });
      return;
    }
    current = queue.shift();
    revealed = false;
    const heShown = getSrsNiqqud() ? current.he : stripNiqqud(current.he);
    cardEl.innerHTML = `
      <button class="srs-close" aria-label="Close">×</button>
      <div class="srs-topbar">
        <div class="srs-progress">${due.length - queue.length} / ${due.length}</div>
        <button class="srs-niqqud-toggle" type="button" aria-pressed="${getSrsNiqqud()}" title="Toggle niqqud (vowel marks)"><span class="dot"></span><span class="label">${getSrsNiqqud()?'Niqqud on':'Niqqud off'}</span></button>
      </div>
      <div class="srs-he" data-he="${escHtml(current.he)}">${escHtml(heShown)}</div>
      <button class="srs-listen" type="button" aria-label="Play audio">▶</button>
      <div class="srs-answer">
        <div class="srs-translit">${escHtml(current.translit||'')}</div>
        <div class="srs-fr">${escHtml(current.fr||'')}</div>
      </div>
      <div class="srs-actions">
        <button class="srs-show fc-btn" type="button">Show answer</button>
        <div class="srs-grade" hidden>
          <button class="srs-g srs-g-again" data-q="1" title="Again (&lt; 1 min)">Again</button>
          <button class="srs-g srs-g-hard" data-q="3" title="Hard">Hard</button>
          <button class="srs-g srs-g-good" data-q="4" title="Good">Good</button>
          <button class="srs-g srs-g-easy" data-q="5" title="Easy">Easy</button>
        </div>
      </div>`;
    cardEl.querySelector('.srs-close').addEventListener('click', () => { modal.remove(); refreshSRSCount(); });
    cardEl.querySelector('.srs-listen').addEventListener('click', () => speak(current.he, 0.85));
    cardEl.querySelector('.srs-he').addEventListener('click', () => speak(current.he, 0.85));
    cardEl.querySelector('.srs-niqqud-toggle').addEventListener('click', () => {
      setSrsNiqqud(!getSrsNiqqud());
      applySrsNiqqud();
    });
    cardEl.querySelector('.srs-show').addEventListener('click', () => {
      revealed = true;
      cardEl.querySelector('.srs-answer').classList.add('revealed');
      cardEl.querySelector('.srs-show').hidden = true;
      cardEl.querySelector('.srs-grade').hidden = false;
    });
    cardEl.querySelectorAll('.srs-g').forEach(b => {
      b.addEventListener('click', () => {
        const q = parseInt(b.dataset.q, 10);
        srUpdate(current.key, q);
        if (q === 1) queue.push(current); // again, re-queue this session
        renderNext();
        refreshSRSCount();
      });
    });
  }
  renderNext();
}

/* ---------- Theme (light/dark) ---------- */
function getCurrentTheme() {
  // Light is the default for new visitors (Jonas's call); dark is opt-in via toggle.
  return localStorage.getItem('theme') || 'light';
}
function applyTheme(theme) {
  if (theme === 'light') document.documentElement.classList.add('light');
  else document.documentElement.classList.remove('light');
  const btn = document.getElementById('fc-theme');
  if (btn) btn.innerHTML = getThemeIcon();
  const headerBtn = document.getElementById('header-theme-toggle');
  if (headerBtn) headerBtn.innerHTML = getThemeIcon(true);
}
function getThemeIcon(forHeader = false) {
  const t = getCurrentTheme();
  if (forHeader) return t === 'light' ? '<span class="ico">☾</span> Dark' : '<span class="ico">☀</span> Light';
  return t === 'light' ? '☾ Dark' : '☀ Light';
}
function toggleTheme() {
  const next = getCurrentTheme() === 'light' ? 'dark' : 'light';
  localStorage.setItem('theme', next);
  applyTheme(next);
}
// Apply theme as early as possible to avoid FOUC
(function initTheme() {
  if (document.body) applyTheme(getCurrentTheme());
  else document.addEventListener('DOMContentLoaded', () => applyTheme(getCurrentTheme()));
})();

/* ---------- Floating Controls (per-lesson) ---------- */
function injectFloatingControls() {
  if (document.getElementById('floating-controls')) return;
  const lesson = location.pathname.split(/[\\/]/).pop().replace('.html', '');
  // '' = directory index (served as '/…/'), 'home' likewise: the home uses the hamburger hub,
  // not the per-lesson floating bar (whose Show/Hide/Listen/Add actions are no-ops there).
  if (lesson === 'index' || lesson === '' || lesson === 'home') return;
  const el = document.createElement('div');
  el.id = 'floating-controls';
  el.innerHTML = `
    <a class="fc-btn fc-home" href="${window.ULPAN_BASE}index.html" title="Back to lessons index">← Index</a>
    <button class="fc-btn" id="fc-show-all" title="Reveal all translit & translation (R)">Show all</button>
    <button class="fc-btn" id="fc-hide-all" title="Hide all translit & translation (H)">Hide all</button>
    <button class="fc-btn" id="fc-theme" title="Toggle light/dark (T)">${getThemeIcon()}</button>
    <button class="fc-btn" id="fc-listen-all" title="Listen to all words (L)">▶ Listen all</button>
    <button class="fc-btn" id="fc-voice" title="Choose voice (Male / Female / Auto)" data-pref="${getVoiceGenderPref()}">${getVoiceGenderPref() === 'female' ? '♀ Female' : getVoiceGenderPref() === 'male' ? '♂ Male' : '♂ Auto'}</button>
    <button class="fc-btn" id="fc-no-sound" title="No audio? Install a Hebrew voice (per-OS guide)">🔊 No sound?</button>
    <button class="fc-btn" id="fc-print" title="Printable view (P)">🖨 Print</button>
    <button class="fc-btn" id="fc-add-sr" title="Add every word in this lesson to SRS (A)">＋ Add all</button>
    <button class="fc-btn" id="fc-srs" title="Spaced repetition review (S)">📚 SRS<span id="fc-srs-count" class="fc-badge"></span></button>
    <button class="fc-btn" id="fc-help" title="Keyboard shortcuts (?)">? Shortcuts</button>
  `;
  document.body.appendChild(el);
  document.getElementById('fc-show-all').addEventListener('click', () => revealAll(true));
  document.getElementById('fc-hide-all').addEventListener('click', () => revealAll(false));
  document.getElementById('fc-theme').addEventListener('click', () => toggleTheme());
  document.getElementById('fc-listen-all').addEventListener('click', () => listenAllWords());
  document.getElementById('fc-voice').addEventListener('click', e => {
    // Cycle: auto -> male -> female -> auto
    const cur = getVoiceGenderPref();
    const next = cur === 'auto' ? 'male' : cur === 'male' ? 'female' : 'auto';
    setVoiceGenderPref(next);
    const btn = e.target.closest('button');
    btn.textContent = (next === 'female' ? '♀ Female' : next === 'male' ? '♂ Male' : '♂ Auto');
    btn.dataset.pref = next;
    flashHint('Voice: ' + (next === 'auto' ? 'auto-detect' : next));
    // Audible test, use a Hebrew word from the current page if available,
    // otherwise a universal greeting so the user immediately hears the new voice.
    const heEl = document.querySelector('.word-row .he, .tb-he, .verses-grid .he');
    const testWord = (heEl && heEl.textContent.trim()) || 'שָׁלוֹם';
    setTimeout(() => speak(testWord, 0.85), 100);
  });
  document.getElementById('fc-no-sound').addEventListener('click', () => showVoiceBanner(true));
  document.getElementById('fc-print').addEventListener('click', () => printableView());
  document.getElementById('fc-add-sr').addEventListener('click', () => { addAllToSRS(lesson); injectPerCardSRS(); refreshSRSCount(); });
  document.getElementById('fc-srs').addEventListener('click', () => openSRSReview());
  document.getElementById('fc-help').addEventListener('click', showShortcutsHelp);
  refreshSRSCount();
  setInterval(refreshSRSCount, 3000);

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, [contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; // don't hijack Ctrl/Cmd+P/S etc.
    if (e.key === 'l' || e.key === 'L') { e.preventDefault(); listenAllWords(); }
    else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); printableView(); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); openSRSReview(); }
    else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); addAllToSRS(lesson); injectPerCardSRS(); refreshSRSCount(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); revealAll(true); }
    else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); revealAll(false); }
    else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      const niqq = document.querySelector('.niqqud-toggle');
      if (niqq) niqq.click();
    }
    else if (e.key === 't' || e.key === 'T') { e.preventDefault(); toggleTheme(); }
    // Only '?' opens help. '/' is owned by the hub's live-translator shortcut — sharing it opened
    // both modals at once on lesson pages.
    else if (e.key === '?') { e.preventDefault(); showShortcutsHelp(); }
    else if (e.key === '1' || e.key === '2') {
      const tab = document.querySelectorAll('.ex-tab')[parseInt(e.key) - 1];
      if (tab) { e.preventDefault(); tab.click(); }
    }
    else if (e.key === ' ') {
      // A focused reveal cell owns Space (it reveals); don't also flip the flashcard.
      if (document.activeElement && document.activeElement.closest('.word-row .translit, .word-row .fr, .tb-translit, .tb-fr')) return;
      const fcCard = document.getElementById('fc-card');
      if (fcCard) { e.preventDefault(); fcCard.click(); }
    }
    else if (e.key === 'ArrowRight') {
      const next = document.getElementById('fc-next');
      if (next) { e.preventDefault(); next.click(); }
    }
    else if (e.key === 'ArrowLeft') {
      const prev = document.getElementById('fc-prev');
      if (prev) { e.preventDefault(); prev.click(); }
    }
  });
}

function showShortcutsHelp() {
  if (document.getElementById('shortcuts-modal')) { document.getElementById('shortcuts-modal').remove(); return; }
  const m = document.createElement('div');
  m.id = 'shortcuts-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML = `<div aria-labelledby="shortcuts-title" style="background:var(--bg-card);border:1px solid var(--accent);border-radius:8px;padding:24px;max-width:480px;width:100%;">
    <h2 id="shortcuts-title" style="margin-bottom:16px;">Keyboard Shortcuts</h2>
    <table style="width:100%;font-size:14px;">
      <tr><td style="padding:6px 0;color:var(--text-dim);">L</td><td>Listen to all words</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">P</td><td>Printable view</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">S</td><td>Open SRS review</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">A</td><td>Add lesson words to SRS</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">R / H</td><td>Reveal / hide all</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">N</td><td>Toggle niqqud (vowel marks)</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">T</td><td>Toggle theme (dark / light)</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">1-2</td><td>Switch exercise mode (Flashcards / Listen)</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">Space</td><td>Flip flashcard</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">→ ←</td><td>Next/previous flashcard</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">?</td><td>This help</td></tr>
    </table>
    <button class="btn btn-primary" id="shortcuts-close" style="margin-top:16px;width:100%;">Got it</button>
  </div>`;
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  m.querySelector('#shortcuts-close').addEventListener('click', () => m.remove());
  document.body.appendChild(m);
  makeModalAccessible(m);
}

async function listenAllWords() {
  const items = collectLessonItems();
  const btn = document.getElementById('fc-listen-all');
  if (btn._stop) {
    btn._stop = false;
    speechSynthesis.cancel?.();
    if (cloudAudio) { cloudAudio.pause(); cloudAudio = null; }
    btn.textContent = '▶ Listen all';
    return;
  }
  btn._stop = true;
  btn.textContent = '⏹ Stop';
  for (const w of items) {
    if (!btn._stop) break;
    if (hasHebrewVoice()) {
      await new Promise(resolve => {
        const u = new SpeechSynthesisUtterance(w.he);
        u.lang = 'he-IL';
        u.rate = 0.8;
        const v = pickHebrewVoice();
        if (v) u.voice = v;
        u.onend = resolve;
        u.onerror = resolve;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      });
    } else {
      await speakViaCloudTTS(w.he);
    }
  }
  btn._stop = false;
  btn.textContent = '▶ Listen all';
}

function addAllToSRS(lesson) {
  const items = collectLessonItems();
  items.forEach(it => srAddCard(it, lesson));
  flashHint(`Added ${items.length} words to spaced repetition`);
}

function printableView() {
  const items = collectLessonItems();
  const title = document.querySelector('h1')?.textContent || 'Hebrew Lesson';
  const w = window.open('', '_blank');
  if (!w) { flashHint('Allow pop-ups to open the printable view.'); return; }
  w.document.write(`<!doctype html><html><head><title>${title}, Print</title>
    <style>body{font-family:Georgia,serif;padding:24px;line-height:1.6;color:#000;background:#fff;}
      h1{border-bottom:2px solid #000;padding-bottom:8px;}
      table{width:100%;border-collapse:collapse;margin-top:16px;}
      td{padding:8px 12px;border-bottom:1px solid #ddd;vertical-align:top;}
      td.he{font-family:'Frank Ruhl Libre','Times',serif;font-size:22px;direction:rtl;text-align:right;width:35%;}
      td.tr{font-style:italic;color:#666;width:30%;}
      td.fr{width:35%;}
      @media print{button{display:none;}}
    </style></head><body>
    <h1>${title}</h1>
    <p>Print this page to study offline. Hebrew right to left, transliteration center, English right.</p>
    <button onclick="window.print()">🖨 Print</button>
    <table>${items.map(it => `<tr><td class="he">${it.he}</td><td class="tr">${it.translit}</td><td class="fr">${it.fr}</td></tr>`).join('')}</table>
    </body></html>`);
}

/* ---------- Word-tokenized passages (click any Hebrew word) ---------- */
function tokenizeHebrewLines() {
  document.querySelectorAll('div.he[style*="Frank Ruhl"]').forEach(line => {
    if (line.dataset.tokenized) return;
    line.dataset.tokenized = '1';
    if (!line.dataset.original) line.dataset.original = line.textContent;
    const text = line.textContent;
    const tokens = text.split(/(\s+)/);
    line.textContent = '';
    tokens.forEach(tok => {
      if (/^\s+$/.test(tok) || !/[א-ת]/.test(tok)) {
        line.appendChild(document.createTextNode(tok));
        return;
      }
      const span = document.createElement('span');
      span.className = 'word-token';
      span.textContent = tok;
      span.title = 'Click to hear';
      span.addEventListener('click', e => {
        e.stopPropagation();
        speak(tok, 0.8);
      });
      line.appendChild(span);
    });
  });
}

/* ---------- Auto-play for cultural text blocks ---------- */
function enableTextBlockAutoPlay() {
  tokenizeHebrewLines();
  document.querySelectorAll('div[id]').forEach(block => {
    const lines = block.querySelectorAll('div.he[style*="Frank Ruhl"]');
    if (lines.length < 4) return;
    if (block.dataset.autoplaySetup) return;
    if (block.parentElement?.querySelector('button.btn-primary')) return;
    block.dataset.autoplaySetup = '1';
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.style.cssText = 'margin-top:12px;';
    btn.textContent = '▶ Listen to passage';
    btn.addEventListener('click', async () => {
      if (btn._stop) {
        btn._stop = false;
        speechSynthesis.cancel?.();
        if (cloudAudio) { cloudAudio.pause(); cloudAudio = null; }
        btn.textContent = '▶ Listen to passage';
        lines.forEach(l => l.style.background = '');
        return;
      }
      btn._stop = true;
      btn.textContent = '⏹ Stop';
      for (const line of lines) {
        if (!btn._stop) break;
        const text = line.dataset.original || line.textContent;
        line.style.background = 'rgba(16,185,129,0.2)';
        line.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (hasHebrewVoice()) {
          await new Promise(resolve => {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'he-IL';
            u.rate = 0.75;
            const v = pickHebrewVoice();
            if (v) u.voice = v;
            u.onend = resolve;
            u.onerror = resolve;
            speechSynthesis.cancel();
            speechSynthesis.speak(u);
          });
        } else {
          await speakViaCloudTTS(text);
        }
        line.style.background = '';
      }
      btn._stop = false;
      btn.textContent = '▶ Listen to passage';
    });
    block.parentElement.appendChild(btn);
  });
}

function collectLessonItems() {
  const rows = document.querySelectorAll('.word-row');
  const items = [];
  rows.forEach(r => {
    const heEl = r.querySelector('.he');
    const trEl = r.querySelector('.translit');
    const frEl = r.querySelector('.fr');
    if (!heEl || !frEl) return;
    const he = (heEl.dataset.original || heEl.textContent || '').trim();
    const translit = (trEl?.textContent || '').trim();
    const fr = (frEl.textContent || '').trim();
    if (he && fr) items.push({ he, translit, fr });
  });
  const seen = new Set();
  return items.filter(it => {
    const k = it.he + '|' + it.fr;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function autoInjectExercises() {
  const items = collectLessonItems();
  if (items.length < 4) return;
  const container = document.querySelector('.container');
  const footer = document.querySelector('footer');
  if (!container || !footer) return;
  if (document.getElementById('exercises-block')) return;

  const lessonId = location.pathname.split(/[\\/]/).pop().replace('.html', '');

  // Production modes are lesson-authored: they only appear when the lesson defines the arrays.
  // A lesson without them degrades gracefully to the two exposure tabs below. (See §2c of the
  // pedagogy plan: Flashcards + Listen&Match stay inline; Sentence Builder / Frames / Situations
  // are launched into a focused modal, and the reconnaissance quiz modes were removed.)
  const sentences = Array.isArray(window.SENTENCES) ? window.SENTENCES : [];
  const frames = Array.isArray(window.FRAMES) ? window.FRAMES : [];
  const situations = Array.isArray(window.SITUATIONS) ? window.SITUATIONS : [];
  const produceBtns = [];
  if (sentences.length) produceBtns.push('<button class="ex-produce-btn primary" id="ex-sentence" type="button">Build a sentence</button>');
  if (frames.length) produceBtns.push('<button class="ex-produce-btn" id="ex-frames" type="button">Swap the slot</button>');
  if (situations.length) produceBtns.push('<button class="ex-produce-btn" id="ex-situations" type="button">Real situations</button>');
  const produceHtml = produceBtns.length
    ? `<div class="ex-produce"><div class="ex-produce-label">Speak &amp; produce</div><div class="ex-produce-row">${produceBtns.join('')}</div></div>`
    : '';

  const wrap = document.createElement('div');
  wrap.id = 'exercises-block';
  wrap.innerHTML = `
    <hr class="section-divider">
    <h2>Practice & Exercises</h2>
    ${produceHtml}
    <div class="ex-tabs">
      <button class="ex-tab active" data-mode="flashcard">Flashcards</button>
      <button class="ex-tab" data-mode="audio">Listen & Match</button>
    </div>
    <div id="ex-stage"></div>
    <div class="ex-stats" id="ex-stats">Score: 0 / 0 · Streak: 0</div>
  `;
  container.insertBefore(wrap, footer);

  if (sentences.length) wrap.querySelector('#ex-sentence').addEventListener('click', () => openSentenceBuilder(sentences, lessonId));
  if (frames.length) wrap.querySelector('#ex-frames').addEventListener('click', () => openFrames(frames, lessonId));
  if (situations.length) wrap.querySelector('#ex-situations').addEventListener('click', () => openSituations(situations, lessonId));

  const stage = wrap.querySelector('#ex-stage');
  const stats = wrap.querySelector('#ex-stats');
  let score = 0, total = 0, streak = 0, best = parseInt(localStorage.getItem('ex-best-' + lessonId) || '0');
  const reviewQueue = JSON.parse(localStorage.getItem('ex-review-' + lessonId) || '[]');

  function updateStats() {
    stats.textContent = `Score: ${score} / ${total} · Streak: ${streak} · Best: ${best}`;
    if (streak > best) { best = streak; localStorage.setItem('ex-best-' + lessonId, '' + best); }
  }
  function recordCorrect() { score++; total++; streak++; updateStats(); if (score >= 10) markLessonDone(lessonId.replace(/^\d+-/, '')); }
  function recordWrong(item) {
    total++; streak = 0; updateStats();
    if (item && !reviewQueue.find(x => x.he === item.he)) {
      reviewQueue.push(item);
      localStorage.setItem('ex-review-' + lessonId, JSON.stringify(reviewQueue.slice(-30)));
    }
    if (item) srAddCard(item, lessonId);
  }

  wrap.querySelectorAll('.ex-tab').forEach(t => t.addEventListener('click', () => {
    wrap.querySelectorAll('.ex-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    renderExercise(t.dataset.mode);
  }));

  function renderExercise(mode) {
    stage.innerHTML = '';
    const pool = items.length > 1 ? items : [items[0], items[0]];
    if (mode === 'audio') renderAudio(stage, pool, recordCorrect, recordWrong);
    else renderFlashcard(stage, pool);
  }
  renderExercise('flashcard');
}

function renderFlashcard(stage, items) {
  let i = 0, flipped = false;
  function show() {
    flipped = false;
    const w = items[i % items.length];
    stage.innerHTML = `
      <div class="flashcard" id="fc-card">
        <div class="fc-side fc-front">
          <div class="fc-he">${w.he}</div>
          <div class="fc-translit">${w.translit}</div>
          <div class="fc-hint">tap/space to flip · swipe ← for next</div>
        </div>
      </div>
      <div class="fc-controls">
        <button class="btn" id="fc-prev">← Prev</button>
        <button class="btn" id="fc-play">▶ Hear</button>
        <button class="btn" id="fc-shuffle">Shuffle</button>
        <button class="btn btn-primary" id="fc-next">Next →</button>
      </div>
      <div class="fc-counter">${(i % items.length) + 1} / ${items.length}</div>`;
    const card = document.getElementById('fc-card');
    card.addEventListener('click', () => {
      flipped = !flipped;
      if (flipped) {
        card.innerHTML = `<div class="fc-side fc-back"><div class="fc-fr">${w.fr}</div><div class="fc-translit">${w.translit}</div><div class="fc-hint">tap to flip back</div></div>`;
      } else {
        card.innerHTML = `<div class="fc-side fc-front"><div class="fc-he">${w.he}</div><div class="fc-translit">${w.translit}</div><div class="fc-hint">tap/space to flip · swipe ← for next</div></div>`;
      }
    });
    // Touch swipe
    let touchStartX = 0;
    card.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    card.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 60) {
        if (dx < 0) { i++; show(); }
        else if (i > 0) { i--; show(); }
      }
    });
    document.getElementById('fc-play').addEventListener('click', e => { e.stopPropagation(); speak(w.he, 0.85); });
    document.getElementById('fc-next').addEventListener('click', () => { i++; show(); });
    document.getElementById('fc-prev').addEventListener('click', () => { i = Math.max(0, i - 1); show(); });
    document.getElementById('fc-shuffle').addEventListener('click', () => { items.sort(() => Math.random() - 0.5); i = 0; show(); });
  }
  show();
}

function renderAudio(stage, items, ok, ko) {
  function next() {
    const correct = items[Math.floor(Math.random() * items.length)];
    const distractors = shuffle(items.filter(x => x.he !== correct.he)).slice(0, 3);
    const opts = shuffle([correct, ...distractors]);
    stage.innerHTML = `
      <div class="ex-prompt"><button class="btn btn-primary" id="qa-play" style="font-size:18px;padding:14px 28px;">▶ Listen</button><div class="ex-q-tr" style="margin-top:8px;">Pick what you heard</div></div>
      <div class="ex-options">${opts.map(o => `<button class="ex-option" data-correct="${o.he === correct.he}">${o.fr}<br><span style="font-size:12px;color:var(--text-dim);">${o.translit}</span></button>`).join('')}</div>
      <div class="ex-feedback" id="qa-fb"></div>`;
    setTimeout(() => speak(correct.he, 0.85), 200);
    document.getElementById('qa-play').addEventListener('click', () => speak(correct.he, 0.85));
    stage.querySelectorAll('.ex-option').forEach(b => b.addEventListener('click', () => {
      stage.querySelectorAll('.ex-option').forEach(x => x.disabled = true);
      const right = b.dataset.correct === 'true';
      b.classList.add(right ? 'correct' : 'wrong');
      if (!right) stage.querySelector('.ex-option[data-correct="true"]').classList.add('correct');
      document.getElementById('qa-fb').textContent = right ? `✓, ${correct.he}` : `✗, ${correct.he} (${correct.fr})`;
      if (right) ok(); else ko(correct);
      setTimeout(next, 1500);
    }));
  }
  next();
}

function setupNiqqudToggle() {
  const lesson = location.pathname.split(/[\\/]/).pop().replace('.html', '');
  if (lesson === 'index' || lesson === '01-alefbet' || lesson === '02-niqqud') return;

  const header = document.querySelector('header');
  if (!header) return;

  const toggle = document.createElement('button');
  toggle.className = 'niqqud-toggle';
  toggle.title = 'Toggle vowel marks (niqqud), real Israeli Hebrew uses none';
  toggle.setAttribute('aria-pressed', 'true');
  toggle.innerHTML = '<span class="dot"></span> Niqqud ON';

  const isOff = localStorage.getItem('niqqud-off') === '1';
  if (isOff) {
    document.body.classList.add('no-niqqud');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.innerHTML = '<span class="dot"></span> Niqqud OFF';
  }

  toggle.addEventListener('click', () => {
    const off = document.body.classList.toggle('no-niqqud');
    toggle.setAttribute('aria-pressed', off ? 'false' : 'true');
    toggle.innerHTML = off ? '<span class="dot"></span> Niqqud OFF' : '<span class="dot"></span> Niqqud ON';
    localStorage.setItem('niqqud-off', off ? '1' : '0');
    applyNiqqudStripping();
  });

  header.appendChild(toggle);
  applyNiqqudStripping();
}

// Handwriting (ktav yad) toggle — same shape as the niqqud toggle. Israelis write in cursive,
// not print, so a learner needs to practice reading it. Cursive fonts carry no niqqud glyphs
// (the whole codebase strips niqqud wherever it shows cursive), so turning cursive ON also forces
// the vowel marks off for display — see applyNiqqudStripping.
//
// ONE shared state: localStorage 'qs-cursive', the key the live translator already reads via
// window.QSPrefs.cursive(). So enabling cursive anywhere — this lesson button OR the translator's
// Preferences panel — flips the same switch, and the translator shows its cursive echo of the
// result too. That is exactly the request: type a romanized phrase, get the whole thing in Hebrew
// script, and in cursive when cursive is on.
function cursiveOn() { return localStorage.getItem('qs-cursive') === 'on'; }

function applyCursive() {
  const on = cursiveOn();
  document.body.classList.toggle('cursive', on);
  const btn = document.querySelector('.cursive-toggle');
  if (btn) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.innerHTML = on ? '<span class="dot"></span> Cursive ON' : '<span class="dot"></span> Cursive OFF';
  }
  applyNiqqudStripping();   // cursive font can't render niqqud -> re-strip
}
// hub.js Preferences toggle calls this so a change there updates the lesson body live too.
if (typeof window !== 'undefined') window.applyCursive = applyCursive;

function setupCursiveToggle() {
  const lesson = location.pathname.split(/[\\/]/).pop().replace('.html', '');
  if (lesson === 'index' || lesson === '01-alefbet' || lesson === '02-niqqud') return;

  const header = document.querySelector('header');
  if (!header) return;

  // Migrate the one-commit-old key so a user who already turned cursive on keeps it.
  if (localStorage.getItem('cursive-on') === '1' && !localStorage.getItem('qs-cursive')) {
    localStorage.setItem('qs-cursive', 'on');
  }

  const toggle = document.createElement('button');
  toggle.className = 'cursive-toggle';
  toggle.title = 'Toggle handwriting (ktav yad) — how Israelis actually write by hand';
  toggle.innerHTML = '<span class="dot"></span> Cursive OFF';
  toggle.addEventListener('click', () => {
    localStorage.setItem('qs-cursive', cursiveOn() ? 'off' : 'on');
    applyCursive();
  });

  header.appendChild(toggle);
  // Init from the shared pref (also re-strips niqqud; runs after setupNiqqudToggle).
  applyCursive();
}

function applyNiqqudStripping() {
  // Cursive mode implies no-niqqud: the ktav yad font has no vowel-mark glyphs.
  const off = document.body.classList.contains('no-niqqud') || document.body.classList.contains('cursive');
  document.querySelectorAll('.he').forEach(el => {
    if (el.dataset.tokenized) {
      el.querySelectorAll('.word-token').forEach(tok => {
        if (!tok.dataset.original) tok.dataset.original = tok.textContent;
        tok.textContent = off ? stripNiqqud(tok.dataset.original) : tok.dataset.original;
      });
      return;
    }
    if (off) {
      if (!el.dataset.original) el.dataset.original = el.textContent;
      el.textContent = stripNiqqud(el.dataset.original);
    } else if (el.dataset.original) {
      el.textContent = el.dataset.original;
    }
  });
}

function flashHint(msg) {
  let el = document.getElementById('flash-hint');
  if (!el) {
    el = document.createElement('div');
    el.id = 'flash-hint';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1c1c1c;border:1px solid #10b981;color:#10b981;padding:10px 18px;border-radius:4px;font-size:13px;z-index:1000;opacity:0;transition:opacity 0.2s;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 2400);
}

function markLessonDone(id) {
  const done = JSON.parse(localStorage.getItem('hebrew-progress') || '[]');
  if (!done.includes(id)) {
    done.push(id);
    localStorage.setItem('hebrew-progress', JSON.stringify(done));
  }
}

function getLessonProgress() {
  return JSON.parse(localStorage.getItem('hebrew-progress') || '[]');
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderTextBlock(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  items.forEach((line, i) => {
    const div = document.createElement('div');
    div.style.cssText = 'padding: 18px 0; border-bottom: 1px solid var(--border);';
    div.innerHTML = `<div style="display: flex; gap: 18px; align-items: baseline;"><span style="color: var(--accent); font-weight: 600; font-size: 13px; min-width: 24px;">${i+1}</span><div style="flex: 1;"><div class="he tb-he" data-he="${line.he.replace(/"/g,'&quot;')}" style="font-family: 'Frank Ruhl Libre', serif; font-size: 30px; direction: rtl; text-align: right; line-height: 1.5; cursor: pointer;">${line.he}</div><div class="tb-translit" style="font-size: 16px; color: var(--text-dim); font-style: italic; margin-top: 14px;">${line.translit}</div><div class="tb-fr" style="font-size: 17px; margin-top: 10px;">${line.fr}</div></div></div>`;
    const heEl = div.querySelector('.tb-he');
    if (heEl) heEl.addEventListener('click', () => speak(line.he, 0.75));
    el.appendChild(div);
  });
}

function addCulturalText(title, subtitle, items) {
  const footer = document.querySelector('footer');
  if (!footer) return;
  const wrap = document.createElement('div');
  const id = 'ct-' + Math.random().toString(36).slice(2, 8);
  wrap.innerHTML = `<h2>${title}</h2><div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 24px; margin-bottom: 16px;"><div style="color: var(--text-dim); margin-bottom: 16px; font-size: 14px;">${subtitle}</div><div id="${id}"></div></div>`;
  footer.parentElement.insertBefore(wrap, footer);
  renderTextBlock(id, items);
}

function addExtraVocab(title, items) {
  const footer = document.querySelector('footer');
  if (!footer) return;
  const wrap = document.createElement('div');
  const id = 'ev-' + Math.random().toString(36).slice(2, 8);
  wrap.innerHTML = `<h2>${title}</h2><div class="word-list" id="${id}"></div>`;
  footer.parentElement.insertBefore(wrap, footer);
  const list = document.getElementById(id);
  items.forEach(w => {
    const r = document.createElement('div');
    r.className = 'word-row';
    r.innerHTML = `<div class="he">${w.he}</div><div class="translit">${w.translit}</div><div class="fr">${w.fr}</div><button class="btn icon-btn">▶</button>`;
    r.querySelector('button').addEventListener('click', () => speak(w.he, 0.85));
    list.appendChild(r);
  });
}

function addMiniQuiz(title, questions) {
  const footer = document.querySelector('footer');
  if (!footer) return;
  const wrap = document.createElement('div');
  const id = 'mq-' + Math.random().toString(36).slice(2, 8);
  wrap.innerHTML = `<h2>${title}</h2><div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 20px; margin-bottom: 16px;"><div id="${id}"></div></div>`;
  footer.parentElement.insertBefore(wrap, footer);
  const root = document.getElementById(id);
  questions.forEach((q, i) => {
    const block = document.createElement('div');
    block.style.cssText = 'padding: 12px 0; border-bottom: 1px solid var(--border);';
    block.innerHTML = `
      <div style="margin-bottom: 8px;"><span style="color: var(--accent); font-weight: 600;">Q${i + 1}.</span> ${q.q}</div>
      ${q.he ? `<div class="he" style="font-family: 'Frank Ruhl Libre', serif; font-size: 22px; direction: rtl; text-align: right; cursor: pointer; margin-bottom: 4px;" data-he="${q.he}">${q.he}</div>` : ''}
      ${q.translit ? `<div style="font-size:13px;color:var(--text-dim);font-style:italic;margin-bottom:8px;">${q.translit}</div>` : ''}
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
        ${q.options.map((opt, j) => `<button class="btn" data-correct="${j === q.answer}">${opt}</button>`).join('')}
      </div>
      <div class="quiz-fb" style="margin-top: 8px; font-size: 13px; color: var(--text-dim); min-height: 18px;"></div>`;
    block.querySelectorAll('button[data-correct]').forEach(b => {
      b.addEventListener('click', () => {
        block.querySelectorAll('button[data-correct]').forEach(x => x.disabled = true);
        const right = b.dataset.correct === 'true';
        b.style.borderColor = right ? 'var(--accent)' : '#ef4444';
        b.style.color = right ? 'var(--accent)' : '#ef4444';
        if (!right) {
          const c = block.querySelector('button[data-correct="true"]');
          if (c) { c.style.borderColor = 'var(--accent)'; c.style.color = 'var(--accent)'; }
        }
        block.querySelector('.quiz-fb').textContent = right ? '✓ Correct' + (q.explain ? ', ' + q.explain : '') : '✗ ' + (q.explain || '');
      });
    });
    const heEl = block.querySelector('[data-he]');
    if (heEl) heEl.addEventListener('click', () => speak(heEl.dataset.he, 0.8));
    root.appendChild(block);
  });
}

/* ---------- Production practice (focused modals launched from a lesson) ----------
   Sentence Builder, Substitution Frames, and Situations. These consume lesson-authored
   window.SENTENCES / window.FRAMES / window.SITUATIONS arrays (never scraped as vocab, since
   collectLessonItems only reads .word-row DOM). Each opens as a focused modal mirroring the
   SRS review shell (#srs-modal / .srs-overlay / .srs-card). Backward compatible: a lesson
   without these arrays shows no launch buttons and the exercise panel behaves as before. */

// One-line grammar rule surfaced when a Sentence-Builder attempt is wrong. The distractors ARE
// the pedagogy; this names what the learner tripped on. UI copy, keyed by the sentence's `focus`.
const FOCUS_HINTS = {
  'agreement:gender': 'Gender agreement: the verb/adjective must match the speaker (m. vs f.).',
  'agreement:number': 'Number agreement: singular and plural forms must match.',
  'word-order': 'Word order: a word is out of place, or a pronoun slipped in.',
  'preposition': 'Preposition: one tile is an extra or wrong attachment (בְּ / לְ / אֶת / מ).',
  'vocabulary': 'Wrong word: one tile does not belong in this sentence.'
};
function focusHint(focus) {
  return FOCUS_HINTS[focus] || 'Not quite — check the order and drop any tile that does not belong.';
}

// Shared modal shell for the production modes. Returns the .srs-card element to fill.
function openProdModal(ariaLabel) {
  const existing = document.getElementById('prod-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'prod-modal';
  modal.innerHTML = `<div class="srs-overlay"></div><div class="srs-card prod-card" role="dialog" aria-label="${escHtml(ariaLabel || 'Practice')}"></div>`;
  document.body.appendChild(modal);
  makeModalAccessible(modal, modal.querySelector('.srs-card'));
  modal.querySelector('.srs-overlay').addEventListener('click', () => modal.remove());
  return modal;
}

function openSentenceBuilder(sentences, lessonId) {
  const list = (sentences || []).filter(s => s && Array.isArray(s.chunks) && s.chunks.length);
  if (!list.length) return;
  if (window.track) track('sentence_builder_open', lessonId, list.length);
  const modal = openProdModal('Sentence builder');
  const card = modal.querySelector('.srs-card');
  let idx = 0;

  function renderOne() {
    if (idx >= list.length) return renderDone();
    const s = list[idx];
    // Stable ids let duplicate word forms coexist; comparison is by the he string sequence.
    const tiles = shuffle(s.chunks.concat(s.distractors || []).map((he, i) => ({ id: i, he })));
    let tray = tiles.slice();
    let placed = [];
    let solved = false;

    card.innerHTML = `
      <button class="srs-close" aria-label="Close">×</button>
      <div class="srs-topbar"><div class="srs-progress">Build · ${idx + 1} / ${list.length}</div></div>
      <div class="sb-prompt">${escHtml(s.fr || '')}</div>
      <div class="sb-answer" id="sb-answer" aria-label="Your sentence"></div>
      <div class="sb-tray" id="sb-tray"></div>
      <div class="sb-feedback" id="sb-feedback" role="status" aria-live="polite"></div>
      <div class="sb-breakdown" id="sb-breakdown"></div>
      <div class="srs-actions sb-actions">
        <button class="btn" id="sb-reset" type="button">Reset</button>
        <button class="btn btn-primary" id="sb-check" type="button">Check</button>
      </div>`;
    card.querySelector('.srs-close').addEventListener('click', () => modal.remove());
    const ansEl = card.querySelector('#sb-answer');
    const trayEl = card.querySelector('#sb-tray');
    const fbEl = card.querySelector('#sb-feedback');
    const checkBtn = card.querySelector('#sb-check');

    function paint() {
      ansEl.innerHTML = placed.length
        ? placed.map(t => `<button class="sb-tile sb-placed" type="button" data-id="${t.id}" dir="rtl" lang="he">${escHtml(t.he)}</button>`).join('')
        : '<span class="sb-placeholder">Tap the words in order…</span>';
      trayEl.innerHTML = tray.map(t => `<button class="sb-tile" type="button" data-id="${t.id}" dir="rtl" lang="he">${escHtml(t.he)}</button>`).join('');
      if (solved) return;
      ansEl.querySelectorAll('.sb-tile').forEach(b => b.addEventListener('click', () => {
        const i = placed.findIndex(t => t.id === +b.dataset.id);
        if (i >= 0) { tray.push(placed.splice(i, 1)[0]); fbEl.textContent = ''; paint(); }
      }));
      trayEl.querySelectorAll('.sb-tile').forEach(b => b.addEventListener('click', () => {
        const i = tray.findIndex(t => t.id === +b.dataset.id);
        if (i >= 0) { placed.push(tray.splice(i, 1)[0]); fbEl.textContent = ''; paint(); }
      }));
    }

    function check() {
      if (solved) return;
      const guess = placed.map(t => t.he);
      const right = guess.length === s.chunks.length && guess.every((g, i) => g === s.chunks[i]);
      if (!right) {
        fbEl.className = 'sb-feedback bad';
        fbEl.textContent = '✗ ' + focusHint(s.focus);
        return;
      }
      solved = true;
      fbEl.className = 'sb-feedback ok';
      fbEl.textContent = '✓ ' + (s.translit || '');
      card.querySelectorAll('.sb-tile').forEach(b => { b.disabled = true; });
      card.querySelector('#sb-reset').disabled = true;
      speak(s.he, 0.85);
      if (window.track) track('sentence_built', lessonId);
      // The finished sentence becomes a grammar micro-lesson: root / binyan / gender per word.
      const out = card.querySelector('#sb-breakdown');
      out.style.display = 'block';
      if (window.QuickSay && window.QuickSay.renderBreakdown) {
        window.QuickSay.renderBreakdown(out, s.he, new AbortController().signal);
      }
      checkBtn.textContent = idx + 1 >= list.length ? 'Finish' : 'Next →';
      checkBtn.onclick = () => { idx++; renderOne(); };
    }

    card.querySelector('#sb-reset').addEventListener('click', () => {
      if (solved) return;
      tray = tiles.slice(); placed = []; fbEl.textContent = ''; paint();
    });
    checkBtn.addEventListener('click', check);
    paint();
  }

  function renderDone() {
    card.innerHTML = `<button class="srs-close" aria-label="Close">×</button>
      <h2 style="margin:0 0 12px;font-size:22px;">Nicely built</h2>
      <p style="color:var(--text-dim);margin:0 0 20px;">You produced ${list.length} sentence${list.length > 1 ? 's' : ''} from scratch.</p>
      <button class="btn btn-primary" id="sb-again" type="button">Again</button>`;
    card.querySelector('.srs-close').addEventListener('click', () => modal.remove());
    card.querySelector('#sb-again').addEventListener('click', () => { idx = 0; renderOne(); });
  }

  renderOne();
}

function openFrames(frames, lessonId) {
  const list = (frames || []).filter(f => f && f.frame && Array.isArray(f.slots) && f.slots.length);
  if (!list.length) return;
  if (window.track) track('frames_open', lessonId, list.length);
  const modal = openProdModal('Substitution frames');
  const card = modal.querySelector('.srs-card');
  let idx = 0;

  function fill(frame, he) {
    // Frames carry the blank as ___; substitute the chosen slot value in place.
    return frame.replace('___', he);
  }

  function renderOne() {
    if (idx >= list.length) return renderDone();
    const f = list[idx];
    const framePretty = f.frame.replace('___', '<span class="fr-blank">___</span>');
    card.innerHTML = `
      <button class="srs-close" aria-label="Close">×</button>
      <div class="srs-topbar"><div class="srs-progress">Swap · ${idx + 1} / ${list.length}</div></div>
      <div class="fr-frame" dir="rtl" lang="he">${framePretty}</div>
      <div class="fr-sub">${escHtml(f.translit || '')} · ${escHtml(f.fr || '')}</div>
      <div class="fr-slots" id="fr-slots">${f.slots.map((sl, i) =>
        `<button class="fr-slot" type="button" data-i="${i}"><span dir="rtl" lang="he">${escHtml(sl.he)}</span><span class="fr-slot-fr">${escHtml(sl.fr || '')}</span></button>`).join('')}</div>
      <div class="fr-result" id="fr-result"></div>
      <div class="srs-actions sb-actions">
        <button class="btn btn-primary" id="fr-next" type="button">${idx + 1 >= list.length ? 'Finish' : 'Next frame →'}</button>
      </div>`;
    card.querySelector('.srs-close').addEventListener('click', () => modal.remove());
    card.querySelector('#fr-next').addEventListener('click', () => { idx++; renderOne(); });
    const result = card.querySelector('#fr-result');
    card.querySelectorAll('.fr-slot').forEach(b => b.addEventListener('click', () => {
      card.querySelectorAll('.fr-slot').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      const sl = f.slots[+b.dataset.i];
      const full = fill(f.frame, sl.he);
      result.innerHTML = `<button class="fr-play icon-btn" type="button" aria-label="Listen">▶</button>
        <span class="fr-full" dir="rtl" lang="he">${escHtml(full)}</span>`;
      result.querySelector('.fr-play').addEventListener('click', () => speak(full, 0.85));
      speak(full, 0.85);
      if (window.track) track('frame_swapped', lessonId);
    }));
  }

  function renderDone() {
    card.innerHTML = `<button class="srs-close" aria-label="Close">×</button>
      <h2 style="margin:0 0 12px;font-size:22px;">Frame drilled</h2>
      <p style="color:var(--text-dim);margin:0 0 20px;">A sentence is a frame plus slots, not a memorized string.</p>
      <button class="btn btn-primary" id="fr-again" type="button">Again</button>`;
    card.querySelector('.srs-close').addEventListener('click', () => modal.remove());
    card.querySelector('#fr-again').addEventListener('click', () => { idx = 0; renderOne(); });
  }

  renderOne();
}

function openSituations(situations, lessonId) {
  const list = (situations || []).filter(q => q && q.q && Array.isArray(q.options) && q.options.length);
  if (!list.length) return;
  if (window.track) track('situations_open', lessonId, list.length);
  const modal = openProdModal('Situations');
  const card = modal.querySelector('.srs-card');
  let idx = 0, score = 0;

  function renderOne() {
    if (idx >= list.length) return renderDone();
    const q = list[idx];
    card.innerHTML = `
      <button class="srs-close" aria-label="Close">×</button>
      <div class="srs-topbar"><div class="srs-progress">Situation · ${idx + 1} / ${list.length}</div><div class="srs-progress">Score ${score}</div></div>
      <div class="sit-q">${escHtml(q.q)}</div>
      <div class="sit-options" id="sit-options">${q.options.map((o, i) =>
        `<button class="sit-option" type="button" data-i="${i}" dir="rtl" lang="he">${escHtml(o)}</button>`).join('')}</div>
      <div class="sit-feedback" id="sit-feedback" role="status" aria-live="polite"></div>
      <div class="srs-actions sb-actions">
        <button class="btn btn-primary" id="sit-next" type="button" disabled>${idx + 1 >= list.length ? 'Finish' : 'Next →'}</button>
      </div>`;
    card.querySelector('.srs-close').addEventListener('click', () => modal.remove());
    const fb = card.querySelector('#sit-feedback');
    const nextBtn = card.querySelector('#sit-next');
    card.querySelectorAll('.sit-option').forEach(b => b.addEventListener('click', () => {
      card.querySelectorAll('.sit-option').forEach(x => { x.disabled = true; });
      const chosen = +b.dataset.i;
      const right = chosen === q.answer;
      b.classList.add(right ? 'correct' : 'wrong');
      if (!right) {
        const correctEl = card.querySelector(`.sit-option[data-i="${q.answer}"]`);
        if (correctEl) correctEl.classList.add('correct');
      }
      if (right) score++;
      const answerHe = q.he || q.options[q.answer];
      if (answerHe) speak(answerHe, 0.85);
      fb.className = 'sit-feedback ' + (right ? 'ok' : 'bad');
      fb.textContent = (right ? '✓ ' : '✗ ') + (q.explain || (right ? 'Correct' : ''));
      nextBtn.disabled = false;
      nextBtn.focus();
      if (window.track) track('situation_answered', lessonId, right ? 1 : 0);
    }));
    nextBtn.addEventListener('click', () => { idx++; renderOne(); });
  }

  function renderDone() {
    card.innerHTML = `<button class="srs-close" aria-label="Close">×</button>
      <h2 style="margin:0 0 12px;font-size:22px;">Situation drill done</h2>
      <p style="color:var(--text-dim);margin:0 0 6px;font-size:32px;color:var(--accent);">${score} / ${list.length}</p>
      <p style="color:var(--text-dim);margin:0 0 20px;">Right greeting, right moment.</p>
      <button class="btn btn-primary" id="sit-again" type="button">Again</button>`;
    card.querySelector('.srs-close').addEventListener('click', () => modal.remove());
    card.querySelector('#sit-again').addEventListener('click', () => { idx = 0; score = 0; renderOne(); });
  }

  renderOne();
}

// --- PWA bootstrap: injects manifest + icons + registers the service worker on every page ---
(function () {
  try {
    var head = document.head;
    function addOnce(sel, make) { if (!document.querySelector(sel)) head.appendChild(make()); }
    // Frank Ruhl Libre (the signature Hebrew face) is now self-hosted via @font-face in style.css
    // — no external Google Fonts fetch, so the CSP can forbid external style/font hosts entirely.
    addOnce('link[rel="manifest"]', function () { var l = document.createElement('link'); l.rel = 'manifest'; l.href = window.ULPAN_BASE + 'manifest.json'; return l; });
    addOnce('meta[name="theme-color"]', function () { var m = document.createElement('meta'); m.name = 'theme-color'; m.content = '#0a0a0a'; return m; });
    addOnce('link[rel="apple-touch-icon"]', function () { var a = document.createElement('link'); a.rel = 'apple-touch-icon'; a.href = window.ULPAN_ASSETS + 'icon-192.png'; return a; });
    addOnce('meta[name="apple-mobile-web-app-capable"]', function () { var m = document.createElement('meta'); m.name = 'apple-mobile-web-app-capable'; m.content = 'yes'; return m; });
    addOnce('meta[name="apple-mobile-web-app-status-bar-style"]', function () { var m = document.createElement('meta'); m.name = 'apple-mobile-web-app-status-bar-style'; m.content = 'black-translucent'; return m; });
    addOnce('meta[name="apple-mobile-web-app-title"]', function () { var m = document.createElement('meta'); m.name = 'apple-mobile-web-app-title'; m.content = 'Ulpan'; return m; });
    // Capture the install prompt as early as possible — it can fire before hub.js loads. The hub's
    // "Install app" menu item reads window.__deferredInstallPrompt and re-checks on every open, so a
    // late-firing event still surfaces the button. Cleared once installed so it stops advertising.
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      window.__deferredInstallPrompt = e;
      try { window.dispatchEvent(new Event('ulpan:installable')); } catch (err) {}
    });
    window.addEventListener('appinstalled', function () { window.__deferredInstallPrompt = null; });
    if ('serviceWorker' in navigator) {
      // Auto-update: bypass the HTTP cache when checking sw.js, and reload once when a fresh
      // worker takes control — so a deploy lands on the next visit with no manual cache clearing.
      var hadController = !!navigator.serviceWorker.controller, swRefreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (swRefreshing || !hadController) return; swRefreshing = true; window.location.reload();
      });
      window.addEventListener('load', function () {
        // sw.js stays at the site root so its scope covers every folder, whatever page registers it.
        navigator.serviceWorker.register(window.ULPAN_BASE + 'sw.js', { scope: window.ULPAN_BASE, updateViaCache: 'none' })
          .then(function (reg) { try { reg.update(); } catch (e) {} })
          .catch(function () {});
      });
    }
  } catch (e) {}
})();

/* Shared front-end modules — injected once from app.js (which every page already loads) so the
   home and all ~500 lesson pages get translit + quick-say + the hamburger hub without editing
   each file. Ship a shared change by editing the module and bumping SHARED_V. Order matters:
   translit -> quicksay (uses window.Translit) -> hub (uses window.QuickSay). */
(function loadSharedModules() {
  var SHARED_V = '1785800000000';
  ['track.js', 'translit.js', 'quicksay.js', 'hub.js'].forEach(function (m) {
    var present = Array.prototype.some.call(document.scripts, function (s) {
      try { return new URL(s.src, location.href).pathname.split('/').pop() === m; } catch (e) { return false; }
    });
    if (present) return;
    var s = document.createElement('script');
    s.src = window.ULPAN_ASSETS + m + '?v=' + SHARED_V;   // siblings of app.js
    s.async = false;              // preserve execution order across the injected modules
    s.onerror = function () { try { console.warn('[ulpan] failed to load shared module', m); } catch (e) {} };
    document.head.appendChild(s);
  });
  // Feed translit.js the loanword stress config so the live translator gets loanword stress too (the
  // Node tooling self-loads it; the browser fetches it). Best-effort — a miss just falls back to the
  // default stress. Polls briefly for window.Translit since the module scripts load async.
  (function loadLoanwords() {
    fetch(window.ULPAN_BASE + 'data/loanwords.json').then(function (r) { return r.json(); }).then(function (map) {
      var tries = 0;
      (function apply() {
        if (window.Translit && window.Translit.setLoanwords) { window.Translit.setLoanwords(map); return; }
        if (tries++ < 40) setTimeout(apply, 100);
      })();
    }).catch(function () {});
  })();
})();
