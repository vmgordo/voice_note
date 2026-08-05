# Voice Note → Text (stable pre-video version)

This is the version restored to match the last known-working UI —
editable title and transcript, no video capture — with every genuine
bug fix from later work retained underneath.

## What's in this version

- Record / Pause / Resume / Stop, wake lock, mic-permission handling.
- Fast/Accurate modes with background model preload, WebGPU→WASM fallback.
- Editable transcript (numbers re-score live as you correct it) and
  editable title, both visible in the UI.
- Photo capture, compressed and saved to history; audio playback,
  retry, and save.
- Share and Save, including photo/audio.
- Previous Notes: search, per-item share/delete(confirm), export,
  share-backup, import, clear-all.

## Bug fixes retained from later work (not tied to the removed features)

- **Startup crash fix**: `ensureTranscriber`'s dependencies are declared
  before `setMode()` is called — the earlier version of this file threw
  a `ReferenceError` at load time that silently prevented almost every
  button from working.
- **Share reliability**: exactly one `navigator.share()` call per tap
  (a second call after a failure always throws "must be handling a
  user gesture" — this version never does that), plus a fallback that
  stops trying to attach files for the rest of the session if the
  browser's `canShare()` proves unreliable.
- **Camera-interrupt fix**: tapping Add Photo while recording/paused
  cleanly stops and finalizes the note first, instead of leaving the
  UI stuck when the OS takes the microphone for the camera app.
- **Mic-denied handling**: a clear message instead of silent failure.
- **Safe storage writes**: a full `localStorage` doesn't lose a note
  silently.

## File structure

```
voicenote-app/
├── index.html
├── app.js
├── sw.js
├── manifest.json
├── icon-192.png
└── icon-512.png
```

Deploy via GitHub Pages, same as before — root of the repo, no subfolder.

## Update: pause instead of stop for photo/video, video restored

- **Add Photo / Add Video now pause the recording instead of stopping
  it.** A still photo doesn't need the microphone, so the recording
  often survives untouched; tap **Resume** (the existing button) when
  you're ready to keep recording. If the OS forcibly reclaims the mic
  anyway (more likely for video, which typically wants audio too), the
  existing safety net still cleans up the state correctly rather than
  leaving the UI stuck.
- **Video capture is back**, alongside Photo, using the same pause-based
  flow. Video is still not saved to history (too large for
  `localStorage`) — same as the audio recording.
- **Share and Save now include text, photo, video, and audio together**
  — whichever are currently attached.

## Update: audio dropped from Share (kept in Save)

Testing on a real device showed WhatsApp's share handler rejecting the
*entire* attachment set (falling back to text-only) when an audio file
was bundled alongside photo/video — most likely because it doesn't
recognize the audio MIME type and bails on the whole array rather than
skipping just that item. Share now sends text + photo + video only.
**Save is unaffected and still includes the audio recording** — if you
need to send the audio itself, use Save and attach that file manually.
