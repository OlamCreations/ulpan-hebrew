const HEBREW_VOICE_PREFS = ['Microsoft Asaf', 'Carmit', 'Asaf', 'he-IL'];

let cachedVoice = null;
let voiceCheckDone = false;

function pickHebrewVoice() {
  if (cachedVoice) return cachedVoice;
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  for (const pref of HEBREW_VOICE_PREFS) {
    const v = voices.find(v => v.name.includes(pref) || v.lang.startsWith('he'));
    if (v) { cachedVoice = v; return v; }
  }
  return null;
}

function hasHebrewVoice() {
  return pickHebrewVoice() !== null;
}

function speakWithSynthesis(text, rate) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'he-IL';
  u.rate = rate;
  const v = pickHebrewVoice();
  if (v) u.voice = v;
  speechSynthesis.speak(u);
  return Promise.resolve();
}

function speak(text, rate = 0.85) {
  if ('speechSynthesis' in window) {
    if (hasHebrewVoice()) return speakWithSynthesis(text, rate);
    // Voices may not be loaded yet on first call — wait briefly before
    // falling back to cloud TTS. Chrome populates getVoices() asynchronously.
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
      return new Promise(resolve => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          if (hasHebrewVoice()) speakWithSynthesis(text, rate).then(resolve);
          else speakViaCloudTTS(text).then(resolve);
        };
        speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
        setTimeout(finish, 800);
      });
    }
  }
  return speakViaCloudTTS(text);
}

let cloudAudio = null;
let audioDB = null;
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
function getAudioDB() {
  if (audioDB) return Promise.resolve(audioDB);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hebrew-audio', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('blobs');
    req.onsuccess = e => { audioDB = e.target.result; resolve(audioDB); };
    req.onerror = () => resolve(null);
  });
}
async function getCachedAudio(key) {
  const db = await getAudioDB();
  if (!db) return null;
  return new Promise(resolve => {
    const tx = db.transaction('blobs', 'readonly');
    const req = tx.objectStore('blobs').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
async function setCachedAudio(key, blob) {
  const db = await getAudioDB();
  if (!db) return;
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put(blob, key);
}
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
// StreamElements TTS — free, supports Carmit (Hebrew, he-IL). Reuses a single
// Audio element across calls; a fresh `new Audio()` per click breaks the
// user-gesture context on Safari/iOS and triggers autoplay-policy rejection.
// No `crossOrigin` — plain <audio> playback doesn't need CORS, and setting
// it forces a preflight that the StreamElements CDN rejects.
function getCloudAudio() {
  if (!cloudAudio) {
    cloudAudio = new Audio();
    cloudAudio.preload = 'auto';
  }
  return cloudAudio;
}

function ttsURL(text) {
  return `https://api.streamelements.com/kappa/v2/speech?voice=Carmit&text=${encodeURIComponent(text)}`;
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
          flashHint('Browser blocked audio. Tap ▶ once and then again — gesture context now armed.');
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
// user-gesture call stack — wrapping it in chunks.reduce(...).then() defers
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
  return text.replace(/[֑-ׇ]/g, '');
}

function forvoLink(hebrewText) {
  const cleaned = stripNiqqud(hebrewText).split(/\s+/)[0];
  return `https://forvo.com/word/${encodeURIComponent(cleaned)}/#he`;
}

function detectOS() {
  const ua = navigator.userAgent;
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  if (/Mac|iPhone|iPad|iPod/.test(ua) || /Mac/i.test(platform)) return 'mac';
  if (/Windows|Win32|Win64/.test(ua) || /Win/i.test(platform)) return 'windows';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
}

function showVoiceBanner() {
  if (document.getElementById('voice-banner')) return;
  const os = detectOS();
  const winOpen = os === 'windows' ? ' open' : '';
  const macOpen = os === 'mac' ? ' open' : '';
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
        Install once — the page detects it automatically on next refresh.
      </div>

      <details class="voice-banner-os"${winOpen}>
        <summary><span class="os-icon">🪟</span> Windows 10 / 11 — Microsoft Asaf voice</summary>
        <ol class="voice-banner-steps">
          <li>Open <strong>Settings</strong> (Win + I) → <strong>Time &amp; language</strong> → <strong>Language &amp; region</strong>.</li>
          <li>Click <strong>Add a language</strong>, type <em>Hebrew</em>, select <strong>עברית (Hebrew)</strong>, click <strong>Next</strong>.</li>
          <li>In <em>Optional language features</em>, tick <strong>Speech</strong>. (You can untick the others.) Click <strong>Install</strong>.</li>
          <li>Wait ~50 MB download. Then go to <strong>Settings → Accessibility → Narrator → Add natural voices</strong> and add <strong>Microsoft Asaf</strong> if shown.</li>
          <li>Restart your browser, then hard-refresh this page (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>).</li>
        </ol>
        <div class="voice-banner-verify">
          Verify in PowerShell:
          <pre>Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | % { $_.VoiceInfo.Name + ' — ' + $_.VoiceInfo.Culture }</pre>
          You should see <code>Microsoft Asaf — he-IL</code>.
        </div>
        <a class="voice-banner-link" href="https://support.microsoft.com/en-us/windows/download-languages-and-voices-for-narrator-tts-and-speech-recognition-d2503ad3-ad42-4d3b-b3d2-0ae599cc939e" target="_blank" rel="noopener">Microsoft documentation →</a>
      </details>

      <details class="voice-banner-os"${macOpen}>
        <summary><span class="os-icon"></span> macOS — Carmit voice</summary>
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

      <div class="voice-banner-foot">
        Skip install? The <span class="forvo-icon">🔊</span> next to each word opens Forvo (real native recordings) — works on every browser without setup.
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
  // Cloud TTS works without local voice — buttons stay functional.
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
  setupNiqqudToggle();
  setTimeout(() => { if (!voiceCheckDone) setupAudioButtons(); }, 1000);
  setTimeout(() => { autoInjectExercises(); recordDailyStreak(); injectFloatingControls(); enableTextBlockAutoPlay(); setupRevealToggle(); enhanceIndexNavTooltips(); }, 250);
});

/* ---------- Index nav tooltips (matrix of lesson numbers) ---------- */
function enhanceIndexNavTooltips() {
  // Run only on index — detected by presence of multiple `.lesson-card` and a top nav matrix
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
    el.classList.toggle('revealed', !!state);
  });
}

function wrapRevealCards() {
  const targets = document.querySelectorAll('.word-row .translit, .word-row .fr, .tb-translit, .tb-fr');
  targets.forEach(el => {
    if (el.querySelector(':scope > .reveal-inner')) return;
    const original = el.innerHTML;
    if (!original.trim()) return;
    el.innerHTML = `<span class="reveal-inner"><span class="reveal-front">${original}</span><span class="reveal-back"></span></span>`;
  });
}

function setupRevealToggle() {
  wrapRevealCards();
  injectPerCardSRS();
  // re-wrap when DOM changes (lessons inject content after R() runs)
  const obs = new MutationObserver(() => { wrapRevealCards(); injectPerCardSRS(); });
  obs.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => {
    if (e.target.closest('.srs-btn')) return;
    const card = e.target.closest('.word-row .translit, .word-row .fr, .tb-translit, .tb-fr');
    if (!card) return;
    card.classList.toggle('revealed');
    e.stopPropagation();
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

function openSRSReview() {
  const existing = document.getElementById('srs-modal');
  if (existing) existing.remove();
  const due = srGetDue();
  const totalAll = srAllCount();
  const modal = document.createElement('div');
  modal.id = 'srs-modal';
  modal.innerHTML = `<div class="srs-overlay"></div><div class="srs-card" role="dialog" aria-label="SRS review"></div>`;
  document.body.appendChild(modal);
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
      <div class="srs-he" data-he="${current.he.replace(/"/g,'&quot;')}">${heShown}</div>
      <button class="srs-listen" type="button" aria-label="Play audio">▶</button>
      <div class="srs-answer" hidden>
        <div class="srs-translit">${current.translit||''}</div>
        <div class="srs-fr">${current.fr||''}</div>
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
      cardEl.querySelector('.srs-answer').hidden = false;
      cardEl.querySelector('.srs-show').hidden = true;
      cardEl.querySelector('.srs-grade').hidden = false;
    });
    cardEl.querySelectorAll('.srs-g').forEach(b => {
      b.addEventListener('click', () => {
        const q = parseInt(b.dataset.q, 10);
        srUpdate(current.key, q);
        if (q === 1) queue.push(current); // again — re-queue this session
        renderNext();
        refreshSRSCount();
      });
    });
  }
  renderNext();
}

/* ---------- Theme (light/dark) ---------- */
function getCurrentTheme() {
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
  if (lesson === 'index') return;
  const el = document.createElement('div');
  el.id = 'floating-controls';
  el.innerHTML = `
    <a class="fc-btn fc-home" href="index.html" title="Back to lessons index">← Index</a>
    <button class="fc-btn" id="fc-show-all" title="Reveal all translit & translation (R)">Show all</button>
    <button class="fc-btn" id="fc-hide-all" title="Hide all translit & translation (H)">Hide all</button>
    <button class="fc-btn" id="fc-theme" title="Toggle light/dark (T)">${getThemeIcon()}</button>
    <button class="fc-btn" id="fc-listen-all" title="Listen to all words (L)">▶ Listen all</button>
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
  document.getElementById('fc-print').addEventListener('click', () => printableView());
  document.getElementById('fc-add-sr').addEventListener('click', () => { addAllToSRS(lesson); injectPerCardSRS(); refreshSRSCount(); });
  document.getElementById('fc-srs').addEventListener('click', () => openSRSReview());
  document.getElementById('fc-help').addEventListener('click', showShortcutsHelp);
  refreshSRSCount();
  setInterval(refreshSRSCount, 3000);

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, [contenteditable]')) return;
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
    else if (e.key === '?' || e.key === '/') { e.preventDefault(); showShortcutsHelp(); }
    else if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4' || e.key === '5' || e.key === '6' || e.key === '7') {
      const tab = document.querySelectorAll('.ex-tab')[parseInt(e.key) - 1];
      if (tab) { e.preventDefault(); tab.click(); }
    }
    else if (e.key === ' ') {
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
  m.innerHTML = `<div style="background:var(--bg-card);border:1px solid var(--accent);border-radius:8px;padding:24px;max-width:480px;width:100%;">
    <h2 style="margin-bottom:16px;">Keyboard Shortcuts</h2>
    <table style="width:100%;font-size:14px;">
      <tr><td style="padding:6px 0;color:var(--text-dim);">L</td><td>Listen to all words</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">P</td><td>Printable view</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">S</td><td>Add lesson words to SRS</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">N</td><td>Toggle niqqud (vowel marks)</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">1–7</td><td>Switch exercise mode (incl. dictation)</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">Space</td><td>Flip flashcard</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">→ ←</td><td>Next/previous flashcard</td></tr>
      <tr><td style="padding:6px 0;color:var(--text-dim);">?</td><td>This help</td></tr>
    </table>
    <button class="btn btn-primary" style="margin-top:16px;width:100%;" onclick="this.closest('#shortcuts-modal').remove()">Got it</button>
  </div>`;
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
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
  w.document.write(`<!doctype html><html><head><title>${title} — Print</title>
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

  const wrap = document.createElement('div');
  wrap.id = 'exercises-block';
  wrap.innerHTML = `
    <hr class="section-divider">
    <h2>Practice & Exercises</h2>
    <div class="ex-tabs">
      <button class="ex-tab active" data-mode="flashcard">Flashcards</button>
      <button class="ex-tab" data-mode="multiple">Multiple Choice</button>
      <button class="ex-tab" data-mode="reverse">English → Hebrew</button>
      <button class="ex-tab" data-mode="audio">Listen & Match</button>
      <button class="ex-tab" data-mode="typing">Typing</button>
      <button class="ex-tab" data-mode="memory">Memory Pairs</button>
      <button class="ex-tab" data-mode="dictation">Dictation</button>
    </div>
    <div id="ex-stage"></div>
    <div class="ex-stats" id="ex-stats">Score: 0 / 0 · Streak: 0</div>
  `;
  container.insertBefore(wrap, footer);

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
    if (mode === 'flashcard') renderFlashcard(stage, pool);
    else if (mode === 'multiple') renderMultiple(stage, pool, recordCorrect, recordWrong);
    else if (mode === 'reverse') renderReverse(stage, pool, recordCorrect, recordWrong);
    else if (mode === 'audio') renderAudio(stage, pool, recordCorrect, recordWrong);
    else if (mode === 'typing') renderTyping(stage, pool, recordCorrect, recordWrong);
    else if (mode === 'memory') renderMemory(stage, pool, recordCorrect);
    else if (mode === 'dictation') renderDictation(stage, pool, recordCorrect, recordWrong);
  }
  renderExercise('flashcard');
}

function renderDictation(stage, items, ok, ko) {
  function next() {
    const correct = items[Math.floor(Math.random() * items.length)];
    stage.innerHTML = `
      <div class="ex-prompt"><button class="btn btn-primary" id="qd-play" style="font-size:18px;padding:14px 28px;">▶ Listen</button><div class="ex-q-tr" style="margin-top:8px;">Type what you hear (transliteration OR English)</div></div>
      <div class="ex-input-row">
        <input type="text" class="ex-input" id="qd-input" placeholder="e.g. shalom · or · hello" autofocus>
        <button class="btn btn-primary" id="qd-submit">Check</button>
        <button class="btn" id="qd-reveal">Reveal</button>
      </div>
      <div class="ex-feedback" id="qd-fb"></div>`;
    setTimeout(() => speak(correct.he, 0.7), 200);
    document.getElementById('qd-play').addEventListener('click', () => speak(correct.he, 0.7));
    const input = document.getElementById('qd-input');
    input.focus();
    function check() {
      const guess = input.value.toLowerCase().replace(/['\-_\s\.\?\!]/g, '').trim();
      const targets = [correct.translit, correct.fr].map(t => t.toLowerCase().replace(/['\-_\s\.\?\!\(\)\,\;]/g, '').split(/[\(\)\,\;\?]/)[0]);
      const right = targets.some(t => levenshtein(guess, t) <= Math.max(1, Math.floor(t.length * 0.2)));
      document.getElementById('qd-fb').innerHTML = right
        ? `✓ Correct — <span dir="rtl" style="font-family:'Frank Ruhl Libre',serif;">${correct.he}</span> · ${correct.translit} · ${correct.fr}`
        : `✗ — <span dir="rtl" style="font-family:'Frank Ruhl Libre',serif;">${correct.he}</span> · ${correct.translit} · ${correct.fr}`;
      input.disabled = true;
      if (right) ok(); else ko(correct);
      setTimeout(next, 2200);
    }
    document.getElementById('qd-submit').addEventListener('click', check);
    document.getElementById('qd-reveal').addEventListener('click', () => { ko(correct); next(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
  }
  next();
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
          <div class="fc-hint">tap/space to flip · swipe →</div>
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
        card.innerHTML = `<div class="fc-side fc-front"><div class="fc-he">${w.he}</div><div class="fc-translit">${w.translit}</div><div class="fc-hint">tap/space to flip · swipe →</div></div>`;
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

function renderMultiple(stage, items, ok, ko) {
  function next() {
    const correct = items[Math.floor(Math.random() * items.length)];
    const distractors = shuffle(items.filter(x => x.he !== correct.he)).slice(0, 3);
    const opts = shuffle([correct, ...distractors]);
    stage.innerHTML = `
      <div class="ex-prompt"><div class="ex-q-he">${correct.he}</div><div class="ex-q-tr">${correct.translit}</div><button class="btn icon-btn" id="qm-play">▶</button></div>
      <div class="ex-options">${opts.map((o, j) => `<button class="ex-option" data-correct="${o.fr === correct.fr}">${o.fr}</button>`).join('')}</div>
      <div class="ex-feedback" id="qm-fb"></div>`;
    document.getElementById('qm-play').addEventListener('click', () => speak(correct.he, 0.85));
    stage.querySelectorAll('.ex-option').forEach(b => b.addEventListener('click', () => {
      stage.querySelectorAll('.ex-option').forEach(x => x.disabled = true);
      const right = b.dataset.correct === 'true';
      b.classList.add(right ? 'correct' : 'wrong');
      if (!right) stage.querySelector('.ex-option[data-correct="true"]').classList.add('correct');
      document.getElementById('qm-fb').textContent = right ? '✓ Correct' : `✗ — ${correct.fr}`;
      if (right) ok(); else ko(correct);
      setTimeout(next, 1200);
    }));
  }
  next();
}

function renderReverse(stage, items, ok, ko) {
  function next() {
    const correct = items[Math.floor(Math.random() * items.length)];
    const distractors = shuffle(items.filter(x => x.he !== correct.he)).slice(0, 3);
    const opts = shuffle([correct, ...distractors]);
    stage.innerHTML = `
      <div class="ex-prompt"><div class="ex-q-fr">${correct.fr}</div><div class="ex-q-tr">Pick the Hebrew</div></div>
      <div class="ex-options ex-options-he">${opts.map(o => `<button class="ex-option" data-correct="${o.he === correct.he}"><span style="font-family:'Frank Ruhl Libre',serif;font-size:24px;direction:rtl;">${o.he}</span><br><span style="font-size:12px;color:var(--text-dim);">${o.translit}</span></button>`).join('')}</div>
      <div class="ex-feedback" id="qm-fb"></div>`;
    stage.querySelectorAll('.ex-option').forEach(b => b.addEventListener('click', () => {
      stage.querySelectorAll('.ex-option').forEach(x => x.disabled = true);
      const right = b.dataset.correct === 'true';
      b.classList.add(right ? 'correct' : 'wrong');
      if (!right) stage.querySelector('.ex-option[data-correct="true"]').classList.add('correct');
      document.getElementById('qm-fb').textContent = right ? `✓ — ${correct.translit}` : `✗ — ${correct.he} (${correct.translit})`;
      speak(correct.he, 0.85);
      if (right) ok(); else ko(correct);
      setTimeout(next, 1500);
    }));
  }
  next();
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
      document.getElementById('qa-fb').textContent = right ? `✓ — ${correct.he}` : `✗ — ${correct.he} (${correct.fr})`;
      if (right) ok(); else ko(correct);
      setTimeout(next, 1500);
    }));
  }
  next();
}

function renderTyping(stage, items, ok, ko) {
  function next() {
    const correct = items[Math.floor(Math.random() * items.length)];
    stage.innerHTML = `
      <div class="ex-prompt"><div class="ex-q-he">${correct.he}</div><button class="btn icon-btn" id="qt-play">▶</button></div>
      <div class="ex-input-row">
        <input type="text" class="ex-input" id="qt-input" placeholder="Type the transliteration (e.g. shalom)" autofocus>
        <button class="btn btn-primary" id="qt-submit">Check</button>
        <button class="btn" id="qt-skip">Skip</button>
      </div>
      <div class="ex-hint">Hint: ${correct.fr}</div>
      <div class="ex-feedback" id="qt-fb"></div>`;
    document.getElementById('qt-play').addEventListener('click', () => speak(correct.he, 0.85));
    const input = document.getElementById('qt-input');
    input.focus();
    function check() {
      const guess = input.value.toLowerCase().replace(/['\-_\s]/g, '').trim();
      const target = correct.translit.toLowerCase().replace(/['\-_\s\.\?\!]/g, '').trim();
      const targetCore = target.split(/[\(\)\,\;\?]/)[0].trim();
      const distance = levenshtein(guess, targetCore);
      const right = distance <= Math.max(1, Math.floor(targetCore.length * 0.2));
      document.getElementById('qt-fb').innerHTML = right ? `✓ Correct — ${correct.translit}` : `✗ — ${correct.translit}`;
      input.disabled = true;
      if (right) ok(); else ko(correct);
      setTimeout(next, 1700);
    }
    document.getElementById('qt-submit').addEventListener('click', check);
    document.getElementById('qt-skip').addEventListener('click', () => { ko(correct); next(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
  }
  next();
}

function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function renderMemory(stage, items, ok) {
  const pool = shuffle(items).slice(0, Math.min(8, items.length));
  const cards = shuffle([
    ...pool.map(p => ({ id: p.he, side: 'he', text: p.he, sub: p.translit })),
    ...pool.map(p => ({ id: p.he, side: 'fr', text: p.fr, sub: '' }))
  ]);
  stage.innerHTML = `<div class="memory-grid" id="mem-grid">${cards.map((c, i) => `
    <div class="memory-card" data-id="${c.id}" data-i="${i}">
      <div class="memory-back">?</div>
      <div class="memory-front" style="${c.side === 'he' ? "font-family:'Frank Ruhl Libre',serif;direction:rtl;font-size:20px;" : 'font-size:14px;'}">${c.text}<br><span style="font-size:11px;color:var(--text-dim);">${c.sub}</span></div>
    </div>`).join('')}</div>
    <div class="ex-feedback" id="mem-fb">Click 2 cards to find a Hebrew↔English pair</div>`;
  let flipped = [], pairs = 0;
  stage.querySelectorAll('.memory-card').forEach(card => {
    card.addEventListener('click', () => {
      if (card.classList.contains('flipped') || card.classList.contains('matched') || flipped.length >= 2) return;
      card.classList.add('flipped');
      flipped.push(card);
      const heText = card.querySelector('.memory-front').textContent;
      if (card.dataset.id) speak(card.dataset.id, 0.85);
      if (flipped.length === 2) {
        if (flipped[0].dataset.id === flipped[1].dataset.id && flipped[0] !== flipped[1]) {
          flipped.forEach(c => c.classList.add('matched'));
          pairs++;
          ok();
          document.getElementById('mem-fb').textContent = `✓ Match! Pairs: ${pairs} / ${pool.length}`;
          flipped = [];
          if (pairs === pool.length) document.getElementById('mem-fb').textContent = '🎉 All pairs found!';
        } else {
          setTimeout(() => { flipped.forEach(c => c.classList.remove('flipped')); flipped = []; }, 900);
        }
      }
    });
  });
}

function setupNiqqudToggle() {
  const lesson = location.pathname.split(/[\\/]/).pop().replace('.html', '');
  if (lesson === 'index' || lesson === '01-alefbet' || lesson === '02-niqqud') return;

  const header = document.querySelector('header');
  if (!header) return;

  const toggle = document.createElement('button');
  toggle.className = 'niqqud-toggle';
  toggle.title = 'Toggle vowel marks (niqqud) — real Israeli Hebrew uses none';
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

function applyNiqqudStripping() {
  const off = document.body.classList.contains('no-niqqud');
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
        block.querySelector('.quiz-fb').textContent = right ? '✓ Correct' + (q.explain ? ' — ' + q.explain : '') : '✗ ' + (q.explain || '');
      });
    });
    const heEl = block.querySelector('[data-he]');
    if (heEl) heEl.addEventListener('click', () => speak(heEl.dataset.he, 0.8));
    root.appendChild(block);
  });
}
