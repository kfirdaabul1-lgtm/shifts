# Seven Collection (hotel shift scheduler + event quotes) — notes for Claude

Live site: https://kfirdaabul1-lgtm.github.io/shifts/ (GitHub Pages, deploys from `main` root on every push).
Owner: kfirdaabul1@gmail.com. The user writes in Hebrew and is not a developer: make the change, push to `main`, and tell them in plain Hebrew what changed. Do not ask them to upload files.

## Files
- `index.html` — shift scheduler + permissions page (`#perms`). Hebrew, RTL, plain JS, no build step. Firebase compat SDK from gstatic.
- `events.html` — event quotes app (7EVEN / Gutman / 7seas). Originally a claude.ai artifact: it still calls `window.claude.use('db'|'user'|'downloads')`, and a bridge script near the bottom (before html2canvas) maps those to Firebase and shows the login / no-access gate. Keep that bridge when editing. `events.html#ceo` is the CEO view (the quotes app's yearly revenue tab shown alone); it needs the `ceo` permission, which may read `quotes` and `config` but not write.
- `config.js` — Firebase web config (not secret) + `ownerEmail`, `appUrl`, `enablePhone`.
- `firestore.rules` — Firestore security rules. **Pushing this file does NOT deploy it.** When it changes, tell the user to paste it in Firebase Console → Firestore → Rules → Publish, and send the full text in a code block.
- `README.md` — Hebrew setup guide.
- Never commit `import-data.json` (salaries) or `events-import.json` (client details); both are in `.gitignore`.

## Data model (Firestore)
`hotels/{id}`, `settings/{hotelId}`, `employees/{uid}` (has `hotel`), `mgr/{uid}` (salary; has `hotel`), `avail/{uid}` (has `hotel`), `shifts/{date_dept_kind[_hotel]}` (has `hotel`), `schedule/{week[_hotel]}`, `roles/{uid}` ({apps:{shifts,events,perms,ceo}, hotels:[...]} — hotels empty = all; a legacy role without `apps` means shifts manager), `joinCodes/{code}` ({hotel}).
Events: `config/main`, `quotes/{id}` (+ `versions/{v}`), `menus/{id}`, `contracts/{id}`.
Permissions: owner = everything. `perms` holders may only grant apps/hotels they hold themselves (enforced in rules via `grantOk`/`existingOk`/`targetInScope`). Everyone must self-register with a hotel join code before they can be given permissions.
Hotel `main` has no suffix in shift/schedule ids. Every record must carry `hotel` — the rules scope managers per hotel by it.

## Key code areas in index.html
- `DEPTS`, `KINDS`, `DEF_TIMES` constants near the top of the script.
- `computeCost` (pay types: hourly, global, cash, volunteer; breaks via `paidHrs`; housing deducted from net).
- `autoAssign` (never borrows from other hotels).
- `start()` / `boot()` at the bottom: auth, role detection, subscriptions (scoped managers query with `where('hotel','in',…)`).

## Sign-in
Google uses `signInWithPopup` only — never add a redirect fallback: redirect breaks on iPhone/Safari because the site (github.io) and authDomain (firebaseapp.com) differ. Email-link sign-in (`sendSignInLinkToEmail`) is the fallback; it needs Email/Password + Email link enabled in Firebase Authentication.

## Language (Hebrew / English)
`i18n.js` is loaded by both pages. Hebrew is the source language; in English mode the script translates the rendered DOM with the dictionary inside it and flips the layout to LTR. A floating button switches language (saved in localStorage `appLang`; default follows the phone's language). Client-facing quote paper (`.doc`) and user data are not translated. **When you add or change Hebrew UI text, add the English to the dictionary in `i18n.js`.** Options without a `value` keep their Hebrew text as the value.

## Before pushing
Run `node --check` on the extracted script and keep `esc()` around any user-entered text inserted into HTML.
