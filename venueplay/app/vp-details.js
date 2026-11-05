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
  var BOXES = [
    { key: "last_name", id: "xLast", type: "text", ph: "Last name", name: "family-name", ac: "family-name", ml: 40 },
    { key: "postcode", id: "xPost", type: "text", ph: "Postcode", name: "postal-code", ac: "postal-code", ml: 4, im: "numeric", pattern: "[0-9]*" },
    { key: "email", id: "xEmail", type: "email", ph: "Email", name: "email", ac: "email", ml: 120 },
    { key: "mobile", id: "xMobile", type: "tel", ph: "Mobile", name: "tel", ac: "tel", ml: 20, im: "tel" }
  ];

  function box(b) {
    return '<div class="field"><input type="' + b.type + '" id="' + b.id + '" name="' + b.name + '" placeholder="' + b.ph +
      '" aria-label="' + b.ph + '" autocomplete="' + b.ac + '" maxlength="' + b.ml + '"' +
      (b.im ? ' inputmode="' + b.im + '"' : "") + (b.pattern ? ' pattern="' + b.pattern + '"' : "") + '></div>';
  }

  /* The boxes the venue asks for, in the order the phones always showed them. */
  function html(collect) {
    var h = "";
    for (var i = 0; i < BOXES.length; i++) if (collect && collect[BOXES[i].key]) h += box(BOXES[i]);
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

  root.VPDetails = { wire: wire, html: html };
})(typeof window !== "undefined" ? window : this);
