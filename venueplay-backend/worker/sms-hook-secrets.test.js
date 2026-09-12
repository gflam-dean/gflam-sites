/* THE SIGN-IN TEXT MUST KEEP WORKING THROUGH A ROLLBACK.

   The Send SMS hook is what actually delivers a host's sign-in code: Supabase signs the
   request, this Worker verifies the signature and hands the message to Mobile Message. It
   held exactly ONE signing secret.

   VenuePlay moved from the Singapore project to Sydney on 12 Sep 2026, and a Supabase project
   issues its own hook secret. Pointing the Worker at Sydney's would have stopped Singapore's
   hook verifying, which is fine while the move holds and destroys the rollback: going back
   would have left every host unable to receive a code on EITHER project. Worse than the fault
   you were rolling back from, and you would only find out with a room waiting.

   So the secret is a list. This runs the real verifier against real HMAC signatures.

   Run: jsc venueplay-backend/worker/sms-hook-secrets.test.js */
/* jsc has neither WebCrypto nor TextEncoder, so the Worker's verifier cannot run here
   without them. The shim supplies a real SHA-256/HMAC rather than a fake that agrees with
   itself, and the FIRST check below proves it against RFC 4231 before anything is built on
   it. A shim that returned the wrong digest would make every signature in this file match
   every other and the suite would pass while proving nothing at all. */
/* jsc has no WebCrypto and no TextEncoder, so the Worker's verifier cannot run here without
   them. Rather than weaken the verifier to suit the test runner, give the runner the two
   things it lacks: a real SHA-256/HMAC, and a UTF-8 encoder.

   THE SHIM IS CHECKED BEFORE IT IS TRUSTED, against RFC 4231 test case 1. A shim that quietly
   returns the wrong digest would make every signature in this suite agree with every other and
   the whole thing would pass while proving nothing. */
function _sha256(bytes) {
  var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
           0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
           0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
           0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
           0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
           0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
           0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
           0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var l = bytes.length, withOne = l + 1, padTo = ((withOne + 8 + 63) >> 6) << 6;
  var m = new Uint8Array(padTo); m.set(bytes); m[l] = 0x80;
  var bits = l * 8;
  m[padTo-4] = (bits >>> 24) & 255; m[padTo-3] = (bits >>> 16) & 255;
  m[padTo-2] = (bits >>> 8) & 255;  m[padTo-1] = bits & 255;
  var w = new Array(64);
  function rr(x,n){ return (x>>>n)|(x<<(32-n)); }
  for (var off = 0; off < padTo; off += 64) {
    for (var i = 0; i < 16; i++)
      w[i] = (m[off+i*4]<<24)|(m[off+i*4+1]<<16)|(m[off+i*4+2]<<8)|m[off+i*4+3];
    for (i = 16; i < 64; i++) {
      var s0 = rr(w[i-15],7) ^ rr(w[i-15],18) ^ (w[i-15]>>>3);
      var s1 = rr(w[i-2],17) ^ rr(w[i-2],19) ^ (w[i-2]>>>10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (i = 0; i < 64; i++) {
      var S1 = rr(e,6) ^ rr(e,11) ^ rr(e,25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      var S0 = rr(a,2) ^ rr(a,13) ^ rr(a,22);
      var mj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + mj) | 0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
    H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
  }
  var out = new Uint8Array(32);
  for (var j = 0; j < 8; j++) {
    out[j*4]=(H[j]>>>24)&255; out[j*4+1]=(H[j]>>>16)&255;
    out[j*4+2]=(H[j]>>>8)&255; out[j*4+3]=H[j]&255;
  }
  return out;
}
function _hmac(keyBytes, msgBytes) {
  var block = 64, k = keyBytes;
  if (k.length > block) k = _sha256(k);
  var pad = new Uint8Array(block); pad.set(k);
  var ip = new Uint8Array(block), op = new Uint8Array(block);
  for (var i = 0; i < block; i++) { ip[i] = pad[i] ^ 0x36; op[i] = pad[i] ^ 0x5c; }
  var inner = new Uint8Array(block + msgBytes.length);
  inner.set(ip); inner.set(msgBytes, block);
  var ih = _sha256(inner);
  var outer = new Uint8Array(block + 32);
  outer.set(op); outer.set(ih, block);
  return _sha256(outer);
}
function _utf8(str) {
  var out = [], s = unescape(encodeURIComponent(String(str)));
  for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255);
  return new Uint8Array(out);
}
TextEncoder = function () {};
TextEncoder.prototype.encode = function (s) { return _utf8(s); };
crypto = {
  subtle: {
    importKey: function (fmt, bytes) { return Promise.resolve({ _k: bytes }); },
    sign: function (alg, key, data) { return Promise.resolve(_hmac(key._k, data).buffer); }
  }
};

var bad = 0, ran = 0;
function pass(n, c, x) {
  if (typeof n !== "string") throw new Error("name first");
  if (typeof c !== "boolean") throw new Error("condition must be a boolean: " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (x ? "   " + x : "")); if (!c) bad++;
}
function find(rel) {
  var t = [rel, "../" + rel, "../../" + rel];
  for (var i = 0; i < t.length; i++) { try { var s = readFile(t[i]); if (s && s.length > 500) return s; } catch (e) {} }
  throw new Error("cannot open " + rel);
}
function fnbody(src, name) {
  var m = new RegExp("\\n\\s*(?:async\\s+)?function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  var i = src.indexOf("{", m.index), d = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  return null;
}
var SRC = find("venueplay-backend/worker/venueplay-sms-hook.js");
var FIVE_MINUTES_SECONDS = (function () { var m = /FIVE_MINUTES_SECONDS\s*=\s*(\d+)/.exec(SRC); return m ? +m[1] : 300; })();
["base64ToBytes", "bytesToBase64", "constantTimeEqual", "verifySignature"].forEach(function (n) {
  var b = fnbody(SRC, n);
  if (!b) { pass("the Worker still defines " + n, false); return; }
  (0, eval)(b);
});
pass("the real verifier was lifted out of the Worker", typeof verifySignature === "function");
/* BEFORE ANYTHING ELSE: is the HMAC underneath this suite actually HMAC? RFC 4231 case 1. */
(function () {
  function hex(u8) { var s = ""; for (var i = 0; i < u8.length; i++) { var h = u8[i].toString(16); s += h.length < 2 ? "0" + h : h; } return s; }
  var key = new Uint8Array(20); for (var i = 0; i < 20; i++) key[i] = 0x0b;
  pass("the HMAC this suite signs with matches RFC 4231, so its signatures mean something",
       hex(_hmac(key, _utf8("Hi There"))) === "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
})();

/* Two secrets that are genuinely different, in the base64 shape Supabase hands over. */
var SINGAPORE = bytesToBase64(new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]));
var SYDNEY    = bytesToBase64(new Uint8Array([201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,224]));
var STRANGER  = bytesToBase64(new Uint8Array([99,98,97,96,95,94,93,92,91,90,89,88,87,86,85,84,83,82,81,80,79,78,77,76]));

var BODY = JSON.stringify({ user: { phone: "+61497605423" }, sms: { otp: "123456" } });

async function signedRequest(secretB64, opts) {
  opts = opts || {};
  var id = "msg_test";
  var ts = String(opts.ts || Math.floor(Date.now() / 1000));
  var signed = id + "." + ts + "." + BODY;
  var key = await crypto.subtle.importKey("raw", base64ToBytes(secretB64),
              { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  var sig = bytesToBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed))));
  var headers = { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": "v1," + sig };
  return { headers: { get: function (k) { return headers[k.toLowerCase()]; } } };
}

function env(secret) { return { SEND_SMS_HOOK_SECRET: secret }; }

(async function () {
  /* THE CASE THAT EXISTS TODAY: one secret, unchanged behaviour. */
  var r = await verifySignature(await signedRequest(SINGAPORE), BODY, env(SINGAPORE));
  pass("a single secret still verifies its own signature", r.ok === true);
  r = await verifySignature(await signedRequest(STRANGER), BODY, env(SINGAPORE));
  pass("and still refuses anybody else's", r.ok === false, r.reason);

  /* THE MOVE: both projects' hooks must work at once. */
  var BOTH = SYDNEY + "," + SINGAPORE;
  r = await verifySignature(await signedRequest(SYDNEY), BODY, env(BOTH));
  pass("with both listed, the NEW project's hook verifies", r.ok === true);
  r = await verifySignature(await signedRequest(SINGAPORE), BODY, env(BOTH));
  pass("and the OLD one still does, which is what a rollback needs", r.ok === true);
  r = await verifySignature(await signedRequest(STRANGER), BODY, env(BOTH));
  pass("a stranger is still refused with two configured", r.ok === false, r.reason);

  /* TYPED BY HAND UNDER PRESSURE. Spaces, a trailing comma, and one mangled entry. */
  r = await verifySignature(await signedRequest(SYDNEY), BODY, env("  " + SYDNEY + " ,  " + SINGAPORE + " ,"));
  pass("spaces and a trailing comma do not break it", r.ok === true);
  r = await verifySignature(await signedRequest(SINGAPORE), BODY, env("!!!not-base64!!!," + SINGAPORE));
  pass("one mangled secret does not stop the good one being tried", r.ok === true,
       "a rollback list is typed in a hurry");
  r = await verifySignature(await signedRequest(SINGAPORE), BODY, env(",, ,"));
  pass("a list of nothing is refused, not waved through", r.ok === false, r.reason);

  /* THE GUARDS THAT WERE ALREADY THERE MUST SURVIVE. */
  r = await verifySignature(await signedRequest(SINGAPORE), BODY, env(""));
  pass("no secret at all still fails CLOSED", r.ok === false, r.reason);
  r = await verifySignature(await signedRequest(SINGAPORE), BODY, {});
  pass("a missing secret does too", r.ok === false, r.reason);
  r = await verifySignature(await signedRequest(SINGAPORE, { ts: Math.floor(Date.now()/1000) - 99999 }), BODY, env(SINGAPORE));
  pass("an old replayed request is still refused", r.ok === false, r.reason);
  r = await verifySignature({ headers: { get: function () { return null; } } }, BODY, env(SINGAPORE));
  pass("a request with no signature headers is refused", r.ok === false, r.reason);
  /* And the body must be what was signed. */
  r = await verifySignature(await signedRequest(SINGAPORE), JSON.stringify({ user: { phone: "+61400000000" }, sms: { otp: "999999" } }), env(SINGAPORE));
  pass("a tampered body is refused", r.ok === false, r.reason);

  print("");
  print(bad ? (bad + " OF " + ran + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
})();
