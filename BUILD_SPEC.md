# Daytrail implementation contract

Base: 2Dango/g-extension- at 0aebe9138b40cfb777120dda7eaaae800adff8c7.

## Outcome and constraints

Build a working local Chrome extension around the existing pixel-art dashboard: searchable history, saved Trails and checkpoints, timed focus and website blocking, and active-time reminders. Preserve the original cream/green pixel font, square borders, offset shadows and landscape. Add a matching sidebar and improve canvas art. No generic rounded-card redesign, paid AI, backend, telemetry, publishing, or remote GitHub writes. Existing charts, category tools and history deletion must remain functional. Local use must not require Google identity.

## Ownership

- Main: manifest.json, auth.js, dashboard.js, popup.html/popup.js, worker.js/time-data.js, legacy history-tools.js, privacy UI module, integration, runtime tests, packaging and README.
- Data worker: settings.js, trails.js, history-data.js and focused tests/data*.test.js only.
- Focus worker: focus-client.js, focus-engine.js, reminder.js, blocked.html/blocked.js/blocked.css and focused tests/focus*.test.js only. Main imports engine from worker and edits manifest.
- UI worker: index.html, styles.css, pixel-art.js, workspace.js only. Do not remove IDs used by dashboard.js, chart code, time-panel.js, category/recommendation code or legacy dialogs. Main adjusts legacy access code.

## Shared data/API contract

ES modules, native Chrome APIs, no framework. All user-facing dynamic strings use textContent. Persist only deliberately chosen records; no remote requests.

settings.js:
- export settingsKey = 'daytrailSettings'; readSettings(); updateSettings(patch); normalizeDomain(input); matchesDomain(site, domain).
- normalized defaults: {excludedSites:[], retentionDays:30, remindersEnabled:false, reminderMinutes:10, distractionSites:['reddit.com','instagram.com'], focusMinutes:25}.
- retention applies to collected time records, not explicitly saved Trails. Exclusions match exact domain and subdomains with proper boundaries. Exclusions override collection/reminders. Domains must be valid HTTP(S) hostnames; reject ports, paths, wildcards, credentials and unsafe schemes in domain inputs (accept a pasted HTTP(S) URL by extracting its hostname only if clearly documented).

trails.js:
- export trailsKey = 'daytrailTrails', activeTrailKey = 'daytrailActiveTrailId'.
- Trail: {id,name,goal,notes,checkpoint,createdAt,updatedAt,pages:[{id,url,title,site,savedAt,note}]}.
- getTrails(); getActiveTrail(); setActiveTrail(id|null); createTrail({name,goal?,notes?,checkpoint?}); updateTrail(id,patch); deleteTrail(id); addPageToTrail(id,{url,title?,note?}); removePageFromTrail(id,url); resumeTrail(id,{urls?}={}); exportTrail(id); importTrail(payload).
- Every mutator returns updated Trail when applicable. createTrail makes it active. resumeTrail opens at most 20 valid HTTP(S) links and returns opened count. No automatic closing of existing tabs. Deduplicate saved URLs. Sanitize imported objects, cap lengths/counts and reject unsafe URLs. Export/import schema version 1. Serialize read/modify/write to prevent popup/dashboard lost updates.

history-data.js:
- readRecentPages({text='',days=7,site='',limit=200}={}) returns {items,hasMore,source:'history'|'sample',rangeStart}; item {id,url,title,site,lastVisitTime,visitCount,category}. Include deterministic sample pages if history permission absent, visibly distinguished by source. Ignore excluded sites and hiddenSites.
- Read real titles/URLs, not just domain aggregates. Date window uses recent page visits, not a complete tab journey. Avoid getVisits per search keystroke; cache bounded results and invalidate on permission/history deletion changes. export invalidateHistoryCache().

focus-client.js:
- export focusKey = 'daytrailFocusState'; readFocusState() returns {session:null|{id,startedAt,endsAt,trailId,sites}}.
- startFocus({minutes,sites,trailId:null|string}); stopFocus(); enableReminders({sites,minutes}); disableReminders().
- Client requests optional permissions on the explicit initiating click. Blocking: declarativeNetRequestWithHostAccess + alarms + tabs and host patterns only for selected domains. Reminders: scripting + tabs + idle + alarms and selected host access. Enable reminders enables existing tracker via timeCommand('enable'). Stopping focus does not implicitly toggle independently enabled tracking.
- Limits: focus 1..180 minutes; reminders 1..120 minutes; at most 30 selected domains. No broad host permission request. Return informative errors on denied permissions.

focus-engine.js:
- export initFocusEngine(); main calls once from worker.js. Own listeners for focus runtime messages, alarms, startup/install, permission removal, and activeTime storage changes. No edits to existing worker required beyond import/init.
- Validate commands/senders/options in background. DNR redirect main_frame requests to /blocked.html only on chosen sites. Own rule ID range 100000..100099. Reconcile expiry after startup, worker restart, and alarms; stop clears owned rules. Handle already-open matching tabs on focus start/activation, skip incognito. Do not navigate tabs merely because browser permission was revoked.
- Reminders use actual persisted activeTime sessions [host,start,end], current active focused tab and optional permissions. Show only after measured active threshold; snooze/cooldown/"This is work" persist across tab changes. Excluded domains never nudge. Reminders are off by default. Never infer productivity from a category.
- Content script renders a dismissible pixel-style in-page reminder via isolated Shadow DOM, safe text, no remote resources. Actions: return to active Trail/dashboard, snooze 5 minutes, allow site for current day. Validate sender.tab domain for actions. User may dismiss without being trapped. Avoid browser privileged pages.
- blocked page reads current session/Trail, has Return to task and End focus; no destination URL or private data in query strings. Match original design.

## UI integration contract

Original Home keeps landscape and stats/chart/report IDs. Add sidebar views Home, History, Trails, Focus, Insights (may route to existing analytics), Privacy. Main handles data access/banner and original account dialog repurposing. workspace.js owns new History/Trails/Focus views and Home Trail card; can import APIs above. It dispatches document events 'daytrail:navigate' {detail:{view}} and handles same, plus hash navigation (#home/history/trails/focus/insights/privacy). Expose window navigation only through DOM/events, no globals required.

Privacy root id privacy-panel is supplied by UI worker; main renders its contents via privacy-panel.js. Home Trail root id home-trail-card is rendered by workspace. New controls use current pixel .button/.card styling. Show status/error messages and meaningful empty states. Demo/sample data never silently becomes user history. No invented productivity scores. Keep text legible and all controls accessible at 360px.

## Completion evidence

Focused deterministic tests for imported data, URL/domain validation, exclusions, time clipping, rule scope and expiry. Actual extension load in isolated Chromium, local history permission and search, Trail persistence, focus redirect/stop/expiry, reminder threshold/snooze, privacy pause/exclusion/deletion. Screenshots at desktop and narrow sizes with original visual identity. Independent read-only audit of final code/diff and test evidence. Package ZIP with manifest at root, install/demo instructions, and truthful known limitations.

## Repair pass requested November 15

User-observed failures override prior limited acceptance: Focus remains loading; toolbar popup and Trail saving fail. Establish real popup and first-use permission baselines; fix causes plus bounded error recovery, not timeouts alone. Preserve original pixel design and existing saved data. Home gets prominent Trailside Discoveries below the hero; Insights gets expanded, filtered, explained discoveries and grounded analytics. No new remote data collection.

Verification for this pass: real toolbar target at Chrome popup dimensions; create/select/save/deduplicate/reopen/resume Trail; preserve unsaved dashboard edits during storage refresh; imported/exported/deleted Trails; first-use focus grant/denial/pending/retry; existing and new tabs blocked, manual stop, expiry and restart; reminder threshold/snooze/pause; history filters, privacy exclusions/retention/disconnect; sample and empty insights; desktop/narrow routes; package exact source. Separate real APIs from permission-fixture evidence and disclose any remaining native UI gaps. Review final immutable diff after runtime tests, then package as 2.0.1. Preserve 2.0.0 ZIP and repair baseline for comparison.

User refinement: soften toolbar-only corners and spacing while keeping cream/green colors and pixel typography. Home keeps the original pixel-art design.

Latest Insights refinement: prominently show total measured time for the selected range; daily measured-time, hourly visit and separate category graphs; recorded-day counts, average per recorded day and busiest measured day. Graphs must agree with source counts, clip intervals across local-midnight/DST boundaries, respect privacy filters, and never manufacture sample time or mix demo visits with measured time. Preserve original dashboard design.

## Local discovery library pass: 2.1.0

User authorized implementation of a larger resource database selected by keywords. Preserve the existing Home art, cream/forest-green pixel UI, toolbar repairs, Focus, Trails and measured-time graphs. No paid API, server, runtime recommendation requests, new permissions, stored browsing-topic profiles or GitHub writes.

The library must contain at least 200 distinct resources across at least 12 categories. Records include stable IDs, provider HTTPS URLs, type, difficulty, tags, related phrases, authored descriptions and next steps. Only actual dated successful link checks may populate a verified reachability status; blocked or inconclusive checks remain unverified. Library descriptions remain authored, while resource selection and ordering respond to context.

Use next checkpoint, active Trail name/goal/saved titles, permitted recent page titles, website/category activity and explicit Useful preferences to rank resources locally. Expand a bounded set of related phrases; explain the strongest matching signal, label saved/visited resources, and mildly prefer unseen resources. Ignore generic title noise and distinguish sample activity from real browsing evidence. Limit title inputs to the current range and respect exclusions/hidden domains both before and during matching. Do not scan page bodies or upload titles. Failed required context reads must clear stale cards and disable their controls, including during pending actions.

Home retains a compact three-card preview directly below its art. Insights supplies keyword, category, type and difficulty filters; browse-all mode; nine-card pagination; Save to active Trail; Useful and Not for me; and Reset choices. Store only catalog IDs for discovery feedback. Saving uses existing Trail validation/deduplication and preserves its suggested next step. With no active Trail, guide the user to choose/create one. Async action receipts must agree with committed state; refreshes must not overwrite privacy failures or leave controls stuck.

Verification: preserve the 75-test baseline; add catalog, ranking/phrase/noise/privacy/context/feedback tests; run isolated Chromium flows with actually visited fixture titles and both desktop/narrow screenshots; run the production-manifest native toolbar regression and existing feature/privacy suites; audit the frozen code and evidence independently; verify ZIP/source equivalence and load the extracted 2.1.0 package. Keep the known native permission-widget test gap explicit. Preserve prior release ZIPs.
