/* The venue's mark on the TV: painted only when the venue has a logo, small, top-left, and kept clear.

   Dean, 7 Aug 2026: the venue's logo in the top-left corner of the TV, on /tv and on every game
   screen. 16 Oct 2026: one size everywhere (at most 120 pixels wide and 56 tall, 14 pixels in
   from the corner), never catching a tap, and marked data-fit-avoid so /app/vp-fit.js moves the
   wall out from under it. It must never sit on a called number, the join code or the question,
   and it is the keep-out mark that makes sure of that.

   The REAL painters are lifted out of tv.html (setVenueLogo and applyVenueLogo) and out of the
   four game screens that show it (paintVenueLogo), and RUN against a small DOM:
     no logo_url   nothing is created, and nothing is shown
     a logo_url    one <img id="venueLogo">, fixed, 14px in, capped at 120x56, pointer-events
                   none, data-fit-avoid, showing that address
     removed       the mark comes off the wall
   and the five copies must paint exactly the same mark, because five copies of one answer is
   how this codebase usually breaks.

   Jag the Joker (switched off) keeps its own title in that corner, and topanswers/screen.html is
   a demo page with no venue, so neither paints a logo; this suite says so out loud.

   Run from the repo root:  jsc tools/test-tv-logo-mark.js
*/
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); fails++; } }

function lift(src, name, where) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' is not in ' + where);
  var d = 0, started = false;
  for (var j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error(name + ' never closes in ' + where);
}
/* cssText into numbers and words, so the check is about the box, not the spelling. */
function css(t) {
  var o = {};
  String(t || '').split(';').forEach(function (kv) { var k = kv.split(':')[0], v = kv.slice(k.length + 1); if (k.trim()) o[k.trim()] = v.trim(); });
  return o;
}
function DOM() {
  var made = {}, created = 0;
  function el() { return { id: '', src: '', attrs: {}, style: { cssText: '', display: '' }, textContent: '', hidden: false,
    setAttribute: function (k, v) { this.attrs[k] = String(v); }, getAttribute: function (k) { return k === 'src' ? (this.src || null) : (this.attrs[k] == null ? null : this.attrs[k]); } }; }
  var doc = { getElementById: function (id) { return made[id] || null; },
    createElement: function () { created++; return el(); },
    body: { appendChild: function (n) { made[n.id] = n; } } };
  return { doc: doc, made: made, created: function () { return created; }, el: el };
}
function shown(m) { return !!m && m.style.display === 'block'; }

var MARKS = [];
function inspect(label, m) {
  var c = css(m && m.style.cssText);
  check(label + ': one fixed <img id="venueLogo"> showing that address', !!m && m.id === 'venueLogo' && m.src === 'https://db/storage/v1/object/public/venue-logos/v/abc.png' && c.position === 'fixed' && shown(m), m && { id: m.id, src: m.src, css: c });
  check(label + ': 14 pixels in from the top-left corner', c.top === '14px' && c.left === '14px', c);
  check(label + ': no bigger than 120 wide and 56 tall', c['max-width'] === '120px' && c['max-height'] === '56px', c);
  check(label + ': never catches a tap', c['pointer-events'] === 'none', c);
  check(label + ': marked as a vp-fit keep-out, so the wall moves out from under it', !!m && m.attrs['data-fit-avoid'] === '', m && m.attrs);
  MARKS.push({ label: label, css: m && m.style.cssText, avoid: m && m.attrs['data-fit-avoid'] });
}

print('tv.html');
(function () {
  var TV = readFile('venueplay/tv.html');
  var D = DOM(), document = D.doc;
  var made = D.made;
  made.venueNameTag = D.el(); made.tvCorner = D.el(); made.lobbyAt = D.el(); made.lobbyAtName = D.el();
  var tvMode = 'bingo', venueLogoUrl = '';
  function $(id) { return made[id] || (made[id] = D.el()); }
  eval(lift(TV, 'applyVenueLogo', 'tv.html')); eval(lift(TV, 'setVenueLogo', 'tv.html'));
  setVenueLogo('');
  check('no logo_url: nothing is created on the wall', !made.venueLogo && D.created() === 0, D.created());
  setVenueLogo('https://db/storage/v1/object/public/venue-logos/v/abc.png');
  inspect('tv.html', made.venueLogo);
  setVenueLogo('');
  check('the logo removed: the mark comes off the wall', !shown(made.venueLogo), made.venueLogo && made.venueLogo.style.display);
  check('loadScreen hands the Worker\'s logo_url to it, and nothing else', /setVenueLogo\(d\.logo_url \|\| ""\);/.test(lift(TV, 'loadScreen', 'tv.html')));
})();

['musical', 'trivia', 'members', 'raffle'].forEach(function (g) {
  var f = 'venueplay/app/' + g + '/screen.html';
  print(f);
  var S = readFile(f);
  var D = DOM(), document = D.doc;
  eval(lift(S, 'paintVenueLogo', f));
  paintVenueLogo('');
  check(g + ': no logo_url: nothing is created on the wall', !D.made.venueLogo && D.created() === 0, D.created());
  paintVenueLogo('https://db/storage/v1/object/public/venue-logos/v/abc.png');
  inspect(g, D.made.venueLogo);
  paintVenueLogo('');
  check(g + ': the logo removed: the mark comes off the wall', !shown(D.made.venueLogo), D.made.venueLogo && D.made.venueLogo.style.display);
  check(g + ': the venue screen read hands the Worker\'s logo_url to it', S.indexOf('.then(function(d){ if(!d) return; paint(d.logo_url||"");') !== -1);
});

print('one mark, not five');
var first = MARKS[0] || {};
check('tv.html and the four game screens paint exactly the same box', MARKS.length === 5 && MARKS.every(function (m) { return m.css === first.css && m.avoid === ''; }),
      MARKS.map(function (m) { return m.label + ' ' + m.css; }));
check('the Punters Reckon demo screen paints no logo (it has no venue)', readFile('venueplay/app/topanswers/screen.html').indexOf('venueLogo') === -1);

print('');
print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
if (fails) throw new Error(fails + ' failed');
