# Voice Note_3 → Text

## Versioning

The app title (in the header and browser tab) shows a version number
— "Voice Note_2", "Voice Note_3", etc. — that increments every time a
new build is delivered, so it's always unmistakable which version
you're looking at on screen. This exists specifically because earlier
in development, files from different versions got mixed together
(different vintages of index.html and app.js uploaded together),
which caused real, hard-to-diagnose bugs. Always upload every file
from the same delivery together, and check the on-screen version
number matches what you expect.

`Voice Note_1` (the version before this rework — pause-and-hope for
photo/video, no guaranteed audio preservation) is preserved as a
separate download and as git tag `v1-audio-pause-approach`, in case
you want to compare or revert.

## What changed in Voice Note_2: reliable audio through photo/video

**The problem:** the previous approach paused the recording and hoped
the operating system would let the microphone stay reserved while the
camera was open. Sometimes it did, often it didn't — entirely up to
the phone's OS, not something the app could control. When it failed,
recording was cut short unpredictably.

**The new approach:** rather than trying to keep one microphone
connection alive through the interruption, the app now:
1. Cleanly finishes and saves whatever's been recorded as a "segment"
   the moment you tap Add Photo/Video.
2. Opens the camera with the microphone properly released — no
   fighting the OS for it.
3. Automatically reconnects the microphone and starts a new segment
   the instant you're back (photo taken, video recorded, **or even if
   you cancel the camera** — either way, recording resumes).
4. When you tap Stop for real, all segments are decoded and stitched
   into one continuous transcript — reliably, since audio is joined at
   the decoded-sample level rather than by concatenating separate
   media files (which can have format issues).

This works because reacquiring a *fresh* microphone connection after
an interruption is a normal, well-supported browser operation —
unlike trying to keep an old connection alive through one, which is
what made the previous approach unreliable.

Manual Pause/Resume (tapping Pause without opening the camera) is
unaffected — that still uses simple in-place pausing since there's no
OS conflict to work around in that case.

**Tested scenarios** (all passing, 31 automated browser-based checks):
normal recording, single photo interruption with auto-resume, camera
cancellation, multiple interruptions in one recording (photo + video),
manual pause/resume, and tapping Stop while a camera interruption is
still in progress.

## Everything else

Unchanged from the previous version: on-device Whisper transcription
(Fast/Accurate modes), number confidence (Confirmed/Verify), editable
title and transcript, Share (text + photo + video — audio intentionally
excluded, since bundling it caused WhatsApp to reject the whole
attachment set), Save (includes audio), Previous Notes with search/
export/import/backup-sharing, and the reliability fixes from earlier
(startup-crash fix, single-call-per-tap Share, mic-permission handling,
safe storage writes).

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

Deploy via GitHub Pages — root of the repo, no subfolder, upload all
files from the same delivery together.


## Voice Note_3 changes

**1. Photo crash fixed (the "app resets after taking a photo" bug).**
The old code loaded each photo into an `<img>` element, which forces the
browser to fully decode the ORIGINAL full-resolution image into memory
before scaling it down. A 12-megapixel phone photo can occupy 40-50MB+
as a raw decoded bitmap even when the file itself is only a few MB — and
mobile browsers (iOS Safari especially) kill and reload the whole tab
when a per-tab memory limit is exceeded. That reload is exactly what
looked like "the app reset", and it explains why some photos triggered
it and others didn't: it depends on pixel dimensions, not file size.

Now uses `createImageBitmap()` with resize-during-decode, so the huge
intermediate bitmap never has to exist. Also fixed a second related
leak: the preview was displaying the full-resolution original, keeping
that large bitmap alive on screen — it now shows the compressed version.
Verified with a 3000x3000 test image: processed with no crash, down to
about 4KB.

**2. Persistent storage requested.** The app now calls
`navigator.storage.persist()`, asking the browser to protect its stored
data (the downloaded speech model, note history) from automatic
eviction. This is why the model could end up re-downloading on later
visits. Best-effort: unsupported browsers ignore it, and iOS Safari's
own privacy cleanup can still override it after prolonged inactivity —
no website can prevent that.

**3. Install prompt on first visit.** A banner now offers to add the app
to the home screen. Two paths, because the platforms differ: Chrome/
Android gets a real one-tap native install dialog; iOS Safari (which has
no install API at all) gets the manual "Share -> Add to Home Screen"
steps instead of a button that couldn't do anything. Never shown when
already running as an installed app, or once dismissed.

**Testing:** 51 automated browser checks passing — the 15 new ones above
plus full regression runs of every previous suite (recording, segment
splitting across camera interruptions, cancellation, multiple
interruptions, manual pause/resume, stop mid-interruption, share/save).
