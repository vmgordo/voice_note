# Voice Note → Text

A phone-installable web app that records a voice note, transcribes it fully
on-device (no server, no account, no data leaving the phone), highlights
numbers that were said more than once, and hands the result to WhatsApp,
Mail, Drive, Dropbox, or any other app via the native share sheet.

Built as a static site — no build step, no framework, no backend. See
`SPEC.md` for the full functional specification this was built against.

---

## Features

**Recording**
- Start / Pause / Resume / Stop, with a timer that pauses/resumes
  correctly, and a pulsing dot while actively recording.
- Screen stays on while recording (Wake Lock), releases on stop.
- Denied mic access shows a clear message rather than doing nothing.
- Starting a new recording clears the screen for a fresh note.
- A safety net (`track.ended` listener) keeps the UI from getting stuck
  if the OS reclaims the microphone for any reason — including the
  camera interaction described below.

**Camera (Photo + Video)**
- Add Photo and Add Video, side by side, open the camera directly.
- Opening the camera hands the microphone to the camera app, which the
  OS reclaims regardless of what the page does — so tapping either
  button while recording/paused **cleanly stops and finalizes the
  current note first**, with a clear status message, rather than
  letting that happen as an uncontrolled interruption.
- Photo is compressed and saved into the note's history entry —
  persists across sessions.
- Video is **not** saved to history (too large for `localStorage`) —
  available only for the current note, same lifetime as the audio
  recording.

**Transcription**
- On-device Whisper via transformers.js — audio never leaves the phone.
- **Fast** (`whisper-tiny.en`) / **Accurate** (`whisper-base.en`,
  default), remembered between sessions.
- The selected model preloads in the background on page load and on
  mode switch, so recording is never blocked waiting for it.
- Attempts WebGPU, falls back silently to WASM.
- A real progress bar shows model-download percentage; an animated
  (indeterminate) version of the same bar shows during audio decoding
  and the transcription pass, since those steps have no real
  percentage to report. No repeated status text — the bar is the
  indicator.
- 30-second chunks with 5-second overlap so words at boundaries survive.
- **Retry Transcription** on failure, reusing the already-captured
  audio.

**Transcript & Message**
- Transcript is **read-only** — exactly what Whisper produced.
- Message box is the editable copy that actually gets shared/saved;
  edits (and the internal title) save automatically, debounced.
- Number badges (green = **Confirmed**, said 2+ times; amber =
  **Verify**, said once) are computed once at transcription time and
  reflect the transcript, not later message edits. The section only
  appears when numbers are actually present.

**Titles**
- Auto-suggested (date + hour + a few words of the transcript) once
  transcription finishes, used for the Previous Notes list — not shown
  in the main UI.

**Playback**
- Audio player for the just-recorded audio sits directly under the
  message box. In-memory only — never saved to history, gone on a new
  recording or a different note.

**Share**
- Sends the message plus whichever of photo/video/audio are attached,
  via the native share sheet — works the same from the main screen or
  from a note's own share icon in Previous Notes (video/audio aren't
  available there, since they aren't saved to history).
- Every failure path shows a real status message — a cancelled share is
  silent (normal), any actual error is not.
- Makes **exactly one** `navigator.share()` call per tap — the Web
  Share API only allows one per gesture; a second call always throws,
  even after the first one just failed. The decision to include files
  is made once, up front, via `canShare()`.
- If `canShare()` says yes but the platform still rejects the files,
  the app remembers that for the rest of the session and skips
  attempting files on every later share — degrading straight to a
  working text-only share instead of repeating the same failure.
- Falls back to clipboard copy if the Web Share API isn't available at
  all; a failed clipboard copy also surfaces a message rather than
  failing silently.

**Save**
- Downloads the message as `.txt`, plus photo (`.jpg`), video, and the
  original recording — whichever are currently attached.

**History (Previous Notes)**
- Auto-saves the instant transcription finishes, before you touch
  anything — nothing is lost if the tab closes. Further edits update
  the same entry rather than duplicating.
- Capped at 50 notes.
- Search box filters by title/message/transcript live.
- Each entry: tap to load (photo included) for further editing, a
  dedicated share icon for one-tap sharing without loading first, a
  delete icon behind a confirmation prompt.
- **Export All (JSON)** downloads a full backup; **Share Backup** sends
  that same file through the share sheet for one-tap Drive/Dropbox.
- **Import** merges a backup back in (de-duplicated, capped at 50).
- **Clear All** wipes everything, behind confirmation.
- A reminder banner appears once 20+ notes have been created since the
  last backup, tracked via a running counter (not `history.length`,
  which would shrink on delete and hide the reminder incorrectly).

**Reliability**
- Every `localStorage` write goes through a safe wrapper — a failure
  (e.g. storage full) shows a message instead of silently losing data.
- The transformers.js library itself is runtime-cached by the service
  worker, not just your app files, so a repeat offline visit doesn't
  depend on the browser's own HTTP cache.

**Installable**
- Service worker caches the app shell for offline use; web manifest
  allows adding to the home screen for a full-screen, app-like feel.

---

## File structure

```
voicenote-app/
├── index.html      Page structure and all styling
├── app.js          All application logic
├── sw.js           Service worker — offline app shell + CDN library cache
├── manifest.json   Web app manifest
├── icon-192.png    Home screen icon (small)
├── icon-512.png    Home screen icon (large)
└── SPEC.md         Full functional specification this build implements
```

No `node_modules`, no bundler, no `package.json` — `app.js` loads as an
ES module and imports `transformers.js` from a CDN at runtime. The app
must be served over `http(s)` (e.g. GitHub Pages), not opened as a
local `file://` — browsers block both ES module imports and microphone
access under `file://`.

## Deployment

Static files only. Currently via **GitHub Pages** (Settings → Pages →
Deploy from branch → `main` / root). Overwrite the changed files in the
repo to update the live site; GitHub rebuilds within a minute or two.

## Privacy

Audio, video, and text never leave the device. The only network
activity is downloading the Whisper model and the transformers.js
library from their CDNs — both cached after first use.

## Known limitations

- The Confirmed/Verify split is a repetition-based heuristic, not true
  accuracy detection — use the audio playback to actually check a
  flagged number.
- iOS may suspend the microphone if the app is backgrounded or the
  phone locks mid-recording — an OS-level restriction, not something
  this app can override.
- Video and audio are never saved to history — only available for the
  note you just captured.
- `localStorage` history is per-browser, per-device — use Export/Share
  Backup for transfers or backups.
- File-sharing support (photo/video/audio via Share) varies by
  browser/OS; the app degrades gracefully to text-only where it isn't
  reliable, rather than failing outright.
