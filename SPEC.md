# Voice Note → Text — Rebuild Spec

Clean-room rebuild. Every item below is either a stable baseline feature
or a fix for a bug found during testing over the last hour. Nothing here
is speculative — each line traces to an explicit request or a
reproduced, verified bug.

## Recording
- Start / Pause / Resume / Stop, with a timer that pauses/resumes
  correctly (not reset).
- Pulsing red dot while actively recording.
- Screen Wake Lock while recording/paused; released on stop.
- Mic-permission-denied shows a clear message, doesn't fail silently.
- Starting a new recording clears the whole screen (transcript, message,
  numbers, photo, video) for a fresh note.
- One-time hint text before first-ever use only (localStorage flag).
- SAFETY NET: if the OS reclaims the microphone for any reason (camera
  app, phone call) the UI must cleanly return to idle — never get stuck
  showing recording controls for a recording that has actually stopped.
  Implemented via a `track.ended` listener on the audio stream.

## Camera (Photo + Video)
- Add Photo and Add Video buttons, side by side in one row (same
  pattern as Share/Copy).
- Add Photo opens the camera for a still image; Add Video opens it in
  video mode. Both show a preview with a remove (✕) button.
- BUG FIX: opening the camera hands the mic to the camera app, which
  kills our recording. Tapping either button while recording/paused
  must first cleanly stop (not crash/hang) the recording — finalizing
  the note — with a clear status message, before the camera opens.
- Photo is compressed (JPEG, capped width) and saved into the note's
  history entry — persists across sessions.
- Video is NOT saved into history (too large for localStorage) — only
  available in-memory for the current note, same lifetime as audio.

## Transcription
- On-device Whisper via transformers.js. Two modes (Fast/Accurate),
  remembered via localStorage.
- The selected mode's model preloads in the background on page load and
  on mode switch — recording is never blocked waiting for it.
- Attempts WebGPU, falls back silently to WASM.
- A real progress bar (not repeated status text) shows model-download
  percentage. An indeterminate/animated version of the same bar shows
  during audio decoding and the transcription pass (steps with no real
  percentage to report). No "Downloading Accurate speech model: N%"
  text spam in the status line — the bar is the indicator.
- 30s chunking with 5s stride overlap so words at boundaries survive.
- Retry Transcription button on failure, reusing the already-captured
  audio (no need to re-record).

## Transcript & Message
- Transcript box is READ-ONLY — it's exactly what Whisper produced.
- Message box is the editable copy; edits here (and to the title,
  internally) save automatically into history (debounced).
- Number badges (Confirmed = green = said 2+ times, Verify = amber =
  said once) are computed from the transcript at transcription time and
  don't change afterward, since the transcript can't be edited. Section
  only appears when numbers are actually present — no empty state.

## Titles
- Auto-suggested (date + hour + first few words of transcript) once
  transcription finishes. Field exists and is stored/used for the
  Previous Notes list, but is NOT shown in the visible UI.

## Playback
- Audio player for the just-recorded audio appears directly under the
  Message box (not near the top). In-memory only — never saved to
  history, gone on new recording or loading a different note.

## Share — the trickiest part, three real bugs fixed here
- Sends message text plus whichever of photo/video/audio are currently
  attached, via the native share sheet.
- BUG FIX 1 (silent failure): every failure path must produce a visible
  status message. A cancelled share is silent (normal); any real error
  is not.
- BUG FIX 2 (double-call): the Web Share API allows exactly ONE
  `navigator.share()` call per user tap — a second call always throws
  "must be handling a user gesture," even if the first one just failed.
  The decision of whether to include files must be made once, up front,
  via `canShare()` (which doesn't consume activation), and only one
  `share()` call may ever be made per tap.
- BUG FIX 3 (unreliable canShare): on some browsers `canShare()`
  optimistically says yes but the real `share()` call still rejects
  the files. When that happens, remember it for the rest of the session
  and skip attempting files on every subsequent share — degrade
  straight to a working text-only share instead of repeating the same
  failure forever.
- Works identically from the main screen and from each note's own
  share icon in Previous Notes (which only ever has photo available,
  since video/audio aren't stored in history — expected, not a bug).
- Falls back to clipboard copy if the Web Share API isn't available at
  all; that fallback's own failure must also surface a message, not
  throw uncaught.

## Save
- Button is labeled "Save" (not "Save as .txt").
- Downloads message text (.txt), photo (.jpg), video, and audio —
  whichever are currently attached.

## History (Previous Notes)
- Auto-saves the instant transcription finishes (before any user
  interaction), so nothing is lost if the tab closes. Further edits
  update the same entry in place.
- Capped at 50 entries.
- Search box filters by title/message/transcript live.
- Each entry: tap to load (including its photo) for further editing,
  a dedicated share icon for one-tap sharing without loading first, a
  delete icon that asks for confirmation (not silent/instant).
- Export All (JSON download) and Share Backup (same JSON via the share
  sheet, for one-tap Drive/Dropbox).
- Import merges a backup file back in (de-duplicated, capped at 50).
- Clear All wipes everything, behind confirmation.
- Backup reminder banner in the panel once 20+ notes have been created
  since the last backup — tracked via a monotonic counter (not
  history.length, which shrinks on delete/eviction and would hide the
  reminder incorrectly).

## Visual
- All buttons colored via a `data-color` attribute + shared CSS rules
  (not one hardcoded rule per button ID).
- Fade transitions on every element that appears/disappears.
- Dark, minimal, functional styling — no unnecessary decoration.

## Help
- "?" icon top-right opens a concise modal covering recording, modes,
  number colors, photo/video, share/save, and Previous Notes.

## Installability
- Service worker caches the app shell (offline-capable) and
  runtime-caches the transformers.js CDN library itself, so a repeat
  offline visit doesn't depend on the browser's own HTTP cache.
