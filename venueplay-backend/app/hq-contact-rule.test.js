/* WHO GETS TICKED WHEN WE RING A VENUE, and what state HQ says a venue is in.

   Two questions that used to be answered in more than one place, which is how HQ ended up
   telling Dean two different things about the same venue on two screens.

   1. Dean, 12 Sep 2026: "I think if they have cancelled and they are quiet and we contact them
      it should auto mark the other as well. Only if they have cancelled." A venue that has
      cancelled AND gone quiet is one phone call. One that is merely quiet is not.

   2. Dean, same day: "also wellshot says active on the venues screen". Wellshot cancelled on
      20 August. The Quiet screen had just been taught to say Cancelled and the venue list had
      not, so the same venue read two ways depending on which tab you were on.

   Both are now single functions in hq.html, and this suite runs THOSE, lifted out of the real
   page. A copy here would go on passing after the page changed underneath it, which has
   happened on this project twice.

   Run: jsc venueplay-backend/app/hq-contact-rule.test.js */
var bad = 0, ran = 0;
function pass(n, c, x) {
  if (typeof n !== "string") throw new Error("name first");
  if (typeof c !== "boolean") throw new Error("condition must be a boolean: " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (x ? "   " + x : "")); if (!c) bad++;
}
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
function lift(src, name) {
  var m = new RegExp("function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) throw new Error("hq.html no longer defines " + name);
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  throw new Error("could not read " + name);
}
var HQ = find('venueplay/app/hq.html');

/* The page's own state object, and the three questions these two functions ask of it. */
var S = { cancelling: {}, live: {}, venues: [] };
function venueById(id) { for (var i = 0; i < S.venues.length; i++) if (S.venues[i].id === id) return S.venues[i]; return null; }
eval(lift(HQ, "isArchived"));
eval(lift(HQ, "isCancelling"));
eval(lift(HQ, "stateBadgeFor"));
eval(lift(HQ, "contactActions"));

function setVenues(list) {
  S.venues = list; S.cancelling = {};
  list.forEach(function (v) { if (v._cancelling) S.cancelling[v.id] = true; });
}

/* ---------------- 1. ONE CALL, OR TWO ---------------- */
setVenues([
  { id: "quiet",     name: "The Average Joe",  status: "active" },
  { id: "leaving",   name: "Wellshot Hotel",   status: "active",    _cancelling: true },
  { id: "gone",      name: "The Anchor Hotel", status: "suspended", suspended_reason: "archived" },
  { id: "suspended", name: "Unpaid Arms",      status: "suspended", suspended_reason: "nonpayment" }
]);

var q = contactActions("quiet", true);
pass("a venue that is only quiet gets the quiet mark and nothing else",
     q.length === 1 && q[0] === "venue_quiet_contacted", q.join(", "));

var c = contactActions("leaving", true);
pass("a venue that has cancelled gets BOTH, which is Dean's rule",
     c.length === 2 && c.indexOf("venue_quiet_contacted") >= 0 && c.indexOf("venue_cancel_contacted") >= 0,
     c.join(", "));

var g = contactActions("gone", true);
pass("an archived venue counts as cancelled for this, because it left",
     g.length === 2 && g.indexOf("venue_cancel_contacted") >= 0, g.join(", "));

var sp = contactActions("suspended", true);
pass("suspended is NOT cancelled: an unpaid venue has not told us it is leaving",
     sp.length === 1 && sp[0] === "venue_quiet_contacted", sp.join(", "));

/* UNDO IS THE EXACT MIRROR. If one tap ticked both, one tap must clear both, or the screen you
   are not looking at keeps a tick for a conversation that has been taken back. */
var u = contactActions("leaving", false);
pass("undo on a cancelled venue clears both",
     u.length === 2 && u.indexOf("venue_quiet_uncontacted") >= 0 && u.indexOf("venue_cancel_uncontacted") >= 0,
     u.join(", "));
pass("undo on a merely quiet venue clears only its own",
     contactActions("quiet", false).join() === "venue_quiet_uncontacted");
pass("marking and undoing always touch the same number of lists",
     contactActions("leaving", true).length === contactActions("leaving", false).length &&
     contactActions("quiet", true).length === contactActions("quiet", false).length);
pass("nothing ever writes a 'contacted' and an 'uncontacted' in the same breath",
     contactActions("leaving", true).every(function (a) { return !/_un/.test(a); }) &&
     contactActions("leaving", false).every(function (a) { return /_un/.test(a); }));
/* A venue that is not on this page at all must not silently do nothing surprising: the quiet
   mark is still correct, because the quiet list is served by the Worker and can name a venue
   the browser's own list has not got. */
pass("an unknown venue still records the quiet call rather than nothing",
     contactActions("nosuchvenue", true).join() === "venue_quiet_contacted");

/* ---------------- 2. ONE WORD FOR ONE STATE ---------------- */
pass("a venue that has cancelled does NOT read as Active, which is the Wellshot fault",
     /Cancelled/.test(stateBadgeFor(venueById("leaving"))) &&
     !/Active/.test(stateBadgeFor(venueById("leaving"))),
     stateBadgeFor(venueById("leaving")));
pass("and it says WHEN it stops, on hover, because Active was not exactly wrong",
     /title="[^"]*paid period/.test(stateBadgeFor(venueById("leaving"))));
pass("an archived venue reads Archived, not Cancelled",
     /Archived/.test(stateBadgeFor(venueById("gone"))));
pass("archived beats cancelling when a venue is both",
     /Archived/.test(stateBadgeFor({ id: "gone", status: "suspended", suspended_reason: "archived_cancelling" })));
pass("an unpaid venue still reads Unpaid and not Cancelled",
     /Unpaid/.test(stateBadgeFor(venueById("suspended"))));
pass("an ordinary venue reads Active", /Active/.test(stateBadgeFor(venueById("quiet"))));
S.live["quiet"] = true;
pass("a venue mid-game reads Live now", /Live now/.test(stateBadgeFor(venueById("quiet"))));
S.live = {};

/* THE THING THAT ACTUALLY WENT WRONG was one screen being taught and the others not. So check
   that no screen builds this badge for itself any more. */
var handRolled = (HQ.match(/badge idle">Active/g) || []).length;
pass("only one place in the page decides how to say Active", handRolled === 1,
     handRolled + " place(s) write that badge; it belongs in stateBadgeFor alone");
var quietBlock = HQ.slice(HQ.indexOf("function loadQuiet("), HQ.indexOf("function loadQuiet(") + 6000);
pass("the quiet screen asks stateBadgeFor rather than deciding for itself",
     /stateBadgeFor\(/.test(quietBlock));
var venueBlock = HQ.slice(HQ.indexOf("function renderVenues("), HQ.indexOf("function renderVenues(") + 9000);
pass("and so does the venue list", /stateBadgeFor\(/.test(venueBlock));

/* And both contact buttons go through the one rule, rather than each writing its own row. */
pass("neither screen writes a contacted row behind contactActions' back",
     (HQ.match(/action:\s*"?venue_(quiet|cancel)_(un)?contacted"?/g) || []).length === 0,
     "every write goes through setContacted");
pass("both screens call setContacted", (HQ.match(/setContacted\(/g) || []).length >= 3);

/* ---------------- 3. EVERY ACTION IT WRITES, IT READS BACK ----------------

   The fault this exists for, found in a browser on 12 Sep 2026 an hour after the undo shipped:
   venue_cancel_uncontacted was missing from CX_ACTIONS, the list of actions the cancelled
   screen asks the database for. So Undo wrote its row every time, perfectly, and the screen
   never asked for it: the tick stayed, and the only way to clear one was somebody with the
   service key deleting rows. It looked exactly like a button that does nothing.

   The checks above could not see it. They test contactActions, which decides WHAT to write,
   and stateBadgeFor, which decides how to say it. Neither goes near the query. A pure function
   can be perfect while the round trip is broken, which is the whole reason this repo's rule is
   that a test must run the thing rather than inspect it.

   So: collect every action name the page WRITES, and require each to appear in an .in(...)
   filter somewhere in the same page. A new pair of actions added next month is caught the day
   it is added rather than whenever somebody happens to press the second button. */
var writes = {};
var wre = /action:\s*(?:"([a-z_]+)"|[^,\n]*\?\s*"([a-z_]+)"\s*:\s*"([a-z_]+)")/g, wm;
while ((wm = wre.exec(HQ))) {
  [wm[1], wm[2], wm[3]].forEach(function (a) { if (a && /^venue_/.test(a)) writes[a] = true; });
}
// contactActions builds its names as plain literals inside the function; take those too.
var ca = lift(HQ, "contactActions");
(ca.match(/"(venue_[a-z_]+)"/g) || []).forEach(function (q) { writes[q.replace(/"/g, "")] = true; });

var reads = {};
var rre = /\.in\(\s*"action"\s*,\s*(\[[^\]]*\]|[A-Z_]+)/g, rm;
while ((rm = rre.exec(HQ))) {
  var lit = rm[1];
  if (/^\[/.test(lit)) {
    (lit.match(/"([a-z_]+)"/g) || []).forEach(function (q) { reads[q.replace(/"/g, "")] = true; });
  } else {
    // a named constant: find its array and read that
    var cm = new RegExp("var\\s+" + lit + "\\s*=\\s*(\\[[\\s\\S]*?\\])").exec(HQ);
    if (cm) (cm[1].match(/"([a-z_]+)"/g) || []).forEach(function (q) { reads[q.replace(/"/g, "")] = true; });
  }
}
var written = Object.keys(writes).sort();
pass("the page writes a recognisable set of venue actions", written.length >= 6, written.join(", "));
pass("at least one screen actually queries by action", Object.keys(reads).length >= 6,
     Object.keys(reads).sort().join(", "));
/* Only the ones a screen depends on reading back. A one-way record (an archive, an alert) is
   written for the audit log and nothing here has to re-read it, so those are named as such
   rather than silently skipped, which would let a real gap hide behind the exemption. */
var WRITE_ONLY = { venue_marked_test:0, venue_unmarked_test:0 };   // read via their own query below
var unread = written.filter(function (a) {
  if (a in WRITE_ONLY) return false;
  return !reads[a];
});
pass("every contacted/uncontacted action the page writes is one it reads back",
     unread.length === 0, unread.join(", ") + " written but never queried");
/* And specifically the pair that broke, named, so the reason is legible in the failure. */
pass("Undo on the cancelled screen is readable, not just writable",
     !!reads["venue_cancel_uncontacted"], "CX_ACTIONS must include it or Undo does nothing");
pass("Undo on the quiet screen is readable too", !!reads["venue_quiet_uncontacted"]);
/* ---------------- 4. WHICH OF THE TWO ROWS WINS ----------------

   Undo does not delete the contacted row, it writes an uncontacted one beside it, so the
   screen's answer depends entirely on reading the newest of the pair. That rule had no test:
   the suite checked what gets WRITTEN and never what the screen then DECIDES. Run cxStories,
   the real one, over rows shaped like the ones PostgREST returns. */
var hideAsTest = function () { return false; };
eval(lift(HQ, "cxVenueId"));
eval(lift(HQ, "cxStories"));

function auditRow(action, vid, when) { return { action: action, target: "venue:" + vid, created_at: when, detail: {} }; }
function storyFor(rows, vid) {
  S.cancelAudit = rows;                       // newest first, as the query orders them
  var out = cxStories();
  for (var i = 0; i < out.length; i++) if (out[i].venue_id === vid) return out[i];
  return null;
}
setVenues([{ id: "leaving", name: "Wellshot Hotel", status: "active", _cancelling: true }]);

pass("a venue with no contact rows at all reads as not contacted",
     storyFor([], "leaving").contacted === null);
pass("one contacted row reads as contacted",
     !!storyFor([auditRow("venue_cancel_contacted", "leaving", "2026-09-12T00:34:44Z")], "leaving").contacted);
pass("contacted then undone reads as NOT contacted, which is the whole point of Undo",
     storyFor([auditRow("venue_cancel_uncontacted", "leaving", "2026-09-12T00:36:40Z"),
               auditRow("venue_cancel_contacted",   "leaving", "2026-09-12T00:34:44Z")], "leaving").contacted === null);
pass("undone then contacted again reads as contacted",
     !!storyFor([auditRow("venue_cancel_contacted",   "leaving", "2026-09-12T00:40:00Z"),
                 auditRow("venue_cancel_uncontacted", "leaving", "2026-09-12T00:36:40Z"),
                 auditRow("venue_cancel_contacted",   "leaving", "2026-09-12T00:34:44Z")], "leaving").contacted);
/* Four taps, which is exactly what happened while testing this in a browser on 12 Sep. */
pass("a whole afternoon of ticking and unticking still ends on the last tap",
     storyFor([auditRow("venue_cancel_uncontacted", "leaving", "2026-09-12T00:36:40Z"),
               auditRow("venue_cancel_contacted",   "leaving", "2026-09-12T00:36:17Z"),
               auditRow("venue_cancel_uncontacted", "leaving", "2026-09-12T00:35:12Z"),
               auditRow("venue_cancel_contacted",   "leaving", "2026-09-12T00:34:44Z")], "leaving").contacted === null);
/* THE FILTER USES THE SAME ANSWER. "Not contacted yet" is the screen's default, so a venue
   whose undo was ignored would be missing from the one list somebody actually works through. */
eval(lift(HQ, "cxPasses"));
S.cxFilter = "uncontacted";
pass("an undone venue is back on the Not-contacted-yet list",
     cxPasses(storyFor([auditRow("venue_cancel_uncontacted", "leaving", "2026-09-12T00:36:40Z"),
                        auditRow("venue_cancel_contacted",   "leaving", "2026-09-12T00:34:44Z")], "leaving")));
pass("and a genuinely contacted one is off it",
     !cxPasses(storyFor([auditRow("venue_cancel_contacted", "leaving", "2026-09-12T00:34:44Z")], "leaving")));
S.cxFilter = "all";

pass("and the test-venue flag is read by its own query",
     /venue_unmarked_test/.test(HQ.slice(HQ.indexOf('"venue_marked_test"'), HQ.indexOf('"venue_marked_test"') + 200)) ||
     !!reads["venue_unmarked_test"]);

print("");
print(bad ? (bad + " OF " + ran + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
