# Seven Collection (hotel shift scheduler + event quotes) — notes for Claude

Live site: https://kfirdaabul1-lgtm.github.io/shifts/ (GitHub Pages, deploys from `main` root on every push).
Owner: kfirdaabul1@gmail.com. The user writes in Hebrew and is not a developer: make the change, push to `main`, and tell them in plain Hebrew what changed. Do not ask them to upload files.

## Files
- `index.html` — shift scheduler + permissions page (`#perms`). Hebrew, RTL, plain JS, no build step. Firebase compat SDK from gstatic.
- `events.html` — event quotes app (7EVEN / Gutman / 7seas). Originally a claude.ai artifact: it still calls `window.claude.use('db'|'user'|'downloads')`, and a bridge script near the bottom (before html2canvas) maps those to Firebase and shows the login / no-access gate. Keep that bridge when editing. `events.html#ceo` is the revenue-by-venue detail (the quotes app's yearly revenue tab shown alone). Quotes have `payments:[{amount,date,kind:deposit|payment,method,note}]`; the editor, list and PDF show paid and balance. Hotel groups (a space given to an in-house group, no charge) are `quotes` docs with `kind:'group'` and `status:'approved'`: they show and clash on the board (`openGroup`) but are excluded from the quotes list and from revenue (events CEO tab and index `ceoCompute`).
- `config.js` — Firebase web config (not secret) + `ownerEmail`, `appUrl`, `enablePhone`.
- `firestore.rules` — Firestore security rules. Pushing a change runs `.github/workflows/deploy-rules.yml`, which publishes them to Firebase (needs the repo secret `FIREBASE_RULES_KEY`, a service-account key with the Firebase Rules Admin role). If the owner says the automatic publish isn't set up or failed, send the full rules text in a code block to paste in Firebase Console → Firestore → Rules → Publish.
- `README.md` — Hebrew setup guide.
- Never commit `import-data.json` (salaries) or `events-import.json` (client details); both are in `.gitignore`.

## Data model (Firestore)
`hotels/{id}`, `settings/{hotelId}`, `employees/{uid}` (has `hotel`), `mgr/{uid}` (salary; has `hotel`), `avail/{uid}` (has `hotel`), `shifts/{date_dept_kind[_hotel]}` (has `hotel`), `schedule/{week[_hotel]}`, `roles/{uid}` ({apps:{shifts,events,perms,ceo,dept}, hotels:[...], depts:[...]} — hotels empty = all; a legacy role without `apps` means shifts manager), `joinCodes/{code}` ({hotel}).
Change requests after publishing: `requests/{id}` ({type:add|remove|change, uid, from, to, fromDesc, toDesc, hotel, week, status:pending|approved|declined|applied, note}). `asg()` applies approved requests on top of the published schedule; a manager's next `saveSched` bakes them in and marks them `applied`. While a week is published, managers can't edit assignments directly and employees can't change availability.
Events: `config/main`, `quotes/{id}` (+ `versions/{v}`), `menus/{id}`, `contracts/{id}`.
Permissions: owner = everything. `perms` holders may only grant apps/hotels they hold themselves (enforced in rules via `grantOk`/`existingOk`/`targetInScope`). Everyone must self-register with a hotel join code before they can be given permissions.
Hotel `main` has no suffix in shift/schedule ids. Every record must carry `hotel` — the rules scope managers per hotel by it.

## Key code areas in index.html
- `DEPTS`, `KINDS`, `DEF_TIMES` constants near the top of the script.
- `computeCost` (pay types: hourly, global, cash, volunteer; breaks via `paidHrs`; housing deducted from net).
- `autoAssign` (never borrows from other hotels).
- `start()` / `boot()` at the bottom: auth, role detection, subscriptions (scoped managers query with `where('hotel','in',…)`).

## Roles added later
- `ceo`: the CEO tab in index.html (`#ceo`, `vCeo`/`ceoCompute`): monthly labor cost per hotel from all schedules + `mgr`, next to approved-quote revenue (net of VAT). Read-only access to `mgr`, `settings`, `quotes`, `config`.
- `dept` (department manager): `S.deptOnly`; sees only Schedule + Open shifts tabs for `role.depts` (`deptOk`, `myDEPTS`), never pay/costs, cannot publish. Rules: `deptManages`/`hotelStaff`; needs at least one hotel. Mutually exclusive with `shifts`.
- Employees see every shift of their departments in availability (not only open ones). After publishing, the Schedule tab has "PDF להדפסה" / "תמונה" (`printSchedule`, one landscape A4 page).

## Sign-in
Google uses `signInWithPopup` only — never add a redirect fallback: redirect breaks on iPhone/Safari because the site (github.io) and authDomain (firebaseapp.com) differ. Email-link sign-in (`sendSignInLinkToEmail`) is the fallback; it needs Email/Password + Email link enabled in Firebase Authentication.

## Language (Hebrew / English / Russian)
`i18n.js` is loaded by both pages. Hebrew is the source language; in English mode the script translates the rendered DOM with the dictionaries inside it (`DICTS.en`, `DICTS.ru`) and flips the layout to LTR. A floating language picker switches language (saved in localStorage `appLang`; default follows the phone's language). Client-facing quote paper (`.doc`) and user data are not translated. **When you add or change Hebrew UI text, add the English and Russian to `DICTS` in `i18n.js`.** Options without a `value` keep their Hebrew text as the value.

## Before pushing
Run `node --check` on the extracted script and keep `esc()` around any user-entered text inserted into HTML.
