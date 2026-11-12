/* THE QUESTION'S COUNTDOWN RING AND THE TIME'S UP MOMENT, one copy (12 Nov 2026, INBOX 309.3, 310, 312).
   Used by the trivia phone (/app/trivia/play.html, the ring) and the drink coaster (/live-here-now, the ring
   and Time's up). Styles: /app/vp-qring.css.

   VPQRing.paint(ringEl, numEl, frac, rem): frac is the share of the time left (1 full, 0 gone), rem the whole
     seconds left. The ring turns from pink to amber at 5 seconds, as the trivia phone always has.
   VPQRing.timesUp(): "Time's up!" for under a second, a buzz where the phone can, and the time's up sound
     once the player has tapped the page (phones refuse sound before a tap) unless they muted it.
     THE SOUND ITSELF comes from Dean's sound pass (INBOX 313: real recorded sounds, never a synth beep).
     Until he picks one, VPQRing.SOUNDS.timesUp is '' and nothing plays: a hook, not a placeholder noise.
   VPQRing.muteButton(into): the small speaker button, in the given row (or bottom right); kept on this phone.
     In a row, never over an answer button. */
(function (root) {
  var C = 2 * Math.PI * 34;   // the ring's circle, r=34 in a 76 box
  var SOUNDS = { timesUp: '' };
  var tapped = false, audio = null;
  function muted() { try { return root.localStorage.getItem('vpqMute') === '1'; } catch (e) { return false; } }
  function setMuted(m) { try { root.localStorage.setItem('vpqMute', m ? '1' : '0'); } catch (e) {} }
  if (root.document) {
    var onTap = function () { tapped = true; root.document.removeEventListener('pointerdown', onTap, true); };
    root.document.addEventListener('pointerdown', onTap, true);
  }
  function paint(ring, num, frac, rem) {
    if (!ring || !num) return;
    var f = Math.max(0, Math.min(1, +frac || 0));
    ring.setAttribute('stroke-dasharray', C);
    ring.setAttribute('stroke-dashoffset', C * (1 - f));
    ring.style.stroke = rem <= 5 ? 'var(--roll)' : 'var(--pink)';
    num.textContent = Math.max(0, rem | 0);
  }
  function play(name) {
    var src = SOUNDS[name];
    if (!src || !tapped || muted()) return false;
    try { audio = audio || new root.Audio(); audio.src = src; var p = audio.play(); if (p && p.catch) p.catch(function () {}); return true; }
    catch (e) { return false; }
  }
  function timesUp(words) {
    var d = root.document; if (!d || !d.body) return;
    var el = d.createElement('div');
    el.className = 'vpq-up'; el.setAttribute('aria-hidden', 'true');
    var b = d.createElement('b'); b.textContent = words || "Time's up!"; el.appendChild(b);
    d.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 950);
    play('timesUp');
    if (!muted() && root.VPCelebrate) root.VPCelebrate.buzz(180);   // the one place a phone is buzzed (vp-celebrate.js)
  }
  function muteButton(into) {
    var d = root.document; if (!d || !d.body || d.getElementById('vpqMute')) return;
    var btn = d.createElement('button');
    btn.type = 'button'; btn.id = 'vpqMute'; btn.className = 'vpq-mute' + (into ? ' inline' : '');
    var SPK = '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>';
    function label() {
      var m = muted();
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="vertical-align:middle">' + SPK +
        (m ? '<path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
           : '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>') + '</svg>';
      btn.setAttribute('aria-label', m ? 'Sound off. Tap to turn it on' : 'Sound on. Tap to turn it off');
    }
    btn.addEventListener('click', function () { setMuted(!muted()); label(); });
    label();
    (into || d.body).appendChild(btn);
  }
  root.VPQRing = { paint: paint, timesUp: timesUp, muteButton: muteButton, SOUNDS: SOUNDS, muted: muted, CIRCLE: C };
})(typeof window !== 'undefined' ? window : this);
