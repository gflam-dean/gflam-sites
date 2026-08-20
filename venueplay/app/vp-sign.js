/* VenuePlay broadcast-message signing (migrations 38 + 49).
 *
 * WHY. Broadcast games (bingo, members draw, and the instant-UX layer of trivia/musical/raffle) meet
 * on a Supabase Realtime channel whose name is derived from the venue's PUBLIC slug. The channel is
 * therefore guessable, and anyone with the anon key (it is printed in every page) can shout into it:
 * a fake ball, a fake winner, the wrong trivia answer, the TV forced back to ads mid-round. There is
 * no game server to appeal to for broadcast bingo.
 *
 * HOW. Each venue has an ECDSA P-256 keypair (see the game Worker /venue/signing/* routes). The HOST
 * fetches the PRIVATE half (staff-gated) and signs every message it broadcasts. TVs and phones fetch
 * the PUBLIC half (anyone may) and verify every message. In ENFORCE mode a message without a good,
 * fresh signature is dropped instead of rendered.
 *
 * SAFE BY DEFAULT. Every failure path degrades to today's behaviour, never to a black screen:
 *   - host can't get its key  -> sends UNSIGNED (exactly as before signing existed)
 *   - screen can't get a key  -> renders everything (as before)
 *   - enforce is off (phase 2) -> screen renders unsigned messages, just logs a warning
 *   - this script fails to load -> callers fall back to calling onMsg directly (see the pages)
 * Only when a venue is flipped to enforce=true (migration 49) does an unsigned message get dropped.
 *
 * Usage:
 *   Receiver (TV / phone):  VPSign.initReceiver(apiBase, slug)
 *                           ch.on("broadcast",{event:"msg"}, function(e){ VPSign.gate(e.payload, onMsg); });
 *   Sender (host console):  VPSign.initHost(apiBase, slug, getAccessToken)   // returns a Promise
 *                           function send(obj){ VPSign.signSend(obj, rawSend); }
 */
(function () {
  "use strict";
  var TE = new TextEncoder();
  var MAX_AGE_MS = 45000;         // a signed message older than this is treated as a replay
  var NONCE_KEEP = 600;           // remember this many recent nonces to reject instant replays

  var S = {
    apiBase: "", slug: "",
    pubKey: null, privKey: null,  // imported CryptoKey objects (null until ready)
    kid: null, enforce: false,
    ready: false,
    seenNonces: [], seenSet: {},
    chain: Promise.resolve()      // serialises host signing so message order is preserved
  };

  // Message types that are harmless page-lifecycle nudges, not game content. They are honoured even
  // unsigned so admin tools (HQ "reload all TVs", the billing screen refresh) keep working: the worst
  // an attacker does with one is make a TV reload, which comes straight back to its true state.
  var EXEMPT = { tv_reload: 1, screen_refresh: 1, tv_here: 1, hello: 1, rollcall: 1 };

  function b64uFromBytes(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function bytesFromB64u(str) {
    str = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Deterministic JSON: keys sorted at every level, and the signature envelope (_sig,_kid) removed,
  // so the same logical message always hashes to the same bytes on the host and on the screen.
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) { return "[" + v.map(canon).join(",") + "]"; }
    var keys = Object.keys(v).filter(function (k) { return k !== "_sig" && k !== "_kid"; }).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) parts.push(JSON.stringify(keys[i]) + ":" + canon(v[keys[i]]));
    return "{" + parts.join(",") + "}";
  }
  function nonce() {
    var a = new Uint8Array(12);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : (function () { for (var i = 0; i < a.length; i++) a[i] = (i * 53 + 7) & 255; })();
    return b64uFromBytes(a);
  }
  function noteNonce(n) {
    if (!n || S.seenSet[n]) return;
    S.seenSet[n] = 1; S.seenNonces.push(n);
    while (S.seenNonces.length > NONCE_KEEP) { delete S.seenSet[S.seenNonces.shift()]; }
  }
  function importKey(jwk, usage) {
    return window.crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [usage]);
  }
  function subtleOk() { return !!(window.crypto && window.crypto.subtle); }
  // Adopt a key payload from the Worker: import the private (sign) + public (verify) halves, and take
  // the venue's kid + enforce flag. Used by initHost both when a key already exists and after minting.
  function useHostKey(d) {
    S.kid = d.kid || null; S.enforce = !!d.enforce;
    var jobs = [importKey(d.private_jwk, "sign").then(function (k) { S.privKey = k; })];
    if (d.public_jwk) jobs.push(importKey(d.public_jwk, "verify").then(function (k) { S.pubKey = k; }));
    return Promise.all(jobs).then(function () { S.ready = true; });
  }

  var VPSign = {
    // Fetch and import the venue PUBLIC key + enforce flag. `ident` is the venue slug (a string), or
    // an object identifying the venue by whatever the receiver holds: {venue:slug} | {code} | {session}.
    // Never rejects; on any failure the screen keeps working in "can't verify -> render" mode.
    initReceiver: function (apiBase, ident) {
      S.apiBase = apiBase;
      var qs = "";
      if (typeof ident === "string") { S.slug = ident; qs = ident ? "venue=" + encodeURIComponent(ident) : ""; }
      else if (ident && ident.venue) { S.slug = ident.venue; qs = "venue=" + encodeURIComponent(ident.venue); }
      else if (ident && ident.code) { qs = "code=" + encodeURIComponent(ident.code); }
      else if (ident && ident.session) { qs = "session=" + encodeURIComponent(ident.session); }
      if (!subtleOk() || !qs) return Promise.resolve();
      return fetch(apiBase + "/venue/signing/public?" + qs)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.exists || !d.public_jwk) return;
          S.kid = d.kid || null; S.enforce = !!d.enforce;
          return importKey(d.public_jwk, "verify").then(function (k) { S.pubKey = k; S.ready = true; });
        })
        .catch(function () { /* leave pubKey null -> render everything */ });
    },

    // Fetch the venue PRIVATE key (staff-gated). getToken() must return the host's Supabase access
    // token (or a Promise of it). If the venue has no key yet, mint an ECDSA P-256 pair in the browser
    // (the Workers runtime cannot) and store it. Never rejects; on any failure the host sends UNSIGNED.
    initHost: function (apiBase, slug, getToken) {
      S.apiBase = apiBase; S.slug = slug;
      if (!subtleOk() || !slug) return Promise.resolve();
      var token = null;
      return Promise.resolve(getToken ? getToken() : null).then(function (t) {
        token = t;
        if (!token) return null;
        return fetch(apiBase + "/host/signing/private", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
          body: JSON.stringify({ slug: slug })
        }).then(function (r) { return r.ok ? r.json() : null; });
      }).then(function (d) {
        if (!d) return;
        if (d.has_key && d.private_jwk) return useHostKey(d);
        // No key yet for this venue: mint one here, store it, then use whatever the Worker settles on
        // (another host may have minted first; the Worker returns the effective key so we converge).
        S.enforce = !!(d && d.enforce);
        return window.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
          .then(function (kp) { return Promise.all([window.crypto.subtle.exportKey("jwk", kp.publicKey), window.crypto.subtle.exportKey("jwk", kp.privateKey)]); })
          .then(function (jw) {
            return fetch(apiBase + "/host/signing/mint", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
              body: JSON.stringify({ slug: slug, public_jwk: jw[0], private_jwk: jw[1] })
            }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d2) { if (d2 && d2.private_jwk) return useHostKey(d2); });
          });
      }).catch(function () { /* leave privKey null -> send unsigned */ });
    },

    enforcing: function () { return !!S.enforce; },
    keyReady: function () { return !!(S.pubKey || S.privKey); },

    // Sign one message (async). Returns the message with a _ts/_n/_sig/_kid envelope, or the message
    // unchanged if we have no private key yet (so the game never stalls waiting on a key).
    sign: function (payload) {
      if (!S.privKey || !subtleOk()) return Promise.resolve(payload);
      var msg = {}; for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
      msg._ts = Date.now(); msg._n = nonce();
      return window.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, S.privKey, TE.encode(canon(msg)))
        .then(function (sig) { msg._sig = b64uFromBytes(new Uint8Array(sig)); if (S.kid) msg._kid = S.kid; return msg; })
        .catch(function () { return payload; });   // signing failed -> send unsigned rather than nothing
    },

    // Sign obj (order-preserving) then hand the result to rawSend(payload).
    signSend: function (obj, rawSend) {
      S.chain = S.chain.then(function () { return VPSign.sign(obj); }).then(function (signed) {
        try { rawSend(signed); } catch (e) { }
      });
      return S.chain;
    },

    // Verify one message. Resolves to 'ok' | 'unsigned' | 'bad' | 'stale' | 'replay'.
    verify: function (payload) {
      if (!payload || typeof payload !== "object" || !payload._sig) return Promise.resolve("unsigned");
      if (!S.pubKey || !subtleOk()) return Promise.resolve("unsigned");   // can't verify -> treat as unsigned
      if (payload._ts && (Date.now() - payload._ts > MAX_AGE_MS)) return Promise.resolve("stale");
      if (payload._n && S.seenSet[payload._n]) return Promise.resolve("replay");
      var sig;
      try { sig = bytesFromB64u(payload._sig); } catch (e) { return Promise.resolve("bad"); }
      return window.crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, S.pubKey, sig, TE.encode(canon(payload)))
        .then(function (ok) { if (!ok) return "bad"; if (payload._n) noteNonce(payload._n); return "ok"; })
        .catch(function () { return "bad"; });
    },

    // The gate a receiver puts in front of onMsg. Two hard safety rules keep it from ever blanking a
    // real screen:
    //   1. ENFORCE OFF (every venue by default): deliver SYNCHRONOUSLY, exactly as before signing
    //      existed. No async verify sits in the render path, so message order can never change. A
    //      signature is still checked in the background, only to log a suspicious one.
    //   2. ENFORCE ON but we hold NO public key yet (fetch not finished, or it failed): deliver
    //      anyway. We cannot judge a message with no key, and going dark on an infrastructure hiccup
    //      is worse than the spoofing we are guarding against. Enforcement only bites once a key is
    //      actually loaded, which for a paired screen is within a second of load.
    // Only when enforce is ON and a key IS loaded do we drop anything that is not a good signature.
    gate: function (payload, cb) {
      if (!S.enforce) {
        try { cb(payload); } catch (e) { }
        if (S.pubKey && payload && payload._sig) {
          VPSign.verify(payload).then(function (v) { if (v === "bad" || v === "replay") console.warn("[VPSign] " + v + " signature, rendered (enforce off)"); });
        }
        return;
      }
      if (!S.pubKey || !subtleOk()) { try { cb(payload); } catch (e) { } return; }   // no key to verify with -> fail open
      VPSign.verify(payload).then(function (verdict) {
        if (verdict === "ok") { try { cb(payload); } catch (e) { } return; }
        var t = payload && payload.t;
        if (t && EXEMPT[t]) { try { cb(payload); } catch (e) { } return; }           // harmless lifecycle nudge
        console.warn("[VPSign] dropped " + verdict + " message" + (t ? " (" + t + ")" : "") + " (enforce on)");
      });
    }
  };

  window.VPSign = VPSign;
})();
