/* PartyPlay: the host signs what it says to the room (15 Oct 2026).
 *
 * WHY. The host console, the telly and every phone meet on one Supabase realtime channel whose name
 * is "pp-" plus the six character code, and that code is on the telly in letters a foot high. The
 * public key that opens the channel is in every page. So anybody who could read the wall could
 * speak AS THE HOST: put "You won" on one guest's phone from a forged draw, put any caption, board
 * or outside photo up on the telly, end a game. Found by the 14 Oct audit.
 *
 * HOW. The same shape as VenuePlay's vp-sign.js, with the party's host key in place of a staff
 * login. Each party has one ECDSA P-256 keypair. A Worker cannot mint one (Cloudflare's runtime has
 * no ECDSA generateKey), so the first console that opens MINTS IT IN THE BROWSER and hands both
 * halves to the Worker through a host-key-authenticated route, which stores them on the licence.
 * Every later console fetches the same pair the same way. The telly and the phones fetch the PUBLIC
 * half (anyone may) and check every message the host sends.
 *
 * NEVER A BLACK TELLY. Every failure falls back to how it worked before signing existed:
 *   - the console cannot get or store a key  -> it sends unsigned, and says so on its own screen
 *   - a screen cannot fetch the public key   -> it renders everything
 *   - the party has no key yet               -> it renders everything (a party already running on
 *                                               the old console when this shipped has no key)
 *   - this file fails to load                -> the pages call onMsg directly
 * Only a screen that HOLDS the party's key drops a message without a good signature.
 *
 *   Console:  PPSign.initHost(api, code, hostKey)          then PPSign.signSend(obj, rawSend)
 *   Screens:  PPSign.initReceiver(api, code)               then PPSign.gate(payload, onMsg)
 */
(function (root) {
  "use strict";
  var SUB = (root.crypto && root.crypto.subtle) || null;
  var ALG = { name: "ECDSA", namedCurve: "P-256" }, SIG = { name: "ECDSA", hash: "SHA-256" };
  /* A night, not a minute. _ts is the console's clock and Date.now() is the telly's, and a cheap
     smart TV with its clock wrong must not throw away every message as stale. In-session replays
     are caught by the nonce list; this only bounds an old capture played back much later. */
  var MAX_AGE_MS = 6 * 60 * 60 * 1000;
  var NONCE_KEEP = 800;
  var KEY_POLL_MS = 2 * 60 * 1000;    // a screen with no key asks again this often (fifty phones: under one call a second)
  var KEY_REFRESH_MS = 5 * 60 * 1000; // and one with a key checks it is still the party's
  var REFETCH_GAP_MS = 30 * 1000;     // a signed message with no key / an unknown kid asks at most this often
  var FETCH_TIMEOUT_MS = 5000;        // a slow Worker must never hold the room's messages for long
  var KEY_WAIT_MS = 4000;             // the console's first send waits this long for its key, no longer
  var HOST_RETRY_MS = 30 * 1000;

  function enc(s) { return new TextEncoder().encode(s); }
  function b64u(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(str) {
    str = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  /* Keys sorted at every level, the envelope left out, so the console and a screen hash the same
     bytes for the same message whatever order the properties were written in. */
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    var keys = Object.keys(v).filter(function (k) { return k !== "_sig" && k !== "_kid" && v[k] !== undefined; }).sort();
    return "{" + keys.map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }
  function nonce() { var a = new Uint8Array(12); root.crypto.getRandomValues(a); return b64u(a); }
  function withTimeout(p, ms) {
    return new Promise(function (res) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; res(null); } }, ms);
      Promise.resolve(p).then(function (v) { if (!done) { done = true; clearTimeout(t); res(v); } },
                              function () { if (!done) { done = true; clearTimeout(t); res(null); } });
    });
  }
  function getJson(url, init) {
    return withTimeout(fetch(url, init).then(function (r) { return r.ok ? r.json() : null; }), FETCH_TIMEOUT_MS);
  }

  var S = {
    api: "", code: "", hostKey: "",
    pub: null, priv: null, kid: null,
    seen: {}, seenList: [],
    sendChain: Promise.resolve(), recvChain: Promise.resolve(),
    keyTried: null, lastAsk: 0, poll: null, refresh: null, hostRetry: null,
    serverHasKey: false, onState: null
  };
  function noteNonce(n) {
    if (!n || S.seen[n]) return;
    S.seen[n] = 1; S.seenList.push(n);
    while (S.seenList.length > NONCE_KEEP) delete S.seen[S.seenList.shift()];
  }
  function importPub(jwk) { return SUB.importKey("jwk", jwk, ALG, false, ["verify"]); }
  function importPriv(jwk) { return SUB.importKey("jwk", jwk, ALG, false, ["sign"]); }
  function forCode(code) {
    /* A different party is a different key. A phone that backs out of one party and joins another
       without reloading must not judge the new party's messages by the old party's key. */
    if (S.code && S.code !== code) {
      S.pub = null; S.priv = null; S.kid = null; S.serverHasKey = false;
      S.seen = {}; S.seenList = []; S.lastAsk = 0;
    }
    S.code = code;
  }

  /* ---------------------------------------------------------------- screens */
  function fetchPublic() {
    var code = S.code;
    if (!SUB || !code) return Promise.resolve(false);
    return getJson(S.api + "/party/signing/public?code=" + encodeURIComponent(code)).then(function (d) {
      if (S.code !== code || !d || !d.exists || !d.public_jwk) return false;
      if (d.kid && d.kid === S.kid && S.pub) return true;
      return importPub(d.public_jwk).then(function (k) {
        if (S.code !== code) return false;
        S.pub = k; S.kid = d.kid || null; S.serverHasKey = true; return true;
      });
    }).catch(function () { return false; });
  }
  function initReceiver(api, code) {
    S.api = api; forCode(code);
    if (!SUB || !code) return Promise.resolve();
    return fetchPublic().then(function () {
      if (!S.poll) S.poll = setInterval(function () { if (!S.pub) fetchPublic(); }, KEY_POLL_MS);
      if (!S.refresh) S.refresh = setInterval(function () { if (S.pub) fetchPublic(); }, KEY_REFRESH_MS);
    });
  }
  function verify(p) {
    if (!p || typeof p !== "object" || !p._sig) return Promise.resolve("unsigned");
    if (!S.pub || !SUB) return Promise.resolve("unsigned");
    if (typeof p._ts !== "number" || Math.abs(Date.now() - p._ts) > MAX_AGE_MS) return Promise.resolve("stale");
    if (!p._n || S.seen[p._n]) return Promise.resolve("replay");
    var sig;
    try { sig = unb64u(p._sig); } catch (e) { return Promise.resolve("bad"); }
    return SUB.verify(SIG, S.pub, sig, enc(canon(p)))
      .then(function (ok) { if (!ok) return "bad"; noteNonce(p._n); return "ok"; })
      .catch(function () { return "bad"; });
  }
  /* What a screen puts in front of onMsg. In order, through one chain, so verifying can never
     reorder two messages the console sent one after the other (a draw's result, then its caption). */
  function gate(payload, cb) {
    S.recvChain = S.recvChain.then(function () {
      var pre = null;
      var signed = !!(payload && payload._sig);
      /* A signed message and no key: the party has one we have not heard about yet (this screen
         opened before the first console did). Ask now rather than at the next poll. Same when
         it is signed under a key id this screen does not hold. */
      /* The gap is between these asks only, not since the screen booted: the console that mints
         the key usually opens seconds after the telly, and its first message must be enough. */
      if (signed && (!S.pub || (payload._kid && payload._kid !== S.kid)) && Date.now() - S.lastAsk > REFETCH_GAP_MS) {
        S.lastAsk = Date.now(); pre = fetchPublic();
      }
      return Promise.resolve(pre).then(function () {
        if (!S.pub || !SUB) { deliver(cb, payload); return; }      // no key for this party: as before signing
        return verify(payload).then(function (v) {
          if (v === "ok") { deliver(cb, payload); return; }
          try { console.warn("[PPSign] dropped a " + v + " message" + (payload && payload.t ? " (" + payload.t + ")" : "")); } catch (e) {}
        });
      });
    }).catch(function () {});
    return S.recvChain;
  }
  function deliver(cb, p) { try { cb(p); } catch (e) { try { console.error(e); } catch (x) {} } }

  /* ---------------------------------------------------------------- the console */
  function useKey(d, code) {
    if (S.code !== code || !d || !d.private_jwk || !d.public_jwk) return null;
    return Promise.all([importPriv(d.private_jwk), importPub(d.public_jwk)]).then(function (k) {
      if (S.code !== code) return;
      S.priv = k[0]; S.pub = k[1]; S.kid = d.kid || null; S.serverHasKey = true;
    });
  }
  function hostAttempt() {
    var code = S.code, key = S.hostKey, api = S.api;
    if (!SUB || !code || !key) return Promise.resolve();
    var post = function (path, body) {
      return getJson(api + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    };
    return post("/party/signing/private", { code: code, key: key }).then(function (d) {
      if (!d || S.code !== code) return;                              // the Worker could not say: try again later
      if (d.exists) { if (d.kid && d.kid === S.kid && S.priv) return; return useKey(d, code); }
      /* No key for this party yet: mint one here and give it to the Worker. If another console got
         there first the Worker keeps the first and answers with it, so every console converges. */
      var kid = "p1_" + nonce().slice(0, 12);
      return SUB.generateKey(ALG, true, ["sign", "verify"]).then(function (kp) {
        return Promise.all([SUB.exportKey("jwk", kp.publicKey), SUB.exportKey("jwk", kp.privateKey)]);
      }).then(function (jw) {
        return post("/party/signing/mint", { code: code, key: key, kid: kid, public_jwk: jw[0], private_jwk: jw[1] });
      }).then(function (d2) { if (d2 && d2.exists) return useKey(d2, code); });   // only a key the Worker holds is used
    }).catch(function () {}).then(function () { report(); });
  }
  /* A CONSOLE THAT CANNOT SIGN MUST SAY SO, but only when it matters: when the party already has a
     key, so the telly and the phones are checking and will ignore this console. A party with no
     key at all (the Worker is down, or migration 16 has not been run) renders unsigned messages
     exactly as before, and a red bar there would be a false alarm. */
  function report() {
    if (typeof S.onState !== "function") return;
    var code = S.code, tell = function (o) { if (S.code === code) { try { S.onState(o); } catch (e) {} } };
    if (S.priv) { tell({ signing: true, ignored: false }); return; }
    getJson(S.api + "/party/signing/public?code=" + encodeURIComponent(code))
      .then(function (d) { tell({ signing: false, ignored: !!(d && d.exists) }); })
      .catch(function () { tell({ signing: false, ignored: false }); });
  }
  function initHost(api, code, hostKey, onState) {
    S.api = api; forCode(code); S.hostKey = hostKey || ""; S.onState = onState || null;
    if (!SUB || !code || !hostKey) { report(); S.keyTried = Promise.resolve(); return S.keyTried; }
    var p = hostAttempt();
    S.keyTried = withTimeout(p, KEY_WAIT_MS);
    /* A console that could not get its key keeps asking: a Worker blip at the moment the host
       opened the page must not leave the whole night unsigned. */
    if (!S.hostRetry) S.hostRetry = setInterval(function () { if (!S.priv) hostAttempt(); }, HOST_RETRY_MS);
    return p;
  }
  function sign(obj) {
    /* Through JSON first, so what is signed is exactly what arrives: a property set to undefined
       is dropped in transit, and must be dropped from the signed bytes too. */
    var msg; try { msg = JSON.parse(JSON.stringify(obj)); } catch (e) { return Promise.resolve(obj); }
    if (!S.priv || !SUB) return Promise.resolve(msg);
    msg._ts = Date.now(); msg._n = nonce();
    return SUB.sign(SIG, S.priv, enc(canon(msg))).then(function (sig) {
      msg._sig = b64u(sig); if (S.kid) msg._kid = S.kid; return msg;
    }).catch(function () { return obj; });
  }
  /* In order, and the first one waits (a few seconds at most) for the key, so a console's opening
     burst does not go out unsigned to a telly that already holds the key and would drop it. */
  function signSend(obj, rawSend) {
    S.sendChain = S.sendChain
      .then(function () { return S.keyTried; })
      .then(function () { return sign(obj); })
      .then(function (m) { try { rawSend(m); } catch (e) {} })
      .catch(function () {});
    return S.sendChain;
  }

  root.PPSign = {
    initReceiver: initReceiver, gate: gate, verify: verify,
    initHost: initHost, sign: sign, signSend: signSend,
    canon: canon, hasKey: function () { return !!S.pub; }, signing: function () { return !!S.priv; }
  };
}(typeof window !== "undefined" ? window : this));
