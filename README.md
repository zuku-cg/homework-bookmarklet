# Homework bookmarklet

A bookmark that redraws a school homework site as one clear list: what's late, what's due this week, and which evening you plan to do each piece. First site supported: DPR (dpr.education), student login.

It runs inside the school site's own page, in the student's own logged-in session. No server, no accounts, no passwords, no tracking. Nothing leaves the browser except the same requests the school site makes itself.

## Use it

Open the install page (https://zuku-cg.github.io/homework-bookmarklet/, or `docs/index.html` locally) and follow the steps (drag the button to the bookmarks bar, or copy the code into a bookmark on an iPad). Then log in to DPR and click the bookmark. Click it again, press Escape, or use "Back to DPR" to close it.

## The extension

The same view as a browser extension, for browsers where a bookmark is awkward (or missing, like Dia and Arc). Click the toolbar button on DPR to open the view, click again to close it.

- Try it: open `chrome://extensions`, turn on Developer mode, choose Load unpacked and pick the `extension/` folder. Works in Chrome, Edge, Brave and other Chromium browsers.
- Permissions: `activeTab` and `scripting` only. It can touch a page only at the moment you click its button, it has no access to any site in the background, and it asks for no host permissions.
- `dist/homework-extension.zip` is the upload for the Chrome Web Store. Bump `VERSION` in `build.py` for each upload.
- Safari (Mac, iPad, iPhone) needs wrapping with Xcode's `xcrun safari-web-extension-converter extension/` and an Apple developer account. Not done yet.

## What it does

- Reads the student's homework from DPR (`GET /api/student/assignment-students/me`), the same call DPR's page makes.
- Ticking a piece sends the same request DPR sends when a student ticks a card (`PATCH /api/student/assignment-students/<id>` with `{"student_check": 1}`). It never hands work in.
- Evening plans and the "New" badges are kept in `localStorage` on the DPR origin, in that browser only.
- System fonts only, so nothing is fetched from anywhere else.

## Develop

```bash
python3 build.py                 # src/ -> dist/ and docs/index.html (stdlib only, no npm)
python3 -m http.server 8799      # then open http://127.0.0.1:8799/test/harness.html
```

`test/harness.html` is a pretend school page with made-up homework and a fake `fetch`, so the whole thing can be tried without touching DPR. Never put real pupils' data in this repo.

```
src/adapters/dpr-student.js   talks to DPR and turns its data into plain items
src/ui.js, src/ui.css         the view (shadow root overlay), knows nothing about DPR
src/main.js                   picks the adapter for the current site and opens the view
src/install.template.html     the install page
src/extension/                the extension's manifest template and toolbar-button script
build.py                      joins it all into dist/bookmarklet.js, .txt, docs/index.html (GitHub Pages serves docs/) and extension/
```

To support another homework site, add an adapter with `matches()`, `home`, `name`, `load()` and `setDone()` and list it in `src/main.js`.

## Rules

- Everything an adapter returns is untrusted text. It goes through `esc()` / `linkify()` / `safeUrl()` before it touches `innerHTML` (see the note at the top of `src/ui.js`).
- No third-party requests, no analytics, no remote code loading. The bookmark contains all the code.
- British English, plain friendly wording for children, no em dashes in anything a user reads.
- Not affiliated with DPR or any school. It relies on DPR's unofficial API and may break when DPR changes.
