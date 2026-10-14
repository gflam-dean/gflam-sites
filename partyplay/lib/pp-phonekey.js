/* PartyPlay: a phone proves it is the same phone (15 Oct 2026).
 *
 * WHY. pp-sign.js protects what the HOST says. Nothing protected what a GUEST says. Every phone
 * message ({t:"answer", name:"Alice", ...}) named its sender in plain text on a channel anybody with
 * the code on the telly could join, and the console believed it. So one guest, or a stranger who had
 * read the wall, could answer trivia in Alice's name, raise her hand, or shout FULL HOUSE for her.
 * Found by the 14 Oct audit.
 *
 * HOW. The same shape as VenuePlay's vp-phonekey.js. Each phone mints its own ECDSA P-256 keypair
 * the first time it joins a party, and keeps it (one per party code, so two parties cannot use it to
 * recognise the same person). Its pid IS the fingerprint of its public key: "k1_" + SHA-256 of the
 * key. Every message it sends carries the public key, a counter and a signature over the whole
 * message. The console checks that the key hashes to the pid and that the signature is by that key,
 * so knowing somebody's pid gives you nothing. The pid also goes to the Worker on /join, and the
 * console asks the Worker who each pid is, so the NAME comes from the server, never the message.
 *
 * SAFE BY DEFAULT. A phone with no WebCrypto, or a phone still on the page from before this shipped,
 * sends what it always sent, unsigned. The console still hears those, but only for a name that no
 * key has claimed (see run.html, admitName).
 */
(function (root) {
  "use strict";
  var SUB = (root.crypto && root.crypto.subtle) || null;
  var ALG = { name: "ECDSA", namedCurve: "P-256" }, SIG = { name: "ECDSA", hash: "SHA-256" };
  /* What a guest's phone sends. Anything else (the host's messages, the telly's hello) is not a
     phone message and is never judged here. */
  var PHONE_TYPES = { hello: 1, claim: 1, answer: 1, hand: 1, truths: 1, truthpick: 1, truthvote: 1,
                      pick: 1, photoguess: 1, song: 1, text: 1, pr_guess: 1 };

  function enc(s) { return new TextEncoder().encode(s); }
  function b64u(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(str) {
    var s = atob(String(str).replace(/-/g, "+").replace(/_/g, "/")), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  /* Every field, sorted, the signature itself left out. A guest message is small and every field
     in it is something the console acts on, so none of them may change after signing. */
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    var keys = Object.keys(v).filter(function (k) { return k !== "sig" && v[k] !== undefined; }).sort();
    return "{" + keys.map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }
  function isKeyed(pid) { return typeof pid === "string" && /^k1_[A-Za-z0-9_-]{32}$/.test(pid); }
  function isPhoneMsg(m) { return !!(m && PHONE_TYPES[m.t] === 1); }
  function pidFor(raw) { return SUB.digest("SHA-256", raw).then(function (h) { return "k1_" + b64u(h).slice(0, 32); }); }

  // ---------------------------------------------------------------- the phone
  var _ids = {};
  function store(code) { return "ppKey:" + code; }
  function lastN(code) { try { return Number(localStorage.getItem("ppKeyN:" + code)) || 0; } catch (e) { return 0; } }
  function saveN(code, n) { try { localStorage.setItem("ppKeyN:" + code, String(n)); } catch (e) {} }
  function makeId(code, priv, pk, pid) {
    var n0 = lastN(code);
    return { pid: pid, pk: pk,
      sign: function (msg) {
        var out; try { out = JSON.parse(JSON.stringify(msg)); } catch (e) { out = {}; }
        n0 = Math.max(Date.now(), n0 + 1); saveN(code, n0);
        out.pid = pid; out.n = n0; out.pk = pk;
        return SUB.sign(SIG, priv, enc(canon(out))).then(function (sig) { out.sig = b64u(sig); return out; });
      } };
  }
  function ensure(code) {
    if (_ids[code]) return _ids[code];
    if (!SUB || !code) return Promise.reject(new Error("no WebCrypto"));
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(store(code)) || "null"); } catch (e) { saved = null; }
    var p;
    if (saved && saved.jwk && saved.pk && isKeyed(saved.pid)) {
      p = SUB.importKey("jwk", saved.jwk, ALG, false, ["sign"]).then(function (priv) { return makeId(code, priv, saved.pk, saved.pid); });
    } else {
      p = SUB.generateKey(ALG, true, ["sign", "verify"]).then(function (kp) {
        return Promise.all([SUB.exportKey("jwk", kp.privateKey), SUB.exportKey("raw", kp.publicKey)]).then(function (x) {
          return pidFor(x[1]).then(function (pid) {
            var pk = b64u(x[1]);
            try { localStorage.setItem(store(code), JSON.stringify({ jwk: x[0], pk: pk, pid: pid })); } catch (e) {}
            return makeId(code, kp.privateKey, pk, pid);
          });
        });
      });
    }
    _ids[code] = p.catch(function (e) { delete _ids[code]; throw e; });
    return _ids[code];
  }

  // ---------------------------------------------------------------- the console
  var _pubs = {};   // pid -> imported key, so a room of answers is not fifty imports a question
  /* Resolves { ok, legacy, pid, why }. NEVER rejects: a verify that throws must read as "no". */
  function verify(m) {
    try {
      if (!m || !isPhoneMsg(m)) return Promise.resolve({ ok: false, legacy: false, why: "not a phone message" });
      if (m.sig == null && m.pk == null && !isKeyed(m.pid)) return Promise.resolve({ ok: true, legacy: true, pid: null, why: "unsigned (an older phone)" });
      if (!isKeyed(m.pid)) return Promise.resolve({ ok: false, legacy: false, why: "a key with no proper pid" });
      if (!SUB) return Promise.resolve({ ok: false, legacy: false, why: "this console cannot check" });
      if (typeof m.pk !== "string" || typeof m.sig !== "string" || typeof m.n !== "number" || !isFinite(m.n))
        return Promise.resolve({ ok: false, legacy: false, why: "unsigned message for a keyed pid" });
      var raw = unb64u(m.pk);
      var keyP = _pubs[m.pid] && _pubs[m.pid].pk === m.pk ? Promise.resolve(_pubs[m.pid].key)
        : pidFor(raw).then(function (pid) {
            if (pid !== m.pid) return null;
            return SUB.importKey("raw", raw, ALG, false, ["verify"]).then(function (k) { _pubs[m.pid] = { pk: m.pk, key: k }; return k; });
          });
      return keyP.then(function (key) {
        if (!key) return { ok: false, legacy: false, why: "that key is not this pid" };
        return SUB.verify(SIG, key, unb64u(m.sig), enc(canon(m))).then(function (good) {
          return { ok: !!good, legacy: false, pid: m.pid, why: good ? "" : "bad signature" };
        });
      }).catch(function () { return { ok: false, legacy: false, why: "could not check" }; });
    } catch (e) { return Promise.resolve({ ok: false, legacy: false, why: "could not check" }); }
  }
  /* Newer than anything this console has had from that phone. Call it only AFTER verify says ok,
     or a forger could use up a phone's counter without a signature. There is no absolute age limit,
     unlike VenuePlay's: nothing a guest sends here undoes anything, a replayed answer is refused as
     a duplicate anyway, and a phone whose clock is a day out must still be able to play. */
  function fresh(seen, m) {
    var n = Number(m.n);
    if (!isFinite(n)) return false;
    if (seen[m.pid] != null && n <= seen[m.pid]) return false;
    seen[m.pid] = n;
    return true;
  }

  root.PPPhoneKey = { ensure: ensure, verify: verify, fresh: fresh, isKeyed: isKeyed, isPhoneMsg: isPhoneMsg, canon: canon };
}(typeof window !== "undefined" ? window : this));
