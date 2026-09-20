/* VenuePlay: a phone proves it is the SAME phone. Broadcast bingo only.
 *
 * WHY. vp-sign.js protects what the HOST says to the room. Nothing protected what a PHONE says to
 * the host. Broadcast bingo has no game server: a phone joins, claims and leaves by shouting
 * {t:"join"|"claim"|"leave", pid} into a channel whose name is a public hash of the venue's slug,
 * and the console believed whoever said it. The only identity was pid, and the host itself
 * broadcasts every pid in the clear when it deals the tickets. So anybody on the channel, from
 * anywhere, could rename Margaret, shout BINGO on her ticket under their own name, or send "leave"
 * for every pid in the room and wipe the tickets people were marking. Found by audit, 20 Sep 2026.
 *
 * HOW. Each phone mints its own ECDSA P-256 keypair the first time it opens a room, and keeps it.
 * Its pid IS the fingerprint of its public key (k1_ + the SHA-256 of the key). Every join, claim and
 * leave carries the public key and a signature. The console checks two things: the key really
 * hashes to that pid, and the signature really is by that key. Nothing has to be remembered or
 * trusted on first use, and knowing a pid gives you nothing, because you cannot sign for it.
 *
 * A replayed message is a real one sent again, so a signature alone does not stop it. Each message
 * carries n, the phone's own clock, which only ever goes up. The console remembers the highest n it
 * has seen per phone and refuses anything that is not newer, and refuses anything more than a day
 * old outright, which is what stops last Saturday's "leave" being played back tonight.
 *
 * SAFE BY DEFAULT, like vp-sign.js. A browser with no WebCrypto keeps the old random pid and sends
 * unsigned, and the console still hears it while LEGACY is allowed (see app/index.html). What is
 * never allowed is an UNSIGNED message about a k1_ pid: that is exactly the forgery.
 */
(function (root) {
  "use strict";
  var SUB = (root.crypto && root.crypto.subtle) || null;
  var ALG = { name: "ECDSA", namedCurve: "P-256" }, SIG = { name: "ECDSA", hash: "SHA-256" };
  var DAY_MS = 24 * 60 * 60 * 1000;
  var PHONE_TYPES = { join: 1, claim: 1, leave: 1 };

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

  /* EXACTLY what is signed. Every field the console acts on is in here, so none of them can be
     changed after signing: who (pid), what (t), when (n), and the name, ticket count and ticket
     number that join and claim carry. An array, so no field can run into the next. */
  function canon(m) {
    return JSON.stringify(["vp-phone-1", String(m.t), String(m.pid), Number(m.n),
      m.name == null ? "" : String(m.name), m.cards == null ? "" : String(m.cards),
      m.cardNo == null ? "" : String(m.cardNo)]);
  }
  function isKeyed(pid) { return typeof pid === "string" && pid.indexOf("k1_") === 0; }
  function isPhoneMsg(m) { return !!(m && PHONE_TYPES[m.t] === 1); }
  function pidFor(pubRaw) {
    return SUB.digest("SHA-256", pubRaw).then(function (h) { return "k1_" + b64u(h).slice(0, 32); });
  }

  // ---------------------------------------------------------------- the phone
  var _ids = {};
  function store(room) { return "vp-key-" + room; }
  function lastN(room) { try { return Number(localStorage.getItem("vp-keyn-" + room)) || 0; } catch (e) { return 0; } }
  function saveN(room, n) { try { localStorage.setItem("vp-keyn-" + room, String(n)); } catch (e) {} }

  function makeId(room, priv, pk, pid) {
    var n0 = lastN(room);
    return { pid: pid, pk: pk,
      sign: function (msg) {
        var out = {}; for (var k in msg) out[k] = msg[k];
        n0 = Math.max(Date.now(), n0 + 1); saveN(room, n0);
        out.pid = pid; out.n = n0; out.pk = pk;
        return SUB.sign(SIG, priv, enc(canon(out))).then(function (sig) { out.sig = b64u(sig); return out; });
      } };
  }
  /* One keypair per ROOM, not per phone. One key everywhere would hand every venue's host the same
     identifier for the same person, which is tracking nobody agreed to. */
  function ensure(room) {
    if (_ids[room]) return _ids[room];
    if (!SUB) return Promise.reject(new Error("no WebCrypto"));
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(store(room)) || "null"); } catch (e) { saved = null; }
    var p;
    if (saved && saved.jwk && saved.pk && saved.pid) {
      p = SUB.importKey("jwk", saved.jwk, ALG, false, ["sign"]).then(function (priv) { return makeId(room, priv, saved.pk, saved.pid); });
    } else {
      p = SUB.generateKey(ALG, true, ["sign", "verify"]).then(function (kp) {
        return Promise.all([SUB.exportKey("jwk", kp.privateKey), SUB.exportKey("raw", kp.publicKey)]).then(function (x) {
          return pidFor(x[1]).then(function (pid) {
            var pk = b64u(x[1]);
            try { localStorage.setItem(store(room), JSON.stringify({ jwk: x[0], pk: pk, pid: pid })); } catch (e) {}
            return makeId(room, kp.privateKey, pk, pid);
          });
        });
      });
    }
    _ids[room] = p.catch(function (e) { delete _ids[room]; throw e; });
    return _ids[room];
  }

  // ---------------------------------------------------------------- the console
  /* Resolves { ok, legacy, why }. NEVER rejects: a verify that throws must read as "no". */
  function verify(m) {
    try {
      if (!m || !isPhoneMsg(m)) return Promise.resolve({ ok: true, legacy: false, why: "not a phone message" });
      if (!isKeyed(m.pid)) return Promise.resolve({ ok: true, legacy: true, why: "legacy pid" });
      if (!SUB) return Promise.resolve({ ok: false, legacy: false, why: "this console cannot verify" });
      if (typeof m.pk !== "string" || typeof m.sig !== "string" || typeof m.n !== "number" || !isFinite(m.n))
        return Promise.resolve({ ok: false, legacy: false, why: "unsigned message for a keyed pid" });
      var raw = unb64u(m.pk);
      return pidFor(raw).then(function (pid) {
        if (pid !== m.pid) return { ok: false, legacy: false, why: "that key is not this pid" };
        return SUB.importKey("raw", raw, ALG, false, ["verify"]).then(function (pub) {
          return SUB.verify(SIG, pub, unb64u(m.sig), enc(canon(m)));
        }).then(function (good) { return { ok: !!good, legacy: false, why: good ? "" : "bad signature" }; });
      }).catch(function () { return { ok: false, legacy: false, why: "could not verify" }; });
    } catch (e) { return Promise.resolve({ ok: false, legacy: false, why: "could not verify" }); }
  }
  /* Newer than anything seen from this phone, and not ancient. `seen` is the console's own map and
     is updated here, so a message is only ever fresh once. Call it AFTER verify says ok, or a forger
     could burn a phone's numbers without a signature. */
  function fresh(seen, m, nowMs) {
    var n = Number(m.n);
    if (!isFinite(n)) return false;
    if (n < nowMs - DAY_MS) return false;
    if (seen[m.pid] != null && n <= seen[m.pid]) return false;
    seen[m.pid] = n;
    return true;
  }

  root.VPPhoneKey = { ensure: ensure, verify: verify, fresh: fresh, isKeyed: isKeyed, isPhoneMsg: isPhoneMsg, canon: canon };
})(typeof window !== "undefined" ? window : this);
