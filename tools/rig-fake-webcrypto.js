/* A RIG, not a test. jsc has no WebCrypto, and vp-phonekey.js is nothing but WebCrypto.

   This stands in for crypto.subtle with something that has the ONE property the protocol relies
   on: only the holder of a private key object can produce a signature that verifies under its
   public key. It is not ECDSA and proves nothing about ECDSA. The real curve is exercised in a
   real browser (see the note at the top of tools/test-phones-cannot-be-impersonated.js). What
   this lets a test prove is everything around it: what is signed, what is checked, in what
   order, and what happens when any of it is missing or altered.

   A private key is a secret number. Its public key is that number's fingerprint, and the rig
   keeps the book of which fingerprint belongs to which secret, the way mathematics does for the
   real thing. An attacker in a test gets public keys and messages, never a private key object. */
var __book = {}, __next = 1000;
function __h(bytes, seed) { var h = (2166136261 ^ seed) >>> 0, out = new Uint8Array(32);
  for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; }
  return out; }
function __hex(b) { var s = ''; for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2); return s; }
function TextEncoder() {}
TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(s)); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
var __B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function btoa(s) { var o = '', i = 0; while (i < s.length) { var a = s.charCodeAt(i++), b = s.charCodeAt(i++), c = s.charCodeAt(i++);
  o += __B[a >> 2] + __B[((a & 3) << 4) | (b >> 4)] + (isNaN(b) ? '=' : __B[((b & 15) << 2) | (c >> 6)]) + (isNaN(c) ? '=' : __B[c & 63]); } return o; }
function atob(s) { s = s.replace(/=+$/, ''); var o = '', bits = 0, acc = 0; for (var i = 0; i < s.length; i++) { var v = __B.indexOf(s[i]); if (v < 0) throw new Error('bad base64');
  acc = (acc << 6) | v; bits += 6; if (bits >= 8) { bits -= 8; o += String.fromCharCode((acc >> bits) & 255); } } return o; }
var __store = {};
var localStorage = { getItem: function (k) { return (k in __store) ? __store[k] : null; }, setItem: function (k, v) { __store[k] = String(v); }, removeItem: function (k) { delete __store[k]; } };
var crypto = { subtle: {
  generateKey: function () { var secret = __next++; var pub = __h(new TextEncoder().encode('pub' + secret), 7).slice(0, 32); __book[__hex(pub)] = secret;
    return Promise.resolve({ privateKey: { __secret: secret, __pub: pub }, publicKey: { __pub: pub } }); },
  exportKey: function (fmt, key) { return Promise.resolve(fmt === 'jwk' ? { kty: 'FAKE', d: key.__secret, x: __hex(key.__pub) } : key.__pub.buffer.slice(0)); },
  importKey: function (fmt, data) {
    if (fmt === 'jwk') { var pub = new Uint8Array(data.x.match(/../g).map(function (h) { return parseInt(h, 16); })); return Promise.resolve({ __secret: data.d, __pub: pub }); }
    return Promise.resolve({ __pub: new Uint8Array(data) }); },
  digest: function (alg, data) { return Promise.resolve(__h(new Uint8Array(data), 99).buffer); },
  sign: function (alg, key, data) { if (key.__secret == null) return Promise.reject(new Error('not a private key')); return Promise.resolve(__h(new Uint8Array(data), key.__secret).buffer); },
  verify: function (alg, key, sig, data) { var secret = __book[__hex(key.__pub)]; if (secret == null) return Promise.resolve(false);
    return Promise.resolve(__hex(__h(new Uint8Array(data), secret)) === __hex(new Uint8Array(sig))); } } };
