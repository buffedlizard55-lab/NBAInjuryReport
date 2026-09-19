# Next-session priorities

## State at the end of session 16 (2026-09-19) — read this first

Session 16 was the **injury-board product**, not another reporter sweep. Training camp opens
2026-09-22 (overseas) / 2026-09-29 (rest of league); the board is about to start moving for
real. The standing constraints still apply: **no X API key**, every claim re-checkable from a
free public source, an omitted ESPN block is never clearance.

**What shipped**

1. **Board alerts no longer silent-drop on ESPN's listing DATE.** `InjuryBoard.alertFor` used
   to set `alertEligible: AlertEngine.isFresh(row.updated, 24h)`. `fire()` already judges board
   items by `observedAt` (the 6-hour freshness fix), but a false `alertEligible` short-circuits
   that test. ESPN's injuries API, re-read 2026-09-19T18:13:01Z, still stamps most rows with the
   original comment date (sampled live: Mouhamed Gueye ATL `date=2026-07-19T00:14Z`). A NEW
   listing or a STATUS CHANGE observed today on a July-stamped row would have been silent-dropped
   even though `observedAt` is now. Fixed: board change alerts are eligible; freshness is judged
   only by `observedAt` + `maxAgeMs`. Social posts stay bound to post time. Pinned by
   `tools/regression_test.js` with a **40-day-old** source stamp (the previous 6h case was still
   inside the old 24h window and could not catch this).
2. **All 30 teams are on the board, including the empty ones.** ESPN HTML + JSON still omit
   CLE, DET and LAL (27/30, same three as 2026-09-17). The coverage line named them; the
   team-grid view did not render them at all. The board now paints a 30-chip strip on every view
   (empty chips are warn-coloured and titled "NOT clearance") and, in the unfiltered team-grid,
   an empty card per omitted franchise with ESPN + NBA.com review links.
3. **Season clock from dated public pages**, not from "today feels like camp".
   `NBA_SEASON_CALENDAR` / `seasonClock()` in `assets/js/data.js`. Opening night 2026-10-20
   tripleheader cited from ESPN's schedule story (3pm / 7pm / 9:30pm ET) and the official NBA
   Bluesky bio. Basketball Monster, re-read the same day, lists the same three games at 2:00pm /
   6:00pm / 8:30pm and "The regular season begins in 31 days." Both tip-time claims are stored;
   neither is picked. Camp dates cite Olympics.com / NBC key-dates roundups and say they are
   **not** a first-party NBA.com HTML page this session.
4. **Dashboard reporter evidence ledger.** `#autoScorecard` existed only on `reporters.html`.
   `intelligence.js` looked it up with single quotes, so the `getElementById` wiring audit
   (double quotes only) never noticed. The dashboard now has the container, and those lookups
   use double quotes so a missing id fails the suite.

**Live re-reads this session (assistant page-fetch, 2026-09-19)**

- Official 2026-27 injury-report page still **404**, new XID **71103381**.
- ESPN injuries HTML title "NBA Injury Status - 2026-27 Season" and JSON timestamp
  2026-09-19T18:13:01Z, season `{year:2027, type:1, name:'Preseason', displayName:'2026-27'}`.
- Basketball Monster playernews.aspx 200; status tags present; Bona Q / Mark Williams INJURED
  copied as format evidence, **not** scraped into alerts.
- ESPN NBA RSS is general news, not an injury feed — not wired.

**What is still open, and why**

1. **Official adapter still blocked** until
   `official.nba.com/nba-injury-report-2026-27-season/` stops 404. Never guess a PDF filename.
2. **Impact stays UNKNOWN** until box scores exist (`roleStats` empty). First measurement window
   is preseason tip 2026-10-03, then opening night 2026-10-20.
3. **In-game QTR/exit latency is fixture-tested only** until that 3 Oct tip.
4. **Reporter-layer leftovers from session 15** are unchanged: verifier-drift UI, beat-change
   watch, thin teams, `rodboone` bio, CHA/UTA identity ceiling, 26/30 clubs unverified on
   Bluesky, X/IG/FB manual-only.
5. **CLE/DET/LAL omitted from ESPN** is still a feed fact. Re-check at camp: if they are still
   missing *while games are live*, that is a source-coverage problem, not an offseason artefact.

## State at the end of session 15 (2026-09-19) — read this first

Session 15 worked the brief's **"next candidates"** list: Mike Vorkunov's NBA starter pack as a corpus for the
thin teams, a periodic re-probe of the club handles, and the CHA / UTA identity ceiling — still under the
standing constraints that **no X API key exists**, every claim must be re-checkable by a free keyless call,
and dormant-only teams stay labelled dormant.

**What shipped**

1. **Vorkunov's starter-pack list was read in full** (`app.bsky.graph.getList`, 10 chunks) and cross-checked
   against the registry; bio-phrase `searchActors` queries ("covering the Orlando Magic") and exact-name
   `searchActorsTypeahead` filled the rest. **16 new graded rows**, each read via `getProfiles` **and**
   `getAuthorFeed?limit=1` the same day, with the verbatim bio, the counts and the newest-post date stored:
   ORL `codytaylornba` (Rookie Wire, "credentialed", 17d) · DET `hunterpatterson` (The Athletic — **valid
   verification object issued by `theathletic.com`**, recorded with the outlet as verifier, 0d) · PHI
   `ginamizell` (Inquirer beat, 8d via repost) + `christopherhine` (Inquirer; bio records his own MIN→PHI
   move, 4d) · TOR `michaelgrangenba` (Sportsnet columnist, **39d DORMANT**) · BKN `lucaskaplan` (NetsDaily,
   **outlet-verified** — bio names no beat, 0d) · NOP `rodwalkernola` (Times-Picayune **multi-sport
   columnist, outlet-verified**; newest post is a Saints column, 0d) + `masonginsberg` (In the NO, 0d) · CHI
   `juliapoe` (Tribune, "covering hoops", PBWA, 3d) + `willgottlieb` (CHGO, 25d) · IND `caitlinmaycooper`
   (independent Pacers film blog, labelled so, 0d) · CHA `britishbuzz` (CLTure + Buzz Beat, 1d) · WAS
   `chasedcsports` (Monumental — **team-owned** network, labelled so, 18d) · UTA `millerjryan` (KSL, **597d
   DORMANT**) · NYK `stevepopper` (Newsday, **352d DORMANT**).
2. **One refusal kept visible, and it is the hardest one so far.** `rodboone.bsky.social` posts Hornets
   roster moves (654 posts) but the profile has **no bio, no outlet, no verification object**. By the rule
   that refused `miketrudell`, the row is `identityRefused, feed:false, unconfirmed` and can never alert. Also
   read and **not** added: Kristian Winfield (`krisplashed`, newest post 2025-05-28), `dan-savage` (a Magic
   employee), and `nypostlewisbot.mirrors.bot` (a third-party mirror of an X account — the registry forbids
   mirror handles, so it is recorded in the FLAGS log, not as a row). No Bluesky presence could be found for
   Brian Lewis (NY Post), Will Guillory, Eric Walden or Tony Jones.
3. **Club-handle re-probe: 20 handles, one batched request, zero change** (`NBA_OFFICIAL_ACCOUNT_PROBE.reprobe`).
   POR / PHI / DEN still carry the only valid `bsky.app` objects; `dallasmavs` still has 2 posts and no object;
   `utahjazz` 0 posts; `orlandomagic` / `brooklynnets` are still squatted placeholders; `nyknicks` still carries
   the `impersonation` label. `nba.com` itself is verified and active; `official.nba.com`'s 2026-27 injury
   report page still answers **404**.
4. **Tests grew with the registry.** `tools/verify_reporters_test.js` names every session-15 handle
   (`SESSION_15_HANDLES`, folded into the count sum), asserts the three dormant arrivals evaluate `dormant` and
   the active ones `active` at a fixed clock, asserts the Athletic-verified row names the outlet as verifier,
   asserts the two outlet-verified rows never read as a current beat writer, and asserts **CHA and UTA are
   still gap-listed** after the additions. Refused-row count pinned 5 → 6.

**Measured coverage after session 15** (`arenaCoverageSummary()`, registry evidence):
30 teams · **18 verified-pollable · 12 bio-pollable · 0 official-only · 0 unexplained gaps** · **65 pollable
writers, 21 Bluesky-verified** · activity **46 active / 19 dormant / 0 unmeasured**, **27 teams with an active
writer**, **dormant-only: DAL, LAL, UTA**. The **same 12 teams** (ATL, BKN, CHA, CHI, DEN, IND, MIA, NOP, ORL,
SAC, SAS, UTA) still lack a Bluesky-verified writer — session 15 added *depth* to eight of them, but no row
added a verification object to a team that lacked one, so no gap was closed and none is claimed closed.

**What is still open, and why**

1. **Club corroboration is manual for 26 of 30 franchises** — re-confirmed today; nothing keyless changes it.
2. **In-arena identity ceiling.** CHA now has three registered identities (podcast analyst, culture-site
   journalist, and a refused no-bio account whose posts look like the beat) and still **no credentialed beat
   writer**; UTA now has three rows and **all three are dormant** (31 / 53 / 597 days); BKN has two supported
   accounts, neither verified. DAL / LAL / UTA stay dormant-only.
3. **The daily CI evidence file has not yet re-measured the 16 new rows** — `live-audit.yml` (09:17 UTC) will;
   until then the page prints the session-15 registry observations (all dated 2026-09-19). If CI finds a
   newer date the CI date wins; if the registry is behind, `--check` fails the job by design.
4. **Live latency remains unvalidated** until the first 2026-27 game (tip-off 2026-10-20); the impact model
   reads UNKNOWN off-season by rule R4; the official NBA adapter stays blocked on 404; X / Instagram /
   Facebook remain manual-review links.
5. **Next candidates:** a "verifier drift" check that flags when an outlet-issued verification object
   (`theathletic.com`) is revoked (`isValid:false` was seen on `joevardon` in the list read); a
   per-season beat-change watch across all rows (Hine's MIN→PHI and Todd's UTA→MIN are the pattern); the
   remaining thin teams with **one** pollable writer (ATL, MIA, SAC, HOU, MIL, PHX, POR, LAC, OKC) if a free
   corpus surfaces; and re-reading `rodboone` for a bio.

## State at the end of session 14 (2026-09-19) — read this first

Session 14 was **the reporter/verification layer**: the brief's open items were *run the audit, backfill the
registry so the page is right before the first CI run, resolve BKN / MEM / NOP writers, verify club accounts
where missing, and either read CHA / UTA / DAL / DEN / LAL / CLE or leave them explicitly gap-listed* — all
under the standing constraints that **no X API key exists** and every claim must be re-checkable by a free,
keyless call.

**What shipped**

1. **The "unmeasured" hole is closed at both ends.** New tool `tools/backfill_registry_recency.js` copies the
   measured newest-post date out of `data/live/reporter_verify.json` into each registry row's `observed`
   block, with provenance; `.github/workflows/live-audit.yml` now runs it after the live re-verification and
   then runs `--check`, which **fails the job** if the registry is behind the CI measurement. 49 of 67
   registry rows store a measured date; the 18 that do not are rows held out of collection (`feed:false`) or
   refused identities — no date is invented for them. The page now prints **identical activity numbers from
   the registry alone and from the CI evidence file** (34 active · 16 dormant · 0 unmeasured).
2. **Every pollable writer is measured.** Six `getAuthorFeed?limit=1` reads (plus four earlier in the
   session) closed the last unread rows: `joelrushnba` (DEN) ACTIVE 2 days · `andyblarsen` (UTA) 31 days ·
   `saltcityhoops` (UTA) 53 days · `nickvanexit` (DAL) 45 days · `mfollowill` (DAL) 120 days · `nolajake`
   (NOP) 458 days · `lakerssbn` (LAL) 318 days · `chrisherrington` (MEM) 5 days. Two of those newest items
   are not basketball at all and one is another user's post returned as a repost; each row records that,
   because the measurement is a fact about the **feed**, not proof that the writer still covers the team.
3. **A real defect was found by running the new tool for real.** The backfill's first version only replaced
   *quoted* dates, so a row storing the pre-measurement shape `latestPostAt: null` kept the null as a second,
   winning key — Boston's Gary Washburn still evaluated to null while every check in the repo passed. Fixed
   three ways (null-aware literal, duplicate-key repair, and a post-edit proof that asserts the **evaluated**
   value of every row it touched equals the planned date), with regression tests and a registry-wide
   invariant. See the session-14 FLAGS entry on `sources.html`.
4. **The nine named gap teams were read live, not assumed.** Ten new graded rows (`dannycunningham` CLE,
   `mfollowill` / `nickvanexit` DAL, `joelrushnba` DEN, `bgeisinger` CHA, `chrisherrington` / `nolajake` NOP,
   `saltcityhoops` / `andyblarsen` UTA, `lakerssbn` LAL) and three **refusals** kept visible
   (`miketrudell` — no bio at all; `david-locke` — motto bio, 2,553 posts; `erikslaterphoto` — an Alaska
   photographer returned by a Brooklyn search). A name match is still not an identity.
5. **A second official-club sweep.** Six more candidate handles read: four self-evident placeholders
   (`charlottehornets` 1 follower / 0 posts, `dallasmavericks` 0/0, `denvernuggets` 1/7, `losangeleslakers`
   2/0), three more `impersonation`-labelled handles (`cavs.com`, `dallas-maverick-s`, `memphisgrizzlies`) —
   and **exactly one real find**: `nuggets.bsky.social`, valid Bluesky verification created 2025-07-08.
6. **Corrections recorded rather than edited away.** The LAL blog row shipped earlier the same day claiming
   it would give the club "a feed that is not a year old"; its own measurement (318 days) disproved that, so
   the sentence was replaced and the correction written into the row.

**Measured coverage after session 14** (`arenaCoverageSummary()`, and identical with the CI evidence map):
30 teams · **18 verified-pollable · 12 bio-pollable · 0 official-only · 0 unexplained gaps** · **50 pollable
writers, 20 Bluesky-verified** · activity **34 active / 16 dormant / 0 unmeasured**, **27 teams with an active
writer**, **dormant-only: DAL, LAL, UTA**, no team unmeasured. The 12 teams short of a Bluesky-verified writer
(ATL, BKN, CHA, CHI, DEN, IND, MIA, NOP, ORL, SAC, SAS, UTA) are named as gaps on the page. The daily CI file
remains the measurement of record: **65 handles checked, 30 club channels HTTP 403, 0 fatal, 0 unreachable.**

**What is still open, and why (a limitation is not a to-do unless a free path exists)**

1. **Club corroboration is manual for 26 of 30 franchises.** No verified club Bluesky account exists to
   poll, and `nba.com/<slug>/news` answers HTTP 403 to a datacentre IP for all 30 — a fact about the request,
   not the page. Nothing keyless fixes that; the site links the page and says "manual review".
2. **In-arena identity has a ceiling.** CHA's paper of record eliminated its Hornets beat on 2026-09-14, so
   the club's only supported identity is a podcast analyst; UTA lost its writer to MIN and both remaining
   rows measure dormant; BKN has exactly one supported account (`Busy — NetsDaily`) and one refusal. A bio
   is not a credential, and this project will not upgrade one into the other.
3. **Live latency is still unvalidated** — no 2026-27 games have been collected, so in-game exit timing is a
   designed behaviour, not a measured one. Next real measurement window is the first regular-season game.
4. **The impact model reads UNKNOWN off-season** (no 2026-27 minutes/starter evidence to grade). That is the
   documented R4 rule, not a bug: no stake evidence ⇒ UNKNOWN even on a heavy road trip.
5. **The official NBA adapter stays blocked** until `official.nba.com/nba-injury-report-2026-27-season/`
   stops returning 404 (last checked 2026-09-17).
6. **X / Instagram / Facebook remain manual-review links**, with dated platform evidence for why no keyless
   read path exists (tokenless oEmbed removed 2020-10-24; IG Basic Display broken since 2024-12-04; Graph API
   needs App Review).
7. **Next candidates if the reporter work continues:** Mike Vorkunov's NBA/WNBA starter pack as a corpus for
   BKN / MEM / NOP depth, a per-season "beat change" watch (session 13's Sarah Todd finding is the pattern to
   automate further), and re-running the club-handle probe periodically in case a franchise finally issues a
   verification object.

## State at the end of session 13 (2026-09-18) — read this first

Sessions 11–12 expanded the registry (recorded in the `FLAGS` log in `assets/js/data.js`); this session was
**official club Bluesky verification + writer activity + the Instagram/Facebook read question**, still under the
standing constraint that **no X API key is available** and everything must be re-checkable by a free, keyless call.

**What shipped**

1. **The official-club question was answered by measurement, not by hope.** One keyless
   `app.bsky.actor.getProfiles` request probed **25 candidate club handles** (`NBA_OFFICIAL_ACCOUNT_PROBE`):
   **16 resolved, 9 do not exist at all** (`hawksnba`, `hornetsnba`, `chicagobulls`, `detroitspistons`,
   `warriorsnba`, `lakersnba`, `minnesotatimberwolves`, `neworleanspelicans`, `sanantoniospurs`),
   **0 carry a valid Bluesky verification object**, and **3 carry Bluesky's own `impersonation` moderation
   label** (`memphisgrizzlies`, `nyknicks`, `charlottehornetsbb`; a fourth, `dallas-maverick-s`, surfaced via
   `searchActorsTypeahead`). Fan placeholders with 0 posts (`brooklynnets`, `orlandomagic`, `houstonrockets`,
   `indianapacers`, `torontoraptors`) and unverified-but-active accounts (`okcthunder`, `sacramentokings`,
   `miamiheat`, whose profile carries `!no-unauthenticated`) are recorded with their verdicts, and the whole
   table — misses included — is rendered on `reporters.html` with the re-runnable probe URL.
2. **Five new writer rows, two refusals.** `BSKY_REPORTERS` 49 → **54**: `montepoole` (GSW, bio-verified,
   **active** — newest indexed item 2026-09-03, a repost), `bennettdurando` (DEN), `grantafseth` (DAL),
   `jasonlloyd` (CLE), `joevardon` (national, The Athletic). `bstownsend.bsky.social` and
   `jovanbuha.bsky.social` were read, did not support the identity, and are stored as
   `identityRefused: true, feed: false` with the text the API actually returned — never re-assumed.
3. **Identity is not activity — now computed.** `ARENA_DORMANT_DAYS` (30), `arenaDaysSince`,
   `writerRecency`, and a `recency` state on every team and every pollable writer in `arenaCoverage()`.
   A writer with no measured newest-post date is `unknown`, never silently `active`; a team whose writers
   are all quiet reads `dormant-only`. `data/live/reporter_verify.json` (daily CI) is fed back into the page
   so the matrix prints the CI measurement rather than the date a row happened to be written.
4. **The verifier reads moderation labels.** `profileLabels()` separates `!no-unauthenticated` (a profile
   setting) from moderation verdicts; new verdicts `impersonation-label` (fatal when the row is in the alert
   path) and `profile-private` (non-fatal, but it says the account cannot be read keylessly). The dormant
   threshold is imported from `data.js`, so there is exactly one definition.
5. **Instagram/Facebook: closed, with dated evidence.** Tokenless oEmbed was removed **2020-10-24**; the
   Instagram Basic Display API errors on **all** requests since **2024-12-04**; the Instagram API with
   Facebook Login requires an IG business/creator account linked to a Facebook Page; the Graph API requires an
   App Access Token plus the reviewable **Page Public Content Access** feature (and `appsecret_proof` since
   v5.0). Both are registered as `Blocked / not wired` sources and rendered as manual-review links only.
6. **One official row earned its place:** `sunsphx.bsky.social` (PHX) — 14,027 followers / 4,142 following,
   bio "The Official Account of the Phoenix Suns", **no verification object** ⇒ `bskyVerified: false`,
   `feed: false`, listed for manual review, never polled.

**Measured coverage after the change** (`arenaCoverageSummary()`, registry evidence only):
30 teams · **17 verified-pollable · 11 bio-pollable · 2 official-channel-only (CHA, UTA) · 0 unexplained gaps** ·
**40 pollable writers, 19 Bluesky-verified**. Activity: **5 teams have a writer who posted inside 30 days**
(GSW Monte Poole 16d · MEM Drew Hill 8d · MIN Sarah Todd 0d · PHX Gerald Bourguet 0d · SAS Jeff McDonald 23d +
Tom Orsborn 1d), **CLE / DAL / DEN have no active writer**, and **30 of 40 writers have no registry-stored
date** — printed as *unmeasured*. The daily CI file measures the whole allow-list and is the measurement of
record: the 2026-09-19T00:07Z run checked **65 handles — 50 clean, 15 dormant, 0 bio-drift, 0 missing,
0 verification-lost, 0 impersonation-labelled, 0 unreadable, 0 fatal — 38 of the 53 accounts in the alert
path active, quietest 638 days.**

**What the first CI run of the new verifier found (and what was wrong with it)**

1. **A beat change, caught with no human input.** `nbasarah.bsky.social` was flagged `bio-drift`; the live
   re-read showed the bio now names the **Timberwolves / Minnesota Star Tribune** ("Previously Jazz, 76ers and
   Warriors"), with a valid `bsky.app` object. The row moved to MIN and **UTA lost its only in-arena writer** —
   reported as a coverage loss, because inventing a replacement is not an option.
2. **`profile-private` was inferred, not measured — fixed.** It reported PHX's Gerald Bourguet unreachable
   from the `!no-unauthenticated` label alone, while a keyless `getAuthorFeed` on that handle returned two
   posts the same day (newest `2026-09-18T18:45:43Z`). The verdict now requires the keyless read to have
   actually failed; a labelled-but-readable row stays pollable with the label recorded as a standing risk.
3. **A drift verdict that fired on punctuation — fixed.** `timcato.bsky.social` read `bio-drift` while its bio
   still said the same thing; the only difference was curly apostrophes. Quote comparison now folds
   typographic apostrophes, quotes, dashes and narrow spaces.
4. **A refused row that could never stop drifting — fixed.** `jovanbuha.bsky.social` stores a note about the
   *absence* of a bio, so "quote not in bio" was true by construction. Refused rows are exempt, and the useful
   inverse check replaced it: if a bio **appears**, the row flips to drift so the identity can be re-examined.

**Tests:** smoke 222 · verify_reporters 89 · integration 80 · impact 80 · poll_fixture 25 · regression 26 groups.

**Still open / blocking**

- **CHA has no writer account at all** — the Charlotte Observer eliminated its Hornets beat on 2026-09-14
  (McClatchy cuts). A replacement in-arena identity has to be found from a live read, not invented.
- **UTA and CHA have no writer account at all**; **DAL, DEN, LAL, CLE are covered by dormant writers only**
  on the freshest CI measurement. Either find an
  active alternative or keep them explicitly labelled dormant — never quietly "covered".
- ~~Two CI rows still read bio-drift~~ **RESOLVED this session by live re-read:** `nbasarah.bsky.social` was a
  genuine beat change (row moved to MIN, UTA now gap-listed) and `timcato.bsky.social` was a verifier defect
  (curly apostrophes). The next CI run should report `bioDrift: 0`; if it does not, read the row before
  believing either number. **Confirmed: the 2026-09-19T00:07Z run reports `bioDrift: 0` and
  `profilePrivate: 0`.**
- **No verified club Bluesky account exists for 26 of 30 franchises.** Until a club verifies one, club
  corroboration on Bluesky is unavailable by construction; `nba.com/<slug>/news` returns 403 to CI for all 30.
- **Unread candidates** worth a live read next session: `daltonjohnson.bsky.social` (NBCS Bay Area, posted
  2026-09-02), `bontahill.bsky.social`.
- Confirmed absent on Bluesky (do not re-probe): Dave McMenamin, Ian Begley, Marcus Thompson, Tony Jones,
  Eric Nehm, Casey Holdahl, Kane Pitman, Brenden Nunes, Duane Rankin, Chris Fedor.
- No live-game validation is possible before the first 2026-27 tip; `roleStats` stays empty until games exist.

## State at the end of session 10 (2026-09-18) — read this first

Branch `arena/01a0b5ed-nbainjuryreport` → merged to `main`. This session's task was **expand in-arena
reporter verification** under the standing constraint that **no X API key is available**, so every added
fact comes from a free, keyless, publicly re-checkable source.

**What shipped**

1. **`BSKY_REPORTERS` 8 → 26 rows.** 18 evidence rows added, each storing the verbatim bio it was verified
   from (`evidenceQuote`), the re-checkable API URL (`evidenceApi`), the identity class (`conf`), the
   verifier domain when a Bluesky verification object existed, and the counts observed that day.
   10 rows are **Bluesky-verified** (valid object; issuer `bsky.app` or the outlet's own domain, e.g.
   `theathletic.com`), 6 are **bio-verified** (account states outlet + beat), 2 are **held out of the
   alert path** (dormant account; unconfirmed handle).
2. **Coverage is computed, not typed.** `arenaCoverage()` / `arenaCoverageSummary()` in `assets/js/data.js`.
   Measured: 30 teams · **10 verified-pollable · 7 bio-pollable · 13 official-channel-only · 0 unexplained
   gaps · 18 pollable writers (10 Bluesky-verified)**. The 13 official-only teams are named as gaps in the
   UI: BOS, BKN, CHA, CHI, DAL, DEN, GSW, HOU, LAL, MEM, NOP, NYK, OKC.
3. **Eight previously-empty teams now have rows** (CLE, DET, MIL, MIN, PHI, POR, SAC, WAS). The old matrix
   had printed a green "✓ In-arena live coverage" badge for teams whose only row was a byline citation.
4. **Official club channels are a first-class layer**: `nba.com/<slug>/news` for all 30, generated from the
   team registry. Verified live for CLE; the other 29 are labelled "pattern, not re-read this session"
   until the verifier checks them.
5. **`tools/verify_reporters.js`** re-runs the exact API call each row cites (bio + verification object +
   newest post) plus all 30 club channels. **Fatal**: a handle that stops resolving, or a claimed
   verification object that disappears. **Recorded, not fatal**: bio drift and dormancy, in
   `data/live/reporter_verify.json`. Daily in `live-audit.yml`; `tools/verify_reporters_test.js` pins every
   verdict branch offline (37 checks).
6. **Tests**: smoke 209 · integration 71 (now boots the reporter page too) · verify_reporters 37 ·
   impact 80 · poll fixtures 24 · regression 26 groups · Python 26 · replay check.

**The verifier earned its keep on its first live run (2026-09-18T19:21Z / 19:27Z, GitHub runner)**

The job was written to keep the identity layer honest; it found four real problems before the session
ended, none of which a human had noticed:

1. `theathletic.com`'s OWN Bluesky verification object is now **invalid** (`isValid: false`), while
   the staff objects it issued are still valid and its `trustedVerifierStatus` is still `valid`. The
   row that claimed otherwise was written on 2026-09-17 — corrected, with the narrow scope recorded.
2. **All 30 club `/news` pages answer HTTP 403 to the runner** (200 to a browser-shaped client the
   same day), so the club layer is a manual-review link, never a machine-read feed.
3. Measured dormancy: `dallasmavs` newest post 2023-05-05 (1,231 days) *and* no verification object →
   taken out of collection as well as out of alerts; `trailblazers` 308 days; `clevelandcavaliers`
   and `basketball-reference` zero posts; reporters `kellyiko` 99 days, `ejelite1` 45.
4. The collector's self-audit failed on a legitimate post because the audit carried its own
   hand-copied phrase list; the rule now lives once (`SOCIAL_OUT_LANGUAGE_RE`) and the failure
   message names each violation instead of being truncated to its first line.

Final state of the job: 34 checked · 27 ok · 0 bio drift · 0 missing · 0 verification-lost · 0 fatal.

**Three identities were refused rather than assumed** — and each refusal is a task for next session:
a dormant Heat account (newest post 2024-12-11), an unconfirmed 76ers handle whose bio names no outlet,
and an "Eric Nehm (mirror)" account carrying the literal handle `handle.invalid`. Also recorded: a
doppelgänger "Brad Rowland" account, and team-name handles on Bluesky squatted by non-club accounts
(`cavaliers.bsky.social` is a Sapporo food blogger).

**Next session, in priority order**

1. **Close the 13 official-channel-only teams.** The method that worked here, per team: exact-name
   `searchActorsTypeahead` → `getProfiles` → require outlet+beat in the bio or a verification object.
   Confirmed absent this session (do not re-probe): Dave McMenamin, Ian Begley, Marcus Thompson, Tony Jones,
   Eric Nehm, Casey Holdahl, Kane Pitman, Brenden Nunes, Duane Rankin, Chris Fedor. Next candidates by
   outlet: Jay King (BOS), Erik Slater (BKN), Roderick Boone (CHA), K.C. Johnson (CHI), Ryan Blackburn /
   Vinny Benedetto (DEN), Dalton Johnson / Monte Poole (GSW), Lachard Binkley (HOU), Mike Trudell /
   Dan Woike (LAL), Drew Hill (MEM), Christian Clark (NOP), Fred Katz (NYK), Clemente Almanza (OKC).
2. **Verify the 29 unread club channels** — the first `live-audit.yml` run does this automatically; check
   the artifact for 403/JS-only pages and decide whether they need per-site handling or a labelled
   "no first-party channel read" state.
3. **Run the identity verifier for real and read the drift report.** Expect `no-quote` on the 8 legacy
   rows: backfill their quotes from the same API so the whole registry becomes uniformly re-checkable.
4. **Start the forward accuracy ledger properly.** With 18 writers across 17 teams, the first games
   (preseason 2026-10-03, opening night 2026-10-20) finally produce measurable "who reported it first"
   evidence. Until then every score is `not established`, and the page says so.
5. **In-arena attendance evidence** remains unproven for every row: a beat assignment is a claim. A real
   test would compare a reporter's post timestamp against the arena's own play-by-play for the same game.
6. **Official NBA injury report** for 2026-27 is still 404 (`data/live/official.json: health unavailable`).
   Re-check at season start; that page is the only free source that can confirm a designation officially.

## State at the end of session 9 (2026-09-18) — read this first

Branch `arena/01a0b254-nbainjuryreport`. This session built the **lineup-impact intelligence layer v2**
(the thing the brief calls "an intelligence layer that defines what a high lineup impact is") and closed
two real defects found while reviewing it. Everything below is verified locally: **197 smoke · 69 impact ·
52 integration · 24 poll fixtures · 26 regression groups · 26 Python tests · replay check 75 rows / 12 posts,
no invariant violations.**

1. **`assets/js/geo.js` (new) — the travel half of the model, and it is honest about being a model.**
   41 city rows cover all 30 NBA home cities plus long-standing and newly observed venues (asserted by
   `tools/impact_test.js`). The list is not a guess: the first schema-3 CI run reported four unresolved
   venue cities, and each was a real city on the published schedule — Inglewood, CA (the Clippers'
   Intuit Dome, whose feed identity says Los Angeles), Boulder, Ames and Tulsa (neutral pre-season
   sites) — so each earned a row. A venue whose address arrives EMPTY (observed: "Venetian Arena")
   is resolved from the venue NAME and marked `venueNameResolved: true` so the weaker provenance
   reaches the UI. Verified against the live snapshot: **14 of 14** previously unresolved rows resolve.
   Every capture carries `geoModel = Geo.MODEL_VERSION`, so a schedule cached under an older city table
   is re-collected instead of being served forever — the deployed board kept printing "travel withheld"
   after the table was fixed, because the 6-hour cache could see age but not provenance. Distances are
   cross-checked against published values; great-circle distances
   cross-checked against published values (Boston→Los Angeles 2,591 vs ~2,611 mi, Chicago→New York 711 vs
   ~713); IANA time-zone offsets read from the runtime database per game date (winter ET −5 / PT −8 /
   Phoenix −7, summer ET −4), so DST is data, not a hard-coded table; `restDaysBetween` returns 0 for a
   back-to-back. Travel time uses a documented model (450 mph cruise + 2.0 h airport overhead; ground under
   250 mi at 45 mph) and every surfaced number says "city-to-city" or "model". An unknown venue city yields
   `unmappedCity`, never an approximation.
2. **`tools/collect_context.js` → schema 3.** Adds a per-team schedule capture (next 7 games plus the last 2,
   with venue city/state, rest days, city-to-city miles, hours and time-zone shift) plus per-player
   production aggregates (points/assists/rebounds/on-court +/− over the games this project actually fetched,
   keyed by stat NAME so a reordered ESPN key list cannot shift columns) and per-team scoring baselines.
   Box-score rows are deduped by event id and the backfill now orders candidates by each game's own date.
3. **`assets/js/role.js` — impact model v2.** `score = 0.6·STAKE + 0.2·EXPOSURE + 0.2·RECURRENCE`,
   renormalised over whichever components have evidence, with the coverage fraction printed. STAKE: minutes,
   start share, the player's share of his team's own collected scoring, assists, and a ±8-point bounded
   on-court +/−. EXPOSURE: games in the next 7 days, back-to-backs, road games, travel miles, time zones.
   RECURRENCE: dated ESPN roster listings and reported in-game exits. Grades HIGH ≥ 65, MEDIUM ≥ 40, else LOW,
   plus R1–R4 (R4: no stake evidence ⇒ UNKNOWN even on a 4-in-6 road trip — schedule load alone can never
   produce HIGH). Game-time decisions additionally get a separate **availability-risk** reading.
4. **Two real defects found and fixed while verifying (both pinned by tests):**
   a. *Alert escalation read only one impact shape.* `AlertEngine.impactGrade`/`offenseTier` understood the
      social layer's full assessment but not the board's flattened clone, a bare grade string, or a flattened
      archive row; and the **official NBA layer and the in-game monitor were firing without any impact
      attached at all**. An official "Out" for a starter, or an in-game listing for a top option, arrived with
      the ordinary chime. Fixed in `assets/js/alerts.js` (all four shapes), `injuries.js` (grade/offenseTier/
      score on board alerts), `intelligence.js` (official designations) and `ingame.js` (game listings, never
      DNP rows). `tools/smoke_test.js` now pins every shape, `tools/impact_test.js` pins the producer wiring.
   b. *The box-score backfill was biased.* `collect_context.js` built an unused ordering map from one
      arbitrary team and then took the last 12 candidate ids in TEAMS order — so the "most recent games"
      sample favoured whichever teams sat last in the list. Extracted to a tested `recentBackfill()` that
      sorts by each game's published date.
5. **New permanent test surface: `tools/impact_test.js` (69 checks)** — geo distances/time zones/rest/model,
   keyed stat parsing, per-event dedupe, team baselines, schedule→travel chain, the whole grade matrix
   (incl. R1–R4 and both cross-checks on the same player: Out vs Questionable), plus a wiring audit asserting
   **every `getElementById` in the shipped modules resolves to an id in `index.html`** and that the board
   renders before the alert center and wire.
6. **Board-first layout + live UI wiring finished.** `renderImpactWatch()` is now called from `render()`;
   `app.js` binds the new high-impact sound-test button and the impact filter tabs; new CSS for the
   watchlist, offense/risk tags and model lines; `intelligence.js` hands the model the schedule and
   team-production captures and rewrote the on-page legend to describe the real formula.
7. **Registry regenerated:** `node tools/build_verified_sources.js` → **25 sources / 44 flags** (two new
   verified sources: the ESPN team-schedule API and the city-coordinate travel model, both with what-it-is /
   what-it-is-NOT wording).

**Third defect, found by reading the live snapshot after the merge:** five clubs are stored by region
name in `data.js` (`GSW` "Golden State", `IND` "Indiana", `LAC` "LA", `MIN` "Minnesota", `UTA` "Utah").
That is right for identity and URLs and wrong as a location, so the travel-origin fallback returned null
and **every time-zone shift for those five teams was silently dropped** (live 02:52Z snapshot: all
Golden State `tzShiftHours` null). `Geo.TEAM_HOME_CITY` now supplies the real city for geography only,
and `tools/impact_test.js` asserts every one of the 30 clubs' home cities resolves with a time zone —
loading the real registry from `data.js` rather than a copy. (The first version of that test helper read
an empty VM registry and passed vacuously; it now throws instead.)

Facts a new session can rely on (in addition to session 8's):
- The impact model is **lineup impact, never medical severity** — that phrase appears on the board, the
  legend and every factor label, and `tools/impact_test.js` fails if a result starts claiming a medical grade.
- `data/live/context.json` on disk is still **schema 2** until `injury-watch.yml` runs the new collector;
  `role.js` discloses that in a note ("schema 2 … components dropped and disclosed"), so a schema-2 file
  degrades to v1 behaviour instead of guessing. First CI run after merge upgrades it to 3.
- `assets/js/geo.js` is only loaded by Node tooling, deliberately: the browser reads the collector's derived
  numbers from `context.json` instead of recomputing geography per page load.

### Still open after session 9 (unchanged blockers)
- **X / Instagram / Facebook live reads** — no authorized free connector; embeds + search links remain manual
  review only and never feed alerts (documented in `sources.html`, `AUDIT.md`, FLAGS).
- **Bluesky keyword search** is 403 unauthenticated; the layer works per-account from an allow-list.
- **Official 2026-27 injury-report page** was 404 on 2026-09-17; the collector tries current then prior
  season and never guesses PDF URLs.
- **Live-game validation** cannot happen before the first tip (2026-10-03, Heat @ Raptors per the schedule
  capture). In-game latency, exit detection and the QTR path remain fixture-verified only.
- **Closed-tab push** does not exist (browser open-tab alerts only), and GitHub scheduled runs are
  best-effort — ten-minute polling is not a low-latency guarantee.
- **Real geographic precision** would need arena coordinates and charter data, neither of which is free;
  the model is city-centroid by design and labelled as such.

## State at the end of session 8 (2026-09-17, ~23:30Z) — read this first

Shipped on branch `arena/01a0b196-nbainjuryreport`: **the deployed page, audited line by line, with its one
rendering defect fixed and three stale limitation claims corrected.** This session re-read every module in
`assets/js/`, every page, the workflows and the committed data files, and — critically — read the LIVE rendered
output of the deployed GitHub Pages site instead of trusting that the code and the page agree.

1. **Real defect found and fixed: the lineup-impact legend printed `undefined` on the deployed site.**
   The rendered page showed "needs at least **undefined** collected games". Cause: `assets/js/intelligence.js`
   interpolated `${c.minGames}` while `LineupImpact.CONFIG` (role.js) only exposes `minGamesForRole`. Fixed by
   reading the real key, and pinned by a new smoke check that renders the legend template against the actual
   CONFIG and fails on any missing key or any `undefined` in the output (verified: the new check fails on the
   pre-fix code, 188/189; passes on the fix, 189/189). Recorded as a session-8 FLAGS entry.
2. **Three stale limitation claims in sources.html corrected to match verified state.** The "CORS unproven"
   item now records the resolution (deployed origin fetched both endpoints directly — re-confirmed this session),
   the "poller has not run yet" item now records that it runs on schedule with the best-effort caveat, and
   roadmap item 1 is marked done with the standing "keep the evidence current" follow-up. `tools/build_verified_sources.js`
   and the regenerated `data/verified_sources.json` carry the same corrected wording (flags 38 → 39).
3. **Live re-verification this session (assistant page-fetch channel, ~23:03–23:15Z):** ESPN injuries API **200**
   (2026-27 Preseason, per-team blocks, sampled Mouhamed Gueye ATL fractured foot with Brad Rowland byline) ·
   ESPN news API **200** (top items dated 2026-09-17 22:19–22:43Z, incl. Shams Charania Pelicans/Bey item) ·
   Bluesky `getProfile?actor=nba.com` **200** (valid verification, 122,589 followers, 6 follows, Oct 20 opener
   in bio) · deployed page **live** (board 75 listings via espn-direct, coverage gaps CLE/DET/LAL named with
   per-team links, news OK 50 articles, scoreboard OK 0 events — offseason).
4. **Everything else re-verified green locally:** 189 smoke · 52 integration · 24 poll fixtures · 26 regression
   groups · 26 Python tests · replay check 75 rows / 12 posts, no invariant violations. Registry counts
   recomputed and confirmed: 30 teams · 23 sources · 56 reporters (25 verified-handle, 20 citation-verified,
   4 outlet-only, 1 retired, 1 inactive) · 8 Bluesky reporters · 7 official/outlet accounts · 39 flags.

Facts a new session can rely on (in addition to session 7's):
- The deployed page renders correctly except where a future edit reintroduces a bug — the new legend check plus
  the browser test (`node tools/browser_test.js`) are the guards.
- `data/verified_sources.json` is regenerated from `assets/js/data.js` by `node tools/build_verified_sources.js`
  after any registry change (session 8 added a flag and corrected the CORS notes; it was regenerated).
- The two remaining "human check" items from the old limitations list are DONE (CORS proven on the deployed
  origin). The genuinely open blockers are unchanged: X/IG/FB free reads, Bluesky keyword search, official
  2026-27 report page (404 until rollover), live-game validation (first tip 2026-10-03), closed-tab push.

## State at the end of session 7 (2026-09-17, ~21:30Z) — read this first

Shipped on branch `arena/01a0b126-nbainjuryreport`: **the audit tool audited.** Session 6 fixed the test harness so a dead
assertion could not hide; session 7 pointed the same suspicion at the runner audit — the only component that independently
re-reads the 18 URLs this sandbox cannot reach. Four of its checks were wrong, each printing a confident wrong number while
the job stayed green.

1. **`tools/verify_live.py` — four defects, all fixed and all now unit-tested (`tools/test_verify_live.py`, 22 assertions).**
   - `bluesky-list` requested `?user=<handle>&list=<bare DID>`. Neither is valid for `app.bsky.graph.getList`, so it was
     answered **HTTP 400 on every run** and the 150-member writers list was never re-verified; the verdict read like "the
     list may have moved". Now requests `list=<AT-URI>` read out of `data.js` at run time (so the audited and published URLs
     cannot drift) and was live-verified the same day: **200, listItemCount 150**.
   - `verifiedFollows` counted `verification.verified`, a field Bluesky does not return → **always 0**. Real fields are
     `verification.verifiedStatus` / `verifications[].isValid`; live read: 6 follows, **4** with valid objects.
   - The roster check read `data['team']['roster']['entries']`; ESPN carries `athletes[]` at the **top level** (re-read live:
     response timestamp 2026-09-17T21:00:13Z), so even a 200 would have reported `athletes: 0`.
   - The verdict ladder printed **OK** whenever 200 was merely *tolerated* by `expect` — so `espn-scoreboard`,
     `espn-roster-mia` and `espn-teams-mia`, all 403 and having read nothing, all printed OK. Each check now declares
     `verifiesOn`, every row carries an explicit `verified` flag, `OK` means verified, and the summary reports
     `verifiedByThisRun`. The CAPABILITY-DRIFT tripwires are unchanged.
2. **Team-coverage gap is now stated on the board** (`InjuryBoard.coverageGaps` + `#boardCoverage`). The committed
   2026-09-17 snapshot carries **75 rows in 27 of 30 team blocks — CLE, DET and LAL absent**. The board names every absent
   team with a link to its own ESPN injuries page and states that an omitted block is not clearance; a 30/30 snapshot still
   denies clearance; an empty snapshot makes no per-team claim.
3. **`sources.html` audit panel** now shows per-row `claim verified` / `claim NOT verified by this run`, an
   `N/M claims verified by this run` counter, the roster read path, the list member count, and relabels `verifiedFollows`
   as "with a valid verification object".
3b. **The stylesheet had drifted from the markup in three panels** (`assets/css/style.css`). `wire.js`, `social.js` and
   `injuries.js` emit `sev-border-<sev>` but the CSS only had `.wire-item.sev-<sev>` / `.post.watch`, and `.board-row` had
   no left border — so the severity edge never rendered anywhere and an OUT item looked like a cleared one. `class="good"`
   / `class="bad"` had no bare rule either, so "✖ refresh failed — alerts paused" printed in body colour. Fixed, and seven
   smoke assertions now pin every status class the modules emit (each verified non-vacuous against the pre-fix stylesheet).
4. **Live re-verification (~20:55–21:05Z):** 2026-27 official page still **404** (`XID: 74717976`) · `getList` AT-URI form
   **200/150 members** · `getFollows(nba.com)` **200**, 6 follows, 4 valid objects, DAL unverified, `bsky.app` a *trusted
   verifier* not a verified account · ESPN `injuries?team=mia` **200** (payload timestamp 17:01:02Z, 2026-27 Preseason) ·
   ESPN `/teams/mia/roster` **200** with top-level `athletes[]` · committed snapshot 75 rows / 27 blocks / 13-of-13 accounts
   / `errors {}`.
5. **A suspected defect that was NOT a defect, recorded so nobody re-investigates it:** `Social.check`'s unbraced
   `if (!res.error) posts = …; accounts = …; error = res.error;` looks like it swallows a failed fetch. Reproduced with a
   harness that fails every request: the statements run sequentially, `error` is assigned, and the panel renders
   "✖ social layer unavailable". No change made.

Facts a new session can rely on:
- Test surface: **188 smoke · 52 integration · 24 poll fixtures · 26 regression groups · 26 Python · live replay 75 rows /
  12 posts.** If a number drops after editing a closure, suspect the harness, not the code.
- `data/audit/latest.json` was regenerated by the runner at **21:22Z with the fixed tool**: 22 checks, 0 drift,
  `verifiedByThisRun: 16`, `notVerifiedByThisRun: 6` (four ESPN API calls fingerprinted to 403, two ESPN HTML pages returning the 202 bot-challenge interstitial).
  `bluesky-list` is 200/150 members and `verifiedFollows` is 4. Read the `verifiedByThisRun` counter, not just "no drift".
- **Never run `tools/verify_live.py` in a sandbox with no HTTPS egress** — it would overwrite committed evidence with 22
  `UNREACHABLE-FROM-RUNNER` rows. It is a runner job (and `workflow_dispatch`).
- Same time gates as session 6: `roleStats` fills from the 2026-10-03 preseason tip; the 2026-27 official page is expected
  around early October; the CI audit tripwire (`CAPABILITY-DRIFT`) fires the moment it goes live. **New:** after 2026-10-03,
  check whether CLE/DET/LAL (or any team) is still missing a board block *while games are live* — that would be a
  source-coverage problem, not an offseason artefact.

## State at the end of session 6 (2026-09-17, ~19:00Z) — read this first

Shipped on branch `arena/01a0b0ba-nbainjuryreport`: the **test-harness integrity fix of the project**, four dated registry re-validations (incl. closing the Fischer outlet dispute), and three lineup-impact refinements that were on this list.

1. **Dead test closures revived (`tools/smoke_test.js`) — the single most important fix this session.**
   `check(name, () => {…})` accepted the closure as truthy and never ran it: 6 grouping closures / 12 inner
   assertions in the lineup-impact section had NEVER executed while the suite reported all-green. The harness now
   executes closures honestly. Moment it was fixed, one previously-dead assertion went red for real: `role.js`
   never disclosed a schema-unmarked context file (and neither `intelligence.js` nor the poller even passed
   `schema` through). Implemented end-to-end; the assertion is now green because the disclosure exists.
2. **Registry re-validation with dated evidence:** Jake Fischer → **The Stein Line ("The People's Insider")**,
   resolved by quoting the outlet's own Substack byline fetched live (post dated 2026-04-08) — the DISPUTED flag is
   closed; Chris Haynes → Amazon Prime (FOS 2025-09-29); Candace Buckner → The Athletic national columnist
   (Sports Media Watch + TheWrap, both 2026-02-26); Will Guillory → The Athletic Rockets + Pelicans staff writer.
   A smoke assertion now fails on any silent DISPUTED outlet. `data/verified_sources.json` regenerated (30/23/56/36).
3. **Impact refinements (were §5 "Remaining"):** median per-game minutes quoted next to the mean with a
   blowout/divergence disclosure (collector keeps bounded `minutesValues`); a **team-change flag** when the
   collected sample belongs to a previous team; and a **named** "no contract entry" state (two-way/expired/
   unpublished — the source does not say which) instead of silence.
4. **Live re-verification (~19:00Z):** 2026-27 official page still 404 · 2025-26 rules page intact verbatim ·
   ESPN injuries 200 with the same schema · nba.com Bluesky verification still valid (followsCount 6) ·
   searchPosts still 403 · Basketball Monster status tags confirmed present in server HTML (settles the
   third-pass retraction question).

Facts a new session can rely on:
- Test surface is now honestly reported: **165 smoke** · 48 integration · 24 poll fixtures · 26 regression groups ·
  4 Python · live replay 74 rows / 12 posts. If a smoke number ever *drops* after editing a closure, suspect the
  harness, not the code.
- Same time gates as session 5: `roleStats` fills from the 2026-10-03 preseason tip; the 2026-27 official page
  is expected around early October; the CI audit tripwire (`CAPABILITY-DRIFT`) fires the moment it goes live.

## State at the end of session 5 (2026-09-17) — read this first

Shipped on branch `arena/01a0b045-nbainjuryreport`: Session 5 enhancements covering real-time in-game alerting, Basketball Monster-style quick search and status filtering, lineup impact alert propagation, and verified reporter directory subpage upgrades.

**Key enhancements and defect fixes:**
1. **Lineup impact alert propagation (`assets/js/alerts.js`, `assets/js/social.js`, `assets/js/app.js`):**
   Fixed property mismatch where `alerts.js:fire` checked `item.impact.tier === "high"` (which was undefined because `LineupImpact.assess` sets `out.impact = "high"` and `out.role.tier = "starter"`). Alerts now check `(item.impact.impact === "high" || item.impact.tier === "high")` and prepend `⚡ HIGH LINEUP IMPACT` to the alert label and log. Attached lineup impact assessments directly to social post alerts and classified news wire items whenever an NBA player is identified. Pinned with new regression checks (26 total passed).
2. **Basketball Monster-style Injury Board toolbar (`index.html`, `assets/js/injuries.js`, `assets/css/style.css`):**
   Added an instant search bar (`#boardSearch`, `#boardResetFilter`) and quick status filter tabs (`#boardStatusFilters`) with live count badges for `All`, `🔴 OUT`, `🟠 Doubtful`, `🟡 Questionable / GTD`, `🟢 Probable`, and `🔵 Return / Good` directly above the structured injury board. Users can filter by player name, injury detail, or status in real time.
3. **Live ongoing game injury alerting (`assets/js/ingame.js`):**
   Updated `InGame.extract` so that in-game injury designations from live ESPN summaries (status Out, Questionable, Doubtful, or in-game exit notes like "questionable to return", "locker room") are alert-eligible (`alertEligible: true`), fulfilling the requirement to alert on players injured during ongoing games while keeping pre-game DNP scratches alert-ineligible.
4. **Reporter directory subpage categorization & 30-team matrix (`reporters.html`, `assets/js/reporters.js`):**
   Added interactive Category Filter Tabs (`All Directory`, `Official League & Team`, `Lead Insiders (Tier 1)`, `In-Arena Beat Writers (30 Teams)`, `Cited Wire Bylines`, `Others & Review`), an In-Arena Live Exit Reporting capability column and filter (`#inArenaFilter`), and a dedicated **30-Team In-Arena Coverage & Live Exit Intelligence Matrix** card (`#matrixCard`, `#arenaMatrixTable`) showing each franchise's verified beat writer, outlet, courtside exit tracking status, profile link, and manual verification link.
5. **Sound test visual feedback (`assets/js/app.js`):**
   Added button state feedback (`🔔 Playing chime…` / `⚠ Audio unavailable`) when `#testSound` is clicked, providing immediate confirmation alongside WebAudio chime playback.
6. **Registry text synchronization:**
   Corrected outdated "NOT yet executed by GitHub" text in `assets/js/data.js` and regenerated `data/verified_sources.json`.
7. **Test suite passing:**
   All 147 unit tests (`smoke_test.js`), 26 regression groups (`regression_test.js`), 48 integration/runtime/wiring checks (`integration_test.js`), 24 end-to-end poll fixture tests (`poll_fixture_test.js`), 4 Python unit tests, and post replay checks pass with 0 errors.

Facts a new session can rely on:
- Live site: https://buffedlizard55-lab.github.io/NBAInjuryReport/
- Directory: https://buffedlizard55-lab.github.io/NBAInjuryReport/reporters.html
- `data/live/context.json` is schema 2; box-score role stats will accumulate once the 2026-10-03 preseason tips.
- The 2026-27 official injury report landing page is expected around October 2026; until then, the last verified page (2025-26 rules) is linked and the 404 is tracked by the runner audit.

## State at the end of session 4 (2026-09-17, ~14:50Z)

Merged to `main`: session-4 pass — full line-by-line re-read of every shipped file, four direct live re-verifications
(2026-27 official page still 404; 2025-26 rules text verbatim; injuries feed identical schema; nba.com Bluesky verification
still valid with `followsCount` 6), one real defect fixed, two cosmetic/stale defects fixed.

**The defect that mattered:** social alert eligibility was keyed on the Bluesky *verification object* alone, so four of the eight
allow-listed reporters (McDonald, Orsborn, Haberstroh, Hollinger) could never sound an alert despite recorded identity evidence.
Now: reporters qualify on recorded evidence (the same standard the directory uses), official team accounts still require the
verification object (the flagged `dallasmavs` account stays silent), the feed shows ✓ vs ◐-evidence badges, and the evidence
ledger stores both fields. Pinned by two new regression groups — 23 total. Also: missing `.tag.ok/.warn/.gtd` CSS added (verified
posts and unverified posts used to look identical), and the stale "poller never ran on GitHub" text in the registry generator fixed
+ `data/verified_sources.json` regenerated.

Facts a new session can rely on:
- Everything green on `main`: `Tests` (incl. Chromium suite), `injury-watch`, `Public source audit`, `Deploy dashboard`.
  The session-4 push re-triggered the runner audit over all 22 checks; read `data/audit/latest.json` first — it is the independent
  re-verification of the 18 URLs the build sandbox cannot re-fetch.
- `data/live/context.json` is still schema 2 with empty `roleStats` — **nothing fills until the 2026-10-03 preseason tip.**
  First acceptance check after tip: `roleStats` gains entries, a starter's OUT alert renders `HIGH IMPACT` + `⚡` prefix, and an
  in-game exit alert from a monitored account carries the post link (and, since session 4, can come from a reporter with evidence
  but no verification object).
- The official report page is expected to exist around the season start (~Oct 2026). The moment
  `https://official.nba.com/nba-injury-report-2026-27-season/` returns 200 with timestamped PDF links, the runner audit fails with
  CAPABILITY-DRIFT **by design** — that is the tripwire. Then: parse the first real report (the April 12 2026 fixture proves the
  parser handles the current layout), confirm every row, and let `Intelligence.officialAlerts` do its job.

## State at the end of session 3 (2026-09-17, ~05:26Z)

Merged to `main`: PR #8 (lineup-impact layer, alert-freshness fix, CI trigger fix, registry re-verification, 20 citation-verified
reporter rows, rewritten source audit) and PR #9 (three claims the first audit run disproved, corrected in place).
Everything below is green on `main`: `Tests` (including the extended Chromium suite), `injury-watch`, `Public source audit`,
`Deploy dashboard`. Deployed: https://buffedlizard55-lab.github.io/NBAInjuryReport/ — rows currently read `IMPACT: UNKNOWN`
with real salary/cadence lines, because `roleStats` is empty until the 2026-10-03 preseason tip. That is correct behaviour.

Facts a new session can rely on without re-deriving:
- `data/live/context.json` is schema 2: 30 rosters, 559 players, 54 with dated injury listings, 0 collector errors.
  `data/live/latest.json` publishes impact fields on 74/74 rows. Both are written only by CI — never hand-edit them.
- The repo's own runner audit (22 checks, no drift) is committed to `data/audit/latest.json` and rendered on the sources page,
  with a per-check `meaning` line. Verdict vocabulary: `CAPABILITY-DRIFT` (fails the job), `DOCUMENTED-BLOCKER`, `ENV-BLOCKED`,
  `OK-PAGE-CHANGED`, `UNREACHABLE-FROM-RUNNER`, `TOOL-ERROR`.
- ESPN refuses *this Python client* (403 on `site.api.espn.com`, 202 with empty body on `www.espn.com`) while Node on the same
  runner and a browser on the deployed origin succeed. Do not generalise a blockage into "the source is down"; do not spoof
  browser headers to make the audit greener.
- Branch hygiene: this session's branch is written by the collector bot, the audit bot and the human at once. Pushes will be
  rejected occasionally; `git fetch` + rebase (or merge with `-X theirs` for `data/**`, which CI owns) is the fix, and the
  commit steps now do exactly that.

The single most valuable next action is **time-based, not code-based**: after 2026-10-03, confirm `roleStats` starts filling
from box scores, that a starter's OUT alert renders `HIGH IMPACT` + the `⚡` log prefix, and that an in-game exit alert carries
the post link. Until then the impact layer is structurally tested but empirically unexercised — say so rather than implying otherwise.

## 1. Establish a genuinely live official injury stream

- Inspect NBA season-report delivery when the current-season page exposes report links. Current result: 2026–27 page 404; prior season HTML has no timestamped injury PDF links.
- Do not guess a report timestamp or present a historical PDF as current.
- Add several dated official fixtures: report rollover, amended status, multiple game dates, not-yet-submitted teams, new PDF layout.
- Acceptance: an actual newly published report is discovered automatically, every player/game row matches the PDF, its source timestamp is preserved, and a later official OUT update triggers one source-linked alert.

## 2. Measure real game-time behavior, then improve latency

- Record actual ESPN scoreboard, summary and official NBA live-data responses during a game; preserve source/observed timestamps and HTTP errors.
- Verify explicit injury exit, questionable-to-return, returned-to-game and out-for-remainder signals. A DNP row is never sufficient.
- Evaluate [Bluesky Jetstream](https://docs.bsky.app/blog/jetstream) with a DID allow-list, reconnect cursor and outage accounting. Its existence is not proof of adequate NBA reporter coverage.
- Run an always-on collector with durable storage if seconds-level latency is required. GitHub scheduled jobs and static Pages cannot provide that guarantee.
- Acceptance: measure median/p95 publication-to-observation-to-alert latency on real events; don't substitute poll interval for measured latency.

## 3. Harden player and reporter identity (partly advanced 2026-09-17: 20 directory rows now carry verbatim injury-feed citations, corrected outlets and cleared flags; session 4 made alert eligibility evidence-based for reporters)

- Revalidate each legacy directory row using outlet bios and official outbound account links; flag employment/handle changes and retired/inactive accounts.
- Pin account DIDs, retain dated verification evidence and stop trusting an account if identity changes. Explicitly separate official team, outlet-verified reporter, community-listed and unverified.
- Build an all-30-team coverage matrix with actual reachable accounts, recent posting activity and gaps. Do not infer attendance at a game from a beat assignment.
- Reconcile ESPN roster IDs across transfers/duplicate names; keep nicknames and ambiguous multi-player posts pending until resolved safely.
- Acceptance: 30 recently retrieved rosters or visible per-team failures, every eligible alert names exactly one supported NBA player, and every reporter identity has re-openable independent evidence.

## 4. Finish game-specific reliability scoring

- Expand automatic ledger beyond exact-name/single-player statements with conservative, tested claim extraction and a human-review queue for ambiguity (collection itself stays automatic).
- Preserve post edits/corrections/deletions and immutable per-observation evidence.
- Match claims to a specific game and claim time, not simply a later season-level injury row.
- Establish independent outcomes for QTR and exits. Absence of an update is not wrong; a later status change need not contradict an earlier report.
- Publish resolved sample size, coverage, abstention rate and uncertainty before any accuracy score. Keep “first observed among monitored sources” separate from global first-to-report.
- Historical backtesting requires obtainable, permitted original posts and contemporaneous outcome evidence. Until then, collect forward and label unknown.

## 5. Role/impact and injury history — first pass SHIPPED 2026-09-17, refinements remain

Shipped: `assets/js/role.js` (`LineupImpact`) separates four things that are usually conflated —
**availability** (the source's status), **lineup impact** (how much production the absence vacates, computed only from evidence this project
collected), **listing cadence** (dated history of ESPN injury listings = recurrence indicator) and **contract cost of the vacated minutes**.
Config is one object (`minGames 3`, `starterShare 0.6`, `rotationMinutes 18`, `benchMinutes 10`, `roleFreshMs 45d`, `rosterFreshMs 48h`) and every
label states which evidence produced it. `tools/collect_context.js` (schema 2) accumulates per-player starter/minutes observations across runs
with a dedupe key so one game is never counted twice; `tools/build_intelligence.js` publishes `exits` (latest reported in-game exit per player,
status `reported-unconfirmed`), and the board, alerts, history table and CI snapshot all carry the impact observation.
**Medical severity is not computed and no code path may add it**: no free source re-read on 2026-09-17 publishes a clinical grade.

Remaining:
- Backfill is impossible without games: `roleStats` stays empty until the 2026-10-03 preseason tip. First acceptance check is therefore *"IMPACT UNKNOWN
  is displayed for most rows in October, and starts filling in as box scores are collected"* — not a populated column on day one.
- Depth charts exist only as HTML (`espn-depth-chart-page` records the probed-and-rejected JSON routes). To use them: capture a real fixture,
  write a parser that fails closed on layout change, keep it as corroboration only. Never scrape blind.
- ~~Team-change note~~ **SHIPPED session 6**: when the accumulated sample's team differs from the listing's team, the assessment sets
  `role.teamChanged`, names both teams and shows "⚠ sample collected with previous team" on the board. Still open: reconciling `playerId`
  drift on trades at the *collector* level (re-keying history when ESPN issues a new roster entry).
- ~~Missing contract entry~~ **SHIPPED session 6**: `contract.missing` + "ESPN's roster feed filed no contract entry … (two-way, expired or
  unpublished; the source does not say which)" is now explicit instead of silence.
- Add recurrence corroboration across seasons (same body part twice) **only** if listing history is retained long enough; today `injuryEntries`
  is capped at 8 per player and 270 days of listing recency, and first observation must never be presented as injury onset.
- ~~Median minutes~~ **SHIPPED session 6**: the collector keeps bounded per-game `minutesValues`, `role.js` quotes the median next to the mean
  and discloses a wide divergence ("blowout-heavy or injury-shortened sample"). Still open: trimming outliers (e.g. <8 min games for
  DNP-return/injured-exit artifacts) once real games show how often they occur.

## 6. Delivery, storage and operations

- Add opt-in Web Push/Discord/email on a backend for closed-tab delivery; never put delivery secrets in public static assets.
- Cross-tab coordination and player/game/status semantic deduplication across sources.
- Automatic source-health monitoring, rate-limit backoff, last-good persistence and explicit missed-coverage windows.
- Replace repeated Git snapshots with an append-only database/object store. Current raw working-tree snapshots: seven days; ledger: 30 days / 10,000 changes. Old Git objects remain.
- Verify deployed Pages output after every collector change. `pages.yml` explicitly deploys after main's collector workflow.

## 7. Standing practice added in session 7: verify the verifier

Two sessions in a row, the highest-value defect was in a **check**, not in the product: session 6 found a test harness that
accepted a closure as truthy and never ran it; session 7 found four audit checks that printed confident wrong numbers. Both
were invisible while everything was green. Concretely, for the next session:

- Any new `verify_live.py` check must state `verifiesOn` (the statuses that can verify its claim) and must have at least one
  unit test in `tools/test_verify_live.py` against a **real captured payload**, not an invented shape. A check with no
  fixture is a check that cannot fail.
- When a check's verdict is `OK-PAGE-CHANGED` or `ENV-BLOCKED` more than twice in a row, read the URL and the probe regex by
  hand. "The source moved" is the least likely explanation for a check that has never once verified anything.
- Before quoting any number out of `data/audit/latest.json`, confirm the field is one the API actually returns
  (`verifiedFollows` was 0 for that reason; `listName` was null for the same reason).
- The `#boardCoverage` line is a cheap honesty instrument: if it ever reads `30/30` during live games, that is worth
  recording too — it means the primary board covered every team that day, which is the claim this project most wants to be
  able to make and currently cannot.

## External access limitations

No authorized X, Instagram, Facebook or live broadcast connector is configured. Review each platform's current official access/licensing terms; do not rely on inherited fixed pricing statements or evade access controls. Free publicly accessible ESPN endpoints are undocumented and may change or return 403. The present system is a best-effort monitoring foundation, not complete verified real-time coverage.
