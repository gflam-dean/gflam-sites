/* vp-ask.js: EVERY QUESTION IS ASKED ON THE PAGE, NEVER WITH confirm(), alert() OR prompt() (19 Oct 2026).

   A native browser dialog stops the whole page until somebody answers it: no rendering, no
   websocket, no buttons. A kiosk browser that blocks dialogs answers "no" (or nothing) for the host
   without a word, and under browser automation the console simply froze the moment Open lobby was
   pressed at a venue with an earlier game still open. So every question is asked here instead,
   with the same words and the same answers:

     vpAsk(message, opts)            resolves true (yes) or false (no)       was confirm()
     vpTell(message, opts)           resolves when OK is tapped              was alert()
     vpAskText(message, value, opts) resolves the typed text, or null        was prompt()

   opts: { yes: "OK", no: "Cancel", id: "vpAsk" }. The buttons are #<id>Go and #<id>Cancel, the
   text box #<id>Text. The first paragraph of the message is the heading, the rest the detail.
   Enter answers yes, Escape answers no, Tab stays inside the box, the page's own keyboard
   shortcuts are held off while it is open, and focus goes back where it was afterwards. Questions
   asked while one is open wait their turn.

   ONCE PER HOST (20 Oct 2026, Dean's split). A note that only informs, and changes nothing
   about what happens next, is shown to a signed-in host the first time and not again:

     vpTellOnce(key, message, opts)  resolves true when shown and OK'd, false when already seen
     vpInfo(near, message, opts)     the small "i" beside a control that reopens the note

   opts adds { user: the host's user id, near: the control the note is about }. It is remembered
   per user id per key in localStorage; with no user id it is remembered for this browser. Once
   OK'd, an "i" button sits straight after `near` and shows the note again whenever it is tapped.
   A store that is blocked or throws just means the note shows again: it never stops the page.
   vpTellOnce.seen(key, user) says whether it has been seen, so a page can put the "i" up front.
   NOT for a question, a failure, or anything the host must accept each time: those stay vpAsk
   and vpTell, every time. The Queensland rules acceptance is every night and never uses this.

   The SAME file is served as /app/vp-ask.js (VenuePlay) and /lib/vp-ask.js (PartyPlay). The gate
   fails if the two copies differ, and if any served page calls a native dialog again. */
(function (root) {
  "use strict";
  if (root.vpAsk && root.vpAsk.__vpAsk) return;
  var queue = Promise.resolve();

  function show(kind, message, value, opts) {
    opts = opts || {};
    function run() { return new Promise(function (resolve) { build(kind, message, value, opts, resolve); }); }
    var p = queue.then(run, run);
    queue = p.then(function () {}, function () {});
    return p;
  }

  function build(kind, message, value, opts, resolve) {
    var d = root.document;
    var NO = kind === "ask" ? false : kind === "text" ? null : undefined;
    if (!d || !d.body) { resolve(NO); return; }
    var id = opts.id || "vpAsk";
    var old = d.getElementById(id); if (old && old.parentNode) old.parentNode.removeChild(old);
    var msg = String(message == null ? "" : message);
    var cut = msg.indexOf("\n\n");
    var title = cut >= 0 ? msg.slice(0, cut) : msg, detail = cut >= 0 ? msg.slice(cut + 2) : "";
    var back = d.activeElement;

    var box = d.createElement("div");
    box.id = id;
    box.setAttribute("role", kind === "tell" ? "dialog" : "alertdialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", id + "T");
    box.style.cssText = "position:fixed;inset:0;z-index:2147483645;display:flex;align-items:center;justify-content:center;" +
      "padding:16px;box-sizing:border-box;background:rgba(10,6,20,.9);font-family:Manrope,system-ui,-apple-system,sans-serif;color:#fff;text-align:left";
    var card = d.createElement("div");
    card.style.cssText = "max-width:440px;width:100%;max-height:100%;overflow:auto;box-sizing:border-box;background:#1b1230;" +
      "border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:24px;line-height:1.5";
    var h = d.createElement("div"); h.id = id + "T";
    h.style.cssText = "font-size:19px;font-weight:800;margin-bottom:8px;white-space:pre-line;overflow-wrap:anywhere";
    h.textContent = title;
    card.appendChild(h);
    if (detail) {
      var p = d.createElement("div"); p.id = id + "D";
      p.style.cssText = "font-size:15px;opacity:.85;margin-bottom:4px;white-space:pre-line;overflow-wrap:anywhere";
      p.textContent = detail;
      box.setAttribute("aria-describedby", p.id);
      card.appendChild(p);
    }
    var input = null;
    if (kind === "text") {
      input = d.createElement("input"); input.type = "text"; input.id = id + "Text";
      input.value = value == null ? "" : String(value);
      input.setAttribute("aria-labelledby", id + "T");
      input.setAttribute("autocomplete", "off");
      input.style.cssText = "display:block;width:100%;box-sizing:border-box;margin-top:12px;font:inherit;font-size:16px;padding:12px 14px;" +
        "border-radius:10px;border:1px solid rgba(255,255,255,.3);background:#0f0a1c;color:#fff";
      card.appendChild(input);
    }
    var row = d.createElement("div"); row.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;margin-top:18px";
    var done = false;
    function close(v) {
      if (done) return; done = true;
      root.removeEventListener("keydown", onKey, true);
      d.removeEventListener("focusin", onFocus, true);
      if (box.parentNode) box.parentNode.removeChild(box);
      try { if (back && back.focus && d.contains(back)) back.focus(); } catch (e) {}
      resolve(v);
    }
    function yesValue() { return kind === "ask" ? true : kind === "text" ? input.value : undefined; }
    function btn(suffix, label, primary, answer) {
      var b = d.createElement("button"); b.type = "button"; b.id = id + suffix; b.textContent = label;
      b.style.cssText = "flex:1;min-width:120px;min-height:48px;font:inherit;font-size:16px;font-weight:800;padding:12px 16px;border-radius:999px;cursor:pointer;" +
        (primary ? "border:0;background:#ff1f8e;color:#fff" : "border:1px solid rgba(255,255,255,.3);background:none;color:#fff");
      b.addEventListener("click", function (e) { e.preventDefault(); close(answer()); });
      return b;
    }
    var yes = btn("Go", opts.yes || "OK", true, yesValue);
    if (kind !== "tell") row.appendChild(btn("Cancel", opts.no || "Cancel", false, function () { return NO; }));
    row.appendChild(yes);
    card.appendChild(row);
    box.appendChild(card);

    function focusables() { return Array.prototype.slice.call(card.querySelectorAll("input,button")); }
    function onKey(e) {
      if (done) return;
      var k = e.key;
      e.stopPropagation();
      if (k === "Escape" || k === "Esc") { e.preventDefault(); close(NO); return; }
      if (k === "Enter") {
        e.preventDefault();
        if (e.target && e.target.tagName === "BUTTON" && box.contains(e.target)) { e.target.click(); return; }   // the focused button answers
        close(yesValue()); return;
      }
      if (k === "Tab") {
        var f = focusables(), i = f.indexOf(d.activeElement);
        e.preventDefault();
        if (!f.length) return;
        i = i < 0 ? 0 : (i + (e.shiftKey ? -1 : 1) + f.length) % f.length;
        f[i].focus();
      }
    }
    function onFocus(e) { if (!done && e.target && !box.contains(e.target)) { var f = focusables(); if (f.length) f[f.length - 1].focus(); } }
    root.addEventListener("keydown", onKey, true);
    d.addEventListener("focusin", onFocus, true);
    d.body.appendChild(box);
    try { if (input) { input.focus(); input.select(); } else yes.focus(); } catch (e) {}
  }

  function vpAsk(message, opts) { return show("ask", message, null, opts); }
  function vpTell(message, opts) { return show("tell", message, null, opts); }
  function vpAskText(message, value, opts) { return show("text", message, value, opts); }

  var ONCE = "vpTellOnce:";
  function onceKey(key, user) { return ONCE + (user == null || user === "" ? "guest" : String(user)) + ":" + String(key); }
  function seen(key, user) {
    try { return !!root.localStorage && root.localStorage.getItem(onceKey(key, user)) === "1"; } catch (e) { return false; }
  }
  function remember(key, user) { try { if (root.localStorage) root.localStorage.setItem(onceKey(key, user), "1"); } catch (e) {} }

  function vpInfo(near, message, opts) {
    opts = opts || {};
    var d = root.document;
    if (!d || !near || !near.parentNode) return null;
    var id = opts.infoId || ((near.id || "vpNote") + "Info");
    var b = d.getElementById(id);
    if (!b) {
      b = d.createElement("button"); b.type = "button"; b.id = id; b.textContent = "i";
      b.setAttribute("aria-label", opts.infoLabel || "About this");
      b.title = opts.infoLabel || "About this";
      b.style.cssText = "display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;min-width:32px;" +
        "margin:0 0 0 8px;padding:0;align-self:center;vertical-align:middle;border-radius:50%;border:1.5px solid rgba(255,255,255,.35);" +
        "background:none;color:inherit;font:italic 800 16px/1 Manrope,system-ui,-apple-system,sans-serif;cursor:pointer";
      b.addEventListener("click", function (e) { e.preventDefault(); vpTell(b.__vpNote, b.__vpOpts); });
      near.parentNode.insertBefore(b, near.nextSibling);
    }
    b.__vpNote = message; b.__vpOpts = { id: opts.id };
    return b;
  }

  function vpTellOnce(key, message, opts) {
    opts = opts || {};
    if (seen(key, opts.user)) { vpInfo(opts.near, message, opts); return Promise.resolve(false); }
    return vpTell(message, opts).then(function () {
      remember(key, opts.user);
      vpInfo(opts.near, message, opts);
      return true;
    });
  }
  vpTellOnce.seen = seen;

  vpAsk.__vpAsk = true;
  root.vpAsk = vpAsk; root.vpTell = vpTell; root.vpAskText = vpAskText;
  root.vpTellOnce = vpTellOnce; root.vpInfo = vpInfo;
})(typeof window !== "undefined" ? window : this);
