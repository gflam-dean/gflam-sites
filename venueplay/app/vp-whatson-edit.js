/* vp-whatson-edit.js  -- THE "WHAT'S ON" EDITOR ON THE ACCOUNT PAGE (Screen tab), INBOX 110, 6 Nov 2026.

   The venue's own nights (DJs, gigs, club nights, specials) in date order, each with Edit, Copy and Remove, and
   "+ Add an event", which opens one short form: Title, One date or Every week (a day, and optionally the last date it
   runs), Starts, a short line, and a picture (the same upload as a promo slide). Each event SAVES BY ITSELF when its
   Save is pressed, and a removed one goes at once: there is no "Save screen" to forget, and nothing sits unsaved.

     VPWhatsOnEdit.mount(box, o) -> { set(events), list() }
       o = { events:[...], venue:"Revolver Upstairs", today:"YYYY-MM-DD" (optional; the device's date otherwise),
             save(ev)   -> Promise<{events}|{error}>   the Worker's answer (POST /account/whats-on-save)
             remove(id) -> Promise<{events}|{error}>   (POST /account/whats-on-remove)
             upload(file, done(url|"" , error)) the promo slide upload, shrunk the same way
             say(text, good)  the page's own message line }

   The date rules are /app/vp-whatson.js, the same file the TV and the phones use. Every word is set as text. Its look
   is billing.html's .woe rules. ES5. tools/test-whats-on.js runs it. */
(function (root) {
  "use strict";
  var d = root.document;
  var DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  var SHORT = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  var TITLE_MAX = 60, LINE_MAX = 48;   // the Worker says the same (design review: one line on the TV)

  function el(tag, cls, text) { var e = d.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function W() { return root.VPWhatsOn; }

  function mount(box, o) {
    if (!box || !W()) return null;
    o = o || {};
    var events = W().clean(o.events || []);
    var editing = null;      // the form's event (a copy), or null when the form is shut
    var t = function () { return o.today || W().today(); };
    function say(s, good) { if (typeof o.say === "function") o.say(s, good); }

    box.innerHTML = "";
    if (!/\bwoe-box\b/.test(box.className || "")) box.className = (box.className ? box.className + " " : "") + "woe-box";
    var list = el("div", "woe-list"), add = el("button", "addbtn woe-add", "+ Add an event"), form = el("div", "woe-form");
    add.setAttribute("type", "button"); form.hidden = true;
    var count = el("span", "woe-count");
    var foot = el("div", "woe-foot"); foot.appendChild(add); foot.appendChild(count);
    box.appendChild(foot); box.appendChild(form); box.appendChild(list);   // Add at the top, the form under it, then the list

    function paintList() {
      list.innerHTML = "";
      var rows = W().sorted(events, t());
      count.textContent = rows.length ? rows.length + " of " + W().MAX : "";
      add.hidden = !!editing || rows.length >= W().MAX;
      if (!rows.length) {
        list.appendChild(el("p", "woe-empty", "Nothing on yet. Add your own events here: a DJ, a gig, a club night or a special."));
        return;
      }
      rows.forEach(function (e) {
        var r = el("div", "woe"); r.setAttribute("data-id", e.id || "");
        var th = el("div", "woe-thumb" + (e.image_url ? "" : " none"));
        if (e.image_url) th.style.backgroundImage = "url(\"" + String(e.image_url).replace(/["\\]/g, "") + "\")";
        var m = el("div", "woe-main"), nx = W().next(e, t());
        if (!e.image_url) th.textContent = (W().dayKey(nx) || "").toUpperCase();   // no picture: the day, quietly
        var when = W().whenText(e, t());
        if (nx === t()) when = "Tonight" + (e.start ? ", " + W().time12(e.start) : "") + (e.day ? " (every " + ({ mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" })[e.day] + ")" : "");
        m.appendChild(el("div", "woe-when" + (nx === t() ? " tn" : ""), when));
        m.appendChild(el("div", "woe-title", e.title));
        if (e.line) m.appendChild(el("div", "woe-line", e.line));
        var a = el("div", "woe-acts");
        var ed = el("button", "addbtn woe-edit", "Edit"), cp = el("button", "addbtn woe-copy", "Copy"), rm = el("button", "canxlink woe-rm", "Remove");
        [ed, cp, rm].forEach(function (b) { b.setAttribute("type", "button"); a.appendChild(b); });
        ed.onclick = function () { open(e, false); };
        cp.onclick = function () { open(e, true); };
        rm.onclick = function () { removeOne(e, rm); };
        r.appendChild(th); r.appendChild(m); r.appendChild(a);
        if (editing && editing.id && editing.id === e.id) { r.hidden = true; list.appendChild(form); }   // the form stands in its place
        list.appendChild(r);
      });
    }

    function removeOne(e, btn) {
      if (typeof o.remove !== "function") return;
      btn.disabled = true;
      Promise.resolve(o.remove(e.id)).then(function (res) {
        if (!res || res.error) { btn.disabled = false; say((res && res.error) || "Could not remove that. Try again."); return; }
        events = W().clean(res.events || []);
        if (editing && editing.id === e.id) shut();
        paintList(); say("Removed. It comes off your TV within a few seconds.", true);
      }, function () { btn.disabled = false; say("Could not remove that. Check your connection and try again."); });
    }

    /* THE FORM. copy: a new event with this one's details (a series of one-off gigs is Copy, change the date). */
    function field(label, input, hint) {
      var f = el("div", "woe-f"), l = el("label", "flabel", label);
      var id = "woe-" + label.replace(/[^a-z]/gi, "").toLowerCase(); input.id = id; l.setAttribute("for", id);
      f.appendChild(l); f.appendChild(input); if (hint) f.appendChild(hint);
      f.labelEl = l;
      return f;
    }
    function input(type, val, max, ph) {
      var i = el("input"); i.setAttribute("type", type); if (val) i.value = val;
      if (max) i.setAttribute("maxlength", String(max)); if (ph) i.setAttribute("placeholder", ph);
      return i;
    }
    function open(src, copy) {
      editing = { id: (src && !copy) ? src.id : "", title: src ? src.title : "", date: src ? (src.date || "") : "", day: src ? (src.day || "") : "",
                  until: src ? (src.until || "") : "", start: src ? (src.start || "") : "", line: src ? (src.line || "") : "", image_url: src ? (src.image_url || "") : "" };
      if (copy && editing.date) editing.date = "";   // a copy asks for its own date
      var kind = editing.day ? "weekly" : "once";
      form.innerHTML = ""; form.hidden = false; add.hidden = true; count.hidden = true;
      /* Edit opens where the manager tapped, in place of that row (the row hides); Add and Copy open at the top. */
      if (editing.id) paintList(); else { box.insertBefore(form, list); paintList(); }
      form.appendChild(el("div", "woe-fhead", editing.id ? "Edit event" : (copy ? "Copy of " + src.title : "Add an event")));

      var title = input("text", editing.title, TITLE_MAX, "DJ Tilly, Trivia with Mikey, $15 Parmas");
      form.appendChild(field("Title", title));

      var seg = el("div", "woe-seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "When");
      var b1 = el("button", "", "One date"), b2 = el("button", "", "Every week");
      [b1, b2].forEach(function (b) { b.setAttribute("type", "button"); seg.appendChild(b); });
      var wl = el("div", "woe-f"); wl.appendChild(el("div", "flabel", "When")); wl.appendChild(seg); form.appendChild(wl);

      var once = el("div", "woe-when-once"), date = input("date", editing.date);
      date.setAttribute("min", t());
      once.appendChild(field("Date", date));
      var weekly = el("div", "woe-when-weekly"), chips = el("div", "woe-days"), until = input("date", editing.until);
      until.setAttribute("min", t());
      DAY_ORDER.forEach(function (k) {
        var c = el("button", "woe-day" + (editing.day === k ? " on" : ""), SHORT[k]); c.setAttribute("type", "button"); c.setAttribute("data-day", k);
        c.setAttribute("aria-pressed", editing.day === k ? "true" : "false");
        c.onclick = function () {
          editing.day = k;
          var all = chips.querySelectorAll(".woe-day");
          for (var i = 0; i < all.length; i++) { var on = all[i].getAttribute("data-day") === k; all[i].className = "woe-day" + (on ? " on" : ""); all[i].setAttribute("aria-pressed", on ? "true" : "false"); }
        };
        chips.appendChild(c);
      });
      var dw = el("div", "woe-f"); dw.appendChild(el("div", "flabel", "Day")); dw.appendChild(chips); weekly.appendChild(dw);
      weekly.appendChild(field("Last date (optional)", until, el("p", "snote", "Leave blank and it runs every week until you remove it.")));
      form.appendChild(once); form.appendChild(weekly);
      function setKind(k) {
        kind = k; once.hidden = k !== "once"; weekly.hidden = k !== "weekly";
        b1.className = k === "once" ? "on" : ""; b2.className = k === "weekly" ? "on" : "";
        b1.setAttribute("aria-pressed", k === "once" ? "true" : "false"); b2.setAttribute("aria-pressed", k === "weekly" ? "true" : "false");
      }
      b1.onclick = function () { setKind("once"); }; b2.onclick = function () { setKind("weekly"); };
      setKind(kind);

      var start = input("time", editing.start);
      var line = input("text", editing.line, LINE_MAX, "DJs from 9, free entry");
      var counter = el("span", "woe-counter");
      function countLine() { counter.textContent = String(line.value || "").length + " of " + LINE_MAX; }
      line.oninput = countLine; countLine();
      var two = el("div", "woe-two"), lf = field("One line about it (optional)", line);
      lf.labelEl.appendChild(counter);
      two.appendChild(field("Starts", start)); two.appendChild(lf);
      form.appendChild(two);

      /* The picture: optional, uploaded the moment it is chosen, like a promo slide. */
      var pic = el("div", "woe-pic"), pth = el("div", "woe-thumb big"), pb = el("div", "woe-picbtns");
      var choose = el("button", "addbtn", ""), drop = el("button", "canxlink woe-rm", "Remove picture"), file = el("input");
      choose.setAttribute("type", "button"); drop.setAttribute("type", "button");
      file.setAttribute("type", "file"); file.setAttribute("accept", "image/png,image/jpeg,image/webp,image/gif"); file.style.display = "none";
      function paintPic(msg) {
        pth.className = "woe-thumb big" + (editing.image_url ? "" : " none");
        pth.style.backgroundImage = editing.image_url ? "url(\"" + String(editing.image_url).replace(/["\\]/g, "") + "\")" : "";
        pth.textContent = msg || (editing.image_url ? "" : "No picture");
        choose.textContent = editing.image_url ? "Change picture" : "Choose a picture";
        drop.hidden = !editing.image_url;
      }
      choose.onclick = function () { file.click(); };
      pth.onclick = function () { file.click(); };
      drop.onclick = function () { editing.image_url = ""; paintPic(); };
      file.onchange = function () {
        var f = file.files && file.files[0]; file.value = "";
        if (!f || typeof o.upload !== "function") return;
        paintPic("Uploading\u2026"); choose.disabled = true; go.disabled = true;
        o.upload(f, function (url, err) {
          choose.disabled = false; go.disabled = false;
          if (url) editing.image_url = url; else if (err) say(err);
          paintPic();
        });
      };
      pb.appendChild(choose); pb.appendChild(drop);
      var pt = el("div", "woe-picwords");
      pt.appendChild(el("p", "snote", "A poster or a photo. Tall posters show whole on your TV."));
      pt.appendChild(el("p", "snote woe-datecheck", "Check the date on your poster matches the date above."));
      pt.appendChild(pb);
      var pf = el("div", "woe-f woe-picf"); pf.appendChild(el("div", "flabel", "Picture (optional)"));
      pic.appendChild(pth); pic.appendChild(pt); pic.appendChild(file);
      pf.appendChild(pic); form.appendChild(pf);
      paintPic();

      var err = el("p", "woe-err"); err.setAttribute("role", "status");
      var acts = el("div", "woe-facts"), go = el("button", "go", "Save event"), cancel = el("button", "addbtn", "Cancel");
      go.setAttribute("type", "button"); cancel.setAttribute("type", "button");
      acts.appendChild(go); acts.appendChild(cancel);
      form.appendChild(err); form.appendChild(acts);
      cancel.onclick = shut;
      go.onclick = function () {
        var ev = { title: String(title.value || "").trim(), start: start.value || "", line: String(line.value || "").trim(), image_url: editing.image_url || "" };
        if (editing.id) ev.id = editing.id;
        if (kind === "once") ev.date = date.value || ""; else { ev.day = editing.day || ""; if (until.value) ev.until = until.value; }
        var why = problem(ev);
        if (why) { err.textContent = why; return; }
        err.textContent = ""; go.disabled = true; go.textContent = "Saving\u2026";
        Promise.resolve(o.save(ev)).then(function (res) {
          go.disabled = false; go.textContent = "Save event";
          if (!res || res.error) { err.textContent = (res && res.error) || "Could not save that. Try again."; return; }
          events = W().clean(res.events || []);
          shut(); say("Saved. It shows on your TV within a few seconds.", true);
        }, function () { go.disabled = false; go.textContent = "Save event"; err.textContent = "Could not save that. Check your connection and try again."; });
      };
      try { title.focus({ preventScroll: true }); } catch (e) {}
      try { if (typeof o.scrollTo === "function") o.scrollTo(form); else form.scrollIntoView({ block: "nearest" }); } catch (e) {}
    }
    /* What is wrong with an event before it is sent, in words (the Worker checks it all again). */
    function problem(ev) {
      if (!ev.title) return "Give it a title.";
      if (ev.title.length > TITLE_MAX) return "Keep the title under " + TITLE_MAX + " letters.";
      if (ev.date !== undefined && !ev.day) {
        if (!ev.date) return "Pick the date.";
        if (ev.date < t()) return "That date has been. Pick today or later.";
      } else if (!ev.day) return "Pick the day it runs each week.";
      if (ev.until && ev.until < t()) return "That last date has been. Leave it blank or pick a later one.";
      if (ev.line && ev.line.length > LINE_MAX) return "Keep the short line under " + LINE_MAX + " letters.";
      return "";
    }
    function shut() { editing = null; form.hidden = true; form.innerHTML = ""; count.hidden = false; box.insertBefore(form, list); paintList(); }
    add.onclick = function () { open(null, false); };
    paintList();
    return {
      set: function (evs) { events = W().clean(evs || []); if (!editing) paintList(); },
      list: function () { return events.slice(); },
      open: function (id, copy) { var e = null; events.forEach(function (x) { if (x.id === id) e = x; }); open(e, !!copy); },
      problem: problem
    };
  }
  root.VPWhatsOnEdit = { mount: mount };
})(typeof window !== "undefined" ? window : this);
