/* A BAD TOKEN IS A SIGN-IN PROBLEM, AND THE ANSWER SHOULD SAY SO.

   A break test of the live Workers on 12 Sep 2026 found every unauthorised request refused,
   which is the important part. But one refusal came back wrong:

       Bearer aaa.bbb            401  Malformed token          correct
       Bearer aaaa.bbbb.cccc     500  Something went wrong     same fault, wrong answer

   Three dots and rubbish either side threw inside the header parse, and the router turned the
   throw into a generic 500 with a support code. A host whose stored session has been corrupted
   is told the product is broken, when what they need is to sign in again. Exactly the shape of
   the sign-in screen blaming a host's own phone number for our SMS provider being down, found
   earlier the same day.

   Run: jsc venueplay-backend/worker/token-refusal.test.js */
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
var GAME = find("venueplay-backend/worker/venueplay-game.js");

/* The real refusal machinery, and the real decoders, so a token that is rubbish is rubbish
   here in the same way it is in the Worker. */
function httpError(status, msg) { var e = new Error(msg); e.status = status; e.expose = true; return e; }
["b64urlToString", "b64urlToBytes"].forEach(function (n) {
  var b = fnbody(GAME, n);
  if (b) { (0, eval)(b); } else { pass("the Worker still defines " + n, false); }
});
if (typeof TextEncoder === "undefined") {
  TextEncoder = function () {};
  TextEncoder.prototype.encode = function (s) {
    var out = [], t = unescape(encodeURIComponent(String(s)));
    for (var i = 0; i < t.length; i++) out.push(t.charCodeAt(i) & 255);
    return new Uint8Array(out);
  };
}
/* Only the part before any crypto: everything this suite asks about is decided before a
   signature is ever checked, which is also why none of it can touch the database. */
var body = fnbody(GAME, "verifyJwtHS256");
pass("verifyJwtHS256 is still in the Worker", !!body);
var upToCrypto = body.slice(0, body.indexOf("if (header.alg"));
var probe = new Function("token", "httpError", "b64urlToString", "b64urlToBytes", "TextEncoder",
  upToCrypto.slice(upToCrypto.indexOf("{") + 1) + "\n return 'reached the signature check';");

function refuse(token) {
  try { return { ok: true, got: probe(token, httpError, b64urlToString, b64urlToBytes, TextEncoder) }; }
  catch (e) { return { ok: false, status: e.status, msg: e.message }; }
}

/* THE ONE THAT WAS WRONG. Three segments, none of them a token. */
var r = refuse("aaaa.bbbb.cccc");
pass("three dots and rubbish is a 401, not a 500", r.ok === false && r.status === 401,
     r.ok ? "it got through to the signature check" : (r.status + " " + r.msg));
pass("and it says the token is malformed, so a host knows to sign in again",
     r.ok === false && /malformed/i.test(r.msg || ""), r.msg);

/* The ones that were already right, which must stay right. */
[["", "an empty token"], ["aaa.bbb", "two segments"], ["a.b.c.d", "four segments"]].forEach(function (c) {
  var x = refuse(c[0]);
  pass(c[1] + " is refused with a 401", x.ok === false && x.status === 401, x.status + " " + x.msg);
});

/* A header that decodes but is not an object. */
var notObj = refuse(btoaUrl('"just a string"') + ".e30.c2ln");
pass("a header that is valid JSON but not an object is refused",
     notObj.ok === false && notObj.status === 401, notObj.status + " " + notObj.msg);

/* AND A WELL-FORMED TOKEN MUST STILL GET THROUGH to be judged on its signature. If this
   fails the fix has gone too far and every host is locked out, which is far worse than a
   confusing message. */
var good = refuse(btoaUrl('{"alg":"HS256","typ":"JWT"}') + "." + btoaUrl('{"sub":"x"}') + ".c2lnbmF0dXJl");
pass("a well-formed token still reaches the signature check", good.ok === true, JSON.stringify(good));

function btoaUrl(s) {
  var b = "", chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  var bytes = new TextEncoder().encode(s), i;
  for (i = 0; i < bytes.length; i += 3) {
    var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    b += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    b += (i + 1 < bytes.length) ? chars[(n >> 6) & 63] : "";
    b += (i + 2 < bytes.length) ? chars[n & 63] : "";
  }
  return b;
}

print("");
print(bad ? (bad + " OF " + ran + " FAILED") : ("ALL " + ran + " CHECKS PASSED"));
