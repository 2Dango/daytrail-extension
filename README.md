# Daytrail

A local Chrome history extension that helps you find a page, keep your place in a project, and return to it when you get distracted. Built on the original Daytrail prototype and its cream-and-forest-green pixel design. No account, API key, paid service, server, or build step is needed.

## Install

1. Extract the release ZIP, or use this source folder.
2. Open `chrome://extensions` in desktop Chrome 120 or later.
3. Turn on **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
4. Pin Daytrail in Chrome’s Extensions menu. Click its icon, then **Open full dashboard**.
5. The dashboard starts with explicitly labeled sample data. Click **Allow history access** to use this Chrome profile’s history.

If replacing an older Daytrail folder, click **Reload** on its extension card and reopen its dashboard. Google sign-in is no longer used. Existing local time/category records are retained; old account information is removed when local history access is read.

## What is included

- **Home:** the original pixel landscape, matching sidebar, Trailside Discoveries directly below the art, active Trail and checkpoint, plus the original activity charts.
- **History:** find recent pages by title, URL, website and date range. Open a result or save it into a Trail. Sample results stay labeled as sample.
- **Trails:** named projects containing selected links, a goal, notes and a next-step checkpoint. Create, edit, choose an active Trail, remove pages, resume saved pages, and delete a Trail with confirmation. JSON exports can be imported into another local copy of Daytrail.
- **Toolbar popup:** softer rounded panels in the same pixel style; create a Trail and save the current website in one step, choose an existing Trail, resume all saved pages (up to 20), and start/end Focus. The dashboard button stays visible and the seven-day preview expands on demand. First-time Focus setup opens in the dashboard so its permission flow survives.
- **Focus:** pick websites and a duration of 1–180 minutes. Selected domains and their subdomains redirect to a matching pixel scene during that session. The page shows your Trail/checkpoint and an explicit **End focus** button. Already-open matching tabs are redirected too.
- **Gentle reminders:** opt in to reminders after 1–120 minutes of measured active time on selected sites during the current day. The in-page card offers **Back to my task**, **5 more minutes**, **This is work**, or dismiss. A work exception lasts until the next local day; snooze lasts five minutes. Dismissal has a ten-minute cooldown.
- **Insights:** prominent total time spent, recorded days, average per recorded day, busiest measured day, daily active-time and hourly-visit graphs, separate category graphs, website/category rankings, shares and descriptive observations. All totals follow the selected date range and privacy filters. Trailside Discoveries includes 226 local resources across 14 categories, with search, category/type/difficulty filters, explanations and next steps. Nine cards appear initially; show nine more at a time. Sample activity stays labeled and is never mixed into measured time rankings.
- **Privacy:** pause collection, choose 7/30/90-day time retention, exclude domains, disconnect permissions, or erase Daytrail data with confirmation.

## Trailside Discoveries in 2.1.0

The library is curated; which resources appear and their order are computed locally. Your next checkpoint carries the strongest topic weight, followed by your active Trail's name, goal and saved page titles, then permitted recent browsing titles and website/category activity. Related phrases connect terms such as **stop distracting websites** to **website blocking**. Each card explains the signal behind its match. A checkpoint about Python data visualization brings up resources such as Matplotlib and pandas; changing it to typography brings up font resources.

Use **Save to Trail** to keep a resource and its suggested next step in your active Trail. **Useful** promotes that resource and related topics; **Not for me** removes it from suggestions and library results. **Reset choices** clears those preferences. Saved and recently visited resources are labeled, and unseen resources get a small ranking boost. Browse the entire library or combine keyword, category, resource-type and difficulty filters.

History-title matching only runs with local history access enabled. It reads up to 200 recent pages in the selected range and uses up to 60 allowed titles for topic matching. Generic login/dashboard titles are ignored. Excluded and hidden domains are removed from matching inputs and discovery results, including saved-page title inputs. Sample page titles never count as your browsing evidence. If required privacy/context reads fail, discoveries clear and their controls stay disabled until a safe snapshot can load.

Resources include authored tags, related phrases, difficulty, provider links and a concrete next step. Link-check dates indicate a successful one-time HTTP reachability check, not an endorsement or a guarantee that the page is unchanged. At release, 185 links were reachable and 41 remained unverified because of access blocks, timeouts or other check failures. Opening a resource visits its external website normally; matching itself makes no network requests.

## Repair notes for 2.0.1

Focus requests Chrome access inside the initiating click, without the unnecessary all-tabs permission. An unanswered permission request returns control after 20 seconds; finish or dismiss Chrome’s prompt and click Start again. A late permission grant does not start a session by itself. Worker restart/lost-reply recovery avoids duplicate sessions.

A website can be saved without connecting history. If no Trail exists, the Save button guides you to **Create & save page**. Chrome’s own pages and the dashboard cannot be saved; open a regular HTTP(S) website first. Resume creates every tab before switching to the first one, so closing the popup cannot interrupt the rest.

Unsaved Trail drafts survive storage updates, route changes and switching between Trails in an open dashboard. Save changes to persist them across a reload; the dashboard warns before leaving with unsaved edits. Saving a page in the toolbar no longer wipes the notes you are typing.

## A three-minute demo

1. Open Home to show the original art and the added sidebar. Enable local history access.
2. Create a Trail such as **Ship the hackathon demo**. Give it a goal and a checkpoint: **Polish the demo and record a walkthrough**.
3. Search History for a page you have visited and save it. Open a regular website and use the toolbar popup to save a second page.
4. Return to Home. The active Trail shows your checkpoint. **Resume Trail** reopens its saved pages.
   Open Insights and try a checkpoint such as **Plot Python data with Matplotlib**, then **Choose typography for my website** to show how Discoveries changes. Save a resource or mark one Useful.
5. In Focus, choose a harmless demo website and start a one-minute session. Open that website to show the focus scene and your checkpoint. End focus to restore access.
6. To demonstrate a reminder, enable reminders with a one-minute threshold and browse the chosen site actively while Chrome remains focused. The tracker checks about every 30 seconds. Choose **5 more minutes** or **This is work**.
7. Show Privacy: exclude a site, pause collection, and explain that data stays on this device.

Use a separate browser profile for a public demo if you do not want to display your real history.

## How the measurements work

History comes from the current Chrome profile, using `chrome.history.search()` and, for the original analytics, `chrome.history.getVisits()`. It includes only entries Chrome makes available. It does not reconstruct deleted history, Incognito visits, Google My Activity, page contents, or time spent before tracking was enabled.

The History view shows recent **pages**, with their latest visit time. It is not a complete chronological sequence of every visit. Search is bounded to the newest 2,000 matches per query and the UI marks truncated results. Changing the query searches Chrome again; typing does not trigger a separate visit lookup for every page. Chrome’s own matching rules apply. The analytics count individual visits, excluding reloads, subframe visits and generated keyword records. A repeated Google search results visit can count again.

Active time counts a normal, non-Incognito tab while its browser window is focused and the device is active. Idle is detected after 60 seconds. Records checkpoint approximately every 30 seconds; stale gaps after sleep or restart are discarded. A recent unsaved interval can be lost on an abrupt close. The measure is an estimate of active browsing, not attention. Reminders use cumulative measured time today, rather than an uninterrupted visit timer, and do not classify a website as unproductive automatically.

Hostname reports and exclusions group `www.` with the bare domain; other subdomains are separate. Exclusion and focus rules include exact domains and their subdomains, with domain boundaries respected. Focus blocking does not depend on time tracking. Stopping focus does not pause separately enabled time collection or reminders. Focus and reminders share a saved website list; starting either feature saves its selected sites for the forms and toolbar. An already-running focus session keeps its own original site list until it ends.

## Permissions and local data

Required permissions are `storage`, `favicon` and `activeTab`. The last permits saving the current page when you invoke the toolbar popup. Site icons use Chrome’s favicon service and fall back to letters.

Optional permissions are requested when you enable their feature:

| Feature | Optional access |
| --- | --- |
| History and its management tools | `history` |
| Active-time collection | `tabs`, `idle`, `alarms` |
| Timed website blocking | `declarativeNetRequestWithHostAccess`, `alarms`, and the selected websites |
| In-page reminders | `scripting`, `tabs`, `idle`, `alarms`, and the selected websites |

The manifest allows requesting HTTP(S) hosts, but feature prompts request only the domains you select, including their subdomains. No remote code, telemetry, AI calls or history uploads are used. All fonts and scripts ship with the extension.

Stored locally: chosen Trail page URLs/titles and notes, checkpoints, active-time intervals, focus sessions, reminder snoozes/work exceptions, hidden/excluded sites, category overrides, preferences, the IDs of discovery resources marked Useful or Not for me, and the history-permission approval date. Search/chart results and discovery title-matching context are cached temporarily in the open page's memory. No browsing-topic profile is stored. Page bodies, screenshots, passwords and form inputs are not collected. A Trail export deliberately contains its selected links and notes; review it before sharing.

- **Hide from Daytrail** filters reports. It does not stop time collection or erase browser history.
- **Exclude website** removes it and its subdomains from history views, time collection and reminders, and removes its recorded time. It does not remove intentionally saved Trail links or Chrome history. Focus blocking remains controlled by its own chosen list.
- **Pause time collection** in Privacy stops time collection and reminders. Existing records remain.
- **Disconnect and pause Daytrail** ends focus, pauses collection/reminders and removes optional permissions. Saved Trails and records remain.
- **Erase Daytrail data** confirms before removing all local Trails, time records and preferences. It leaves Chrome history untouched.
- **Delete from Chrome history** in Home’s website manager is a separate, destructive action with a preview and confirmation. It removes every Chrome visit to the listed page addresses across all dates. You may separately choose to erase recorded time for that site.

## Deliberate limits

This is an unpacked hackathon build, not a published Chrome Web Store release. Blocking is a focus aid: you can end the session, remove permissions or disable the extension. Chrome can delay alarms during sleep; expired sessions reconcile when the worker resumes. Restricted browser pages such as `chrome://` cannot show reminders. Site scripts, browser policy or permission revocation can also prevent injection. The build supports up to 100 Trails, 100 saved pages per Trail, and opens at most 20 saved pages per resume action.

Explicitly saved Trails remain until you delete them; the retention setting applies to measured active-time records. Discoveries use a fixed local catalog with keyword and related-phrase matching. Descriptions and next steps are authored, so this is not live search or generated advice; unfamiliar topics may have no direct match. There is no cloud sync, account integration, semantic/AI search, automatic page summarization, or historical page-body archive.

## Development and verification

The extension runs directly from these files. Node 20+ is only needed to run development tests:

```sh
npm test
```

`npm run test:browser` runs the isolated Chromium verification and writes its evidence outside the extension. Install Playwright and its Chromium browser for this optional development check. `DAYTRAIL_PLAYWRIGHT_MODULE` can specify a local Playwright module, and `PLAYWRIGHT_BROWSERS_PATH` can specify its browser cache. The deterministic tests use controlled Chrome fixtures.

Verification for the discovery update is recorded in `artifacts/discoveries-2.1.0/VERIFICATION.md` in the source checkout; earlier repair evidence remains in `artifacts/repair-2.0.1`. `npm run test:discoveries` covers matching from actual visited fixture titles, active-Trail changes, filters, pagination, save/deduplication, feedback/reset and privacy failures. `npm run test:native` exercises the actual Chrome toolbar action and `activeTab`, using a separate profile; `DAYTRAIL_CHROME` selects a Chrome executable supporting the DevTools Extensions domain. `npm run test:extra` covers additional History and Privacy flows. No personal browser profile is used.

The native suite tests create/save/select/deduplicate/reopen/resume, drafts, import/export/delete, popup dimensions, Discoveries filters, and Focus's pending-permission recovery against the unchanged production manifest. Other browser checks exercise actual history, DNR, alarms and reminder injection using optional permissions promoted to required **only in a disposable test copy**. Expiry and reminder time are accelerated with seeded test state.

Chrome’s native permission Allow/Cancel widgets are not exposed by this automation environment. Their visual interaction and full selected-site permission revocation still need a manual check in a fresh profile. Deterministic tests cover denial, late grant, missing access, retry and disconnect ordering; the exact-manifest native test verifies that an unanswered request no longer leaves the button stuck. These are distinct from having clicked Chrome’s native Allow button.

Original prototype: [2Dango/g-extension-](https://github.com/2Dango/g-extension-) at `0aebe9138b40cfb777120dda7eaaae800adff8c7`. The included Pixelify Sans font retains its `OFL.txt` license. The original art and interface were extended in canvas and CSS.
