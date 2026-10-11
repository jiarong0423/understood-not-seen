# Understood, not seen

Turn your bookmarks into place ideas **without uploading them**.

Most "personalised" tools ask you to hand over your history first. This one reads your bookmark export inside your own
browser tab, removes anything private on the spot, and sends only a short list of public place categories plus a city to
[Qloo](https://www.qloo.com)'s taste graph. You see exactly what would leave your device before you press the button.

> Built for the Qloo Agentic Hackathon. License: MIT. Interface in English and Traditional Chinese, bookmark titles in either language, light and dark mode, and 14 switchable visual styles (top right, Alt+S).

## Why this is an agent
It pursues one goal for you, to understand your taste privately and turn it into real places, and it does so with two gates between your data and the world:

| | Step | What the agent does |
|---|---|---|
| Perceive | Reads the bookmark export in your tab | Nothing is sent anywhere |
| **Gate 1: privacy** | Fails closed | Removes adult, account, personal, private-address and identifier links and their neighbours before anything else sees them |
| Understand | Maps what is left to what each activity does for you (social, stress relief, quiet time ...), optionally with a small on-device model | Builds ideas, never a label for you |
| **Gate 2: consent** | Shows the exact outgoing payload | Nothing leaves until you approve it |
| Act | Calls Qloo as a tool (`/search`, `/v2/insights`) | Uses places you saved as taste signals and ambience tags for quality-first ranking |
| Adapt | Looks at what came back | Falls back to neighbouring categories when a city has none, relaxes the quality bar when nothing passes, follows the calendar (Taiwan holidays and international days) or rotates weekly, and says so on the page |

The decisions are rules plus a small on-device embedding model, not a chat model, and a person stays in the loop at the consent gate. That is deliberate: the personal part never leaves your device.

## How it works

```
bookmarks.html  ──(stays in your browser)──►  1. Privacy gate      removes adult, account, personal, private-address
                                                                    and identifier-bearing links, plus their neighbours
                                              2. Combine           matches what is left to an activity knowledge base
                                                                    (what each activity does for you: social, stress relief,
                                                                     business talk, quiet time, culture ...)
                                              3. You choose        optional: pick what you want from your time off
                                              4. Preview           the full outgoing payload: {city, [Qloo tag ids]}
                          ──(only after you approve)──►  Qloo place search via a thin proxy  ──►  places in your city
```

What stays on your device: the bookmark file, every title and URL, and the text of anything the gate removed (only counts are shown).
What goes out, after your click: a city name and Qloo place-category ids such as `urn:tag:category:place:badminton_court`.

### Where Qloo matters
The ideas are mapped to Qloo place tags and looked up per city with `/v2/insights` (`filter.type=urn:entity:place`, `filter.tags`,
`filter.location.query`). Without Qloo there are no real places to show. Coverage was measured, not assumed, through the same path the page uses:
the first 22 activities x 11 cities returned places in 213 of 242 cells (88%), the 44 added later (shopping, cafes, bars, cooking,
gym, outdoors, physio and more) in 461 of 484 cells (95%), with no request errors and no dead activity (see `tools/probe_matrix.py`).
Thin data is Qloo's, and the page then says "no places found". Pickleball courts, for example, are missing in some cities, so that
idea falls back to shared badminton and tennis courts and says so.

| City | Activities with places (of 66 measured) |
|---|---|
| London | 66 |
| Taipei | 65 |
| Singapore | 65 |
| New York | 65 |
| Tokyo | 62 |
| New Taipei | 64 |
| Taichung | 63 |
| Tainan | 59 |
| Kaohsiung | 57 |
| Taoyuan | 59 |
| Hsinchu | 49 (limited data) |

### Taste signals (optional)
A place the visitor saved, such as a cafe, can be ticked as a taste signal (up to 5, nothing ticked by default). The name is shown in the
"everything that leaves your device" box, resolved to a Qloo place entity with `/search`, and passed to `/v2/insights` as
`signal.interests.entities` with `feature.explainability=true`. Qloo then ranks places by taste similar to the saved place, and each place
shows which saved place it came from. In a Taipei test the tags-only and taste-ranked cafe lists shared 0 to 1 of 8 places, so the signal
changes the result. Whether the new ranking is better for a person is not measured here.

### Beyond the bookmarks
Optional suggestions next to the ticked ideas, in four labelled ways: deeper (same world), same feeling (a shared need, another field),
goes with (same occasion) and balance (a counterweight need). The tables are hand-written in `kb/expansion.json` and describe
activities, not the visitor. Nothing is ticked by default, and a ticked suggestion appears in the box of what leaves the device.

### Invitations that look forward
History cannot be replayed, so the results page opens with an invitation for the coming weekend, for example a social badminton or
pickleball game, or a refined dinner as a treat. When a Taiwan holiday or a widely celebrated day is near (`kb/calendar.json`),
the invitation follows it and adds a small ritual line; otherwise the picks rotate once a week. Taiwan dates come from public reports of
the government work calendar and apply to government offices; check your own. Places are shown, not event sessions, and opening
hours are not checked.

### Evidence of every Qloo call
The results page has a collapsible "Evidence" panel that lists every request made to Qloo for that result: endpoint, parameters, status,
time, result count and whether it was answered from the server's memory. The API key is never part of it, and a test checks that.

### Needs, not people
The system never assigns a person a type. Each activity carries the daily-life needs it serves. A visitor may pick needs by hand.
Reading about work or news is never turned into a leisure need.

## Security checks (built into the repo)
`npm run security` runs three tools: **gitleaks** (secrets in the files and the whole git history), **semgrep** (static analysis for JavaScript, Node and Python, plus a secrets rule pack) and **npm audit** (dependency vulnerabilities; the app has no npm dependencies). A **pre-push hook** (`git config core.hooksPath .githooks`) runs gitleaks and the full test suite before any push and refuses to push without gitleaks.
The server tests also cover path traversal, input validation, a monthly budget guard and a per-IP rate limit. The one third-party script the page loads at runtime is the optional on-device matcher (transformers.js, pinned version, from a CDN), which downloads a model once; it is only fetched when the visitor presses the button.

## One language per page
Qloo stores one name per place and has no language setting, so place names go through a small mapping layer: `kb/place_names.json` (hand-written; entries marked `translated` are pinyin or translated type words, not official names), a rule that splits mixed names ("Mars Fitness 瑪爾斯全方位運動空間" shows the Latin part on the English page and the Chinese part on the Chinese page) and a fallback to Qloo's English descriptor. Names with no entry stay as Qloo stores them; `tools/unmapped_names.py` lists them. The demo has an English sample and a Chinese sample, and the button loads the one that matches the page.

## The look is locked
The stylesheet, the 14 themes, the icon set and the app icons are hashed in `design.lock.json`, and a test fails if any of them changes. A deliberate change is re-locked with `node tools/lock_design.mjs --approve "reason"`. Language strings are audited by `test/i18n.test.mjs` (every string in English and Traditional Chinese, no stray English in the Chinese page).

## Install it as an app (PWA)
Open the hosted page in Chrome, Edge or Safari and choose "Install" or "Add to Home Screen". It opens full screen, and the app's own files work
offline; place lookups still need a connection. Everything about your bookmarks still stays in the app on your device. Phone browsers cannot
export bookmarks, so load a bookmarks.html exported on a computer.

## Run it

```bash
cp .env.example .env        # add your Qloo hackathon key
node --env-file=.env server/server.mjs
# open http://127.0.0.1:8770 and press "Use sample bookmarks"
npm test                    # privacy-gate and ranking tests
```
Node 22 or newer. No dependencies.

The server holds the API key, keeps Qloo answers only in memory (24 hours, never written to disk or this repository),
spaces requests 250 ms apart, allows 20 requests per minute per address, and stops at a monthly budget of 8,000 calls.

## Repository map

| Path | What it is |
|---|---|
| `web/` | The browser app: `js/gate.js` (privacy gate), `js/combine.js` (ranking), `js/app.js` (UI), `kb/activities.json` |
| `server/server.mjs` | Static files plus the Qloo proxy |
| `kb/activities.json` | Activity knowledge base: functions, Qloo tag ids, keywords, fallbacks |
| `kb/i18n.json` | English and Traditional Chinese names for activities, needs, removal reasons and interface text |
| `filter_bookmarks.py` | Source of the privacy rules (Python), with self-tests |
| `tools/export_rules.py` | Exports the rules and knowledge base to `web/` so both sides stay identical |
| `build_signals.py` | Local-model labelling stage for a desktop run (optional) |
| `web/js/themes.js` | The collapsible style switcher: 14 original styles, all driven by CSS variables |
| `web/js/embed.js`, `web/eval.html` | Optional on-device matching and its reproducible check |
| `kb/vocab.json` | Domain vocabulary per activity, used only by the on-device matching |
| `test/` | Node tests for the gate and ranking |

## Honest limits
- The privacy gate is rule based. It removes more than it keeps on purpose, and a rule can still miss something. Review the "kept" count.
- Optional on-device matching: a small multilingual embedding model (about 120 MB, runs in the tab with WebAssembly, no GPU needed)
  compares bookmark titles that matched no keyword with each activity's name, keywords and domain vocabulary. On a held-out set of
  20 titles that should match and 12 that should not, it got 18 of 20 right at the default threshold, with 1 wrong activity, 1 miss and
  1 false positive (a podcast about Roman history matched "concert hall"). The titles were written by the same author as the vocabulary, so
  treat this as optimistic. Open `/eval.html` in the running app to reproduce it. A generative 1.5B model was tried first and rejected:
  it picked the right activity for 1 of 13 titles.
- Qloo coverage differs by city and activity. The page says when a city has no listing and shows a "limited data" label for thin cities.
- Places come from Qloo and are shown as returned.

## Data and attribution
Place data comes from the Qloo API under the hackathon key terms. Qloo responses are not stored in this repository.
