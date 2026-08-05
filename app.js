import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

const MODELS = {
  fast: 'Xenova/whisper-tiny.en',
  accurate: 'Xenova/whisper-base.en',
};
const HISTORY_KEY = 'voicenote_history';
const MODE_KEY = 'voicenote_mode';
const MAX_HISTORY = 50;

const recordBtn = document.getElementById('recordBtn');
const statusEl = document.getElementById('status');
const timerEl = document.getElementById('timer');
const transcriptEl = document.getElementById('transcript');
const numbersEl = document.getElementById('numbers');
const summaryEl = document.getElementById('summary');
const shareBtn = document.getElementById('shareBtn');
const copyBtn = document.getElementById('copyBtn');
const saveBtn = document.getElementById('saveBtn');
const historyBtn = document.getElementById('historyBtn');
const historyPanel = document.getElementById('historyPanel');
const historyList = document.getElementById('historyList');
const modeFastBtn = document.getElementById('modeFast');
const modeAccurateBtn = document.getElementById('modeAccurate');

let mediaRecorder = null;
let chunks = [];
let recording = false;
let recordStart = null;
let timerInterval = null;
let recordMimeType = '';
const transcribers = {}; // cached per mode: { fast: pipelineInstance, accurate: pipelineInstance }
let mode = localStorage.getItem(MODE_KEY) || 'accurate';

// --- Service worker for offline app shell ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// --- Mode toggle (persisted) ---
function setMode(newMode) {
  mode = newMode;
  localStorage.setItem(MODE_KEY, mode);
  modeFastBtn.classList.toggle('active', mode === 'fast');
  modeAccurateBtn.classList.toggle('active', mode === 'accurate');
}
modeFastBtn.addEventListener('click', () => setMode('fast'));
modeAccurateBtn.addEventListener('click', () => setMode('accurate'));
setMode(mode);

// --- Recording ---
function pickMimeType() {
  const candidates = [
    'audio/mp4', // Safari/iOS
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return ''; // let the browser choose
}

recordBtn.addEventListener('click', async () => {
  if (!recording) {
    await startRecording();
  } else {
    stopRecording();
  }
});

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  recordMimeType = pickMimeType();
  mediaRecorder = recordMimeType
    ? new MediaRecorder(stream, { mimeType: recordMimeType })
    : new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
  mediaRecorder.onstop = onRecordingStopped;
  mediaRecorder.start();
  recording = true;
  recordBtn.textContent = 'Stop Recording';
  recordBtn.classList.add('recording');
  statusEl.textContent = 'Recording...';

  recordStart = Date.now();
  timerEl.classList.add('show');
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function updateTimer() {
  const secs = Math.floor((Date.now() - recordStart) / 1000);
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  timerEl.textContent = `${m}:${s}`;
}

function stopRecording() {
  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach((t) => t.stop());
  recording = false;
  recordBtn.textContent = 'Start Recording';
  recordBtn.classList.remove('recording');
  clearInterval(timerInterval);
  timerEl.classList.remove('show');
}

async function onRecordingStopped() {
  const blob = new Blob(chunks, { type: recordMimeType || 'audio/webm' });
  await transcribe(blob);
}

// --- Transcription (on-device, mode-selectable) ---
async function transcribe(blob) {
  recordBtn.disabled = true;
  modeFastBtn.disabled = true;
  modeAccurateBtn.disabled = true;
  try {
    statusEl.textContent = 'Loading speech model (first time only)...';
    if (!transcribers[mode]) {
      transcribers[mode] = await pipeline('automatic-speech-recognition', MODELS[mode], {
        quantized: true,
        progress_callback: (p) => {
          if (p.status === 'progress') {
            statusEl.textContent = `Downloading model: ${Math.round(p.progress)}%`;
          }
        },
      });
    }

    statusEl.textContent = 'Decoding audio...';
    const audioData = await decodeToMono16k(blob);

    statusEl.textContent = 'Transcribing...';
    // stride_length_s overlaps chunk boundaries so words aren't cut off
    // at the 30s mark; the library stitches the overlap back together.
    const result = await transcribers[mode](audioData, { chunk_length_s: 30, stride_length_s: 5 });

    const text = result.text.trim();
    transcriptEl.value = text;
    renderNumbers(text);
    summaryEl.value = text;
    statusEl.textContent = 'Done. Edit below, then share or save.';

    // auto-save immediately so nothing is lost if the tab closes
    saveToHistory(text, text);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
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

// --- Number extraction with majority-vote confidence, formatted for legibility ---
function renderNumbers(text) {
  const matches = text.match(/\d+(\.\d+)?/g) || [];
  if (matches.length === 0) {
    numbersEl.innerHTML = '<span style="color:#666">No numbers found.</span>';
    return;
  }
  const freq = {};
  matches.forEach((n) => (freq[n] = (freq[n] || 0) + 1));

  const confirmed = Object.keys(freq)
    .filter((n) => freq[n] > 1)
    .sort((a, b) => Number(a) - Number(b));
  const unverified = Object.keys(freq)
    .filter((n) => freq[n] === 1)
    .sort((a, b) => Number(a) - Number(b));

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
}

// --- Share / Copy ---
shareBtn.addEventListener('click', async () => {
  const text = summaryEl.value;
  if (navigator.share) {
    try {
      await navigator.share({ text });
    } catch (e) {
      /* user cancelled */
    }
  } else {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = 'Sharing not supported here — copied to clipboard instead.';
  }
});

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(summaryEl.value);
  statusEl.textContent = 'Copied to clipboard.';
});

// --- Save as .txt file ---
saveBtn.addEventListener('click', () => {
  const content = summaryEl.value || transcriptEl.value;
  if (!content) {
    statusEl.textContent = 'Nothing to save yet.';
    return;
  }
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const filename = `voicenote-${stamp}.txt`;
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  statusEl.textContent = `Saved ${filename}`;
});

// --- History (localStorage, scrollable by date) ---
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveToHistory(transcript, summary) {
  const history = loadHistory();
  history.unshift({
    id: Date.now(),
    date: new Date().toISOString(),
    transcript,
    summary,
  });
  while (history.length > MAX_HISTORY) history.pop();
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  if (historyPanel.classList.contains('show')) renderHistory();
}

function renderHistory() {
  const history = loadHistory();
  if (history.length === 0) {
    historyList.innerHTML = '<div id="emptyHistory">No previous notes yet.</div>';
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
    meta.innerHTML = `<div class="date">${dateStr}</div><div class="preview">${escapeHtml(item.summary.slice(0, 60))}</div>`;
    meta.addEventListener('click', () => {
      transcriptEl.value = item.transcript;
      summaryEl.value = item.summary;
      renderNumbers(item.transcript);
      statusEl.textContent = `Loaded note from ${dateStr}`;
      historyPanel.classList.remove('show');
    });

    const del = document.createElement('span');
    del.className = 'del';
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      const remaining = loadHistory().filter((h) => h.id !== item.id);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(remaining));
      renderHistory();
    });

    div.appendChild(meta);
    div.appendChild(del);
    historyList.appendChild(div);
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

historyBtn.addEventListener('click', () => {
  historyPanel.classList.toggle('show');
  if (historyPanel.classList.contains('show')) renderHistory();
});
