/* A NOTE THAT ONLY INFORMS IS SHOWN ONCE PER HOST (20 Oct 2026).

   Dean's split: questions that protect the night or the data are asked every time, the
   Queensland rules every night, and a note that only informs is shown to a host once, with a
   small "i" beside the control to read it again. This RUNS the real /app/vp-ask.js (and its
   PartyPlay twin) in a small fake page and taps the buttons:

     shown the first time, and OK resolves true and remembers it
     not shown again to the same host, on a fresh page load, and the "i" is there instead
     shown again to a different host
     a localStorage that throws (private window, blocked site data) shows it every time and
     never breaks the page
     the "i" reopens the same note, and closes on OK
     plain vpTell is untouched: every time
     the album's Get prints, the one note converted, runs from the real album.html

   Run: jsc venueplay-backend/app/vp-ask-once.test.js
*/
function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel, "../../../" + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 100) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var ASK_VP = find("venueplay/app/vp-ask.js");
var ASK_PP = find("partyplay/lib/vp-ask.js");
var ALBUM = find("partyplay/album.html");

var pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; print("ok  " + m); } else { fail++; print("FAIL  " + m); } }

/* ---- a fake page, just enough DOM for vp-ask.js ---- */
function El(tag, doc) {
  this.tagName = String(tag).toUpperCase(); this.doc = doc; this.children = []; this.parentNode = null;
  this.attrs = {}; this.style = {}; this.listeners = {}; this.id = ""; this.textContent = ""; this.disabled = false;
}
El.prototype.appendChild = function (c) { return this.insertBefore(c, null); };
El.prototype.insertBefore = function (c, ref) {
  if (c.parentNode) c.parentNode.removeChild(c);
  var i = ref ? this.children.indexOf(ref) : -1;
  if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
  c.parentNode = this; return c;
};
El.prototype.removeChild = function (c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; };
Object.defineProperty(El.prototype, "nextSibling", { get: function () {
  if (!this.parentNode) return null; var s = this.parentNode.children; return s[s.indexOf(this) + 1] || null; } });
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return this.attrs[k] == null ? null : this.attrs[k]; };
El.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
El.prototype.click = function () {
  if (this.disabled) return;
  var fs = (this.listeners.click || []).slice();
  for (var i = 0; i < fs.length; i++) fs[i]({ preventDefault: function () {}, target: this });
};
El.prototype.focus = function () { this.doc.activeElement = this; };
El.prototype.select = function () {};
El.prototype.contains = function (n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; };
El.prototype.all = function (out) { out = out || []; for (var i = 0; i < this.children.length; i++) { out.push(this.children[i]); this.children[i].all(out); } return out; };
El.prototype.querySelectorAll = function (sel) {
  var want = sel.toUpperCase().split(","); return this.all().filter(function (e) { return want.indexOf(e.tagName) >= 0; });
};

function makePage(storage) {
  var doc = { activeElement: null, listeners: {} };
  doc.body = new El("body", doc);
  doc.createElement = function (t) { return new El(t, doc); };
  doc.getElementById = function (id) { var a = doc.body.all(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; };
  doc.addEventListener = function () {}; doc.removeEventListener = function () {};
  doc.contains = function (n) { return doc.body.contains(n); };
  var win = { document: doc, addEventListener: function () {}, removeEventListener: function () {} };
  Object.defineProperty(win, "localStorage", { get: function () {
    if (storage === "throws-on-touch") throw new Error("SecurityError: the operation is insecure");
    return storage; } });
  return win;
}
function load(win, src) { (new Function("window", src))(win); return win; }

/* A store that remembers, shared between page loads like a real browser's. */
function memoryStore() {
  var m = {};
  return { m: m, getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
           setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } };
}
var throwing = { getItem: function () { throw new Error("blocked"); }, setItem: function () { throw new Error("QuotaExceededError"); } };

function dialog(win) { return win.document.getElementById("vpAsk"); }
function dialogText(win) { var d = win.document.getElementById("vpAskT"); return d ? d.textContent : ""; }
function tapOK(win) { var b = win.document.getElementById("vpAskGo"); if (b) b.click(); return !!b; }
function control(win) {   // a bar with the button the note is about and a link after it
  var bar = win.document.createElement("div"); win.document.body.appendChild(bar);
  var b = win.document.createElement("button"); b.id = "print"; bar.appendChild(b);
  var after = win.document.createElement("a"); after.id = "after"; bar.appendChild(after);
  return b;
}
function tick() { return new Promise(function (r) { r(); }).then(function () {}).then(function () {}); }

var NOTE = "Changed settings apply from the next draw.";
var steps = Promise.resolve();
function step(f) { steps = steps.then(f); }

[["VenuePlay /app/vp-ask.js", ASK_VP], ["PartyPlay /lib/vp-ask.js", ASK_PP]].forEach(function (pair) {
  var name = pair[0], SRC = pair[1];
  var store = memoryStore(), w, near, first;

  step(function () {
    print("== " + name + ": first time for host u-1 ==");
    w = load(makePage(store), SRC); near = control(w);
    ok(typeof w.vpTellOnce === "function" && typeof w.vpInfo === "function", name + " defines vpTellOnce and vpInfo");
    ok(!w.vpTellOnce.seen("tip", "u-1"), "not seen before");
    first = w.vpTellOnce("tip", NOTE, { user: "u-1", near: near });
    return tick();
  });
  step(function () {
    ok(!!dialog(w) && dialogText(w) === NOTE, "the note is on the page the first time");
    ok(!w.document.getElementById("printInfo"), "no \"i\" yet, before it is read");
    tapOK(w);
    return first;
  });
  step(function (shown) {
    ok(shown === true, "OK resolves true (it was shown)");
    ok(!dialog(w), "OK closes it");
    ok(store.m["vpTellOnce:u-1:tip"] === "1", "remembered for u-1 under this note's key");
    var i = w.document.getElementById("printInfo");
    ok(!!i && near.nextSibling === i, "an \"i\" now sits straight after the control");
    ok(!!i && i.textContent === "i" && i.getAttribute("aria-label"), "it reads i and has a label for a screen reader");

    print("== " + name + ": same host, a fresh page load ==");
    w = load(makePage(store), SRC); near = control(w);
    ok(w.vpTellOnce.seen("tip", "u-1"), "seen for u-1");
    first = w.vpTellOnce("tip", NOTE, { user: "u-1", near: near });
    return tick();
  });
  step(function () {
    ok(!dialog(w), "NOT shown again to the same host");
    return first;
  });
  step(function (shown) {
    ok(shown === false, "resolves false when it was not shown");
    var is = w.document.body.all().filter(function (e) { return e.id === "printInfo"; });
    ok(is.length === 1 && near.nextSibling === is[0], "the \"i\" is there instead, once");
    w.vpTellOnce("tip", NOTE, { user: "u-1", near: near });
    return tick();
  });
  step(function () {
    ok(w.document.body.all().filter(function (e) { return e.id === "printInfo"; }).length === 1, "asking again never adds a second \"i\"");

    print("== " + name + ": the \"i\" reopens it ==");
    w.document.getElementById("printInfo").click();
    return tick();
  });
  step(function () {
    ok(!!dialog(w) && dialogText(w) === NOTE, "tapping the \"i\" shows the same note");
    tapOK(w);
    return tick();
  });
  step(function () {
    ok(!dialog(w), "and OK closes it again");
    w.document.getElementById("printInfo").click();
    return tick();
  });
  step(function () {
    ok(!!dialog(w), "the \"i\" works every time, not just once");
    tapOK(w);

    print("== " + name + ": a different host ==");
    ok(!w.vpTellOnce.seen("tip", "u-2"), "u-1 reading it says nothing about u-2");
    first = w.vpTellOnce("tip", NOTE, { user: "u-2", near: near });
    return tick();
  });
  step(function () {
    ok(!!dialog(w) && dialogText(w) === NOTE, "shown to u-2 the first time");
    tapOK(w); return first;
  });
  step(function (shown) {
    ok(shown === true && store.m["vpTellOnce:u-2:tip"] === "1", "and remembered for u-2 on its own");
    ok(!w.vpTellOnce.seen("other-tip", "u-1"), "a different note is its own key for the same host");

    print("== " + name + ": plain vpTell is still every time ==");
    first = w.vpTell(NOTE);
    return tick();
  });
  step(function () {
    ok(!!dialog(w), "vpTell shows even after the note was read");
    tapOK(w); return first;
  });

  ["throws on every call", "throws on touch"].forEach(function (how) {
    var ws, p1, p2;
    step(function () {
      print("== " + name + ": localStorage " + how + " ==");
      var crashed = null;
      try {
        ws = load(makePage(how === "throws on touch" ? "throws-on-touch" : throwing), SRC);
        near = control(ws);
        ok(ws.vpTellOnce.seen("tip", "u-1") === false, "seen() answers false rather than throwing");
        p1 = ws.vpTellOnce("tip", NOTE, { user: "u-1", near: near });
      } catch (e) { crashed = e; }
      ok(!crashed, "nothing throws" + (crashed ? ": " + crashed : ""));
      return tick();
    });
    step(function () {
      ok(!!dialog(ws), "the note is shown");
      tapOK(ws); return p1;
    });
    step(function (shown) {
      ok(shown === true, "OK still resolves, though the store would not keep it");
      ok(!!ws.document.getElementById("printInfo"), "the \"i\" still goes up");
      p2 = ws.vpTellOnce("tip", NOTE, { user: "u-1", near: near });
      return tick();
    });
    step(function () {
      ok(!!dialog(ws), "and with nowhere to remember it, it is simply shown again");
      tapOK(ws); return p2;
    });
  });
});

/* ---- the one note converted: Get prints on the real album page ---- */
var body = ALBUM.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
function albumPage(store) {
  var w = load(makePage(store), ASK_PP);
  var app = w.document.createElement("div"); app.id = "app"; w.document.body.appendChild(app);
  var bar = null;
  Object.defineProperty(app, "innerHTML", { set: function (h) {
    // The page writes its HTML; build the one bit this test taps: the bar with Get prints.
    app.children = [];
    if (/id="print"/.test(h)) {
      bar = w.document.createElement("div"); app.appendChild(bar);
      var b = w.document.createElement("button"); b.id = "print"; b.textContent = "Get prints"; bar.appendChild(b);
      var a = w.document.createElement("a"); bar.appendChild(a);
    }
  }, get: function () { return ""; } });
  var data = { party: "Sam's 40th", count: 1, photos: [{ id: "p1" }], deleteAfter: null };
  var fetchFn = function () { return Promise.resolve({ json: function () { return data; } }); };
  var USP = function () { this.get = function () { return "abc"; }; };
  (new Function("window", "document", "location", "fetch", "PPConfig", "URLSearchParams", "vpTell", "vpTellOnce", "vpInfo", body))
    (w, w.document, { search: "?share=abc" }, fetchFn, { API: "https://x" }, USP, w.vpTell, w.vpTellOnce, w.vpInfo);
  return w;
}
var store = memoryStore(), aw;
step(function () {
  print("== the album's Get prints (partyplay/album.html) ==");
  aw = albumPage(store); return tick().then(tick);
});
step(function () {
  var b = aw.document.getElementById("print");
  ok(!!b && b.textContent === "Get prints" && !b.disabled, "first visit: Get prints is a live button");
  b.click(); return tick();
});
step(function () {
  ok(!!dialog(aw) && /Printing is coming very soon/.test(dialogText(aw)), "tapping it shows the printing note");
  tapOK(aw); return tick().then(tick);
});
step(function () {
  var b = aw.document.getElementById("print");
  ok(b.disabled && b.textContent === "Prints coming soon", "after OK it says what it means and is not a dead tap");
  ok(!!aw.document.getElementById("printInfo") && b.nextSibling === aw.document.getElementById("printInfo"), "the \"i\" sits beside it");
  aw = albumPage(store); return tick().then(tick);
});
step(function () {
  var b = aw.document.getElementById("print");
  ok(!dialog(aw) && b.disabled && b.textContent === "Prints coming soon", "next visit: no pop-up, the button already says coming soon");
  var i = aw.document.getElementById("printInfo");
  ok(!!i, "and the \"i\" is there from the start");
  if (i) i.click();
  return tick();
});
step(function () {
  ok(!!dialog(aw) && /Printing is coming very soon/.test(dialogText(aw)), "the \"i\" reopens the printing note");
  tapOK(aw);
  var aw2 = albumPage(throwing); return tick().then(tick).then(function () { return aw2; });
});
step(function (aw2) {
  var b = aw2.document.getElementById("print");
  ok(!!b && !b.disabled && b.textContent === "Get prints", "with the store blocked the album still loads, button live");
  b.click(); return tick().then(function () { return aw2; });
});
step(function (aw2) {
  ok(!!dialog(aw2), "and the note shows");
});

steps.then(function () {
  print("");
  print(fail ? "FAILED " + fail + " of " + (pass + fail) : "ALL " + pass + " CHECKS PASSED");
}, function (e) {
  print("FAIL  the suite threw: " + e + (e && e.stack ? "\n" + e.stack : ""));
  print("FAILED");
});
