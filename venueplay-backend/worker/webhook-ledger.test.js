/* THE STRIPE EVENT LEDGER, RUN RATHER THAN READ.

   Stripe retries a webhook it did not get a 2xx for, and can deliver the same
   event twice even when it did. vpaClaimStripeEvent is what decides whether a
   delivery does the work or is waved through. Getting it wrong is expensive in
   BOTH directions, which is why every branch is exercised here:

     too eager to skip  -> an event whose first attempt died is never handled at
                           all. A venue pays and stays switched off.
     too eager to go    -> the retry runs every branch again, which is the thing
                           the ledger exists to stop.

   This lifts the REAL function out of the shipped Worker and runs it against a
   fake Supabase, so it tests what gets pasted, not a copy written here. The
   fake also records the HTTP it was asked to do, because "does not do the work
   twice" is a claim about requests, not about a return value.

   Run: jsc venueplay-backend/worker/webhook-ledger.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if(!c) bad++; }

function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
function lift(src, name) {
  var m = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  return null;
}
var BILL = find("venueplay-backend/worker/venueplay-api-FULL.js");

var claimSrc  = lift(BILL, "vpaClaimStripeEvent");
var finishSrc = lift(BILL, "vpaFinishStripeEvent");
var headSrc   = lift(BILL, "vpaHeaders");
var selSrc    = lift(BILL, "vpaSelect");
pass("the real functions came out of the shipped Worker",
     !!(claimSrc && finishSrc && headSrc && selSrc),
     claimSrc ? "" : "vpaClaimStripeEvent not found: it was renamed or deleted");
if (!claimSrc) { print("\n1 OF 1 CHECKS FAILED"); throw new Error("nothing to test"); }

// The stale window is a constant beside the function; read it rather than assume.
var STALE = /VPA_EVENT_STALE_MS\s*=\s*([0-9*\s]+);/.exec(BILL);
pass("the stale window is defined", !!STALE, STALE ? STALE[1].trim() : "");
var STALE_MS = STALE ? eval(STALE[1]) : 300000;
/* DEFINE IT FOR THE LIFTED FUNCTION TOO, not just for this file's own maths. The
   first version of this suite read the number and forgot to declare it, so inside
   the lifted function the name was undeclared, the ReferenceError was swallowed by
   its own deliberate fail-open catch, and every case came back "go". Two checks
   went red and both were THIS FILE'S fault, not the Worker's. Worth remembering:
   a catch that exists to fail open will also hide a plain coding mistake, so
   nothing inside it can be trusted to a green line alone. */
var VPA_EVENT_STALE_MS = STALE_MS;

var calls;                 // every request the fake Supabase was asked to make
var env = { SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_KEY: "svc" };

/* The fake Supabase. `state` is what the ledger table already holds for this
   event: null for nothing, or a row. `postOk` false is Supabase refusing, which
   must fail OPEN. */
function setup(state, postOk) {
  calls = [];
  globalThis.fetch = function (url, opt) {
    opt = opt || {};
    calls.push({ method: opt.method || "GET", url: String(url), body: opt.body || null });
    if (opt.method === "POST") {
      if (postOk === false) return Promise.resolve({ ok: false, status: 500, json: function(){ return Promise.resolve({}); } });
      // ignore-duplicates: the row comes back only when there was nothing there.
      var made = state ? [] : [{ event_id: "evt_1" }];
      return Promise.resolve({ ok: true, status: 201, json: function(){ return Promise.resolve(made); } });
    }
    if (opt.method === "PATCH") return Promise.resolve({ ok: true, status: 204, json: function(){ return Promise.resolve([]); } });
    // the GET that vpaSelect makes
    return Promise.resolve({ ok: true, status: 200, json: function(){ return Promise.resolve(state ? [state] : []); } });
  };
}
eval(headSrc); eval(selSrc); eval(claimSrc); eval(finishSrc);

function iso(msAgo) { return new Date(Date.now() - msAgo).toISOString(); }
var EV = { id: "evt_1", type: "invoice.paid" };
function claim() { var out; vpaClaimStripeEvent(env, EV).then(function(r){ out = r; }); drainMicrotasks(); return out; }
function patches() { var n = 0; for (var i=0;i<calls.length;i++) if (calls[i].method === "PATCH") n++; return n; }

print("\nWHAT A DELIVERY DOES");

setup(null);
pass("a brand new event is handled", claim() === "go");
pass("claiming it is one INSERT, not a read then a write",
     calls.length === 1 && calls[0].method === "POST",
     calls.length + " request(s): reading first would be the same race the ledger exists to close");

/* claimed LONG ago on purpose. The first version of this used a recent
   claimed_at, so when "finished means duplicate" was deliberately broken the
   function still answered skip, by falling through to the age check, and the
   suite stayed green on the ledger's single most important behaviour. A fixture
   that lets a second branch produce the right answer is not testing the first
   one. Past the stale window, ONLY completed_at can produce skip. */
setup({ event_id: "evt_1", claimed_at: iso(STALE_MS + 60000), completed_at: iso(30000), attempts: 1 });
pass("an event already finished is waved through", claim() === "skip",
     "and this is isolated: it was claimed long enough ago that nothing else would skip it");
pass("a finished event is not re-claimed either", patches() === 0);

setup({ event_id: "evt_1", claimed_at: iso(1000), completed_at: null, attempts: 1 });
pass("an event another delivery is handling RIGHT NOW is left alone", claim() === "skip");
pass("and it is not stolen by rewriting the claim", patches() === 0);

setup({ event_id: "evt_1", claimed_at: iso(STALE_MS + 60000), completed_at: null, attempts: 1 });
pass("an event whose first attempt DIED is taken over, not stranded", claim() === "go",
     "otherwise a venue pays and stays switched off for ever");
pass("taking it over re-stamps the claim so a third delivery does not pile in", patches() === 1);

print("\nWHEN THE BOOKKEEPING ITSELF BREAKS");
setup(null, false);
pass("Supabase refusing the claim still handles the event", claim() === "go",
     "a webhook dropped because the ledger broke is worse than one handled twice");

globalThis.fetch = function () { return Promise.reject(new Error("network is down")); };
pass("the network being down still handles the event", claim() === "go");

setup(null);
var noId;
vpaClaimStripeEvent(env, {}).then(function(r){ noId = r; }); drainMicrotasks();
pass("an event with no id is handled rather than dropped", noId === "go" && calls.length === 0);

print("\nFINISHING");
setup({ event_id: "evt_1", claimed_at: iso(1000), completed_at: null, attempts: 1 });
vpaFinishStripeEvent(env, EV); drainMicrotasks();
pass("finishing writes completed_at, which is what makes the NEXT delivery a duplicate",
     patches() === 1 && /completed_at/.test(calls[calls.length - 1].body || ""));

/* The order is the security property: an unsigned event must never be able to
   claim an id, because that would make us ignore the real one when it arrives. */
var sigAt   = BILL.indexOf("if (!ok) return new Response('bad signature'");
/* The CALL, not the definition. Searching for the bare name found the function
   declaration, which sits above the handler, so this check passed nothing and
   failed for the wrong reason. */
var claimAt = BILL.indexOf("(await vpaClaimStripeEvent(env, event))");
var firstBranch = BILL.indexOf("if (event.type === 'checkout.session.completed')");
pass("the signature is checked BEFORE anything can claim an event id",
     sigAt > 0 && claimAt > sigAt,
     "an unsigned event claiming an id would make us ignore the real one");
pass("the claim happens BEFORE the first branch runs", claimAt > 0 && firstBranch > claimAt);

print("");
print(bad ? (bad + " OF " + ran + " CHECKS FAILED") : ("ALL " + ran + " CHECKS PASSED"));
if (bad) throw new Error("webhook ledger: " + bad + " failed");
