/* WHERE THE CODE ACTUALLY IS.

   These paths used to point into /Users/dean.tindale/partyplay, a copy of this
   project that stopped being the one we ship. On 3 Sep it was 6.5 KB and 148
   lines behind the repo, so every PartyPlay suite reported all checks passing
   against code nobody deploys. A test pointed at the wrong file cannot fail, and
   that is worse than no test: the green line says it did the job. */
function ppFile(rel) {
  var tries = [rel, "partyplay-backend/" + rel, "../" + rel, "../../" + rel + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 100) return tries[i]; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}

/* CAN SOMEBODY ACTUALLY BUY A PARTY?
 *
 * On 28 Aug 2026 the answer was no. Every checkout answered 500, because
 * `marketing_optin: wantsMarketing` sat nine lines ABOVE
 * `const wantsMarketing = ...`, and a const read inside its temporal dead zone
 * throws rather than reading as undefined.
 *
 * Nothing caught it. The Worker parsed, because it is a runtime error and not a
 * syntax one. check-defs.py passed, because wantsMarketing IS defined, just
 * later. And the only checkout test asserted that a HALF-CONFIGURED worker
 * returns 503, which it happily did all the way through.
 *
 * So this drives the real handleCheckout out of the DEPLOY build against a
 * stubbed Stripe and database, and asserts a purchase actually completes. The
 * money path gets a test that exercises the SUCCESS case, not only the refusals.
 *
 *   jsc lib/pp-checkout.test.js
 */
load(ppFile("partyplay-backend/worker/_test-sha256.js"));

globalThis.crypto = { getRandomValues: function (a) { for (var i=0;i<a.length;i++) a[i]=(i*97)%251; return a; }, subtle: {} };
globalThis.TextEncoder = function () { this.encode = function (s) { return SHA.utf8(s); }; };
globalThis.URL = function () { this.pathname = "/checkout"; this.searchParams = { get: function () { return null; } }; };
globalThis.URLSearchParams = function (o) {
  var p = []; for (var k in (o||{})) p.push(k + "=" + o[k]);
  this.toString = function () { return p.join("&"); };
};
globalThis.Response = function (b, i) { this._b = b; this.status = (i||{}).status || 200; };

var INSERTED = null, STRIPE_BODY = null, CLASHES = 0;
function reply(o) {
  var t = typeof o === "string" ? o : JSON.stringify(o);
  return Promise.resolve({ ok:true, status:200,
    text: function () { return Promise.resolve(t); },
    json: function () { return Promise.resolve(typeof o === "string" ? JSON.parse(o) : o); } });
}
globalThis.fetch = function (u, o) {
  u = String(u); o = o || {};
  if (u.indexOf("pp_licences") >= 0 && (o.method || "GET") === "GET") {
    return reply(CLASHES-- > 0 ? [{ id: "taken" }] : []);   // force a code clash on demand
  }
  if (u.indexOf("pp_licences") >= 0 && o.method === "POST") {
    INSERTED = JSON.parse(o.body)[0];
    return reply([Object.assign({ id: "L1" }, INSERTED)]);
  }
  if (u.indexOf("stripe.com") >= 0) {
    STRIPE_BODY = String(o.body || "");
    return reply({ id: "cs_test_1", url: "https://checkout.stripe.com/pay/x" });
  }
  return reply([]);
};

var src = readFile(ppFile("partyplay-backend/worker/DEPLOY-partyplay-api.js"))
            .replace(/^export default/m, "var _d =");
var W = new Function(src + "\n; return { handleCheckout: handleCheckout };")();
var ENV = { STRIPE_SECRET_KEY:"sk_test_x", STRIPE_WEBHOOK_SECRET:"whsec",
            STRIPE_PRICE_1DAY:"price_1", STRIPE_PRICE_3DAY:"price_3",
            SUPABASE_URL:"https://x.supabase.co", SUPABASE_SERVICE_KEY:"s",
            SITE_ORIGIN:"https://partyplay.com.au" };

var pass = 0, fail = 0, notes = [];
function ok(c, m) { if (c) pass++; else { fail++; notes.push("  FAIL  " + m); } }

function buy(body, env) {
  INSERTED = null; STRIPE_BODY = null;
  var req = { method:"POST", url:"https://api.x/checkout", headers:{ get:function(){ return null; } },
              json: function () { return Promise.resolve(body); } };
  return W.handleCheckout(req, env || ENV)
    .then(function (r) { return { status: r.status, body: JSON.parse(String(r._b)) }; })
    .catch(function (e) { return { status: 0, threw: String(e) }; });
}

var chain = Promise.resolve()
  .then(function () { return buy({ name:"Dean", email:"d@e.co", days:1, optin:false }); })
  .then(function (r) {
    ok(!r.threw, "a 24 hour party must not throw: " + r.threw);
    ok(r.status === 200, "expected 200, got " + r.status);
    ok(r.body && /checkout\.stripe\.com/.test(r.body.url || ""), "a Stripe URL comes back");
    ok(r.body && /^[A-Z0-9]{6}$/.test(r.body.code || ""), "a party code comes back, got " + (r.body||{}).code);
    ok(INSERTED && INSERTED.price_cents === 5000, "24 hours costs $50, got " + (INSERTED||{}).price_cents);
    ok(INSERTED && INSERTED.days === 1, "and is recorded as one day");
    ok(INSERTED && INSERTED.status === "pending", "the row starts pending, not paid");
    ok(INSERTED && !!INSERTED.host_key, "a host key is minted");
    ok(INSERTED && INSERTED.marketing_optin === false, "opt-in false is carried through");
  })
  .then(function () { return buy({ name:"Dean", email:"d@e.co", days:3, optin:true }); })
  .then(function (r) {
    ok(r.status === 200, "a 3 day party works too, got " + r.status);
    ok(INSERTED && INSERTED.price_cents === 12000, "3 days costs $120, got " + (INSERTED||{}).price_cents);
    ok(INSERTED && INSERTED.marketing_optin === true, "opt-in true is carried through");
    ok(/allow_promotion_codes=true/.test(STRIPE_BODY || ""), "promo codes stay switched on");
  })
  // a code that is already taken must be retried, not handed out twice
  .then(function () { CLASHES = 2; return buy({ name:"Dean", email:"d@e.co", days:1 }); })
  .then(function (r) { ok(r.status === 200, "a clashing code is retried, got " + r.status); CLASHES = 0; })
  // and the refusals must still refuse
  .then(function () { return buy({ email:"d@e.co", days:1 }); })
  .then(function (r) { ok(r.status === 400, "no name is refused, got " + r.status); })
  .then(function () { return buy({ name:"Dean", email:"nope", days:1 }); })
  .then(function (r) { ok(r.status === 400, "a bad email is refused, got " + r.status); })
  .then(function () {
    /* A half configured Worker is turned away by the ROUTER, before it ever
       reaches this handler, so asserting it here would be testing the wrong
       layer. worker/partyplay-api.test.js covers that one through W.fetch. */
    return buy({ name:"Dean", email:"d@e.co", days:1 });
  })
  .then(function (r) { ok(r.status === 200, "and a normal purchase still works at the end, got " + r.status); });

chain.catch(function (e) { fail++; notes.push("  THREW " + e); }).then(function () {
  notes.forEach(function (n) { print(n); });
  print(fail ? "FAILED " + fail + " of " + (pass + fail) : "ALL " + pass + " CHECKS PASSED");
});
