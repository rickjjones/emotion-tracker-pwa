# Emotion Tracker PWA

A small, offline-first Progressive Web App to record and review mood / behavior ratings. Built with plain HTML, CSS and vanilla JavaScript. The app stores entries locally using IndexedDB and is packaged as a PWA (manifest + service worker). The site is prepared to be hosted from the `docs/` folder (ideal for GitHub Pages).

## What’s new / current state
- UI grouped into three categories: High Moods, Low Moods, and ADHD-related items.
- Ratings are numeric (1–10) for each tracked item and a free-text `Note` is stored with each entry.
- Data persisted locally using IndexedDB (no server required).
- History view with export / import (JSON) and clear-all options.
- Service worker with precaching and an update-banner flow (skipWaiting + clients) so users can reload to activate new versions.
- Light visual polish: category chips with subtle green variants, responsive layout and a centered container.
 - Customizable tracking: users can open a "Customize Emotions" modal and choose which emotions appear on the main form. Selections persist in `localStorage` so the form stays tailored between visits.
 - CSV/JSON exports respect the user's selected (tracked) emotions. CSV columns are generated in category order and always include `note` as the last column.
 - The modal and its show/hide behavior are attribute-driven and styled in `docs/styles.css`. The app honors the HTML `hidden` attribute to avoid rendering the modal on page load.

## Project layout (important files)
```
emotion-tracker-pwa/
├── docs/                  # Deploy-ready site (what you publish to GitHub Pages)
│   ├── index.html         # Main UI (PWA entry)
│   ├── app.js             # IndexedDB + UI logic
│   ├── styles.css         # App styles (includes category chip variants)
│   ├── sw.js              # Service worker (precache + runtime caching)
│   ├── manifest.json      # PWA manifest
│   └── icon-*.svg         # App icons used by the manifest
├── README.md              # This document
├── package.json           # Optional (if you add tooling)
└── src/                   # (unused / original source folder)
```

## Quick start (local)
1. Serve the `docs/` folder from a static file server. Examples:

	 - Using Node (http-server):

		 ```powershell
		 npx http-server docs -p 8080
		 ```

	 - Or use any static hosting / local server that serves `docs/index.html`.

2. Open http://localhost:8080 in a supported browser (Chrome/Edge/Firefox). The app will register the service worker and work offline after the initial load.

## How it works (brief)
- IndexedDB: a tiny wrapper in `docs/app.js` stores each entry (timestamp, numeric ratings, note).
- UI: `index.html` contains grouped category headings and numeric inputs (1–10). The `note` field is a textarea.
- History: saved entries render in a list. Use Export to download JSON, Import to restore, or Clear All to remove local data.
- Service worker: `docs/sw.js` precaches core assets and supports an update flow — when a new SW version is installed, the page shows an update banner allowing users to reload and activate the new version immediately.
 - Customization: the main form is rendered dynamically from a category/emotion structure in `docs/app.js`. Open "Customize Emotions" to pick individual emotions; choices are saved under the `localStorage` key `ll_tracked_emotions_v1`. The app prevents saving an empty tracked set and falls back to a sensible default if the saved value is empty or invalid.
 - Exports: CSV export uses only the tracked emotions (plus `note`) and produces stable headers. JSON export includes the full stored entries as-is.

## Styling notes
- Category headings are styled as chips and use subtle green variants via `category--high`, `category--low`, and `category--adhd` classes in `docs/styles.css`.
 - Modal and accessibility: the categories modal is implemented with a backdrop and an accessible panel (`role="dialog"`, `aria-modal`), and the stylesheet honors `[hidden] { display: none !important }` to prevent flicker or accidental rendering on load.

## Deploying to GitHub Pages
1. Ensure the `docs/` folder contains the build / site files (it does already).
2. In your repository settings, set GitHub Pages to serve from the `main` branch and the `/docs` folder.
3. Commit and push changes; GitHub Pages will serve the site at `https://<your-username>.github.io/<repo-name>/`.

## Testing the update flow
1. Bump the `CACHE_NAME` in `docs/sw.js` (e.g. `emotion-tracker-v2` → `emotion-tracker-v3`).
2. Reload the page. The new service worker will install in the background and the app will display an update banner when the worker reaches the `waiting` state. Click Reload to activate.

## Customization / Troubleshooting
- Open the app and click the "Customize Emotions" button to pick which emotions you want to track. Save your selection and the main form will update.
- If the app appears to show no fields (stuck state), it's usually because an old/invalid tracked-selection is stored. Recover quickly by opening DevTools Console and running:

```javascript
localStorage.removeItem('ll_tracked_emotions_v1');
location.reload();
```

- If the modal appears on page load, the stylesheet includes a rule to honor `hidden` so the modal should remain invisible until you open it. Use:

```javascript
document.getElementById('categories-modal').hidden = true;
```

to hide it immediately while debugging.

## Notes for developers
- The tracked-emotions behavior is implemented in `docs/app.js` via `getTrackedKeys()` / `setTrackedKeys()` and `renderEmotionForm()`. CSV header generation is handled by `getEmotionCsvKeys()` which returns tracked keys in category order and appends `note`.
- The app also records exported entry ids in `localStorage` under `lastExportedIds` so the undo-export feature can restore `exported` flags.

## Contributing
Contributions are welcome. If you make changes, please keep the PWA logic and `docs/` folder consistent with paths (service worker and manifest use relative paths).

## License
MIT

---
