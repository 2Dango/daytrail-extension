# Daytrail

Daytrail is a Chrome extension that is able to act as a multi-tool package based off your browser activity. It includes a daily activity graph, a chart of your most visited sites, and totals for searches, unique sites, and visits analyzed. It also shows recent search terms and the first date you granted access. Daytrail is able to act as both a quick and more efficient browser history dashboard that's able to change your search history and keep track, and as a fully-fledged site for analysis of activity and changes that you could make. There are also many productivity features, such as blocking websites, being able to see the different categories of sites you use, and setting up pop-ups on sites that might be acting as distractions.

## Install and connect

1. Unzip Daytrail if you downloaded the ZIP folder.
2. In the desktop Chrome profile you normally use, open `chrome://extensions`. Turn on **Developer mode**, choose **Load unpacked**, and select the **Daytrail** folder containing `manifest.json`. If you already installed this folder, click **Reload** on its extension card.
3. Open Daytrail from Chrome’s **Extensions** menu. The dashboard opens in a new tab with labeled sample data by default.
4. Click **Connect Google account**. Use the same account you’re signed into in Chrome. This build already includes the Google OAuth client ID.
5. Click **Allow history access** and approve Chrome’s history permission. The dashboard will load activity saved in this Chrome profile.

Local installation is free. [Chrome’s guide to loading an unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)

## Change the Google sign-in configuration

Use these steps when switching to a different Google Auth Platform project.

1. Sign into the **Chrome profile** with the Google account you want to connect. The Chrome profile icon is in the upper-right corner of Chrome. Check `chrome://history` in that profile to see the browsing history available for testing.
2. Copy the extension’s ID from the Daytrail card at `chrome://extensions`. This build uses `idhilhljpjfodmnmookfohpnfmeonhpc`.
3. Open [Google Auth Platform](https://console.cloud.google.com/auth/clients). Select or create a project and complete **Branding** and **Audience**. For a personal Google account, use an **External** audience. If you’re using a workspace with an **Internal** audience, sign in as a member of that organization.
4. Go to **Clients → Create client → Chrome Extension**. Name the client, paste the extension ID into **Item ID**, and create it. The client ID ends in `.apps.googleusercontent.com`.
5. In `manifest.json`, replace the value of `oauth2.client_id` with the new **client ID**. Keep the existing scopes.
6. At `chrome://extensions`, click **Reload** on the Daytrail card. Open Daytrail again.
7. Click **Connect Google account** and follow the Google sign-in or consent prompt. Once Daytrail shows the account, click **Allow history access** and approve Chrome’s permission separately. Refresh the dashboard after a new search if you want to check that it counts.

The extension uses Google’s Chrome Identity OAuth flow for name and email. Google may reuse a previously approved sign-in, and Chrome can remember previously granted extension permissions. [Chrome’s Google OAuth setup guide](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth) · [Google Auth Platform audience settings](https://support.google.com/cloud/answer/15549945)

## What the dashboard measures

| Metric | Definition |
| --- | --- |
| **Google searches** | Visits to Google search results with a query in the URL. A repeat visit to a results page can count again. |
| **Unique sites** | Distinct HTTP(S) hostnames, with `www.` and the corresponding bare hostname counted together. Other subdomains are counted separately. |
| **Data processed** | Number of web visit records analyzed, including visits to Google search results. The dashboard skips page reloads, subframe visits, and generated keyword records. |
| **Tracking since** | Date of the first history approval for the current connection. The selected period can include visits from before you connected. |
| **Favorite websites** | The five hostnames in the current date range that were visited most often. |

Last 24 hours uses a rolling window with hourly buckets. The 7-, 30-, and 90-day filters use calendar days in your local time zone and include today. Hover over the trend chart or focus it and use the arrow keys to inspect a day. History is recalculated when you open or return to the dashboard, change the range, or click **Refresh**.

Daytrail uses `chrome.history.search()` to find URLs and `chrome.history.getVisits()` to count individual visits. Chrome typically retains up to 90 days. The dashboard can include entries synced into this profile and excludes Incognito history and entries removed from Chrome. Account-level Google Search records found only in Google My Activity require a separate Data Portability integration. [Chrome History API](https://developer.chrome.com/docs/extensions/reference/api/history) · [Chrome history coverage](https://support.google.com/chrome/answer/95589?co=GENIE.Platform%3DDesktop) · [Google Data Portability scopes](https://developers.google.com/data-portability/user-guide/scopes)

## Permissions and privacy

- `identity` opens Google’s sign-in or consent flow. The extension uses an access token to get the account’s basic details from Google’s OpenID Connect user info endpoint. It does not store the token in extension storage.
- `identity.email` checks that the connected Google account matches the one signed into the Chrome profile. This permission allows Chrome to display an email-access warning during installation.
- `history` is optional until you click **Allow history access**. Chrome’s approval wording includes the ability to change history. Daytrail only reads it.
- `storage` saves the connected account information and first approval date locally. Searches, URLs, and chart data are calculated in the open dashboard and stay on the device. Opening the dashboard without a matching Chrome profile shows sample data.
- **Disconnect Daytrail** clears the connection in the extension, removes its history permission, and clears Chrome’s cached OAuth tokens for Daytrail. You can manage the Google OAuth grant in [Google Account connections](https://myaccount.google.com/connections).

[Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity) · [Optional permission prompts](https://developer.chrome.com/docs/extensions/reference/api/permissions#method-request)

## Working with a teammate

Put the Daytrail folder in a shared GitHub repository. There’s no build step or dependency installation. Keep the public manifest key unchanged so everyone’s local copy uses the same extension ID. A team can share the Google OAuth **client ID** for that extension ID. Keep client secrets, tokens, and real history exports out of the repo.

For a Chrome Web Store release, ZIP the contents of the Daytrail folder with `manifest.json` at the root of the archive. Create a draft in the Developer Dashboard and use the draft’s **Package → View public key** value as the development manifest key. Set up a production OAuth client for the resulting Store Item ID and test with that ID before submitting. The Chrome Web Store requires its own registration and review, including for unlisted releases. A history extension also needs a published privacy policy and disclosures in the listing. [Consistent extension IDs](https://developer.chrome.com/docs/extensions/reference/manifest/key) · [Store privacy requirements](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

## Troubleshooting

- **Connect opens the setup dialog again.** Confirm that the replacement manifest contains `oauth2.client_id` and that you reloaded the same folder.
- **Google rejects the client.** Check that the client type is **Chrome Extension**, its Item ID matches the extension ID shown in Chrome, and the Google Auth Platform project is configured for the account you’re trying to use.
- **Daytrail asks for the same account.** Check Chrome’s profile icon. Sign into Chrome itself with the account you connect in Daytrail.
- **You see fewer searches than expected.** Check `chrome://history` and the date filter. Daytrail counts Google Search result URLs that Chrome saved. For saved Chrome visits from other devices, enable **History and tabs** in Chrome’s Google account settings if you want to sync them. [Chrome sync settings](https://support.google.com/chrome/answer/165139)

## Pixel design and website icons

Version 1.1 adds an original canvas pixel landscape and illustrated title, responsive raised panels, keyboard-accessible chart inspection, and Chrome favicon icons. The favicon permission supplies site icons through Chrome. Icons fall back to letters if loading fails.

## Toolbar popup and history management

Open Daytrail from Chrome’s Extensions menu for a seven-day preview. Choose **Open full dashboard** for the complete view. Most active hour and weekday count visible visits within the displayed date range in your local time.

Use **Search websites** at the top of the dashboard. Type part of a domain, use the arrow keys or click to select a match, and review its visits and active time for the dashboard range. The search includes hidden sites and sites outside the selected range. **Hide from Daytrail** excludes the site from counts, charts, and lists. Choose **Show in Daytrail** to restore it. **Delete from Chrome history** previews how many page addresses will be affected. Confirming deletes all saved visits to those addresses across all dates. Select the checkbox to also erase Daytrail’s recorded time for that site. Daytrail groups www and the bare hostname together and lists other subdomains separately.

## Active time tracking

Requires Chrome 120 or later. Choose **Enable time tracking** on the dashboard and approve the optional permissions. `tabs` reads the active tab’s address, `idle` detects an idle or locked device, and `alarms` periodically saves elapsed time. Daytrail treats the device as idle after 60 seconds without input. Choose **Pause time tracking** to stop collection and **Resume time tracking** to start again. Tracking begins when enabled, and the extension retains up to 90 days of measured time on this device.

The time chart ranks up to eight sites and shows total measured time across all visible sites. It counts only the overlap with the selected date range. The extension saves a checkpoint about every 30 seconds and discards stale gaps after sleep or a browser restart. The most recent unsaved interval can be lost if Chrome closes unexpectedly.

## Website categories and recommendations

Daytrail uses a list of known domains and a few domain suffix rules to classify sites on the device. Sites that do not match appear as **Uncategorized**. Open a site through **Search websites** and use **Change category** to label it yourself. Choose **Automatic** to restore its suggested label.

The **Trending categories** chart shows each category’s share of visits or active time for the selected range. **Recommended for you** offers Chrome add-ons matched to websites you use and related websites matched to your categories. Use the selector to browse either type. Daytrail ranks suggestions using recorded time and visits. Hidden sites are excluded. No key is needed for categorization or recommendations. The update removes the saved WhoisXML API key from Daytrail’s local storage.
