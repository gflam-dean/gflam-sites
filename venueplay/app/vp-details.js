/* "YOUR DETAILS" THAT THE PHONE CAN AUTOFILL (5 Nov 2026, for the 6 Nov release).

   Dean: "on the player screen we've asked for details... it doesn't autofill every detail."

   The three player phones (bingo /play, musical bingo and trivia) built the details boxes with
   innerHTML, with autocomplete words but no name= and not inside a <form>. iPhone Safari AutoFill and
   Android's Google autofill both look for a real form, a name and an autocomplete word on each box,
   and often skip loose inputs. This file is the ONE place the three phones get that right:

     VPDetails.wire({ join: join, kind: "person" | "team" })
         Wraps the name box, #joinExtra, #joinErr and the Join button in a real
         <form autocomplete="on">. Join is the form's submit button, so a tap and the keyboard's Go /
         Enter both submit; the submit handler calls preventDefault() and then the page's own join().
         Nothing navigates. kind "person" (bingo, musical bingo): #nameIn is the player's first name
         (name and autocomplete "given-name"). kind "team" (trivia): #nameIn is a TEAM name, so it stays
         autocomplete="off" and name="team"; no first-name box is added.

     VPDetails.html(collect)
         The extra boxes for what the venue already asks for (r.collect), nothing else:
           last name   name/autocomplete family-name
           postcode    name/autocomplete postal-code, inputmode numeric, pattern [0-9]*
           email       type email, name/autocomplete email
           mobile      type tel, name/autocomplete tel, inputmode tel
         Same ids as before (xLast, xPost, xEmail, xMobile), same placeholders, same look. Each box
         carries an aria-label, because autofill reads labels as well as autocomplete words.

   Look and rules are unchanged: the form is display:contents, so the layout is exactly as it was;
   vp-consent.js still draws the 18+ and "Keep me posted" ticks into #joinExtra after this.
   Nothing new is collected. No em dashes in anything a person reads. */
(function (root) {
  "use strict";
  /* FIRST NAME + MOBILE AT EVERY VENUE (Dean, 14 Nov 2026, INBOX 416 UPDATE 2; Sunday 22 Nov). The game Worker now says
     first_name and mobile (with mobile_required) for every venue. The bingo and musical phones' #nameIn IS the first
     name; trivia's #nameIn is a TEAM name, so trivia asks html(collect, { firstBox:true }) for its own first-name box
     (xFirst). A required mobile box carries data-required and mobileError() refuses it empty. A known phone (/app/vp-known.js)
     passes a collect with only the fields still missing, so a returning player sees no box for what is already held. */
  var FIRST = { key: "first_name", id: "xFirst", type: "text", ph: "Your first name", name: "given-name", ac: "given-name", ml: 40 };
  var BOXES = [
    { key: "last_name", id: "xLast", type: "text", ph: "Last name", name: "family-name", ac: "family-name", ml: 40 },
    { key: "postcode", id: "xPost", type: "text", ph: "Postcode", name: "postal-code", ac: "postal-code", ml: 4, im: "numeric", pattern: "[0-9]*" },
    { key: "email", id: "xEmail", type: "email", ph: "Email", name: "email", ac: "email", ml: 120 },
    { key: "mobile", id: "xMobile", type: "tel", ph: "Mobile", name: "tel", ac: "tel", ml: 16, im: "tel" }
  ];

  function box(b, req) {
    return '<div class="field"><input type="' + b.type + '" id="' + b.id + '" name="' + b.name + '" placeholder="' + b.ph +
      '" aria-label="' + b.ph + '" autocomplete="' + b.ac + '" maxlength="' + b.ml + '"' +
      (b.im ? ' inputmode="' + b.im + '"' : "") + (b.pattern ? ' pattern="' + b.pattern + '"' : "") + (req ? ' data-required="1"' : "") + '></div>';
  }

  /* The boxes the venue asks for, in the order the phones always showed them. */
  function html(collect, opts) {
    var h = "";
    if (collect && collect.first_name && opts && opts.firstBox) h += box(FIRST);
    /* LAST NAME AND POSTCODE SHARE ONE ROW when a venue asks both (INBOX 416: with the first name and mobile now asked
       everywhere, a venue asking everything must still fit one phone screen; the purchase raffle form does the same). */
    var pair = !!(collect && collect.last_name && collect.postcode);
    for (var i = 0; i < BOXES.length; i++) {
      if (!(collect && collect[BOXES[i].key])) continue;
      var one = box(BOXES[i], BOXES[i].key === "mobile" && collect.mobile_required === true);
      if (pair && BOXES[i].key === "last_name") h += '<div class="vp-pair" style="display:flex;gap:10px">' + one.replace('<div class="field">', '<div class="field" style="flex:1 1 0;min-width:0">');
      else if (pair && BOXES[i].key === "postcode") h += one.replace('<div class="field">', '<div class="field" style="flex:0 0 38%;min-width:0">') + '</div>';
      else h += one;
    }
    return h;
  }

  function wire(o) {
    o = o || {};
    var d = document, nameIn = d.getElementById("nameIn"), btn = d.getElementById("joinBtn");
    if (!nameIn || !btn || typeof o.join !== "function") return null;
    var team = o.kind === "team";
    nameIn.setAttribute("name", team ? "team" : "given-name");
    nameIn.setAttribute("autocomplete", team ? "off" : "given-name");
    nameIn.setAttribute("aria-label", team ? "Team name" : "First name");

    var form = d.createElement("form");
    form.id = "joinForm";
    form.setAttribute("autocomplete", "on");
    form.setAttribute("novalidate", "");
    form.setAttribute("style", "display:contents");
    var first = nameIn.closest(".field") || nameIn, last = btn.closest(".field") || btn;
    if (first.parentNode && first.parentNode === last.parentNode) {
      var p = first.parentNode, n = first, next;
      p.insertBefore(form, first);
      while (n) { next = n.nextSibling; form.appendChild(n); if (n === last) break; n = next; }
    } else {
      /* Not neighbours (a page laid out differently): tie each piece to the form by attribute. */
      d.body.appendChild(form);
      var all = [nameIn, btn], x = d.getElementById("joinExtra");
      if (x) { all.push.apply(all, x.querySelectorAll("input")); }
      for (var i = 0; i < all.length; i++) all[i].setAttribute("form", "joinForm");
    }
    btn.setAttribute("type", "submit");
    form.addEventListener("submit", function (e) {
      e.preventDefault();       // nothing navigates, ever
      o.join();
    });
    return form;
  }

  /* A REAL AUSTRALIAN OR NEW ZEALAND MOBILE (Dean, 12 Nov 2026, INBOX 291: the box took 20 characters of anything).
     Spaces, dashes, dots and brackets are ignored. Australia: 04 and 8 more digits, or +61 4..., 61 4..., 4... (9 digits).
     New Zealand: 02 and 7 to 9 more digits, or +64 2... / 64 2.... Answers the number in international form
     ("+61412345678", "+64211234567"), or "" when it is not one. */
  function mobile(raw) {
    var d = String(raw == null ? "" : raw).replace(/[\s\-().]/g, "");
    var plus = d.charAt(0) === "+"; if (plus) d = d.slice(1);
    if (!/^\d+$/.test(d)) return "";
    if (/^614\d{8}$/.test(d)) return "+" + d;
    if (!plus && /^04\d{8}$/.test(d)) return "+61" + d.slice(1);
    if (!plus && /^4\d{8}$/.test(d)) return "+61" + d;
    if (/^642\d{7,9}$/.test(d)) return "+" + d;
    if (!plus && /^02\d{7,9}$/.test(d)) return "+64" + d.slice(1);
    return "";
  }
  /* What to say when the mobile box holds something that is not a mobile; "" when it is fine or empty (it is optional). */
  var MOBILE_WRONG = "That mobile number doesn\u2019t look right. An Australian mobile starts 04 and has 10 digits; a New Zealand one starts 02.";
  var MOBILE_NEEDED = "Pop your mobile in, so you can be told if you win.";
  function mobileError() {
    var b = document.getElementById("xMobile"); if (!b) return "";
    var v = String(b.value || "").trim();
    if (!v && b.getAttribute && b.getAttribute("data-required") === "1") return MOBILE_NEEDED;
    return (v && !mobile(v)) ? MOBILE_WRONG : "";
  }

  root.VPDetails = { wire: wire, html: html, mobile: mobile, mobileError: mobileError, MOBILE_WRONG: MOBILE_WRONG, MOBILE_NEEDED: MOBILE_NEEDED };
})(typeof window !== "undefined" ? window : this);
