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

print("");
print(bad ? (bad + " OF " + ran + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
