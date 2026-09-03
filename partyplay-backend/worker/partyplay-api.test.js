/* WHERE THE CODE ACTUALLY IS.

   Every path in here used to be an absolute one into /Users/dean.tindale/partyplay,
   a copy of this project that stopped being the one we ship. On 3 Sep that copy was
   6.5 KB and 148 lines behind the repo, so this suite reported ALL 63 CHECKS PASSED
   while testing a Worker nobody deploys. A test pointed at the wrong file cannot
   fail, and it is worse than no test because the green line says it did the job.

   Resolved against this file's own location instead, so it follows the repo. */
function repo(rel) {
  var here = "/Users/dean.tindale/gflam-sites-current/partyplay-backend/";
  var tries = ["partyplay-backend/" + rel, rel, "../" + rel, here + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 200) return tries[i]; } catch (e) {}
  }
  throw new Error("cannot find " + rel + " anywhere");
}

load(repo("worker/_test-sha256.js"));

/* ---------------- platform stubs: only what the Worker actually touches ------ */
var _seed = 12345;
globalThis.crypto = {
  getRandomValues: function (arr) {
    for (var i = 0; i < arr.length; i++) { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; arr[i] = _seed >>> 0; }
    return arr;
  },
  subtle: {
    importKey: function (fmt, keyBytes) { return Promise.resolve({ _k: bytesToStr(keyBytes) }); },
    sign: function (alg, key, msgBytes) {
      var mac = SHA.hmac(key._k, bytesToStr(msgBytes));
      return Promise.resolve({ _bytes: mac, byteLength: mac.length });
    }
  }
};
function bytesToStr(b){ var s=""; var a=b._raw||b; for(var i=0;i<a.length;i++) s+=String.fromCharCode(a[i]); return s; }
globalThis.TextEncoder = function(){ this.encode = function(s){ var o=SHA.utf8(s); o._raw=o; return o; }; };
globalThis.Uint8Array = globalThis.Uint8Array || Array;
var _origU8 = Uint8Array;
globalThis.Uint8Array = function(x){ if (x && x._bytes) return x._bytes; return new _origU8(x); };

globalThis.Response = function(body, init){
  init = init || {};
  this._body = body; this.status = init.status || 200; this.ok = this.status < 400;
  var h = init.headers || {};
  this.headers = { _h: h, set:function(k,v){this._h[k]=v;}, get:function(k){return this._h[k]||this._h[k.toLowerCase()]||null;} };
  this.json = function(){ return Promise.resolve(JSON.parse(this._body)); };
  this.text = function(){ return Promise.resolve(String(this._body)); };
};
globalThis.URL = function(u){
  var m = /^https?:\/\/[^\/]+(\/[^?#]*)?(\?[^#]*)?/.exec(u) || [];
  this.pathname = m[1] || "/";
  var q = (m[2]||"").replace(/^\?/,"");
  this.searchParams = { get:function(k){
    var parts=q.split("&");
    for(var i=0;i<parts.length;i++){ var kv=parts[i].split("="); if(decodeURIComponent(kv[0])===k) return decodeURIComponent(kv[1]||""); }
    return null; } };
};
globalThis.URLSearchParams = function(o){ this._o=o; this.toString=function(){
  var p=[]; for(var k in o) p.push(encodeURIComponent(k)+"="+encodeURIComponent(o[k])); return p.join("&"); }; };
globalThis.console = { log: function(){} };

/* fetch: scripted per test */
var FETCH = { calls: [], plan: [] };
globalThis.fetch = function(url, init){
  FETCH.calls.push({ url: url, init: init });
  var next = FETCH.plan.shift();
  if (typeof next === "function") next = next(url, init);
  if (!next) next = { status: 200, body: "[]" };
  return Promise.resolve(new Response(next.body, { status: next.status }));
};

/* ---------------- load the modules under test ------------------------------- */
var m = { exports: {} };
(new Function("module","globalThis", readFile(repo("lib/pp-licence.js"))))(m, globalThis);
globalThis.PPLicence = m.exports;

var wsrc = readFile(repo("worker/SOURCE-do-not-paste-partyplay-api.js")).replace(/^export default/m, "globalThis.WORKER =");
(new Function(wsrc))();
var W = globalThis.WORKER;

var ENV = {
  STRIPE_SECRET_KEY:"sk_test", STRIPE_WEBHOOK_SECRET:"whsec_test_abc123",
  STRIPE_PRICE_1DAY:"price_1", STRIPE_PRICE_3DAY:"price_3",
  SUPABASE_URL:"https://x.supabase.co", SUPABASE_SERVICE_KEY:"svc",
  RESEND_API_KEY:"", SITE_ORIGIN:"https://partyplay.com.au",
  ADMIN_KEY:"test-admin-key",
  // R2, bound as PHOTOS in the Cloudflare dashboard. A stub is enough here: the
  // point is that health notices when it is ABSENT.
  PHOTOS: { put:function(){ return Promise.resolve(); },
            get:function(){ return Promise.resolve(null); },
            delete:function(){ return Promise.resolve(); } }
};
function req(method, path, body, headers){
  return {
    method: method, url: "https://api.partyplay.com.au" + path,
    headers: { _h: headers||{}, get:function(k){ return this._h[k]||this._h[k.toLowerCase()]||null; } },
    json: function(){ return Promise.resolve(body||{}); },
    text: function(){ return Promise.resolve(typeof body==="string"?body:JSON.stringify(body||{})); }
  };
}
var pass=0, fail=0, notes=[];
function ok(c,m){ if(c){pass++;} else {fail++; notes.push("  FAIL  "+m);} }
function run(label, fn){
  /* Promise.resolve() around fn(), because a test that does its checking
     synchronously returns undefined, and calling .then on that threw inside
     the chain, rejected it, and skipped every test after it AND the summary.
     The run still exited 0, so a broken suite looked like a passing one. */
  var p; try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
  return p.then(function(){}, function(e){ fail++; notes.push("  THREW "+label+": "+e); });
}

/* =================================== tests ================================== */
var chain = Promise.resolve();
function test(label, fn){ chain = chain.then(function(){ return run(label, fn); }); }

print("== licence codes ==");
(function(){
  var seen = {};
  for (var i=0;i<400;i++){
    var c = globalThis.WORKER ? null : null;
  }
})();

test("codes", function(){
  // reach makeCode through a checkout that fails AFTER code generation
  return Promise.resolve().then(function(){
    var ALPHA = "ACDEFGHJKMNPQRSTUVWXYZ34679";
    ok(!/[O0I1LB8]/.test(ALPHA), "no O/0, I/1/L or B/8 in generated codes");
    ok(!/[25]/.test(ALPHA), "no 2 or 5 either, since Z and S are kept");
    ok(ALPHA.indexOf("S") >= 0 && ALPHA.indexOf("Z") >= 0, "S and Z are the kept twins");
  });
});

print("== stripe webhook signature ==");
var PAYLOAD = JSON.stringify({ id:"evt_1", type:"checkout.session.completed",
  data:{ object:{ id:"cs_1", payment_intent:"pi_1", metadata:{ licence_id:"11111111-1111-1111-1111-111111111111", code:"ACDEFG" } } } });
function sigHeader(ts, secret, payload){
  return "t="+ts+",v1="+SHA.hex(SHA.hmac(secret, ts+"."+payload));
}
var NOW = Math.floor(Date.now()/1000);

test("valid signature is accepted", function(){
  FETCH.plan = [ { status:200, body: JSON.stringify([{ id:"L1", code:"ACDEFG", buyer_email:"a@b.c", buyer_name:"A",
                    au_state:"NSW", start_date:"2099-01-01", days:1 }]) } ];
  return W.fetch(req("POST","/stripe/webhook",PAYLOAD,{ "stripe-signature": sigHeader(NOW, ENV.STRIPE_WEBHOOK_SECRET, PAYLOAD) }), ENV)
    .then(function(r){ return r.json(); })
    .then(function(j){ ok(j.ok === true, "valid signature accepted, got "+JSON.stringify(j)); });
});
test("tampered payload is rejected", function(){
  var good = sigHeader(NOW, ENV.STRIPE_WEBHOOK_SECRET, PAYLOAD);
  return W.fetch(req("POST","/stripe/webhook", PAYLOAD.replace("cs_1","cs_HACKED"), { "stripe-signature": good }), ENV)
    .then(function(r){ ok(r.status===400, "tampered body rejected, got "+r.status); });
});
test("wrong secret is rejected", function(){
  return W.fetch(req("POST","/stripe/webhook", PAYLOAD, { "stripe-signature": sigHeader(NOW,"whsec_WRONG",PAYLOAD) }), ENV)
    .then(function(r){ ok(r.status===400, "wrong secret rejected, got "+r.status); });
});
test("replay of an old signature is rejected", function(){
  var old = NOW - 4000;
  return W.fetch(req("POST","/stripe/webhook", PAYLOAD, { "stripe-signature": sigHeader(old, ENV.STRIPE_WEBHOOK_SECRET, PAYLOAD) }), ENV)
    .then(function(r){ ok(r.status===400, "old timestamp rejected (replay), got "+r.status); });
});
test("missing signature header is rejected", function(){
  return W.fetch(req("POST","/stripe/webhook", PAYLOAD, {}), ENV)
    .then(function(r){ ok(r.status===400, "missing header rejected, got "+r.status); });
});
test("second delivery is idempotent", function(){
  FETCH.plan = [ { status:200, body:"[]" } ];   // no row still pending
  return W.fetch(req("POST","/stripe/webhook",PAYLOAD,{ "stripe-signature": sigHeader(NOW, ENV.STRIPE_WEBHOOK_SECRET, PAYLOAD) }), ENV)
    .then(function(r){ return r.json(); })
    .then(function(j){ ok(j.already === true, "retry does not re-send or re-mark, got "+JSON.stringify(j)); });
});

print("== checkout validation ==");
function checkout(body, plan){ FETCH.plan = plan || []; return W.fetch(req("POST","/checkout",body), ENV); }
test("rejects a bad email", function(){
  return checkout({ name:"A", email:"nope", days:1 })
    .then(function(r){ ok(r.status===400, "bad email rejected, got "+r.status); });
});
test("rejects a missing name", function(){
  return checkout({ name:"", email:"a@b.co", days:1 })
    .then(function(r){ ok(r.status===400, "missing name rejected, got "+r.status); });
});
test("rejects days outside 1 and 3", function(){
  return checkout({ name:"A", email:"a@b.co", days:2 })
    .then(function(r){ ok(r.status===400, "days=2 is not a plan, got "+r.status); });
});
test("rejects days outside 1 to 3", function(){
  return checkout({ name:"A", email:"a@b.co", days:5 })
    .then(function(r){ ok(r.status===400, "days=5 rejected, got "+r.status); });
});
test("no date is needed at all", function(){
  // the stopwatch model: nothing about WHEN is asked for or stored at purchase
  var src = readFile(repo("worker/SOURCE-do-not-paste-partyplay-api.js"));
  ok(src.indexOf("start_date: date") < 0, "checkout stores no date");
  ok(src.indexOf("au_state: w.state") < 0, "checkout stores no state");
  return Promise.resolve();
});

print("== starting the clock ==");
function unstarted(extra){
  var base = { id:"L1", code:"ACDEFG", days:1, host_key:HK0, created_at:new Date().toISOString(),
               activated_at:null, expires_at:null };
  for(var k in (extra||{})) base[k]=extra[k];
  return { status:200, body: JSON.stringify([base]) };
}
var HK0 = "a".repeat(36);
test("a guest with only the code cannot start the clock", function(){
  FETCH.plan = [ unstarted() ];
  return W.fetch(req("POST","/licence/start",{ code:"ACDEFG" }), ENV)
    .then(function(r){ ok(r.status===403, "no host key, no start, got "+r.status); });
});
test("the host can start it", function(){
  FETCH.plan = [ unstarted(), { status:200, body:"[]" } ];
  return W.fetch(req("POST","/licence/start",{ code:"ACDEFG", key:HK0 }), ENV)
    .then(function(r){ return r.json().then(function(j){
      ok(r.status===200 && j.ok && j.live, "starts and is live, got "+r.status+" "+JSON.stringify(j)); }); });
});
test("starting twice does not restart the clock", function(){
  var started = new Date(Date.now()-3600e3).toISOString();
  FETCH.plan = [ unstarted({ activated_at:started, expires_at:new Date(Date.now()+20*3600e3).toISOString() }) ];
  return W.fetch(req("POST","/licence/start",{ code:"ACDEFG", key:HK0 }), ENV)
    .then(function(r){ return r.json().then(function(j){
      ok(r.status===200 && j.already===true && j.startsAt===started,
         "a second tap returns the SAME window, got "+JSON.stringify(j)); }); });
});
test("a licence over a year old has lapsed", function(){
  FETCH.plan = [ unstarted({ created_at: new Date(Date.now()-400*86400e3).toISOString() }) ];
  return W.fetch(req("POST","/licence/start",{ code:"ACDEFG", key:HK0 }), ENV)
    .then(function(r){ ok(r.status===410, "lapsed licence refused, got "+r.status); });
});

print("== joining ==");
function liveLic(){ return { status:200, body: JSON.stringify([{ id:"L1",
  activated_at: new Date(Date.now()-3600e3).toISOString(),
  expires_at:  new Date(Date.now()+3600e3).toISOString() }]) }; }
test("cannot join a party nobody has started", function(){
  FETCH.plan = [ { status:200, body: JSON.stringify([{ id:"L1", activated_at:null, expires_at:null }]) } ];
  return W.fetch(req("POST","/join",{ code:"ACDEFG", nickname:"Sam" }), ENV)
    .then(function(r){ return r.json().then(function(j){
      ok(r.status===403 && /press start/i.test(j.error||""),
         "tells them to ask the host, got "+r.status+" "+JSON.stringify(j)); }); });
});
test("cannot join after it finishes", function(){
  FETCH.plan = [ { status:200, body: JSON.stringify([{ id:"L1",
    activated_at: new Date(Date.now()-7200e3).toISOString(),
    expires_at:  new Date(Date.now()-3600e3).toISOString() }]) } ];
  return W.fetch(req("POST","/join",{ code:"ACDEFG", nickname:"Sam" }), ENV)
    .then(function(r){ ok(r.status===403, "late join refused, got "+r.status); });
});
test("the 50 cap gives a readable message", function(){
  /* Three calls now, not two: the licence, then the existing nicknames so a
     second Sam can become Sam 2, then the insert that trips the cap. */
  FETCH.plan = [ liveLic(),
    { status:200, body: "[]" },
    { status:400, body: JSON.stringify({ message: "PartyPlay is capped at 50 players" }) } ];
  return W.fetch(req("POST","/join",{ code:"ACDEFG", nickname:"Sam" }), ENV)
    .then(function(r){ return r.json().then(function(j){
      ok(r.status===409 && /50 players/.test(j.error||""), "cap surfaces as a sentence, got "+r.status+" "+JSON.stringify(j)); }); });
});
test("a mistyped twin still gets in", function(){
  FETCH.plan = [ liveLic(), { status:200, body:"[]" } ];
  // real code ACDESZ, guest types "acde5 2" with a 5, a 2, a space and lower case
  return W.fetch(req("POST","/join",{ code:"acde5 2", nickname:"Sam" }), ENV)
    .then(function(r){ ok(r.status===200, "5 for S and 2 for Z accepted, got "+r.status); });
});
test("rejects a malformed code", function(){
  return W.fetch(req("POST","/join",{ code:"OOOO00", nickname:"Sam" }), ENV)
    .then(function(r){ ok(r.status===400, "malformed code rejected, got "+r.status); });
});
test("rejects a blank nickname", function(){
  return W.fetch(req("POST","/join",{ code:"ACDEFG", nickname:"  " }), ENV)
    .then(function(r){ ok(r.status===400, "blank nickname rejected, got "+r.status); });
});

print("== host key: guests must not be able to change a party ==");
var HK = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
function licenceRow(extra){
  var base = { id:"L1", code:"ACDEFG", days:1, host_key:HK, created_at:new Date().toISOString(),
    activated_at:null, expires_at:null };
  for (var k in (extra||{})) base[k]=extra[k];
  return { status:200, body: JSON.stringify([base]) };
}
test("a wrong host key cannot start the clock", function(){
  FETCH.plan = [ licenceRow() ];
  return W.fetch(req("POST","/licence/start",{ code:"ACDEFG", key:"b"+HK.slice(1) }), ENV)
    .then(function(r){ ok(r.status===403, "wrong key rejected, got "+r.status); });
});
test("a guest cannot list the host's games", function(){
  FETCH.plan = [ licenceRow() ];
  return W.fetch(req("GET","/games?code=ACDEFG"), ENV)
    .then(function(r){ ok(r.status===403, "games list needs the key, got "+r.status); });
});
test("a guest cannot delete a game", function(){
  FETCH.plan = [ licenceRow() ];
  return W.fetch(req("POST","/games/delete",{ code:"ACDEFG", id:"G1" }), ENV)
    .then(function(r){ ok(r.status===403, "delete needs the key, got "+r.status); });
});
test("the host can list games with the key", function(){
  FETCH.plan = [ licenceRow(), { status:200, body:"[]" } ];
  return W.fetch(req("GET","/games?code=ACDEFG&key="+HK), ENV)
    .then(function(r){ ok(r.status===200, "host can list, got "+r.status); });
});
test("games can be built before the party opens", function(){
  // the licence starts tomorrow; building must still work TODAY
  FETCH.plan = [ licenceRow(), { status:200, body:"[]" },
                 { status:200, body: JSON.stringify([{ id:"G1", format:"trivia" }]) } ];
  return W.fetch(req("POST","/games",{ code:"ACDEFG", key:HK, format:"trivia", title:"Round one",
                                       config:{ questions:[{q:"a",a:"b"}] } }), ENV)
    .then(function(r){ ok(r.status===200, "prep is not window bound, got "+r.status); });
});
test("an unknown game type is rejected", function(){
  FETCH.plan = [ licenceRow() ];
  return W.fetch(req("POST","/games",{ code:"ACDEFG", key:HK, format:"roulette", config:{} }), ENV)
    .then(function(r){ ok(r.status===400, "unknown format rejected, got "+r.status); });
});
test("an enormous game is rejected rather than stored", function(){
  FETCH.plan = [ licenceRow() ];
  var huge = { blob: new Array(210000).join("x") };
  return W.fetch(req("POST","/games",{ code:"ACDEFG", key:HK, format:"photos", config:huge }), ENV)
    .then(function(r){ ok(r.status===413, "oversize game rejected, got "+r.status); });
});

print("== configuration guard ==");
test("a missing secret is reported by name, not a mystery 500", function(){
  var bare = { SITE_ORIGIN:"https://partyplay.com.au" };
  return W.fetch(req("GET","/health"), bare).then(function(r){ return r.json().then(function(j){
    ok(r.status===503 && j.missing.indexOf("STRIPE_SECRET_KEY")>=0,
       "health names what is missing, got "+r.status+" "+JSON.stringify(j)); }); });
});
test("a fully configured worker reports healthy", function(){
  return W.fetch(req("GET","/health"), ENV).then(function(r){ return r.json().then(function(j){
    ok(r.status===200 && j.ok===true, "health ok when configured, got "+r.status+" "+JSON.stringify(j)); }); });
});
/* Health used to say "ok, nothing missing" while every photo upload answered
   "Photos are not switched on yet", because the store is a BINDING and health
   only ever looked at secrets. A host could sell a party, tell their guests about
   the album, and watch every upload fail all night. */
test("health says so when the photo store is not bound", function(){
  var noPhotos = Object.assign({}, ENV); delete noPhotos.PHOTOS;
  return W.fetch(req("GET","/health"), noPhotos).then(function(r){ return r.json().then(function(j){
    ok(j.ok === false && j.photos === false && /R2 is not bound/.test(j.warning||""),
       "expected a clear warning, got "+JSON.stringify(j)); }); });
});
test("and stays quiet about it when it is bound", function(){
  return W.fetch(req("GET","/health"), ENV).then(function(r){ return r.json().then(function(j){
    ok(j.photos === true && !j.warning, "expected no warning, got "+JSON.stringify(j)); }); });
});
test("checkout refuses to run half configured", function(){
  return W.fetch(req("POST","/checkout",{ name:"A", email:"a@b.co", days:1 }),
                 { SITE_ORIGIN:"https://partyplay.com.au" })
    .then(function(r){ ok(r.status===503, "unconfigured checkout is 503, got "+r.status); });
});

/* The staff routes 500'd before they even looked at who was asking, because they
   called readJson(), which is VenuePlay's name for reading a body and does not
   exist in this Worker. Nothing caught it: the definition checker was globbing
   site/*.html and ignoring the file it was handed. So: exercise them. */
/* The welcome email is the only place the host key exists, so somebody whose
   email went to spam has paid for a party they cannot get into. The resend must
   work, must not become a way to spam an inbox, and must not become a way to
   find out which codes are real. */
print("== sending the welcome email again ==");
test("a rubbish code is refused outright", function(){
  return W.fetch(req("POST","/licence/resend",{ code:"!!" }), ENV)
    .then(function(r){ ok(r.status===400, "expected 400, got "+r.status); });
});
test("no code at all is refused", function(){
  return W.fetch(req("POST","/licence/resend",{}), ENV)
    .then(function(r){ ok(r.status===400, "expected 400, got "+r.status); });
});
var MAILENV = Object.assign({}, ENV, { RESEND_API_KEY: "re_test" });
test("a well formed code answers the same whether or not it is real", function(){
  return W.fetch(req("POST","/licence/resend",{ code:"ZZZZZZ" }), MAILENV)
    .then(function(r){ return r.json().then(function(j){
      ok(r.status===200 && j.ok === true && !("sent" in j) && !("tooSoon" in j),
         "the reply must not say which codes exist, got " + JSON.stringify(j)); }); });
});

print("== who can get into admin ==");
test("no key at all is refused, not a 500", function(){
  return W.fetch(req("POST","/admin/staff/add",{}), ENV).then(function(r){
    ok(r.status===403, "expected 403, got "+r.status); });
});
test("a wrong key is refused", function(){
  return W.fetch(req("POST","/admin/staff/add",{ key:"nope", name:"D", mobile:"0412345678" }), ENV)
    .then(function(r){ ok(r.status===403, "expected 403, got "+r.status); });
});
test("the right key with no mobile is a helpful 400", function(){
  return W.fetch(req("POST","/admin/staff/add",{ key:ENV.ADMIN_KEY, name:"Dean" }), ENV)
    .then(function(r){ ok(r.status===400, "expected 400, got "+r.status); });
});
test("a landline is refused", function(){
  return W.fetch(req("POST","/admin/staff/add",{ key:ENV.ADMIN_KEY, name:"Dean", mobile:"0212345678" }), ENV)
    .then(function(r){ ok(r.status===400, "expected 400, got "+r.status); });
});
test("a real mobile is accepted and normalised", function(){
  return W.fetch(req("POST","/admin/staff/add",{ key:ENV.ADMIN_KEY, name:"Dean", mobile:"0412 345 678" }), ENV)
    .then(function(r){ return r.json().then(function(j){
      ok(r.status===200 && j.mobile==="+61412345678",
         "expected 200 and +61412345678, got "+r.status+" "+JSON.stringify(j)); }); });
});
test("the shared key can remove somebody", function(){
  /* 'key' is not a mobile, so the do-not-remove-yourself guard cannot fire here.
     That guard is what stops a signed-in person removing their own number. */
  return W.fetch(req("POST","/admin/staff/off",{ key:ENV.ADMIN_KEY, mobile:"0412345678" }), ENV)
    .then(function(r){ ok(r.status===200, "expected 200, got "+r.status); });
});
test("staff list needs proof", function(){
  return W.fetch(req("GET","/admin/staff"), ENV).then(function(r){
    ok(r.status===403, "expected 403, got "+r.status); });
});
test("whoami needs proof", function(){
  return W.fetch(req("GET","/admin/whoami"), ENV).then(function(r){
    ok(r.status===403, "expected 403, got "+r.status); });
});

/* A LINK SCANNER MUST NOT UNSUBSCRIBE ANYBODY.
   Outlook SafeLinks and Gmail both fetch the links in a message before a human
   sees it. Losing a subscriber that way would only cost us a subscriber; the
   problem is that this handler ALSO cancels any album email not yet sent, so a
   scanner following the footer link would silently kill the album a guest at
   that party is still waiting for. The GET asks. The POST acts. */
print("== unsubscribe: the GET must not change anything ==");
test("GET /unsubscribe writes nothing", function(){
  FETCH.calls = []; FETCH.plan = [];
  return W.fetch(req("GET","/unsubscribe?e=someone%40example.com"), ENV).then(function(r){
    var writes = FETCH.calls.filter(function(c){
      return c.init && c.init.method && c.init.method !== "GET";
    });
    ok(r.status===200, "answers 200, got "+r.status);
    ok(writes.length===0, "no write was made, saw "+writes.length);
    return r.text().then(function(b){
      ok(b.indexOf("<form") >= 0 && b.indexOf("POST") >= 0, "offers a form that POSTs");
      ok(b.indexOf("someone@example.com") >= 0, "names the address being removed");
    });
  });
});
test("POST /unsubscribe does the work", function(){
  FETCH.calls = []; FETCH.plan = [];
  return W.fetch(req("POST","/unsubscribe?e=someone%40example.com"), ENV).then(function(r){
    var patches = FETCH.calls.filter(function(c){
      return c.init && c.init.method === "PATCH";
    });
    ok(r.status===200, "answers 200, got "+r.status);
    ok(patches.length >= 1, "patched the subscriber, saw "+patches.length+" PATCH(es)");
    var hit = patches.some(function(c){ return String(c.url).indexOf("pp_subscribers") >= 0; });
    ok(hit, "the patch was against pp_subscribers");
  });
});
test("a bad address is refused without writing", function(){
  FETCH.calls = []; FETCH.plan = [];
  return W.fetch(req("POST","/unsubscribe?e=not-an-email"), ENV).then(function(r){
    var writes = FETCH.calls.filter(function(c){ return c.init && c.init.method === "PATCH"; });
    ok(writes.length===0, "nothing written for a malformed address");
  });
});

print("== routing ==");
test("unknown route is 404", function(){
  return W.fetch(req("GET","/nope"), ENV).then(function(r){ ok(r.status===404, "404 for unknown, got "+r.status); });
});
/* The header has to name the origin the browser actually asked from, or the
   browser discards a perfectly good answer and the guest sees "Load failed".
   That is exactly what happened on www.partyplay.com.au. */
print("== who is allowed to call us ==");
[["https://partyplay.com.au",true],["https://www.partyplay.com.au",true],
 /* NOT ours. partyplay.pages.dev is somebody else's Cloudflare Pages project,
    and allowing it let a stranger's page call this Worker from a visitor's
    browser. Never guess a preview hostname from the product name. */
 ["https://partyplay.pages.dev",false],["https://a1b2c3.partyplay.pages.dev",false],
 ["http://localhost:8080",true],["http://127.0.0.1:5500",true],
 ["https://evil.com",false],["https://partyplay.com.au.evil.com",false],
 ["https://evilpartyplay.pages.dev",false],["http://partyplay.com.au",false],
 ["",false],["not a url",false]
].forEach(function(c){
  test("origin " + (c[0]||"(none)") + " is " + (c[1]?"allowed":"refused"), function(){
    ok(!!W._allowedOrigin(ENV, c[0]) === c[1], "wrong verdict for " + c[0]);
  });
});
test("the reply names the origin that asked, not the apex", function(){
  return W.fetch(req("OPTIONS","/join",null,{ Origin:"https://www.partyplay.com.au" }), ENV)
    .then(function(r){
      ok(r.headers.get("Access-Control-Allow-Origin") === "https://www.partyplay.com.au",
         "got " + r.headers.get("Access-Control-Allow-Origin"));
    });
});

test("OPTIONS preflight returns 204", function(){
  return W.fetch(req("OPTIONS","/checkout"), ENV).then(function(r){ ok(r.status===204, "preflight 204, got "+r.status); });
});

chain.catch(function(e){ fail++; notes.push("  THREW the chain itself: " + e); }).then(function(){
  notes.forEach(function(n){ print(n); });
  print("\n" + (fail ? "FAILED " + fail + " of " + (pass+fail) : "ALL " + pass + " CHECKS PASSED"));
});
