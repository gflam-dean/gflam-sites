/* "HOSTED BY" ON THE TV, THE GAME WORKER'S HALF (Dean, 6 Nov 2026, INBOX 120; migration 181).

   Runs the REAL /host/hosted-by on tools/rig-game-worker.js, with the Worker's own requireStaff put back
   (the rig stubs it), for Sam, one host login at two pubs on two accounts (the world
   tools/test-hosted-by.js builds through the Account page):

     The Royal switched trivia on, The Anchor trivia and musical bingo: each venue answers with Sam's
     one card, for exactly the games THAT venue switched on
     a venue where Sam is not staff is refused (403), and a stranger learns nothing about Sam's card
     a logo address that is not our own venue-logos/hosts/ storage is never handed to a TV (name only)
     nothing to show, never an error, when: the switch is off, the card has no name, an HQ admin is
     using View as, or migration 181 has not run (the column and the table answer 400)
   And the TV half of /app/vp-hostedby.js, run in jsc: tag() puts the card on "mode" messages only,
   a console that has not heard back sends no hosted_by at all (so an older wall is left as it is), and
   clean() keeps a foreign logo address off the wall.

   Run from the repo root:  jsc tools/test-hosted-by-game.js
*/
load('tools/rig-game-worker.js');
(0, eval)(SRC.match(/async function requireStaff\(env, authUserId, venueId, audience\) \{[\s\S]*?\n\}\n/)[0]);   // the real one, not the rig's stub
var WHO = null;
verifyHostJwt = async function () { if (!WHO) { var e = new Error('no token'); e.status = 401; throw e; } return WHO; };
function U(n) { return '70000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
function V(n) { return '80000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var SAM = U(9), OLIVE = U(1), PAT = U(2), STRANGER = U(3), ADMIN = U(8);
var ROYAL = V(1), ANCHOR = V(2), ELSE = V(3);
var LOGO = ENV.SUPABASE_URL + '/storage/v1/object/public/venue-logos/hosts/' + SAM + '/abc123.png';
function world() {
  DB = {};
  DB.vp_venues = [{ id: ROYAL, name: 'The Royal', slug: 'the-royal', status: 'active' },
                  { id: ANCHOR, name: 'The Anchor', slug: 'the-anchor', status: 'active' },
                  { id: ELSE, name: 'Somewhere Else', slug: 'somewhere-else', status: 'active' }];
  DB.vp_venue_groups = [];
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, role: 'owner' }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OLIVE, venue_id: ROYAL, role: 'owner' },
                       { id: 's2', auth_user_id: PAT, venue_id: ANCHOR, role: 'owner' },
                       { id: 's3', auth_user_id: STRANGER, venue_id: ELSE, role: 'owner' },
                       { id: 's4', auth_user_id: SAM, venue_id: ROYAL, role: 'host', hosted_by: { trivia: true, musical: false } },
                       { id: 's5', auth_user_id: SAM, venue_id: ANCHOR, role: 'host', hosted_by: { trivia: true, musical: true } }];
  DB.vp_host_brands = [{ auth_user_id: SAM, name: 'Quiz Co Trivia', logo_url: LOGO }];
}
function req(venueId) { return { method: 'GET', url: 'https://game.venueplay.com.au/host/hosted-by?venue_id=' + encodeURIComponent(venueId), headers: { get: function () { return ''; } } }; }
async function ask(who, venueId) {
  WHO = who;
  try { return await handleHostedBy(req(venueId), ENV, json); }
  catch (e) { return { status: e.status || 500, body: { error: e.message } }; }
}
function card(r, g) { return r && r.body && r.body[g]; }

(async function () {
  world();
  print('one host, two pubs, two accounts');
  var r = await ask(SAM, ROYAL);
  show('The Royal: Sam\'s card for trivia', r.status === 200 && card(r, 'trivia') && card(r, 'trivia').name === 'Quiz Co Trivia' && card(r, 'trivia').logo_url === LOGO, JSON.stringify(r));
  show('  and none for musical bingo (The Royal left it off)', r.body.musical === null, JSON.stringify(r.body));
  var a = await ask(SAM, ANCHOR);
  show('The Anchor: the SAME card, for trivia and musical bingo', a.status === 200 && card(a, 'trivia') && card(a, 'trivia').name === 'Quiz Co Trivia' && card(a, 'musical') && card(a, 'musical').logo_url === LOGO, JSON.stringify(a));
  var x = await ask(SAM, ELSE);
  show('a pub Sam does not work at is refused', x.status === 403, JSON.stringify(x));
  var s = await ask(STRANGER, ROYAL);
  show('a stranger asking at Sam\'s pub is refused and learns nothing', s.status === 403 && !JSON.stringify(s).includes('Quiz Co'), JSON.stringify(s));
  var o = await ask(OLIVE, ROYAL);
  show('the owner running her own console gets nothing (the card is Sam\'s, not the venue\'s)', o.status === 200 && o.body.trivia === null && o.body.musical === null, JSON.stringify(o));
  var hq = await ask(ADMIN, ROYAL);
  show('HQ using View as gets nothing to show, not an error', hq.status === 200 && hq.body.trivia === null && hq.body.musical === null, JSON.stringify(hq));
  var no = await ask(null, ROYAL);
  show('no sign-in is refused', no.status === 401, JSON.stringify(no));

  print('nothing to show, never an error');
  DB.vp_venue_staff[3].hosted_by = null;
  r = await ask(SAM, ROYAL);
  show('switched off at The Royal: nothing', r.status === 200 && r.body.trivia === null && r.body.musical === null, JSON.stringify(r));
  DB.vp_venue_staff[3].hosted_by = { trivia: 'yes' };
  r = await ask(SAM, ROYAL);
  show('a switch that is not exactly true is off', r.status === 200 && r.body.trivia === null, JSON.stringify(r));
  DB.vp_venue_staff[3].hosted_by = { trivia: true, musical: false };
  DB.vp_host_brands[0].name = '   ';
  r = await ask(SAM, ROYAL);
  show('a card with no name: nothing', r.status === 200 && r.body.trivia === null, JSON.stringify(r));
  DB.vp_host_brands[0].name = 'Quiz <b>Co</b>';
  r = await ask(SAM, ROYAL);
  show('markup in a name is stripped before it reaches a TV', card(r, 'trivia') && !/[<>]/.test(card(r, 'trivia').name), JSON.stringify(r));
  DB.vp_host_brands[0].name = 'Quiz Co Trivia';
  var foreign = ['https://evil.example/x.png', ENV.SUPABASE_URL + '/storage/v1/object/public/venue-logos/' + ROYAL + '/x.png', ENV.SUPABASE_URL + '/storage/v1/object/public/venue-logos/hosts/a"onerror=1.png'];
  for (var i = 0; i < foreign.length; i++) {
    DB.vp_host_brands[0].logo_url = foreign[i];
    r = await ask(SAM, ROYAL);
    show('a logo address that is not ours under hosts/ is dropped, the name kept (' + ['another site', 'a venue folder', 'a quote in it'][i] + ')',
         card(r, 'trivia') && card(r, 'trivia').logo_url === '' && card(r, 'trivia').name === 'Quiz Co Trivia', JSON.stringify(r));
  }
  DB.vp_host_brands[0].logo_url = LOGO;
  var realFetch = fetch;
  fetch = async function (url, opts) {
    var u = String(url);
    if (/\/rest\/v1\/vp_host_brands/.test(u) || (/\/rest\/v1\/vp_venue_staff\?/.test(u) && /select=hosted_by/.test(u))) return resp(400, { code: '42703', message: 'column does not exist' });
    return realFetch(url, opts);
  };
  r = await ask(SAM, ANCHOR);
  show('before migration 181: nothing to show, and no error', r.status === 200 && r.body.trivia === null && r.body.musical === null, JSON.stringify(r));
  fetch = realFetch;

  print('the console and the TV halves of /app/vp-hostedby.js');
  var window = { addEventListener: function () {}, innerWidth: 1920, innerHeight: 1080 };
  var document = { getElementById: function () { return null; }, createElement: function () { return {}; } };
  var lib = (new Function('window', 'document', 'fetch', readFile('venueplay/app/vp-hostedby.js') + '; return window.VPHostedBy;'))(window, document,
    function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ trivia: { name: 'Quiz Co Trivia', logo_url: LOGO.replace('fake.supabase.co', 'abcd.supabase.co') }, musical: null }); } }); });
  var m0 = lib.tag({ t: 'mode', mode: 'trivia' }, 'trivia');
  show('before the console has heard back, "mode" carries no hosted_by at all', !('hosted_by' in m0), JSON.stringify(m0));
  var changed = null;
  await lib.load('https://game', ROYAL, function () { return 'tok'; }, 'trivia', function (c) { changed = c; });
  var m1 = lib.tag({ t: 'mode', mode: 'trivia', title: 'Trivia' }, 'trivia');
  show('after: "mode" carries the card, name and our logo', m1.hosted_by && m1.hosted_by.name === 'Quiz Co Trivia' && /abcd\.supabase\.co\/storage\/v1\/object\/public\/venue-logos\/hosts\//.test(m1.hosted_by.logo) && m1.title === 'Trivia', JSON.stringify(m1));
  show('  and the console is told the card arrived, so it can tell the TV again', changed && changed.name === 'Quiz Co Trivia', JSON.stringify(changed));
  var q = { t: 'question', qseq: 1 };
  show('every other message is handed back untouched', lib.tag(q, 'trivia') === q && !('hosted_by' in q));
  var mm = lib.tag({ t: 'mode', mode: 'musical' }, 'musical');
  show('musical bingo switched off: "mode" says hosted_by null, so the wall clears it', 'hosted_by' in mm && mm.hosted_by === null, JSON.stringify(mm));
  show('the TV keeps a foreign logo off the wall, the name kept', JSON.stringify(lib.clean({ name: 'Quiz Co', logo: 'https://evil.example/a.png' })) === '{"name":"Quiz Co","logo":""}');
  show('  and a script URL', lib.clean({ name: 'Quiz Co', logo: 'javascript:alert(1)' }).logo === '');
  show('a card with no name is no card', lib.clean({ name: '  ', logo: LOGO }) === null);
  show('the demo takes a logo from this site only', JSON.stringify(lib.fromQuery('?demo=1&hostedby=Quiz%20Co&hostlogo=/logos/x.png')) === '{"name":"Quiz Co","logo":"/logos/x.png"}'
       && lib.fromQuery('?hostedby=Quiz&hostlogo=https://evil.example/x.png').logo === '');
  var src = readFile('venueplay/app/vp-hostedby.js');
  show('one layout only (Dean picked "hosted by" under the game\'s name, 11 Nov 2026): no ?hostedat= switch, no top or bottom mode, no option B', !/hostedat/.test(src) && !/\bMODE\b/.test(src) && !/\bSPLIT\b/.test(src) && !/hb-bottom|hb-top|hb-inline/.test(src));
  show('  the words are one line under the game\'s name and the slide is held clear of one fixed band (the same height on every variant)', /id = "hostedByLine"/.test(src) && /id = "hostedByBand"/.test(src) && /var BAND = 0\.\d+;/.test(src) && /data-fit-ignore/.test(src));

})().catch(function (e) { show('threw: ' + (e && e.stack || e), false); }).then(function () {
  print(bad ? (bad + ' of ' + ran + ' checks FAILED') : ('ALL ' + ran + ' CHECKS PASSED'));
  if (bad) throw new Error('failed');
});
