import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// ============================================================
// Config
// ============================================================
const MODELS = {
  fast: 'Xenova/whisper-tiny.en',
  accurate: 'Xenova/whisper-base.en',
};
const HISTORY_KEY = 'voicenote_history';
const MODE_KEY = 'voicenote_mode';
const HINT_KEY = 'voicenote_hint_seen';
const INSTALL_DISMISSED_KEY = 'voicenote_install_dismissed';
const MAX_HISTORY = 50;
const HISTORY_UPDATE_DEBOUNCE_MS = 800;

// ============================================================
// Element references — matched exactly to this HTML's IDs
// ============================================================
const recordBtn = document.getElementById('recordBtn');
const recRow = document.querySelector('.rec-row');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const timerEl = document.getElementById('timer');
const timerTextEl = document.getElementById('timerText');
const recDot = document.getElementById('recDot');
const modelProgressWrap = document.getElementById('modelProgressWrap');
const modelProgressFill = document.getElementById('modelProgressFill');
const retryBtn = document.getElementById('retryBtn');
const audioPlayerEl = document.getElementById('audioPlayer');
const noteTitleEl = document.getElementById('noteTitle');
const transcriptEl = document.getElementById('transcript');
const numbersSection = document.getElementById('numbersSection');
const numbersEl = document.getElementById('numbers');
const summaryEl = document.getElementById('summary');
const shareBtn = document.getElementById('shareBtn');
const copyBtn = document.getElementById('copyBtn');
const saveBtn = document.getElementById('saveBtn');
const historyBtn = document.getElementById('historyBtn');
const historyPanel = document.getElementById('historyPanel');
const historySearchEl = document.getElementById('historySearch');
const historyList = document.getElementById('historyList');
const modeFastBtn = document.getElementById('modeFast');
const modeAccurateBtn = document.getElementById('modeAccurate');
const exportBtn = document.getElementById('exportBtn');
const shareBackupBtn = document.getElementById('shareBackupBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const clearAllBtn = document.getElementById('clearAllBtn');
const addPhotoBtn = document.getElementById('addPhotoBtn');
const photoInput = document.getElementById('photoInput');
const photoPreview = document.getElementById('photoPreview');
const photoImg = document.getElementById('photoImg');
const removePhotoBtn = document.getElementById('removePhotoBtn');
const addVideoBtn = document.getElementById('addVideoBtn');
const videoInput = document.getElementById('videoInput');
const videoPreview = document.getElementById('videoPreview');
const videoPreviewEl = document.getElementById('videoPreviewEl');
const removeVideoBtn = document.getElementById('removeVideoBtn');
const helpBtn = document.getElementById('helpBtn');
const closeHelpBtn = document.getElementById('closeHelpBtn');
const helpOverlay = document.getElementById('helpOverlay');
const installBanner = document.getElementById('installBanner');
const installText = document.getElementById('installText');
const installBtn = document.getElementById('installBtn');
const dismissInstallBtn = document.getElementById('dismissInstallBtn');

// ============================================================
// State
// ============================================================
let mediaRecorder = null;
let chunks = [];
let recState = 'idle'; // 'idle' | 'recording' | 'paused'
let recordMimeType = '';
let mode = localStorage.getItem(MODE_KEY) || 'accurate';

let elapsedBeforePause = 0;
let segmentStart = null;
let timerInterval = null;

let wakeLock = null;

let photoBlob = null;
let currentPhotoDataUrl = null; // compressed version, persisted to history

let videoBlob = null;
let videoUrl = null; // in-memory only — never persisted, too large for localStorage

let lastRecordingBlob = null;
let lastRecordingUrl = null; // in-memory only — never persisted

let currentHistoryId = null;
let historyUpdateTimer = null;

let recordingSegments = []; // audio blobs, one per continuous segment — stitched together at Stop
let pausedViaSegmentSplit = false; // true when the current pause released the mic entirely (camera flow), vs a plain in-place pause

let fileShareUnreliable = false; // set once canShare() proves untrustworthy on this browser this session

// ============================================================
// Small helpers
// ============================================================
function show(el, displayType = 'block') {
  el.style.display = displayType;
  requestAnimationFrame(() => el.classList.add('visible'));
}
function hide(el) {
  el.classList.remove('visible');
  setTimeout(() => { el.style.display = 'none'; }, 200);
}
function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}
function timestamp() {
  return new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
}
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function downloadFile(filename, content, mimeType) {
  downloadBlob(filename, new Blob([content], { type: mimeType }));
}
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ============================================================
// Service worker (offline app shell)
// ============================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ============================================================
// Persistent storage
// ============================================================
// Ask the browser to protect this site's stored data (the downloaded
// speech model, note history) from automatic eviction. Without this,
// browsers are free to clear cached data whenever storage runs low or
// the site goes unused for a while — which is why the model can end up
// re-downloading on later visits. Best-effort by design: unsupported
// browsers ignore it, and iOS Safari's own privacy cleanup can still
// override it after prolonged inactivity, which no site can prevent.
(async () => {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (!already) await navigator.storage.persist();
    }
  } catch (e) {
    // never block startup on this
  }
})();

// ============================================================
// Install prompt (first visit, browser tab only)
// ============================================================
// Two different paths, because the platforms genuinely differ:
//  - Chrome/Android fires 'beforeinstallprompt', giving us a real
//    one-tap native install dialog.
//  - iOS Safari has no install API at all, so the only option is to
//    show the manual "Share → Add to Home Screen" steps.
// Never shown when already running as an installed app, or once the
// person has dismissed or completed it.
let deferredInstallPrompt = null;

function isRunningStandalone() {
  return (
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function maybeShowInstallBanner() {
  if (isRunningStandalone()) return;               // already installed
  if (localStorage.getItem(INSTALL_DISMISSED_KEY)) return; // already answered

  if (deferredInstallPrompt) {
    installText.textContent = 'Install this app to your home screen for quicker access and offline use.';
    installBtn.style.display = 'block';
    show(installBanner);
  } else if (isIos()) {
    // No install API on iOS — show the manual steps instead of a button
    // that couldn't do anything.
    installText.textContent = 'To install: tap the Share button below, then "Add to Home Screen" — it opens full screen and works offline.';
    installBtn.style.display = 'none';
    show(installBanner);
  }
  // Other browsers with no install support: show nothing rather than
  // instructions that may not match what the person actually sees.
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // stop the browser's own mini-infobar; we prompt at our own moment
  deferredInstallPrompt = e;
  maybeShowInstallBanner();
});

installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  hide(installBanner);
  try {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
  } catch (e) {
    // prompt can only be used once; nothing useful to do if it fails
  }
  deferredInstallPrompt = null;
  safeSet(INSTALL_DISMISSED_KEY, '1');
});

dismissInstallBtn.addEventListener('click', () => {
  hide(installBanner);
  safeSet(INSTALL_DISMISSED_KEY, '1');
});

window.addEventListener('appinstalled', () => {
  hide(installBanner);
  safeSet(INSTALL_DISMISSED_KEY, '1');
  deferredInstallPrompt = null;
});

// iOS never fires beforeinstallprompt, so check on load for that path.
maybeShowInstallBanner();

// ============================================================
// Help modal
// ============================================================
helpBtn.addEventListener('click', () => helpOverlay.classList.add('show'));
closeHelpBtn.addEventListener('click', () => helpOverlay.classList.remove('show'));
helpOverlay.addEventListener('click', (e) => {
  if (e.target === helpOverlay) helpOverlay.classList.remove('show');
});

// ============================================================
// One-time hint
// ============================================================
if (!localStorage.getItem(HINT_KEY)) {
  statusEl.textContent = 'Tap to record. First use downloads the offline speech model (one time, needs Wi-Fi).';
}

// ============================================================
// Model loading — preload/warm in background, WebGPU with WASM fallback
// ============================================================
const transcriberPromises = {};

function makeProgressHandler(m) {
  return (p) => {
    if (p.status === 'progress') {
      show(modelProgressWrap);
      const pct = Math.round(p.progress);
      modelProgressFill.style.width = pct + '%';
      statusEl.textContent = `Downloading ${m === 'fast' ? 'Fast' : 'Accurate'} speech model: ${pct}%`;
    }
  };
}

async function loadTranscriber(m) {
  const modelId = MODELS[m];
  const progressCb = makeProgressHandler(m);
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      return await pipeline('automatic-speech-recognition', modelId, {
        quantized: true,
        device: 'webgpu',
        progress_callback: progressCb,
      });
    } catch (e) {
      // WebGPU unavailable or failed for this model — fall through to WASM
    }
  }
  return await pipeline('automatic-speech-recognition', modelId, {
    quantized: true,
    progress_callback: progressCb,
  });
}

function ensureTranscriber(m) {
  if (!transcriberPromises[m]) {
    transcriberPromises[m] = loadTranscriber(m)
      .then((t) => { hide(modelProgressWrap); return t; })
      .catch((err) => { delete transcriberPromises[m]; throw err; });
  }
  return transcriberPromises[m];
}

// ============================================================
// Mode toggle — declared before setMode() is called, avoiding the
// ReferenceError bug from an earlier version where this ordering was wrong
// ============================================================

// The background preload is genuinely convenient (recording usually isn't
// blocked waiting for a download) but shouldn't happen silently over
// cellular — that would burn a chunk of someone's data plan before they've
// even decided to use the app, directly contradicting the one-time hint's
// own "needs Wi-Fi" promise. Where the connection type can't be confirmed
// at all (iOS Safari has no Network Information API), err on the side of
// NOT preloading automatically — the model still loads normally the
// moment Start Recording is tapped, just without the head start.
function shouldAutoPreload() {
  const conn = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
  if (!conn) return false;
  if (conn.saveData) return false; // respect the browser's own Data Saver setting
  if (typeof conn.type === 'string') return conn.type === 'wifi';
  if (typeof conn.effectiveType === 'string') return conn.effectiveType === '4g'; // imperfect fallback where 'type' isn't exposed
  return false;
}

function setMode(newMode, userInitiated) {
  mode = newMode;
  safeSet(MODE_KEY, mode);
  modeFastBtn.classList.toggle('active', mode === 'fast');
  modeAccurateBtn.classList.toggle('active', mode === 'accurate');
  // A manual tap of Fast/Accurate is a deliberate signal of intent to use
  // the app shortly, so preload regardless of connection type in that case.
  // The initial, unprompted page-load call is the one that needs to be careful.
  if (userInitiated || shouldAutoPreload()) {
    ensureTranscriber(mode).catch(() => {});
  }
}
modeFastBtn.addEventListener('click', () => setMode('fast', true));
modeAccurateBtn.addEventListener('click', () => setMode('accurate', true));
setMode(mode, false); // initial load — only preloads automatically on a confirmed non-cellular connection

// ============================================================
// Wake Lock
// ============================================================
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) {}
}
async function releaseWakeLock() {
  if (wakeLock) {
    try { await wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && recState !== 'idle' && !wakeLock) {
    await acquireWakeLock();
  }
});

// ============================================================
// Recording controls — segment-based, so a photo/video mid-recording
// never risks losing audio. Rather than trying to keep one microphone
// connection alive through the camera interruption (unreliable — depends
// entirely on whether the OS lets it survive, which varies by phone and
// is outside this app's control), each camera trip cleanly finishes the
// current segment, and a fresh microphone connection is reacquired the
// moment the camera returns control. All segments are stitched together
// (at the decoded-audio level, for reliable transcription) when you
// finally tap Stop. Reacquiring a *fresh* connection after an
// interruption is a normal, well-supported operation — unlike keeping an
// old one alive through it — which is what makes this approach reliable
// where the previous pause-and-hope approach wasn't.
// ============================================================
function pickMimeType() {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

// Safety net: if the OS reclaims the mic unexpectedly (a phone call, or
// anything other than our own deliberate camera-triggered release), the
// browser auto-stops the recorder per spec — this keeps our UI state
// from getting stuck out of sync when that happens.
function attachTrackSafetyNet(stream) {
  stream.getAudioTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      if (recState !== 'idle') {
        clearInterval(timerInterval);
        recState = 'idle';
        pausedViaSegmentSplit = false;
        showIdleUI();
        releaseWakeLock();
      }
    });
  });
}

function showRecordingUI() {
  hide(recordBtn);
  show(recRow, 'flex');
  pauseBtn.style.display = recState === 'recording' ? 'block' : 'none';
  resumeBtn.style.display = recState === 'paused' ? 'block' : 'none';
  recDot.classList.toggle('on', recState === 'recording');
  timerEl.classList.add('show');
}
function showIdleUI() {
  hide(recRow);
  show(recordBtn);
  recDot.classList.remove('on');
  timerEl.classList.remove('show');
}
showIdleUI();

recordBtn.addEventListener('click', startRecording);
pauseBtn.addEventListener('click', pauseRecording);
resumeBtn.addEventListener('click', resumeRecording);
stopBtn.addEventListener('click', stopRecording);

async function startRecording() {
  statusEl.textContent = 'Requesting microphone access...';
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    statusEl.textContent = 'Microphone access denied or unavailable. Check your browser/site permissions and try again.';
    return;
  }

  safeSet(HINT_KEY, '1');

  // clear the screen for a fresh note
  noteTitleEl.value = '';
  transcriptEl.value = '';
  summaryEl.value = '';
  hide(numbersSection);
  numbersEl.innerHTML = '';
  clearPhoto();
  clearVideo();
  hideAudioPlayback();
  hide(retryBtn);
  lastRecordingBlob = null;
  currentHistoryId = null;
  recordingSegments = [];
  pausedViaSegmentSplit = false;
  elapsedBeforePause = 0;

  beginSegment(stream);

  recState = 'recording';
  showRecordingUI();
  statusEl.textContent = 'Recording...';

  await acquireWakeLock();
}

// Starts a fresh MediaRecorder on a fresh stream. Used for the initial
// recording and to resume after a camera-triggered pause, where the
// previous mic connection was deliberately released rather than kept
// alive through the interruption.
function beginSegment(stream) {
  chunks = [];
  recordMimeType = pickMimeType();
  mediaRecorder = recordMimeType
    ? new MediaRecorder(stream, { mimeType: recordMimeType })
    : new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
  mediaRecorder.onstop = onSegmentStopped;
  mediaRecorder.start();
  attachTrackSafetyNet(stream);
  segmentStart = Date.now();
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
}

function pauseRecording() {
  if (recState !== 'recording') return;
  mediaRecorder.pause();
  clearInterval(timerInterval);
  elapsedBeforePause += Math.floor((Date.now() - segmentStart) / 1000);
  recState = 'paused';
  pausedViaSegmentSplit = false;
  showRecordingUI();
  statusEl.textContent = 'Paused.';
}

function resumeRecording() {
  if (recState !== 'paused') return;
  if (pausedViaSegmentSplit) {
    resumeAfterSegmentSplit();
    return;
  }
  mediaRecorder.resume();
  segmentStart = Date.now();
  timerInterval = setInterval(updateTimer, 1000);
  recState = 'recording';
  showRecordingUI();
  statusEl.textContent = 'Recording...';
}

function updateTimer() {
  const running = recState === 'recording' ? Math.floor((Date.now() - segmentStart) / 1000) : 0;
  const secs = elapsedBeforePause + running;
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  timerTextEl.textContent = `${m}:${s}`;
}

function stopRecording() {
  if (recState === 'idle') return;
  clearInterval(timerInterval);
  recState = 'idle';
  pausedViaSegmentSplit = false;
  showIdleUI();
  releaseWakeLock();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop(); // onSegmentStopped sees recState === 'idle' and finalizes the whole session
    mediaRecorder.stream.getTracks().forEach((t) => t.stop());
  } else {
    // no live recorder right now (stopped mid camera-pause, mic already
    // released) — finalize directly from whatever segments exist already
    finishRecordingSession();
  }
}

// Used by Add Photo / Add Video. Cleanly finishes the current segment and
// remembers it; resumeAfterSegmentSplit (below) reconnects the mic and
// starts a new segment once the camera returns control.
function pauseRecordingForCamera(whatFor) {
  if (recState !== 'recording' && recState !== 'paused') return; // idle: nothing to do
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((t) => t.stop());
  }
  clearInterval(timerInterval);
  if (recState === 'recording') {
    elapsedBeforePause += Math.floor((Date.now() - segmentStart) / 1000);
  }
  recState = 'paused';
  pausedViaSegmentSplit = true;
  showRecordingUI();
  statusEl.textContent = `Recording paused for ${whatFor} — will resume automatically once you're back.`;
}

// Called once the camera returns control (photo/video picked), to pick
// recording back up automatically. Also reachable via the Resume button
// as a manual fallback if that automatic attempt hasn't run yet or failed.
async function resumeAfterSegmentSplit() {
  if (!pausedViaSegmentSplit || recState !== 'paused') return;
  statusEl.textContent = 'Reconnecting microphone...';
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    statusEl.textContent = "Couldn't reconnect the microphone automatically — tap Resume to try again, or Stop to finish with what's captured so far.";
    return;
  }
  pausedViaSegmentSplit = false;
  beginSegment(stream);
  recState = 'recording';
  showRecordingUI();
  statusEl.textContent = 'Recording resumed.';
  await acquireWakeLock();
}

async function onSegmentStopped() {
  const blob = new Blob(chunks, { type: recordMimeType || 'audio/webm' });
  recordingSegments.push(blob);
  chunks = [];
  if (recState === 'idle') {
    // this was the real, final stop — finalize the whole session
    await finishRecordingSession();
  }
  // otherwise this was a camera-triggered segment split — resumeAfterSegmentSplit
  // (called from the photo/video 'change' handlers) picks up from here
}

async function finishRecordingSession() {
  if (recordingSegments.length === 0) return;
  const combinedBlob = new Blob(recordingSegments, { type: recordMimeType || 'audio/webm' });
  lastRecordingBlob = combinedBlob; // best-effort combined file, for playback/Save
  showAudioPlayback(combinedBlob);
  await transcribe(recordingSegments);
}

// ============================================================
// Playback (in-memory only)
// ============================================================
function showAudioPlayback(blob) {
  if (lastRecordingUrl) URL.revokeObjectURL(lastRecordingUrl);
  lastRecordingUrl = URL.createObjectURL(blob);
  audioPlayerEl.src = lastRecordingUrl;
  show(audioPlayerEl);
}
function hideAudioPlayback() {
  if (lastRecordingUrl) {
    URL.revokeObjectURL(lastRecordingUrl);
    lastRecordingUrl = null;
  }
  audioPlayerEl.removeAttribute('src');
  hide(audioPlayerEl);
}

// ============================================================
// Transcription + retry
// ============================================================
retryBtn.addEventListener('click', () => {
  if (recordingSegments.length) transcribe(recordingSegments);
});

function suggestTitle(text) {
  const words = text.trim().split(/\s+/).slice(0, 6).join(' ');
  return words.length > 40 ? words.slice(0, 40) + '…' : words;
}

// Decodes each segment separately (avoids any container-format issues
// from naively concatenating independent WebM/MP4 files) and joins the
// raw decoded samples into one continuous buffer — reliable regardless
// of how many segments a note ended up split into.
async function decodeSegments(blobs) {
  const decoded = [];
  let totalLength = 0;
  for (const blob of blobs) {
    const pcm = await decodeToMono16k(blob);
    decoded.push(pcm);
    totalLength += pcm.length;
  }
  const combined = new Float32Array(totalLength);
  let offset = 0;
  for (const pcm of decoded) {
    combined.set(pcm, offset);
    offset += pcm.length;
  }
  return combined;
}

async function transcribe(segments) {
  recordBtn.disabled = true;
  modeFastBtn.disabled = true;
  modeAccurateBtn.disabled = true;
  hide(retryBtn);
  try {
    statusEl.textContent = 'Loading speech model...';
    const transcriber = await ensureTranscriber(mode);

    statusEl.textContent = 'Decoding audio...';
    const audioData = await decodeSegments(segments);

    statusEl.textContent = 'Transcribing...';
    const result = await transcriber(audioData, { chunk_length_s: 30, stride_length_s: 5 });

    const text = result.text.trim();
    transcriptEl.value = text;
    renderNumbers(text);
    summaryEl.value = text;
    if (!noteTitleEl.value.trim()) noteTitleEl.value = suggestTitle(text);

    const { ok, id } = saveToHistory(text, text, currentPhotoDataUrl, noteTitleEl.value);
    currentHistoryId = id;
    statusEl.textContent = ok
      ? 'Done. Edit below, then share or save.'
      : 'Done — but saving to history failed (storage may be full). Use Save to keep this note.';
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message + ' — you can retry using the recording below.';
    show(retryBtn);
  } finally {
    recordBtn.disabled = false;
    modeFastBtn.disabled = false;
    modeAccurateBtn.disabled = false;
  }
}

async function decodeToMono16k(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);
  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
  const ch0 = decoded.getChannelData(0);
  const ch1 = decoded.getChannelData(1);
  const mono = new Float32Array(ch0.length);
  for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
  return mono;
}

// ============================================================
// Number extraction — majority-vote confidence
// ============================================================
function renderNumbers(text) {
  const matches = text.match(/\d+(\.\d+)?/g) || [];
  if (matches.length === 0) {
    hide(numbersSection);
    numbersEl.innerHTML = '';
    return;
  }
  const freq = {};
  matches.forEach((n) => (freq[n] = (freq[n] || 0) + 1));

  const confirmed = Object.keys(freq).filter((n) => freq[n] > 1).sort((a, b) => Number(a) - Number(b));
  const unverified = Object.keys(freq).filter((n) => freq[n] === 1).sort((a, b) => Number(a) - Number(b));

  let html = '';
  if (confirmed.length) {
    html += `<div class="numbers-group confirmed"><h3>Confirmed (repeated)</h3><div class="numbers-list">`;
    html += confirmed.map((n) => `<span class="num-chip">${n} <small>×${freq[n]}</small></span>`).join('');
    html += `</div></div>`;
  }
  if (unverified.length) {
    html += `<div class="numbers-group unverified"><h3>Verify (mentioned once)</h3><div class="numbers-list">`;
    html += unverified.map((n) => `<span class="num-chip">${n}</span>`).join('');
    html += `</div></div>`;
  }
  numbersEl.innerHTML = html;
  show(numbersSection);
}

// ============================================================
// Live edits — transcript is editable in this version, so fixing a number
// by hand re-scores the badges immediately; message and title sync too
// ============================================================
transcriptEl.addEventListener('input', () => {
  renderNumbers(transcriptEl.value);
  scheduleHistoryUpdate();
});
summaryEl.addEventListener('input', scheduleHistoryUpdate);
noteTitleEl.addEventListener('input', scheduleHistoryUpdate);

function scheduleHistoryUpdate() {
  clearTimeout(historyUpdateTimer);
  historyUpdateTimer = setTimeout(updateCurrentHistoryEntry, HISTORY_UPDATE_DEBOUNCE_MS);
}
function updateCurrentHistoryEntry() {
  if (!currentHistoryId) return;
  const history = loadHistory();
  const idx = history.findIndex((h) => h.id === currentHistoryId);
  if (idx === -1) return;
  history[idx].transcript = transcriptEl.value;
  history[idx].summary = summaryEl.value;
  history[idx].title = noteTitleEl.value;
  history[idx].photo = currentPhotoDataUrl;
  safeSet(HISTORY_KEY, JSON.stringify(history));
  if (historyPanel.classList.contains('show')) renderHistory();
}

// ============================================================
// Photo
// ============================================================
addPhotoBtn.addEventListener('click', () => {
  pauseRecordingForCamera('the photo');
  photoInput.click();
});

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  if (file) {
    photoBlob = file;
    try {
      currentPhotoDataUrl = await compressPhoto(file);
      // Show the COMPRESSED version in the preview, not the original.
      // Displaying the full-resolution original would keep that large
      // decoded bitmap alive in memory for as long as it's on screen —
      // the same pressure that causes the tab to be killed.
      photoImg.src = currentPhotoDataUrl;
      show(photoPreview);
      // Keep memory bounded: hold the small version as the working copy
      // rather than the original camera file.
      photoBlob = dataURLtoBlob(currentPhotoDataUrl);
    } catch (e) {
      currentPhotoDataUrl = null;
      photoBlob = null;
      hide(photoPreview);
      statusEl.textContent = 'Could not process that photo: ' + e.message;
    }
    updateCurrentHistoryEntry();
  }
  // Resume even if the camera was cancelled with no photo taken — we
  // already paused for it, so recording should continue either way.
  if (pausedViaSegmentSplit) await resumeAfterSegmentSplit();
});

removePhotoBtn.addEventListener('click', () => {
  clearPhoto();
  updateCurrentHistoryEntry();
});

function clearPhoto() {
  photoBlob = null;
  photoInput.value = '';
  photoImg.removeAttribute('src');
  hide(photoPreview);
  currentPhotoDataUrl = null;
}

// Memory-safe photo processing.
//
// The previous implementation loaded the photo into an <img> element,
// which forces the browser to fully decode the ORIGINAL full-resolution
// image into memory before it can be scaled down. A modern phone photo
// (12+ megapixels) can occupy 40-50MB+ as a raw decoded bitmap even
// though the file itself is a few MB — and mobile browsers (iOS Safari
// especially) have tight per-tab memory limits. Exceeding one doesn't
// throw a catchable error; the browser kills and reloads the whole page,
// which is exactly the "app randomly resets after taking a photo"
// symptom, and why it varied by image (bigger pixel dimensions = more
// memory, regardless of compressed file size).
//
// createImageBitmap() with resize options lets the browser decode
// straight to (approximately) the target size, so the giant intermediate
// bitmap never has to exist. Falls back to the old <img> path only where
// that API isn't available, and guards that fallback with a size check.
const PHOTO_MAX_WIDTH = 640;
const PHOTO_FALLBACK_MAX_BYTES = 8 * 1024 * 1024; // only applies to the legacy fallback path

async function compressPhoto(blob) {
  if (typeof createImageBitmap === 'function') {
    let bitmap = null;
    try {
      // Ask for the resize during decode — the key memory saving.
      try {
        bitmap = await createImageBitmap(blob, {
          resizeWidth: PHOTO_MAX_WIDTH,
          resizeQuality: 'medium',
        });
      } catch (e) {
        // Some browsers reject the resize options but handle plain decode fine.
        bitmap = await createImageBitmap(blob);
      }

      const scale = Math.min(1, PHOTO_MAX_WIDTH / bitmap.width);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', 0.6);
    } finally {
      // Release the decoded pixels promptly rather than waiting for GC.
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    }
  }

  // Legacy fallback (older browsers without createImageBitmap). Refuse
  // very large files here rather than risk the full-decode crash.
  if (blob.size > PHOTO_FALLBACK_MAX_BYTES) {
    throw new Error('This photo is too large for this browser to process safely.');
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);
    img.onload = () => {
      const scale = Math.min(1, PHOTO_MAX_WIDTH / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not process photo.'));
    };
    img.src = objectUrl;
  });
}

function dataURLtoBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = (header.match(/data:(.*?);base64/) || [])[1] || 'image/jpeg';
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ============================================================
// Video — in-memory only, never persisted to history (too large)
// ============================================================
addVideoBtn.addEventListener('click', () => {
  pauseRecordingForCamera('the video');
  videoInput.click();
});

videoInput.addEventListener('change', async () => {
  const file = videoInput.files[0];
  if (file) {
    videoBlob = file;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = URL.createObjectURL(file);
    videoPreviewEl.src = videoUrl;
    show(videoPreview);
  }
  // Resume even if the camera was cancelled with no video taken.
  if (pausedViaSegmentSplit) await resumeAfterSegmentSplit();
});

removeVideoBtn.addEventListener('click', clearVideo);

function clearVideo() {
  videoBlob = null;
  videoInput.value = '';
  if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = null; }
  videoPreviewEl.removeAttribute('src');
  hide(videoPreview);
}

function extForVideoMime(mime) {
  if (!mime) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('quicktime')) return 'mov';
  return 'mp4';
}

function extForAudioMime(mime) {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

// ============================================================
// Share — single-call-per-tap safe, learns from unreliable canShare()
// ============================================================
async function shareText(text, files) {
  if (navigator.share) {
    // The Web Share API allows exactly ONE navigator.share() call per user
    // gesture — a second call after the first fails (even synchronously)
    // throws "must be handling a user gesture". So the decision of whether
    // to include files must be made up front via canShare() (which does
    // NOT consume activation), and only one share() call is ever made.
    const includeFiles = !!(
      files && files.length && !fileShareUnreliable &&
      navigator.canShare && navigator.canShare({ text, files })
    );
    try {
      if (includeFiles) {
        await navigator.share({ text, files });
        return 'shared';
      } else {
        await navigator.share({ text });
        return files && files.length ? 'text-only' : 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      if (includeFiles) {
        fileShareUnreliable = true;
        return 'file-share-unreliable';
      }
      return 'error:' + (e && e.message ? e.message : 'Share failed.');
    }
  } else {
    try {
      await navigator.clipboard.writeText(text);
      return 'clipboard';
    } catch (e) {
      return 'error:Could not copy to clipboard.';
    }
  }
}

function reportShareResult(result) {
  if (result === 'text-only') {
    statusEl.textContent = "Shared the text — this browser can't attach the photo/video automatically, so attach them separately.";
  } else if (result === 'file-share-unreliable') {
    statusEl.textContent = 'This browser rejected the attachment — sharing text only for the rest of this session. Use Save to keep the photo/video/audio.';
  } else if (result === 'clipboard') {
    statusEl.textContent = 'Sharing not supported here — copied to clipboard instead.';
  } else if (typeof result === 'string' && result.startsWith('error:')) {
    statusEl.textContent = result.slice(6);
  }
  // 'shared' and 'cancelled' need no message.
}

shareBtn.addEventListener('click', async () => {
  // Audio is deliberately left out of Share (though Save still includes
  // it): testing showed that bundling an audio file alongside photo/video
  // caused WhatsApp's share handler to reject the whole attachment set and
  // fall back to text-only — likely because it doesn't recognize the audio
  // MIME type and bails on the entire file array rather than skipping just
  // that one. Photo/video together are far more broadly supported.
  const files = [];
  if (photoBlob) files.push(photoBlob);
  if (videoBlob) {
    files.push(new File([videoBlob], `voicenote-video.${extForVideoMime(videoBlob.type)}`, { type: videoBlob.type || 'video/mp4' }));
  }
  const result = await shareText(summaryEl.value, files);
  reportShareResult(result);
});

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(summaryEl.value);
  statusEl.textContent = 'Copied to clipboard.';
});

// ============================================================
// Save
// ============================================================
saveBtn.addEventListener('click', () => {
  const content = summaryEl.value || transcriptEl.value;
  if (!content && !photoBlob && !videoBlob && !lastRecordingBlob) {
    statusEl.textContent = 'Nothing to save yet.';
    return;
  }
  const saved = [];
  if (content) { downloadFile(`voicenote-${timestamp()}.txt`, content, 'text/plain'); saved.push('text'); }
  if (photoBlob) { downloadBlob(`voicenote-photo-${timestamp()}.jpg`, photoBlob); saved.push('photo'); }
  if (videoBlob) { downloadBlob(`voicenote-video-${timestamp()}.${extForVideoMime(videoBlob.type)}`, videoBlob); saved.push('video'); }
  if (lastRecordingBlob) { downloadBlob(`voicenote-audio-${timestamp()}.${extForAudioMime(recordMimeType)}`, lastRecordingBlob); saved.push('audio'); }
  statusEl.textContent = `Saved ${saved.join(', ')}.`;
});

// ============================================================
// History
// ============================================================
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveToHistory(transcript, summary, photo, title) {
  const history = loadHistory();
  const id = Date.now();
  history.unshift({ id, date: new Date().toISOString(), transcript, summary, photo: photo || null, title: title || '' });
  while (history.length > MAX_HISTORY) history.pop();
  const ok = safeSet(HISTORY_KEY, JSON.stringify(history));
  if (historyPanel.classList.contains('show')) renderHistory();
  return { ok, id };
}

function renderHistory() {
  const query = historySearchEl.value.trim().toLowerCase();
  let history = loadHistory();
  if (query) {
    history = history.filter((h) =>
      (h.title || '').toLowerCase().includes(query) ||
      (h.summary || '').toLowerCase().includes(query) ||
      (h.transcript || '').toLowerCase().includes(query)
    );
  }

  if (history.length === 0) {
    historyList.innerHTML = `<div id="emptyHistory">${query ? 'No notes match your search.' : 'No previous notes yet.'}</div>`;
    return;
  }

  historyList.innerHTML = '';
  history.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'history-item';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const dateStr = new Date(item.date).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const primary = item.title ? item.title : (item.summary || '').slice(0, 60);
    meta.innerHTML = `<div class="title">${escapeHtml(primary)}</div><div class="date">${dateStr}${item.photo ? ' · 📷' : ''}</div>`;
    meta.addEventListener('click', () => loadHistoryItem(item, dateStr));

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const shareSpan = document.createElement('span');
    shareSpan.className = 'item-share';
    shareSpan.textContent = '📤';
    shareSpan.addEventListener('click', async (e) => {
      e.stopPropagation();
      const files = item.photo ? [new File([dataURLtoBlob(item.photo)], 'photo.jpg', { type: 'image/jpeg' })] : [];
      const result = await shareText(item.summary, files);
      reportShareResult(result);
    });

    const del = document.createElement('span');
    del.className = 'item-del';
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete this note?')) return;
      const remaining = loadHistory().filter((h) => h.id !== item.id);
      safeSet(HISTORY_KEY, JSON.stringify(remaining));
      renderHistory();
    });

    actions.appendChild(shareSpan);
    actions.appendChild(del);
    div.appendChild(meta);
    div.appendChild(actions);
    historyList.appendChild(div);
  });
}

function loadHistoryItem(item, dateStr) {
  noteTitleEl.value = item.title || '';
  transcriptEl.value = item.transcript;
  summaryEl.value = item.summary;
  renderNumbers(item.transcript);
  hideAudioPlayback(); // no audio saved with history entries
  clearVideo(); // no video saved with history entries either
  hide(retryBtn);
  lastRecordingBlob = null;
  recordingSegments = [];
  currentHistoryId = item.id; // further edits update this same entry

  if (item.photo) {
    photoBlob = dataURLtoBlob(item.photo);
    photoImg.src = item.photo;
    show(photoPreview);
    currentPhotoDataUrl = item.photo;
  } else {
    clearPhoto();
  }

  statusEl.textContent = `Loaded note from ${dateStr}`;
  historyPanel.classList.remove('show');
}

historyBtn.addEventListener('click', () => {
  historyPanel.classList.toggle('show');
  if (historyPanel.classList.contains('show')) renderHistory();
});
historySearchEl.addEventListener('input', renderHistory);

// ============================================================
// Export / Share Backup / Import / Clear all
// ============================================================
exportBtn.addEventListener('click', () => {
  const history = loadHistory();
  if (history.length === 0) {
    statusEl.textContent = 'No history to export.';
    return;
  }
  downloadFile(`voicenote-history-${timestamp()}.json`, JSON.stringify(history, null, 2), 'application/json');
  statusEl.textContent = `Exported ${history.length} note(s).`;
});

shareBackupBtn.addEventListener('click', async () => {
  const history = loadHistory();
  if (history.length === 0) {
    statusEl.textContent = 'No history to share.';
    return;
  }
  const file = new File(
    [JSON.stringify(history, null, 2)],
    `voicenote-history-${timestamp()}.json`,
    { type: 'application/json' }
  );
  const result = await shareText(`Voice Note history backup — ${history.length} note(s)`, [file]);
  if (result === 'shared') {
    statusEl.textContent = 'Backup shared.';
  } else if (result === 'text-only' || result === 'file-share-unreliable') {
    statusEl.textContent = "This browser can't share the backup file directly — use Export All to download it instead.";
  } else if (result === 'clipboard') {
    statusEl.textContent = 'Sharing not supported here — use Export All to download instead.';
  } else if (typeof result === 'string' && result.startsWith('error:')) {
    statusEl.textContent = result.slice(6);
  }
});

importBtn.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error('File is not a valid history export.');

    const existing = loadHistory();
    const byId = new Map(existing.map((h) => [h.id, h]));
    imported.forEach((h) => {
      if (h && h.id && h.date && typeof h.summary === 'string') byId.set(h.id, h);
    });
    const merged = Array.from(byId.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
    const trimmed = merged.slice(0, MAX_HISTORY);

    const ok = safeSet(HISTORY_KEY, JSON.stringify(trimmed));
    statusEl.textContent = ok
      ? `Imported. History now has ${trimmed.length} note(s).`
      : 'Import failed to save — storage may be full.';
    renderHistory();
  } catch (err) {
    statusEl.textContent = 'Import failed: ' + err.message;
  } finally {
    importFile.value = '';
  }
});

clearAllBtn.addEventListener('click', () => {
  if (!confirm('Delete all saved notes? This cannot be undone.')) return;
  safeSet(HISTORY_KEY, JSON.stringify([]));
  renderHistory();
  statusEl.textContent = 'History cleared.';
});
