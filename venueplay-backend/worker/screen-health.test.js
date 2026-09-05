/* WOULD THIS BADGE HAVE SAVED THE AFTERNOON OF 5 SEP?
 *
 * A venue screen that has lost its realtime socket keeps rotating the venue's
 * advertising perfectly and hears nothing at all. HQ said "Live now" and "Active",
 * which describe the SESSION, not the screen, so the only way to discover a deaf
 * screen was to press Reload TV and watch nothing happen. Three separate faults
 * were each independently blocking that button, and every diagnosis had to start by
 * guessing whether the screen was receiving anything.
 *
 * So the thresholds have to be right, and the two states that must never be
 * confused are "never had a screen" and "had one and lost it".
 *
 *   jsc venueplay-backend/worker/screen-health.test.js
 */
function findFile(rel){
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return tries[i]; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var HQ = readFile(findFile("venueplay/app/hq.html"));
var W  = readFile(findFile("venueplay-backend/worker/venueplay-game.js"));

var pass = 0, fail = 0, failed = [];
function ok(label, good, detail){
  if (good) { pass++; print("  PASS  " + label + (detail ? "  (" + detail + ")" : "")); }
  else { fail++; failed.push(label); print("  FAIL  " + label + (detail ? "  (" + detail + ")" : "")); }
}

ok("found the real hq.html", HQ.indexOf("screenBadge") > 0);

// ---- the Worker end: is the heartbeat actually recorded? --------------------
ok("the Worker selects screen_seen_at on /venue", /select=name,screen_reload_at,screen_seen_at/.test(W));
ok("and writes it back", /screen_seen_at:\s*new Date\(\)\.toISOString\(\)/.test(W));
ok("throttled, so it is not a write per request",
   /Date\.now\(\)\s*-\s*last\s*>\s*25000/.test(W), "25s against a 30s poll");
ok("the write is awaited, not left dangling",
   /await sbPatch\(env, 'vp_venues'[\s\S]{0,120}screen_seen_at/.test(W),
   "an unawaited promise in a Worker can be cancelled when the response returns");
ok("a failed write never changes the answer",
   /screen_seen_at: new Date\(\)\.toISOString\(\)[\s\S]{0,160}catch \(e\)/.test(W));
ok("it only writes when the column is really there",
   /'screen_seen_at' in v/.test(W), "or a pre-migration paste writes a column that does not exist");

// ---- HQ end: the thresholds ------------------------------------------------
ok("HQ fetches the column in its own fault-tolerant query",
   /select\("id,screen_seen_at(,screen_version)?"\)/.test(HQ),
   "naming it in listVenues would 400 the whole venue list pre-migration");

// The decision, on real numbers. Mirrors the badge's own boundaries.
function state(seen, now, slug){
  if (!slug) return "";
  if (seen === undefined) return "";
  if (!seen) return "never";
  var mins = Math.floor((now - seen) / 60000);
  if (mins <= 2) return "ok";
  if (mins <= 15) return "quiet";
  return "down";
}
var NOW = 1788600000000, M = 60000;
var cases = [
  ["a venue with no screen address",      undefined, false, ""],
  ["column missing (pre-migration)",      undefined, true,  ""],
  ["never polled at all",                 null,      true,  "never"],
  ["polled 10 seconds ago",               NOW - 10000,   true, "ok"],
  ["polled 2 minutes ago",                NOW - 2*M,     true, "ok"],
  ["polled 3 minutes ago",                NOW - 3*M,     true, "quiet"],
  ["polled 15 minutes ago",               NOW - 15*M,    true, "quiet"],
  ["polled 16 minutes ago",               NOW - 16*M,    true, "down"],
  ["polled 4 hours ago",                  NOW - 240*M,   true, "down"],
];
for (var i = 0; i < cases.length; i++) {
  var c = cases[i];
  var got = state(c[1], NOW, c[2] ? "the-mini-bar" : null);
  ok("badge: " + c[0], got === c[3], "got '" + got + "', want '" + c[3] + "'");
}

/* THE DISTINCTION THAT MATTERS. "Never polled" is a venue that has not opened the
   TV link yet - a setup job. "Down" is a screen that WAS working and has stopped -
   somebody has to go and power cycle it. Calling the first one DOWN would send Dean
   to a pub that never had a screen. */
ok("never-polled and down are different states",
   state(null, NOW, "x") !== state(NOW - 240*M, NOW, "x"));
ok("a venue with no slug says nothing at all",
   state(NOW - 240*M, NOW, null) === "", "no screen address means no screen to report on");

// The wording has to tell Dean what to DO, not just that something is wrong.
ok("the down badge says it needs a power cycle at the venue",
   /power cycle at the venue/i.test(HQ));
ok("the never badge names the URL to open",
   /venueplay\.com\.au\/tv\?'\+esc\(v\.slug\)/.test(HQ));


/* ==========================================================================
   WHO DECIDES A GAME IS ON THE WALL?

   The Mini Bar's screen sat on a finished bingo board through reset after reset on
   5 Sep. Nothing was failing to restart it - something was re-starting it. A phone
   sends exactly three things (join, claim, leave) and none of them were on the TV's
   NOT_ON_AIR list, so one punter who left the play page open, whose phone woke and
   re-announced join, put the wall back into a dead game with no host involved.

   The other half matters just as much: a real game must still reach the wall.
   ========================================================================== */
var TV = readFile(findFile("venueplay/tv.html"));
var PLAY = readFile(findFile("venueplay/play.html"));

// What a phone actually SENDS, read from the phone rather than assumed.
var sends = {};
var re = /(?:send|rawSend|psend)\(\s*\{\s*t:\s*"([a-z_]+)"/g, mm;
while ((mm = re.exec(PLAY)) !== null) sends[mm[1]] = 1;
var sendList = Object.keys(sends).sort();
ok("read what a phone sends from play.html", sendList.length === 3,
   sendList.join(", "));

var na = TV.match(/var NOT_ON_AIR = \{([\s\S]*?)\};/);
ok("found the TV's NOT_ON_AIR list", !!na);
var notOnAir = {};
if (na) { var r2 = /(\w+)\s*:\s*1/g, m2; while ((m2 = r2.exec(na[1])) !== null) notOnAir[m2[1]] = 1; }

for (var i = 0; i < sendList.length; i++) {
  ok("a phone's t:\"" + sendList[i] + "\" does not put a game on the wall",
     !!notOnAir[sendList[i]],
     "one punter with the page open would otherwise revive a finished game");
}

/* AND THE OTHER WAY. These come from the HOST and MUST still take the wall, or a
   real night never reaches the screen - which would be a far worse bug than the one
   being fixed. */
var hostOnAir = ["mode", "ball", "started", "winner", "question", "reveal", "podium",
                 "played", "drawing", "drawn", "carryon"];
for (var j = 0; j < hostOnAir.length; j++) {
  ok("the host's t:\"" + hostOnAir[j] + "\" still reaches the wall",
     !notOnAir[hostOnAir[j]],
     "a real game has to be able to start");
}

// The HQ push, and the hold that makes it stick.
ok("HQ has an Ads back on button", /data-tvads/.test(HQ));
ok("it sends command ads", /command:\s*"ads"/.test(HQ));
ok("the TV holds the ads after an HQ ads command", /adsHoldUntil\s*=\s*Date\.now\(\) \+ ADS_HOLD_MS/.test(TV));
ok("and ignores a mode announcement during the hold",
   /Date\.now\(\) < adsHoldUntil[\s\S]{0,200}return;/.test(TV),
   "or a console still shouting about a dead game undoes the press in seconds");
ok("the hold expires on its own", /ADS_HOLD_MS = 2 \* 60 \* 1000/.test(TV),
   "a real night starting must not be blocked");
ok("one command is one action", /cAt > lastCommandAt/.test(TV),
   "the poll repeats every 30s; without this it would act for ever");

/* ==========================================================================
   ONE BUTTON, NOW OR 3AM.

   A reload is a deployment, and a deployment must not interrupt a Friday night. The
   condition that makes that work is easy to get exactly backwards: a time in the
   FUTURE is a schedule, not an instruction, and without that check a reload set for
   3am fires the instant it is saved.
   ========================================================================== */
function wouldAct(commandAt, now, pageLoadedAt, lastCommandAt){
  var cAt = Date.parse(commandAt);
  if (!isFinite(cAt)) return false;
  return cAt <= now && cAt > pageLoadedAt && cAt > lastCommandAt;
}
var T8PM = Date.parse("2026-09-05T10:00:00Z");            // page loaded
var T3AM = Date.parse("2026-09-05T17:00:00Z");            // 3am Brisbane = 17:00 UTC
ok("a 3am reload does NOT fire when it is set at 8pm",
   wouldAct("2026-09-05T17:00:00Z", T8PM + 1000, T8PM, 0) === false,
   "the whole point of scheduling it");
ok("it fires once 3am arrives",
   wouldAct("2026-09-05T17:00:00Z", T3AM + 1000, T8PM, 0) === true);
ok("a screen that loaded AFTER 3am does not fire it again",
   wouldAct("2026-09-05T17:00:00Z", T3AM + 60000, T3AM + 30000, 0) === false);
ok("and it does not fire twice on the next poll",
   wouldAct("2026-09-05T17:00:00Z", T3AM + 31000, T8PM, T3AM) === false);
ok("a NOW reload fires immediately",
   wouldAct("2026-09-05T10:00:05Z", T8PM + 6000, T8PM, 0) === true);
ok("the TV really has all three conditions",
   /cAt <= Date\.now\(\) && cAt > PAGE_LOADED_AT && cAt > lastCommandAt/.test(TV));

// The Worker end of the same thing.
ok("the Worker accepts a scheduled time", /body\.at[\s\S]{0,200}Date\.parse/.test(W));
ok("and refuses one absurdly far ahead", /48 \* 3600 \* 1000/.test(W),
   "a typo must not park a reload on every screen for a month");
ok("it can address every venue at once", /body\.all[\s\S]{0,200}slug=not\.is\.null/.test(W));
ok("bulk skips suspended venues", /status=neq\.suspended/.test(W));

// HQ: one button, and the old machinery actually gone.
ok("HQ offers a dropdown, not a typed answer",
   /id="reloadScreensWhen"[\s\S]{0,300}value="3am"[\s\S]{0,200}value="now"/.test(HQ),
   "the first version asked Dean to TYPE NOW or 3AM, which is a quiz, not a control");
ok("3am is the default, because it interrupts nobody",
   /value="3am" selected/.test(HQ));
ok("and the choice is read from the dropdown", /sel \? sel\.value : "3am"/.test(HQ));
ok("it still confirms before acting, naming how many screens",
   /confirm\([\s\S]{0,200}targets\.length \+ " screen"/.test(HQ));
ok("3am is computed as 17:00 UTC (Brisbane has no daylight saving)",
   /setUTCHours\(17, 0, 0, 0\)/.test(HQ));
ok("and rolls to tomorrow if 3am has passed", /\+ 24 \* 3600 \* 1000/.test(HQ));
ok("the broadcast machinery is gone, not dormant",
   !/sendTvReload|reloadOneScreen|data-tvreload/.test(HQ),
   "dead code around something this fragile gets called again in six months");

/* ==========================================================================
   HEALTHY IS NOT THE SAME AS CURRENT.

   The Mini Bar's screen reported "Screen ok" in HQ - it really was polling every
   thirty seconds - and still ignored every reload, because it was running a page
   from before the reload code existed. Both facts were true at once, and from HQ
   they looked identical. That is the same blindness the heartbeat was meant to cure,
   one level down.
   ========================================================================== */
ok("the TV reports its build on the poll", /TV_BUILD\s*=\s*"[0-9a-z.-]+"/.test(TV));
ok("and sends it as ?v=", /\/venue\?code="\+encodeURIComponent\(CODE\)\+"&v="/.test(TV));
ok("the Worker records it", /screen_version: ver/.test(W));
ok("a screen that sends nothing is recorded as old", /\|\|\s*'pre-5-sep'/.test(W),
   "silence IS the signal: it predates the feature");
ok("the version is sanitised before it is stored",
   /replace\(\/\[\^A-Za-z0-9\.-\]\/g, ''\)/.test(W), "it arrives from the open internet");
ok("a version change forces a write even inside the throttle",
   /ver !== v\.screen_version/.test(W), "or an upgrade would not show for 25 seconds");
ok("HQ reads the version", /screen_seen_at,screen_version/.test(HQ));
ok("HQ says OLD PAGE for a healthy screen running an old build",
   /Screen ok &middot; OLD PAGE/.test(HQ));
ok("and that badge tells Dean what to do about it",
   /power cycle at the venue, once/.test(HQ));

// The distinction, on the values themselves.
function badge(mins, ver){
  var stale = (ver === "pre-5-sep" || !ver);
  if (mins <= 2) return stale ? "ok-old" : "ok";
  if (mins <= 15) return "quiet";
  return "down";
}
ok("polling and current  -> ok",       badge(1, "2026-09-05c") === "ok");
ok("polling but silent about its build -> ok-old", badge(1, null) === "ok-old");
ok("polling and admits it is old -> ok-old", badge(1, "pre-5-sep") === "ok-old");
ok("an old page that has also stopped polling still reads down", badge(300, "pre-5-sep") === "down",
   "not talking to us at all is the more urgent fact");

/* ==========================================================================
   ONE CONTROL: WHAT, AND WHEN, FOR EVERY SCREEN.

   Dean asked for an ads-back-on that applies to all of them, not just one row at a
   time: "we do reset all TV's and we do an ads back on and a restart then a dropdown
   with time". Two dropdowns, one button.
   ========================================================================== */
ok("there is an action dropdown", /id="screensAction"/.test(HQ));
ok("it offers ads back on", /<option value="ads" selected>/.test(HQ));
ok("and restart", /<option value="reload">/.test(HQ));
ok("ads is the default, because it interrupts less", /value="ads" selected/.test(HQ));
ok("the chosen action is what gets sent", /command:\s*cmd/.test(HQ));
ok("and it applies to every venue", /\{ all:true, command:cmd \}/.test(HQ));
ok("the confirm says which action and which time",
   /This will " \+ what \+ "[\s\S]{0,300}When: /.test(HQ),
   "a control that does two things must say which one it is about to do");

// The Worker takes both commands in bulk, and only those two.
ok("the Worker's command allowlist is exactly ads and reload",
   /SCREEN_COMMANDS = \{ ads: 1, reload: 1 \}/.test(W));
ok("an unknown command is refused", /unknown command/.test(W));
ok("bulk + ads is a valid combination (no command-specific branch blocks it)",
   !/body\.all[\s\S]{0,300}cmd !== 'reload'/.test(W),
   "ads for all venues must not be quietly special-cased away");

/* ==========================================================================
   THE ADS DEFAULT, AND THE ADMIN ROW.

   Dean pressed "Put the ads back on" and nothing happened, correctly: the shared time
   dropdown was on its default of 3am, so the command sat waiting eight hours while we
   both looked for a fault that was not there. command_at read 17:00Z - 3am Brisbane -
   which is the mechanism working exactly as built and the default being wrong.
   ========================================================================== */
ok("the time default follows the action", /function syncWhen\(\)/.test(HQ));
ok("ads means now", /act\.value === "reload"\) \? "3am" : "now"/.test(HQ),
   "you press ads BECAUSE a wall is wrong this second");
ok("and it re-syncs when the action changes", /addEventListener\("change", syncWhen\)/.test(HQ));
ok("and is applied on load, not only on change", /syncWhen\(\);\s*\}\)\(\);/.test(HQ));

/* NINE BUTTONS x 400 VENUES IS 3,600 BUTTONS. Two per row, the rest inside the
   Details panel that already existed for each venue. */
var rowBlock = HQ.slice(HQ.indexOf("var actions='<button"), HQ.indexOf("var moreActions ="));
var inlineButtons = (rowBlock.match(/<button|<a class="mini"/g) || []).length;
ok("the row itself has two controls, not nine", inlineButtons === 2,
   inlineButtons + " inline");
ok("everything else moved to a moreActions list", /var moreActions =/.test(HQ));
ok("and moreActions is actually rendered in the Details panel",
   /actcell[^']*'\+moreActions\+'/.test(HQ),
   "moving them out of the row and never drawing them would be worse than the clutter");
ok("Details toggles to Close so the row says what the button will do",
   /S\.openVenue===v\.id \? 'Close' : 'Details'/.test(HQ));

/* THE TWO THAT STOP A VENUE TRADING. A confirm() is muscle memory by the fiftieth
   venue. Typing the name is not. */
ok("there is a type-the-name confirmation", /function confirmByName/.test(HQ));
ok("pausing requires it", /if\(to==="suspended"\)\{\s*\n\s*if\(!confirmByName/.test(HQ));
ok("archiving requires it", /confirmByName\(name, "Archive "/.test(HQ));
ok("reactivating does NOT require it", /\} else if\(!confirm\(q\)\) return;/.test(HQ),
   "putting a venue back on air harms nobody");
ok("a mismatch changes nothing and says so", /so nothing was changed/.test(HQ));

// The matcher itself: forgiving about case and space, strict about the name.
function nameOk(typed, name){
  return String(typed).trim().toLowerCase() === String(name).trim().toLowerCase();
}
ok("exact name passes", nameOk("The Mini Bar", "The Mini Bar"));
ok("different case passes", nameOk("the mini bar", "The Mini Bar"));
ok("stray spaces pass", nameOk("  The Mini Bar  ", "The Mini Bar"));
ok("a different venue does NOT pass", nameOk("The Mini Bar", "Wallsend Hotel") === false,
   "the whole point is noticing you have the wrong row");
ok("empty does not pass", nameOk("", "The Mini Bar") === false);
ok("a partial name does not pass", nameOk("Mini", "The Mini Bar") === false);

/* ==========================================================================
   HOW A SCREEN GETS STRANDED.

   On 5 Sep The Mini Bar's screen sat on a bingo board that had finished hours
   earlier. It was polling us every thirty seconds - HQ read "Screen ok" - and there
   was no remote lever of any kind that could reach it. It had to be reloaded by hand.

   The cause was one line: screenIsAlive() began `if(!idle()) return true;`, so a game
   on the wall was proof of life full stop. That disabled every escape at once - the
   four-hourly reload is idle-only, and the watchdog declared the screen healthy - and
   the command pull did not exist in that page yet.

   A game is proof of life only while something is still ARRIVING.
   ========================================================================== */
ok("a frozen game is no longer proof of life",
   !/function screenIsAlive\(\)\{\s*\n\s*if\(!idle\(\)\) return true;/.test(TV),
   "that one line stranded a screen for a whole evening");
ok("there is a frozen-game test", /function gameLooksFrozen\(\)/.test(TV));
ok("it measures silence, not mode", /Date\.now\(\) - Math\.max\(lastHostAt \|\| 0, lastBingoAt \|\| 0\)/.test(TV));
ok("ten minutes, comfortably longer than a gap between balls",
   /FROZEN_GAME_MS = 10 \* 60 \* 1000/.test(TV));
ok("a frozen game reloads instead of rebuilding the ads",
   /gameLooksFrozen\(\)\)\{ reload\("frozen-game"\); return; \}/.test(TV),
   "the slides are behind the board; rebuilding them cannot help");

// The decision itself.
function frozen(mode, lastTraffic, now){
  if (mode === "ads") return false;
  return (now - lastTraffic) > 10*60*1000;
}
var NOW2 = 1788700000000, MIN = 60000;
ok("a live bingo game, ball 20 seconds ago -> not frozen", frozen("bingo", NOW2-20000, NOW2) === false);
ok("a game with a 5 minute gap -> not frozen", frozen("bingo", NOW2-5*MIN, NOW2) === false,
   "a host pausing to sort a prize must not trip this");
ok("a game silent for 11 minutes -> frozen", frozen("bingo", NOW2-11*MIN, NOW2) === true);
ok("a board silent since last night -> frozen", frozen("bingo", NOW2-600*MIN, NOW2) === true);
ok("the ads loop is never 'frozen' in this sense", frozen("ads", NOW2-600*MIN, NOW2) === false,
   "an idle screen is handled by the ad-slide check instead");
print("");
if (fail) { print(fail + " OF " + (pass + fail) + " CHECKS FAILED: " + failed.join(", ")); throw new Error(fail + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
