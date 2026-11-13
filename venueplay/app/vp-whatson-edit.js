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

   13 Nov 2026 (INBOX 360, "make What's on foolproof"):
     - LIVE PREVIEW: under the fields, the exact TV card as you type: the same file draws it (vp-whatson.js tvHtml), in the
       same look (vp-whatson-css.js), at the TV's real size (1920x1080 or 1280x720, scaled to fit the page), with the
       venue's other events and ticked games, so a night with several things shows as the ONE card it will be. If anything
       would still not fit at the smallest size, it says "This is too long for the TV, try under N characters."
     - Starts is a text box that reads how people type it (2pm, 2:30 PM, 19:30). A time that cannot be read is said in words
       and nothing is saved; a clock picker saved nothing at all when its AM/PM was left blank.
     - Changing When keeps the date you set (and says so when it has to put one in).
     - "Show on What's on": a tick for each of the venue's own nights, draws and raffles (o.schedule), so nobody types them
       twice. A tick is stored as a link (see vp-whatson.js) and the TV reads the real day, time and jackpot.
       o.schedule() -> Promise<{ week, draws, raffles }>, o.logo (the venue's logo address, for the preview)

   The date rules are /app/vp-whatson.js, the same file the TV and the phones use. Every word is set as text. Its look
   is billing.html's .woe rules. ES5. tools/test-whats-on.js runs it. */
(function (root) {
  "use strict";
  var d = root.document;
  var DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  var SHORT = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  var LONG = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
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
    var sched = { week: [], draws: [], raffles: [] };   // the venue's real schedule (o.schedule), for the ticks and the preview
    var ticks = el("div", "woe-ticks"); ticks.hidden = true;
    var list = el("div", "woe-list"), add = el("button", "addbtn woe-add", "+ Add an event"), form = el("div", "woe-form");
    add.setAttribute("type", "button"); form.hidden = true;
    var count = el("span", "woe-count");
    var foot = el("div", "woe-foot"); foot.appendChild(add); foot.appendChild(count);
    box.appendChild(foot); box.appendChild(ticks); box.appendChild(form); box.appendChild(list);   // Add at the top, then the ticks, the form under them, then the list

    /* THE TICKS (13 Nov 2026, "no double typing"): each of the venue's own nights, members draws and raffles, from its real
       schedule, with one tick "Show on What's on". OFF for every venue until it is ticked. A tick is saved at once as a
       link; unticking removes it. */
    var PLURAL = { sun: "Sundays", mon: "Mondays", tue: "Tuesdays", wed: "Wednesdays", thu: "Thursdays", fri: "Fridays", sat: "Saturdays" };
    function tickItems() {
      var out = [], seen = {}, WN = W().GAME_NIGHT, N = W().normDay;
      (sched.week || []).forEach(function (d) {
        ((d && d.games) || []).forEach(function (g) {
          if (!g || !WN[g.game] || !PLURAL[d.day]) return;
          var key = "night:" + d.day + ":" + g.game; if (seen[key]) return; seen[key] = 1;
          var tm = W().time12(g.start), n = (+g.count >= 2 && +g.count <= 4) ? " \u00d7" + (+g.count) : "";
          out.push({ order: DAY_ORDER.indexOf(d.day) * 100 + (g.start ? +String(g.start).replace(":", "") / 100 : 99), link: { link: "night", day: d.day, game: g.game }, text: WN[g.game] + n, when: PLURAL[d.day] + (tm ? " " + tm : "") });
        });
      });
      (sched.draws || []).forEach(function (x) {
        var k = N(x && x.draw_day); if (!k) return;
        var nm = String(x.name || "Members draw").slice(0, 60), key = "draw:" + k + ":" + nm.toLowerCase(); if (seen[key]) return; seen[key] = 1;
        var tm = W().time12(W().parseTime(x.draw_time) || "");
        out.push({ order: DAY_ORDER.indexOf(k) * 100 + 50, link: { link: "draw", ref: nm }, text: nm, when: PLURAL[k] + (tm ? " " + tm : "") });
      });
      (sched.raffles || []).forEach(function (x) {
        var k = N(x && x.day); if (!k || !String(x.label || "").trim()) return;
        var nm = String(x.label).trim().slice(0, 60), key = "raffle:" + k + ":" + nm.toLowerCase(); if (seen[key]) return; seen[key] = 1;
        var tm = W().time12(W().parseTime(x.time) || "");
        out.push({ order: DAY_ORDER.indexOf(k) * 100 + 60, link: { link: "raffle", ref: nm }, text: nm, when: PLURAL[k] + (tm ? " " + tm : "") });
      });
      return out.sort(function (a, b) { return a.order - b.order; });
    }
    function linkOf(it) {
      var hit = null;
      events.forEach(function (e) { if (e.link === it.link.link && e.day === it.link.day && e.game === it.link.game && e.ref === it.link.ref) hit = e; });
      return hit;
    }
    function paintTicks() {
      ticks.innerHTML = "";
      var items = tickItems();
      ticks.hidden = !items.length;
      if (!items.length) return;
      ticks.appendChild(el("div", "woe-tkhead", "Your venueplay games"));
      ticks.appendChild(el("p", "woe-hint", "Tick one to show it on your What\u2019s on card, in the right night with the real day and time. You do not type it again, and it changes when your games do."));
      items.forEach(function (it) {
        var row = el("label", "woe-tk"), cb = el("input"), tx = el("span", "woe-tktx"), have = linkOf(it);
        cb.setAttribute("type", "checkbox"); cb.checked = !!have;
        tx.appendChild(el("b", "", it.text)); tx.appendChild(el("span", "woe-tkwhen", it.when));
        row.appendChild(cb); row.appendChild(tx); row.appendChild(el("span", "woe-tkon", "Show on What\u2019s on"));
        cb.onchange = function () {
          var want = cb.checked, cur = linkOf(it);
          cb.disabled = true;
          var job = want ? (cur ? Promise.resolve({ events: events }) : Promise.resolve(o.save(JSON.parse(JSON.stringify(it.link))))) : (cur ? Promise.resolve(o.remove(cur.id)) : Promise.resolve({ events: events }));
          job.then(function (res) {
            cb.disabled = false;
            if (!res || res.error) { cb.checked = !want; say((res && res.error) || "Could not save that. Try again."); return; }
            events = W().clean(res.events || []);
            paintList(); say(want ? "Added. It shows on your TV within a few seconds." : "Taken off What\u2019s on. It comes off your TV within a few seconds.", true);
          }, function () { cb.disabled = false; cb.checked = !want; say("Could not save that. Check your connection and try again."); });
        };
        ticks.appendChild(row);
      });
    }
    function paintList() {
      paintTicks();
      list.innerHTML = "";
      var rows = W().sorted(events, t());
      var total = rows.length + events.filter(function (e) { return e.link; }).length;   // ticked games count towards the 30 too
      count.textContent = total ? total + " of " + W().MAX : "";
      add.hidden = !!editing || total >= W().MAX;
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
        if (nx === t()) when = "Tonight" + (e.start ? ", " + W().time12(e.start) : "") + (e.day ? " (weekly)" : "");
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
      var kind = editing.day ? "weekly" : "once";   // set from the When list (setKind)
      form.innerHTML = ""; form.hidden = false; add.hidden = true; count.hidden = true;
      /* Edit opens where the manager tapped, in place of that row (the row hides); Add and Copy open at the top. */
      if (editing.id) paintList(); else { box.insertBefore(form, list); paintList(); }
      form.appendChild(el("div", "woe-fhead", editing.id ? "Edit event" : (copy ? "Copy of " + src.title : "Add an event")));

      /* ROUND 3 (Dean, 6 Nov 2026: "a lot of wasted space in there"): three short rows, side by side where they fit.
           Title | When | Starts
           Date (one date) or Last date (every week) | One line about it
           Poster | Save event, Cancel
         "When" is one list: One date, or Every Monday to Every Sunday. On a phone every field takes the full width. */
      var title = input("text", editing.title, TITLE_MAX, "DJ Tilly, Parma night, Live music");
      var sel = el("select", "woe-when-sel");
      [["once", "One date"]].concat(DAY_ORDER.map(function (k) { return [k, "Every " + LONG[k]]; })).forEach(function (op) {
        var x = el("option", "", op[1]); x.value = op[0]; x.setAttribute("value", op[0]); sel.appendChild(x);
      });
      sel.value = editing.day || "once";
      /* STARTS IS A TEXT BOX (13 Nov 2026): how people type it. A clock picker holds nothing until its hour, minute AND
         am/pm are all filled, so "2:00" and a click on Save stored no time, silently. This reads 2pm, 2:30 PM, 7.30pm,
         19:30, shows what it understood under the box, and says why in words when it cannot. */
      var start = input("text", editing.start ? W().time12(editing.start) : "", 14, "7:30pm");
      start.setAttribute("autocomplete", "off"); start.setAttribute("autocapitalize", "off"); start.setAttribute("inputmode", "text");
      var startNote = el("p", "woe-hint woe-startnote"); startNote.setAttribute("role", "status");
      function readStart() {
        var v = W().parseTime(start.value);
        if (v === null) { startNote.textContent = W().timeProblem(start.value); startNote.className = "woe-hint woe-startnote bad"; return null; }
        startNote.textContent = v ? "Starts at " + W().time12(v) + "." : "";
        startNote.className = "woe-hint woe-startnote";
        return v;
      }
      var r1 = el("div", "woe-grid woe-r1");
      r1.appendChild(field("Title", title)); r1.appendChild(field("When", sel)); r1.appendChild(field("Starts (optional)", start, startNote));
      form.appendChild(r1);

      var date = input("date", editing.date), until = input("date", editing.until);
      date.setAttribute("min", t()); until.setAttribute("min", t());
      var dateNote = el("p", "woe-hint woe-datenote");
      var once = field("Date", date, dateNote), weekly = field("Last date (optional)", until, el("p", "woe-hint", "Leave blank if it runs every week until you remove it."));
      once.className += " woe-when-once"; weekly.className += " woe-when-weekly";
      var line = input("text", editing.line, LINE_MAX, "DJs from 9, free entry");
      var counter = el("span", "woe-counter");
      function countLine() { counter.textContent = String(line.value || "").length + " of " + LINE_MAX; }
      countLine();
      var lf = field("One line about it (optional)", line);
      lf.labelEl.appendChild(counter);
      var r2 = el("div", "woe-grid woe-r2");
      r2.appendChild(once); r2.appendChild(weekly); r2.appendChild(lf);
      form.appendChild(r2);
      /* WHEN KEEPS WHAT YOU TYPED (13 Nov 2026: changing When emptied the date and Save said "Pick the date"). The date and
         the last date stay in their boxes whichever When is picked. Changing an Every... event to One date with no date
         yet puts in the next one of that day and says so. */
      function nextOf(dayKey) {
        var d0 = t(), i;
        for (i = 0; i < 7; i++) { var s1 = W().addDays(d0, i); if (W().dayKey(s1) === dayKey) return s1; }
        return "";
      }
      function setKind(fromUser) {
        var was = kind;
        kind = sel.value === "once" ? "once" : "weekly";
        if (kind === "weekly") editing.day = sel.value;
        once.hidden = kind !== "once"; weekly.hidden = kind !== "weekly";
        dateNote.textContent = "";
        if (fromUser === true && kind === "once" && was === "weekly" && !date.value && editing.day) {
          var nx = nextOf(editing.day);
          if (nx) { date.value = nx; dateNote.textContent = "Set to " + W().dayLabel(nx, "") + ", the next " + LONG[editing.day] + ". Change it if it is another date."; }
        } else if (fromUser === true && kind === "weekly" && date.value) {
          dateNote.textContent = "";
        }
      }
      sel.onchange = function () { setKind(true); paintPreview(); };
      setKind(false);

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
      drop.onclick = function () { editing.image_url = ""; paintPic(); paintPreview(); };
      file.onchange = function () {
        var f = file.files && file.files[0]; file.value = "";
        if (!f || typeof o.upload !== "function") return;
        paintPic("Uploading\u2026"); choose.disabled = true; go.disabled = true;
        o.upload(f, function (url, err) {
          choose.disabled = false; go.disabled = false;
          if (url) editing.image_url = url; else if (err) say(err);
          paintPic(); paintPreview();
        });
      };
      pb.appendChild(choose); pb.appendChild(drop);
      var pt = el("div", "woe-picwords");
      pt.appendChild(el("p", "woe-hint", "A poster or a photo. Tall posters show whole on your TV. With none, your TV shows a finished card with your title and time."));
      pt.appendChild(pb);
      var pf = el("div", "woe-f woe-picf"); pf.appendChild(el("div", "flabel", "Poster (optional)"));
      pic.appendChild(pth); pic.appendChild(pt); pic.appendChild(file);
      pf.appendChild(pic);
      paintPic();

      /* THE LIVE PREVIEW (13 Nov 2026): the TV's own card, as you type. */
      var pv = el("div", "woe-pv"), pvHead = el("div", "woe-pvhead"), pvTabs = el("div", "woe-pvtabs"), pvWarn = el("p", "woe-pvwarn"), pvBox = el("div", "woe-pvbox"), pvStage = el("div", "vpwo-stage");
      pvWarn.setAttribute("role", "status");
      var sizeBig = el("button", "woe-pvtab on", "Large TV"), sizeSmall = el("button", "woe-pvtab", "Small TV");
      sizeBig.setAttribute("type", "button"); sizeSmall.setAttribute("type", "button");
      pvHead.appendChild(el("span", "woe-pvt", "How it looks on your TV")); pvTabs.appendChild(sizeBig); pvTabs.appendChild(sizeSmall); pvHead.appendChild(pvTabs);
      pvBox.appendChild(pvStage); pv.appendChild(pvHead); pv.appendChild(pvBox); pv.appendChild(pvWarn);
      var pvSize = 1728, PVH = { 1728: 972, 1152: 648 };
      var pvNote = el("p", "woe-hint woe-pvnote");
      pv.appendChild(pvNote);

      var err = el("p", "woe-err"); err.setAttribute("role", "status");
      var acts = el("div", "woe-facts"), go = el("button", "go", "Save event"), cancel = el("button", "addbtn", "Cancel");
      go.setAttribute("type", "button"); cancel.setAttribute("type", "button");
      acts.appendChild(go); acts.appendChild(cancel);
      /* Editing one that exists: Copy and Remove are here too, so a phone's row can carry Edit alone (round 5). */
      if (editing.id && src) {
        var fcp = el("button", "addbtn woe-fcopy", "Copy"), frm = el("button", "canxlink woe-rm woe-frm", "Remove");
        fcp.setAttribute("type", "button"); frm.setAttribute("type", "button");
        fcp.onclick = function () { open(src, true); };
        frm.onclick = function () { removeOne(src, frm); };
        acts.appendChild(fcp); acts.appendChild(frm);
      }
      var r3 = el("div", "woe-r3"); r3.appendChild(pf); r3.appendChild(acts);
      form.appendChild(pv); form.appendChild(err); form.appendChild(r3);
      cancel.onclick = shut;

      /* The event as typed so far. Nothing here is sent; it is what the preview and Save both read. */
      function draft(forPreview) {
        if (!editing) return {};
        var st0 = W().parseTime(start.value);
        var ev = { title: String(title.value || "").trim(), start: st0 || "", line: String(line.value || "").trim(), image_url: editing.image_url || "" };
        if (editing.id) ev.id = editing.id;
        if (kind === "once") ev.date = date.value || ""; else { ev.day = editing.day || ""; if (until.value) ev.until = until.value; }
        return ev;
      }
      function paintPreview() { try { paintPreview1(); } catch (e) { pvWarn.textContent = ""; pvWarn.className = "woe-pvwarn"; } }   // a preview that cannot draw never stops the form
      function paintPreview1() {
        if (!W().previewCard || !editing || form.hidden) return;
        var d = draft(true), r = W().previewCard(pvStage, d, { events: events, editingId: editing.id, today: t(), venue: o.venue || "", logo: o.logo || "", schedule: sched, size: pvSize });
        var k = Math.min(1, (pvBox.clientWidth || pvSize) / pvSize);
        pvStage.style.width = pvSize + "px"; pvStage.style.height = PVH[pvSize] + "px";
        pvStage.style.transform = "scale(" + k + ")"; pvStage.style.transformOrigin = "0 0";
        pvBox.style.height = Math.round(PVH[pvSize] * k) + "px";
        pvNote.textContent = r.example ? "Your date is later than a week away, so the card here is shown on an example day. On the TV it appears in the week before." : "";
        if (r.over) {
          var lim = W().safeLength(pvStage, d, { events: events, editingId: editing.id, today: t(), venue: o.venue || "", logo: o.logo || "", schedule: sched, sizes: [1728, 1152] });
          pvWarn.textContent = lim.text; pvWarn.className = "woe-pvwarn on";
        } else { pvWarn.textContent = ""; pvWarn.className = "woe-pvwarn"; }
        var other = W().overAt ? W().overAt(pvStage, d, { events: events, editingId: editing.id, today: t(), venue: o.venue || "", logo: o.logo || "", schedule: sched, size: pvSize === 1728 ? 1152 : 1728 }) : false;
        if (other && !r.over) {
          var lim2 = W().safeLength(pvStage, d, { events: events, editingId: editing.id, today: t(), venue: o.venue || "", logo: o.logo || "", schedule: sched, sizes: [1728, 1152] });
          pvWarn.textContent = lim2.text; pvWarn.className = "woe-pvwarn on";
        }
      }
      var pvTimer = null;
      function soon() { if (pvTimer) clearTimeout(pvTimer); pvTimer = setTimeout(function () { pvTimer = null; paintPreview(); }, 120); }
      title.oninput = soon; line.oninput = function () { countLine(); soon(); };
      start.oninput = function () { readStart(); soon(); }; date.onchange = soon; date.oninput = soon; until.onchange = soon;
      sizeBig.onclick = function () { pvSize = 1728; sizeBig.className = "woe-pvtab on"; sizeSmall.className = "woe-pvtab"; paintPreview(); };
      sizeSmall.onclick = function () { pvSize = 1152; sizeSmall.className = "woe-pvtab on"; sizeBig.className = "woe-pvtab"; paintPreview(); };
      readStart();
      var resize = function () { if (!form.hidden && pvBox.clientWidth) paintPreview(); };
      if (root.addEventListener) { root.addEventListener("resize", resize); form._woResize = resize; }
      setTimeout(paintPreview, 0);
      if (root.document && root.document.fonts && root.document.fonts.ready) root.document.fonts.ready.then(function () { if (!form.hidden) paintPreview(); });

      go.onclick = function () {
        var st1 = W().parseTime(start.value);
        if (st1 === null) { err.textContent = W().timeProblem(start.value); try { start.focus(); } catch (e) {} return; }
        var ev = draft(false);
        var why = problem(ev);
        if (why) { err.textContent = why; return; }
        /* NOTHING THAT WOULD BE CUT EVER REACHES A TV (13 Nov 2026): the card is drawn once more, now, and a card that
           would not fit says so in the same words as the preview and is not saved. */
        paintPreview();
        if (pvWarn.className.indexOf("on") !== -1) { err.textContent = pvWarn.textContent + " Nothing was saved."; return; }
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
    function shut() { if (form._woResize && root.removeEventListener) { root.removeEventListener("resize", form._woResize); form._woResize = null; } editing = null; form.hidden = true; form.innerHTML = ""; count.hidden = false; box.insertBefore(form, list); paintList(); }
    add.onclick = function () { open(null, false); };
    paintList();
    if (typeof o.schedule === "function") {
      try {
        Promise.resolve(o.schedule()).then(function (sc) {
          if (!sc || typeof sc !== "object") return;
          sched = { week: Array.isArray(sc.week) ? sc.week : [], draws: Array.isArray(sc.draws) ? sc.draws : [], raffles: Array.isArray(sc.raffles) ? sc.raffles : [] };
          paintTicks();
        }, function () {});
      } catch (e) {}
    }
    return {
      set: function (evs) { events = W().clean(evs || []); if (!editing) paintList(); },
      list: function () { return events.slice(); },
      open: function (id, copy) { var e = null; events.forEach(function (x) { if (x.id === id) e = x; }); open(e, !!copy); },
      problem: problem
    };
  }
  root.VPWhatsOnEdit = { mount: mount };
})(typeof window !== "undefined" ? window : this);
