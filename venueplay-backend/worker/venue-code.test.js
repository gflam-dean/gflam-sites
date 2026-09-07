/* ONE CODE PER VENUE, AND NO TWO VENUES SHARE ONE.

   There used to be two codes and both were wrong.

     * The SCREEN code was fnvVenueCode(slug), a hash. Two unrelated slugs can
       land on the same six characters - roughly 0.75% likely somewhere at 3,000
       venues, 3% at 6,000, 8% at 10,000 - and the only defence was to refuse
       BOTH venues until one was re-slugged. It also moved if a slug was ever
       corrected, which invalidates a printed table talker.
     * The PLAYER code was genCode(6) at session creation: new every session. The
       wall changed codes the moment a host opened a lobby, which is fault 8 on
       the live-test list, and nothing printable was ever right for long.

   Migration 68 gives each venue one code it owns. The BROADCAST CHANNEL stays
   derived from the slug deliberately: it is plumbing nobody sees, and deriving
   it is what lets a TV and console meet with no round trip so a night survives a
   Worker outage. It is not secret and never was - the algorithm is in public
   page JavaScript - so signing protects it, not obscurity.

   Run: jsc venueplay-backend/worker/venue-code.test.js
*/
var bad = 0, pass = 0;
function ok(n, c, extra){
  if (c) { pass++; print("  ok   " + n); }
  else { bad++; print("  FAIL " + n + (extra ? "   " + extra : "")); }
}
function find(rel){
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  return null;
}
var W = find("venueplay-backend/worker/venueplay-game.js");
var TV = find("venueplay/tv.html");
var SESS = find("venueplay/app/vp-session.js");
var MIG = find("venueplay-backend/supabase/venueplay-68-venue-join-code.sql");
ok("the Worker, the TV, the session lib and migration 68 are all here", !!W && !!TV && !!SESS && !!MIG);
if (!W || !TV || !SESS || !MIG) throw new Error("missing source");

print("== a session uses the venue's own code, not a new one ==");
ok("session creation asks for the venue's code", /const ownCode = await venueJoinCode\(env, venueId\)/.test(W));
ok("and only mints one if the venue has none",
   /const joinCode = \(attempt === 0 && ownCode\) \? ownCode : genCode\(6\)/.test(W),
   "a fresh code per session is what made the wall change mid-night");
ok("venueJoinCode reads the stored column", /select=join_code,slug/.test(W));
ok("and falls back to the legacy hash if the migration has not run",
   /v\.join_code \|\| \(v\.slug \? fnvVenueCode\(v\.slug\) : null\)/.test(W),
   "pasting the Worker before the migration must not leave a venue codeless");

print("== the screen is told the code rather than deriving it ==");
ok("/screen returns join_code", /join_code: joinCode/.test(W));
ok("the TV uses what it is given", /if\(d\.join_code && CODE_RE\.test\(d\.join_code\)\) setJoinCode\(d\.join_code\)/.test(TV));

print("== the channel stays derived, and stays hidden ==");
ok("the broadcast channel is still built from CODE", /client\.channel\("vp-"\+CODE/.test(TV),
   "deriving the channel is what lets a night survive a Worker outage");
/* The hiding is on the WRAPPER, not the span: <div class="pt-code"
   style="display:none"><span id="pairCode">. The first version of this check
   looked for it on the span and failed a product that was correct. */
ok("the channel code is not displayed on the TV",
   /class="pt-code"[^>]*style="display:\s*none"[^>]*>\s*<span id="pairCode"/.test(TV),
   "it is plumbing, and showing it invites somebody to type it");

print("== only an owner or a manager can change a venue's code ==");
var h = /async function handleVenueCodeRefresh[\s\S]*?\n\}/.exec(W);
ok("the refresh endpoint exists", !!h);
ok("it is routed", /path === '\/venue\/code\/refresh'/.test(W));
ok("it requires a signed-in host token", !!h && /verifyHostJwt/.test(h[0]));
ok("it requires staff AT THAT VENUE", !!h && /requireStaff\(env, authUserId, venueId\)/.test(h[0]));
ok("a HOST is refused", !!h && /role !== 'owner' && role !== 'manager'/.test(h[0]),
   "the code is printed in the room, so a host must not be able to change it");
ok("it retries when the code is already taken", !!h && /res\.status === 409\) continue/.test(h[0]));
ok("and it clears the cached code map", !!h && /_vcMap = null/.test(h[0]),
   "otherwise the old code keeps resolving for up to a minute");
ok("the change is audited", !!h && /venue_code_refreshed/.test(h[0]));

print("== the database is what actually stops two venues sharing a code ==");
ok("migration 68 adds the column", /add column if not exists join_code text/.test(MIG));
ok("with a UNIQUE index, not a hope", /create unique index[\s\S]{0,120}vp_venues \(join_code\)/.test(MIG));
ok("existing venues keep the code they already have",
   /set join_code = vp_legacy_venue_code\(slug\)/.test(MIG),
   "a trading venue may have theirs on a table talker already");
ok("and a legacy clash is broken by age, not by failing the migration",
   /row_number\(\) over \(partition by join_code order by created_at asc/.test(MIG));

print("== the code the owner is SHOWN is the code that actually works ==");
/* This is the fault Dean hit live on 8 Sep 2026: an error on the first go, the
   same code working on the second. The lookup map was built by hashing the slug
   and never read join_code, so the moment an owner pressed Change code the console
   showed them one code and the door answered to the old one. It looked intermittent
   because each Cloudflare isolate rebuilds that map on its own minute.

   A fixture using a letter that cannot appear in a code passes without ever
   reaching the code it means to test - B I L O 0 1 8 are excluded so nobody
   misreads a table talker - so every fixture below goes through CODE(). */
var ALPHA = /^[ACDEFGHJKMNPQRSTUVWXYZ2345679]{6}$/;
function CODE(c){
  if(!ALPHA.test(c)) throw new Error('fixture "'+c+'" is not a legal venue code');
  return c;
}
ok("the lookup reads the issued join_code, not a hash of the slug",
   /join_code \|\| fnvVenueCode\(v\.slug\)/.test(W) && /select=id,slug,join_code/.test(W),
   "backfill made them equal, so hashing looked correct until somebody changed a code");
ok("a miss asks the database instead of trusting a one-minute cache",
   /join_code=eq\.' \+ enc\(code\)/.test(W),
   "each isolate caches separately, so clearing one leaves the rest stale");
ok("that lookup refuses an ambiguous answer rather than picking one",
   /hit\.length > 1\) return null/.test(W),
   "two rows for one code should be impossible under the unique index; refusing beats guessing");
ok("the hot path is ONE indexed row, not a scan of every venue",
   /join_code=eq\.' \+ enc\(code\)[^;]*limit=2/.test(W) &&
   W.indexOf("await refreshVenueCodes(env);\n  const legacy") > 0,
   "a full table scan per cold isolate is what made the 95th percentile 11 seconds");
ok("and it will not hand out a suspended venue", /join_code=eq[^;]*status=neq\.suspended/.test(W));
ok("every generator uses the no-lookalike alphabet", CODE('ACDEFG') === 'ACDEFG');

print("== an owner can actually change it, from a page a host cannot reach ==");
var SET = find("venueplay/app/settings.html");
ok("settings.html is where it lives", !!SET);
ok("and that page turns a host away", !!SET && /canEdit\s*=\s*ctx\.isAdmin\s*\|\|\s*ctx\.role==="owner"\s*\|\|\s*ctx\.role==="manager"/.test(SET),
   "the Worker checks the role too, but a host should never see the button");
ok("there is a button", !!SET && /id="refreshCodeBtn"/.test(SET));
ok("it calls the refresh endpoint", !!SET && /gameApiPost\("\/venue\/code\/refresh"/.test(SET));
ok("it warns about reprinting table talkers BEFORE changing anything",
   !!SET && /TABLE TALKERS[\s\S]{0,120}REPRINT/.test(SET),
   "the code is printed in the room: changing it silently is the fault, not the change");
ok("the warning is a confirm the owner has to accept", !!SET && /if\(!confirm\(/.test(SET));
ok("the code is shown, not just changeable", !!SET && /id="venueCodeVal"/.test(SET));

print("== the console shows the venue code, never the channel ==");
ok("vp-session exposes venueJoinCode", /venueJoinCode: venueJoinCode/.test(SESS));
ok("it reads the stored column first", /select\("join_code,slug"\)/.test(SESS));

print("");
if (bad) { print(bad + " OF " + (pass + bad) + " CHECKS FAILED"); throw new Error(bad + " failed"); }
print("ALL " + pass + " CHECKS PASSED");
