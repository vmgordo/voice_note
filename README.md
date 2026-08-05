# Voice Note → Text

A phone-installable web app that records a voice note, transcribes it fully
on-device (no server, no account, no data leaving the phone), highlights
numbers that were said more than once, and hands the result to WhatsApp,
Mail, or any other app via the native share sheet.

Built as a static site — no build step, no framework, no backend.

---

## Features

**Recording**
- Start / Pause / Resume / Stop controls (MediaRecorder), with a running
  timer (and a pulsing red dot while actively recording) that correctly
  pauses and resumes rather than resetting.
- Starting a new recording clears the screen (title, transcript, message,
  numbers, any attached photo) so the previous note doesn't linger.
- Auto-detects a recording format your browser actually supports
  (`audio/mp4` on Safari/iOS, `audio/webm` variants on Chrome/Android).
- Keeps the screen from auto-locking while recording (Screen Wake Lock
  API). Unsupported on some older browsers — fails silently, recording
  still works, the screen may just dim on its own.
- If the browser denies microphone access, the app tells you directly
  instead of silently doing nothing.
- The one-line hint about the first-time model download only shows
  before you've ever recorded — it doesn't come back after that.

**Playback**
- After a recording is transcribed, an audio player appears so you can
  listen back to what you actually said — this is the way to check any
  number flagged "Verify" (see below) against the real recording.
- The raw audio is kept in memory only for the current recording, never
  written to `localStorage` or history — audio files are too large to
  store safely there. Closing the note or starting a new recording
  discards it. (You can keep it permanently via **Save** — see below.)

**Transcription**
- Runs entirely on-device using [Whisper](https://openai.com/research/whisper)
  via [transformers.js](https://github.com/xenova/transformers.js) —
  audio never leaves the phone.
- Two selectable modes, remembered between sessions:
  - **Fast** → `Xenova/whisper-tiny.en` — quicker, less accurate.
  - **Accurate** → `Xenova/whisper-base.en` — slower, more accurate (default).
- The current mode's model starts loading quietly in the background the
  moment the page opens (and again whenever you switch modes), so it's
  usually already downloaded by the time you tap Start — instead of
  making every session wait through the download on first use.
- Uses the device's GPU (WebGPU) for transcription when the browser
  supports it, for a meaningful speed boost; falls back automatically
  and silently to the standard CPU (WASM) path otherwise.
- A real progress bar (not just percentage text) shows model download
  progress.
- Long recordings are transcribed in 30-second windows with 5-second
  overlap between them, so words at chunk boundaries aren't cut off.
- If transcription itself fails (bad audio, model error, etc.), a
  **Retry Transcription** button appears — it reuses the same recording
  rather than making you record again.

**Number confidence**
- Every number in the transcript is extracted and counted.
- Numbers said more than once are shown as **Confirmed** (green).
- Numbers said only once are shown as **Verify** (amber) — a flag that
  the transcription may have misheard it, since Whisper gives no
  built-in confidence signal per word.
- This re-runs live as you edit the transcript box — fix a number by hand
  and the confirmed/verify grouping updates immediately.
- The whole "Numbers found" section only appears when the transcript
  actually contains numbers — no empty placeholder otherwise.

**Editing stays in sync**
- Any edit to the title, transcript, or message box is saved
  automatically (debounced ~1 second after you stop typing) into that
  note's history entry — the version you actually correct and send is
  what's kept, not just the raw first-pass transcript.

**Titles**
- Each note has an optional title field. If you leave it blank, one is
  auto-suggested from the first few words of the transcript once
  transcription finishes. Previous Notes shows the title (or, if none,
  a preview of the message) as the primary line, with the date below.

**Photo**
- **Add Photo** opens the camera directly (rear camera by default) and
  attaches a picture to the current note.
- The photo is included automatically when you **Share** (on browsers
  that support sharing files — most modern mobile browsers do; falls
  back to text-only with a note if not) and when you **Save**.
- The photo is also saved into that note's history entry (compressed to
  keep `localStorage` usage reasonable), so reopening the note later
  brings the photo back too — marked with a small 📷 in Previous Notes.

**Output**
- Editable transcript box and a separate editable "message to send" box.
- **Share** — opens the phone's native share sheet (WhatsApp, Mail,
  Messages, Google Drive, Dropbox, whatever's installed) via the Web
  Share API, including the photo and the original recording where the
  browser supports sharing files. Works identically whether the note
  was just recorded or reopened from Previous Notes (audio is only
  included for a note just recorded — see History note below). Falls
  back to clipboard copy if the browser doesn't support sharing at all.
- **Copy** — copies the message text to the clipboard directly.
- **Save** — downloads the message as a timestamped `.txt` file, the
  photo as a `.jpg` if one's attached, and the original recording
  (`.m4a`/`.webm`/`.ogg` depending on the browser) if it's still
  available in memory — i.e. for the note you just recorded, not one
  reopened from history.

**History**
- Every completed transcription is saved automatically the moment it
  finishes (before you touch anything else), so nothing is lost if the
  tab closes unexpectedly. Further edits update that same entry in
  place rather than creating duplicates.
- Stored in the browser's `localStorage`, capped at the most recent 50
  notes.
- **Previous Notes** panel — a search box filters by title/message/
  transcript as you type; each entry can be tapped to reload it
  (including its photo) for further editing, **shared directly** with
  one tap without needing to load it first, or deleted (with a
  confirmation prompt, so a mis-tap doesn't lose a note).
- **Export All (JSON)** — downloads the entire history as one timestamped
  `.json` file, meant to be kept somewhere durable (Drive, iCloud) as a
  real backup, since `localStorage` can be wiped by clearing browser
  data, switching phones, or the OS evicting storage under space
  pressure.
- **Share Backup** — sends that same `.json` backup file through the
  share sheet instead of downloading it, so you can drop it straight
  into Google Drive, Dropbox, or similar with one tap rather than
  downloading then moving the file manually.
- **Import** — reads a previously exported `.json` file back in, merges
  it with whatever's currently stored (de-duplicated by entry, sorted by
  date, trimmed to the same 50-note cap).
- **Clear All** — wipes all saved notes, behind a confirmation prompt.

**Reliability**
- Every write to `localStorage` goes through a safe wrapper. If a write
  fails (e.g. phone storage full), the app tells you explicitly instead
  of the note silently vanishing.
- The transformers.js library itself (not just your app files) is
  cached by the service worker at runtime, so a repeat offline visit
  doesn't depend on the browser's own HTTP cache still having it.

**In-app help**
- A "?" button top-right opens a concise usage guide covering recording,
  the Fast/Accurate modes, what the confirmed/verify colors mean, how to
  attach a photo, and what Share/Save/Previous Notes do.

**Installable**
- Registers a service worker that caches the app shell (HTML/CSS/JS),
  so once loaded, the app itself works fully offline.
- Includes a web manifest so it can be added to the home screen on
  iOS/Android and opens full-screen like a native app.

**Interface polish**
- Buttons and panels fade in/out on state changes (recording controls,
  history panel, photo preview, numbers section, playback, retry)
  instead of snapping instantly.
- A pulsing dot marks active recording so it's visually obvious at a
  glance, separate from reading the timer text.

---

## File structure

```
voicenote-app/
├── index.html      Page structure and all styling (single stylesheet, no framework)
├── app.js          All application logic (recording, transcription, history, etc.)
├── sw.js           Service worker — caches the app shell + CDN library for offline use
├── manifest.json   Web app manifest — name, icons, "standalone" display mode
├── icon-192.png    Home screen icon (small)
└── icon-512.png    Home screen icon (large)
```

No `node_modules`, no bundler, no `package.json` — `app.js` is loaded
directly as an ES module (`<script type="module">`) and imports
`transformers.js` straight from a CDN at runtime. This is why the app
must be served over `http(s)` (e.g. via GitHub Pages) rather than opened
as a local `file://` — browsers block both ES module imports and
microphone access under `file://` for security reasons.

### `index.html`
All markup and CSS live in this one file. Button colors are applied via
a `data-color` attribute plus a small set of generic CSS rules (e.g.
`button[data-color="blue"] { background: var(--blue); }`) rather than
one CSS rule per button ID. A `.fade` class plus a small JS `show()`/
`hide()` helper drives the fade transitions consistently across every
element that appears/disappears (recording controls, retry button,
audio player, photo preview, numbers section, model progress bar).

Structure top to bottom: header (title + help button) → mode toggle →
recording controls + timer/pulse dot → status line → model download
progress bar → retry button → audio player → title field → transcript
box → numbers-found section → message box → photo capture/preview →
share/copy/save/history buttons → collapsible history panel (search,
export/import/clear-all, note list) → help modal overlay.

### `app.js`
Organized into clearly separated sections, in order:
1. Config (model names, storage keys, history cap, debounce timing)
2. Element references
3. Fade show/hide helper
4. Help modal
5. One-time hint logic
6. Mode toggle (persisted to `localStorage`, triggers background model warm-up)
7. Screen Wake Lock
8. Model loading — background preload, WebGPU attempt with WASM fallback,
   progress reporting, in-flight promise caching so preload and an actual
   recording never race each other
9. Recording controls (start / pause / resume / stop, mic-permission
   handling, MIME detection, timer, pulse dot)
10. Playback (object URL lifecycle for the in-memory recording)
11. Transcription + retry
12. Number extraction and confidence formatting
13. Live-edit sync (re-scores numbers and updates the history entry as
    you type or edit the title, debounced)
14. Photo capture, compression, and removal
15. Share (shared helper used by both the main Share button and each
    history item's own share action) / Copy
16. Save (text, photo, and/or original recording)
17. `localStorage` safe-write wrapper
18. History (save, render with search, delete with confirmation,
    per-item share, export, import, clear-all)

### `sw.js`
Caches the six app files as the offline app shell (cache-first). Also
runtime-caches the transformers.js library script itself from its CDN
the first time it's fetched, so a later offline visit doesn't depend on
the browser's own HTTP cache still holding onto it. Model weight files
(from a separate host) are deliberately left alone — transformers.js
manages their caching itself via the Cache Storage API.

---

## Deployment

Static files only — any static host works. Currently deployed via
**GitHub Pages** (Settings → Pages → Deploy from branch → `main` / root).
To update the live site, overwrite these files in the repo; GitHub
rebuilds automatically within a minute or two.

## Privacy

Audio and text never leave the device. The only network activity is
downloading the Whisper model and the transformers.js library itself
from their CDNs — both cached after first use. Everything else —
recording, transcription, storage, history — happens locally in the
browser.

## Known limitations

- Whisper has no built-in confidence score; the "Confirmed vs Verify"
  split is a repetition-based heuristic, not true accuracy detection —
  the audio playback feature exists specifically to give you a way to
  actually check the flagged numbers rather than just seeing a warning.
- iOS may suspend the microphone if the app is backgrounded or the
  phone is locked mid-recording (an OS-level restriction, not something
  this app can override) — the Wake Lock helps with screen auto-lock but
  not with switching apps.
- Original recording audio is never saved to history — only the current,
  in-progress note can be played back or saved as an audio file.
  Reopening an old note from Previous Notes will not have audio available.
- `localStorage` history is per-browser, per-device — it does not sync
  across phones or browsers. Use Export/Import for backups or transfers.
- Photo sharing via Share depends on `navigator.canShare` support for
  files, which isn't universal across every browser/OS combination —
  falls back to text-only sharing with a status message when unsupported.
- WebGPU transcription support varies by browser and OS version; where
  it isn't available or fails to initialize, the app falls back to the
  standard path automatically with no visible interruption.
