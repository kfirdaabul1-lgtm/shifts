# Hotel shift scheduler — notes for Claude

Live site: https://kfirdaabul1-lgtm.github.io/shifts/ (GitHub Pages, deploys from `main` root on every push).
Owner: kfirdaabul1@gmail.com. The user writes in Hebrew and is not a developer: make the change, push to `main`, and tell them in plain Hebrew what changed. Do not ask them to upload files.

## Files
- `index.html` — the whole app (Hebrew, RTL). Plain JS, no build step. Firebase compat SDK from gstatic.
- `config.js` — Firebase web config (not secret) + `ownerEmail`, `appUrl`, `enablePhone`.
- `firestore.rules` — Firestore security rules. **Pushing this file does NOT deploy it.** When it changes, tell the user to paste it in Firebase Console → Firestore → Rules → Publish, and send the full text in a code block.
- `README.md` — Hebrew setup guide.
- Never commit `import-data.json` (salaries); it is in `.gitignore`.

## Data model (Firestore)
`hotels/{id}`, `settings/{hotelId}`, `employees/{uid}` (has `hotel`), `mgr/{uid}` (salary; has `hotel`), `avail/{uid}` (has `hotel`), `shifts/{date_dept_kind[_hotel]}` (has `hotel`), `schedule/{week[_hotel]}`, `roles/{uid}` ({hotels:[...]}, empty = all), `joinCodes/{code}` ({hotel}).
Hotel `main` has no suffix in shift/schedule ids. Every record must carry `hotel` — the rules scope managers per hotel by it.

## Key code areas in index.html
- `DEPTS`, `KINDS`, `DEF_TIMES` constants near the top of the script.
- `computeCost` (pay types: hourly, global, cash, volunteer; breaks via `paidHrs`; housing deducted from net).
- `autoAssign` (never borrows from other hotels).
- `start()` / `boot()` at the bottom: auth, role detection, subscriptions (scoped managers query with `where('hotel','in',…)`).

## Before pushing
Run `node --check` on the extracted script and keep `esc()` around any user-entered text inserted into HTML.
