/* WHERE THE CODE ACTUALLY IS.

   These paths used to point into /Users/dean.tindale/partyplay, a copy of this
   project that stopped being the one we ship. On 3 Sep it was 6.5 KB and 148
   lines behind the repo, so every PartyPlay suite reported all checks passing
   against code nobody deploys. A test pointed at the wrong file cannot fail, and
   that is worse than no test: the green line says it did the job. */
function ppFile(rel) {
  var tries = [rel, "partyplay-backend/" + rel, "../" + rel, "../../" + rel,
               "/Users/dean.tindale/gflam-sites-current/" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 100) return tries[i]; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}

/* TWO PEOPLE CALLED SAM.
 *
 * Ordinary at a party of twenty, and it used to put two identical names on the
 * leaderboard with no way to tell which was yours.
 *
 * Worse: charades and Who am I decide whose phone shows the secret by matching
 * the name. The word goes out tagged "actor: Sam" and every phone belonging to a
 * Sam displayed it, so the one game whose entire point is that exactly one person
 * sees something was broken by two guests sharing a name.
 *
 * This drives the REAL handleJoin out of the DEPLOY build, against a stub
 * database. The deploy build and not the source, because the source has no
 * PPLicence in it: the build inlines it, and testing the source passes on code
 * that could never run.
 *
 *   jsc lib/pp-join-names.test.js
 */
load(ppFile("partyplay-backend/worker/_test-sha256.js"));

globalThis.crypto = { getRandomValues: function (a) { for (var i=0;i<a.length;i++) a[i]=(i*77)%251; return a; }, subtle: {} };
globalThis.TextEncoder = function () { this.encode = function (s) { return SHA.utf8(s); }; };
globalThis.URL = function () { this.pathname = "/join"; this.searchParams = { get: function () { return null; } }; };
globalThis.Response = function (b, i) { this._b = b; this.status = (i || {}).status || 200; };

var PLAYERS = [];
var LICENCE = { id: "L1",
  activated_at: new Date(Date.now() - 3600e3).toISOString(),
  expires_at:  new Date(Date.now() + 3600e3).toISOString() };

function reply(o) { var t = JSON.stringify(o); return Promise.resolve({ ok:true, status:200, text:function(){ return Promise.resolve(t); } }); }
globalThis.fetch = function (u, o) {
  u = String(u); o = o || {};
  if (u.indexOf("pp_licences") >= 0) return reply(LICENCE ? [LICENCE] : []);
  if (u.indexOf("pp_players") >= 0 && o.method === "POST") { PLAYERS.push(JSON.parse(o.body)[0]); return reply([]); }
  if (u.indexOf("pp_players") >= 0) return reply(PLAYERS.map(function (p) { return { nickname: p.nickname }; }));
  return reply([]);
};

var src = readFile(ppFile("partyplay-backend/worker/DEPLOY-partyplay-api.js"))
            .replace(/^export default/m, "var _d =");
var W = new Function(src + "\n; return { handleJoin: handleJoin };")();
var ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "s" };

var pass = 0, fail = 0, notes = [];
function ok(c, m) { if (c) pass++; else { fail++; notes.push("  FAIL  " + m); } }

function join(nick) {
  var req = { method:"POST", url:"https://api.x/join", headers:{ get:function(){ return null; } },
              json: function () { return Promise.resolve({ code:"ACDEFG", nickname:nick }); } };
  return W.handleJoin(req, ENV).then(function (r) { return JSON.parse(r._b); });
}

var chain = Promise.resolve()
  .then(function () { return join("Sam"); })
  .then(function (j) { ok(j.nickname === "Sam", "the first Sam keeps their name, got " + j.nickname); })
  .then(function () { return join("Sam"); })
  .then(function (j) { ok(j.nickname === "Sam 2", "the second becomes Sam 2, got " + j.nickname); })
  .then(function () { return join("sam"); })
  .then(function (j) { ok(j.nickname === "sam 3", "lower case counts as the same name, got " + j.nickname); })
  .then(function () { return join("Nicole"); })
  .then(function (j) { ok(j.nickname === "Nicole", "an unused name is untouched, got " + j.nickname); })
  .then(function () { return join("Sam"); })
  .then(function (j) { ok(j.nickname === "Sam 4", "and it keeps counting, got " + j.nickname); })
  .then(function () {
      var names = PLAYERS.map(function (p) { return p.nickname.toLowerCase(); });
      ok(new Set(names).size === names.length, "every name on the leaderboard is unique: " + names.join(", "));
  })
  // the things that must still be refused
  .then(function () { return join("   "); })
  .then(function (j) { ok(!!j.error, "a blank name is refused"); })
  .then(function () {
      var long = new Array(60).join("x");
      return join(long).then(function (j) {
        ok(!j.error && j.nickname.length <= 24, "a very long name is cut to fit, got " + j.nickname.length);
      });
  })
  .then(function () { LICENCE = null; return join("Late"); })
  .then(function (j) { ok(!!j.error, "no such party is refused"); });

chain.catch(function (e) { fail++; notes.push("  THREW " + e); }).then(function () {
  notes.forEach(function (n) { print(n); });
  print(fail ? "FAILED " + fail + " of " + (pass + fail) : "ALL " + pass + " CHECKS PASSED");
});
