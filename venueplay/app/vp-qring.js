/* THE QUESTION'S COUNTDOWN RING AND THE TIME'S UP MOMENT, one copy (12 Nov 2026, INBOX 309.3, 310, 312).
   Used by the trivia phone (/app/trivia/play.html, the ring) and the drink coaster (/live-here-now, the ring
   and Time's up). Styles: /app/vp-qring.css.

   VPQRing.paint(ringEl, numEl, frac, rem): frac is the share of the time left (1 full, 0 gone), rem the whole
     seconds left. The ring turns from pink to amber at 5 seconds, as the trivia phone always has.
   VPQRing.timesUp(): "Time's up!" for under a second, a buzz where the phone can, and the time's up sound
     once the player has tapped the page (phones refuse sound before a tap) unless they muted it.
     The sound and the on/off button are the one sound player's (VPCelebrate.sound('timesup'), muteButton, in
     /app/vp-celebrate.js): its 'timesup' slot is empty until Dean's sound pass, so nothing plays yet.
   VPQRing.muteButton(into): hands to VPCelebrate.muteButton. */
(function (root) {
  var C = 2 * Math.PI * 34;   // the ring's circle, r=34 in a 76 box
  function cel() { return root.VPCelebrate || null; }
  function paint(ring, num, frac, rem) {
    if (!ring || !num) return;
    var f = Math.max(0, Math.min(1, +frac || 0));
    ring.setAttribute('stroke-dasharray', C);
    ring.setAttribute('stroke-dashoffset', C * (1 - f));
    ring.style.stroke = rem <= 5 ? 'var(--roll)' : 'var(--pink)';
    num.textContent = Math.max(0, rem | 0);
  }
  function timesUp(words) {
    var d = root.document; if (!d || !d.body) return;
    var el = d.createElement('div');
    el.className = 'vpq-up'; el.setAttribute('aria-hidden', 'true');
    var b = d.createElement('b'); b.textContent = words || "Time's up!"; el.appendChild(b);
    d.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 950);
    var c = cel();
    if (c) { c.sound('timesup'); if (!c.muted()) c.buzz(180); }   // the one sound player and the one buzz (vp-celebrate.js)
  }
  function muteButton(into) { var c = cel(); if (c) c.muteButton(into); }   // the one sound on/off button (vp-celebrate.js)
  root.VPQRing = { paint: paint, timesUp: timesUp, muteButton: muteButton, CIRCLE: C };
})(typeof window !== 'undefined' ? window : this);
