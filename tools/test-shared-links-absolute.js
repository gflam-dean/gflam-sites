/* A SHARED SCRIPT NEVER SENDS THE BROWSER TO A RELATIVE PAGE.
   venueplay/app/vp-*.js are loaded from /app/ AND from the game consoles one folder down
   (/app/musical/, /app/trivia/, ...). A relative "index.html" is /app/index.html from one and
   /app/musical/index.html from the other, which does not exist, and a missing page on this site
   answers with the marketing homepage. Played 30 Sep 2026: a musical console whose login had run
   out landed on the sales site. RUNS vp-session.js's homeHref, and reads every shared script's
   navigation targets.
   Run: jsc tools/test-shared-links-absolute.js */
var ran = 0, bad = 0;
function ok(n, c, extra){ ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   ' + extra : '')); if (!c) bad++; }
var files = ['vp-session.js', 'vp-sign.js', 'vp-channel.js', 'vp-screen-router.js', 'vp-venueurl.js', 'vp-celebrate.js', 'vp-hold.js', 'vp-fit.js', 'vp-room.js', 'vp-phonekey.js', 'vp-weekly.js', 'vp-analytics.js'];
var offenders = [], read = 0;
files.forEach(function (f) {
  var src; try { src = readFile('venueplay/app/' + f); } catch (e) { return; }
  read++;
  // a navigation to a quoted target that does not start with / or http, or is a variable holding one
  var re = /(location\.(?:href|replace|assign)\s*(?:=|\()\s*)(["'])([^"'\/][^"']*)\2/g, m;
  while ((m = re.exec(src))) { if (!/^(https?:|#|\?)/.test(m[3])) offenders.push(f + ': ' + m[3]); }
  var v = /var\s+SIGNIN\s*=\s*(["'])([^"']*)\1/.exec(src);
  if (v && v[2].charAt(0) !== '/') offenders.push(f + ': SIGNIN = ' + v[2]);
});
ok('the shared scripts were read', read >= 6, read + ' read');
ok('no shared script navigates to a relative page', offenders.length === 0, offenders.join(', '));
/* and the one that decides where a signed-in person goes, run for real */
var root = { location: {}, localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
             sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} } };
var src = readFile('venueplay/app/vp-session.js');
var i = src.indexOf('function homeHref('), j = src.indexOf('\n  }\n', i) + 4;
var homeHref = (new Function('_ctx', src.slice(i, j) + '; return homeHref;'))(null);
[[{ isAdmin: true }, 'HQ'], [{ scope: 'staff', staff: [{ role: 'host' }] }, 'a host'],
 [{ scope: 'staff', staff: [{ role: 'marketing' }] }, 'a marketing login'], [{}, 'nobody in particular']].forEach(function (c) {
  var h = homeHref(c[0]);
  ok('home for ' + c[1] + ' is an absolute /app/ address', /^\/app\//.test(h), h);
});
print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
if (bad) throw new Error(bad + ' failed');
