/* "PLAY A QUICK GAME": THE PAGE, THE LINKS, THE ONE-SETTING LABEL AND ORDER, THE FUNNEL CLIENT (INBOX 412, 15 Nov 2026).
   Runs vp-quick-config.js and vp-try-slot.js for real and reads the pages. Run from the repo root:  jsc tools/test-quick-page.js */
var bad = 0, ran = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 300) : '')); } }
function section(t) { print(''); print(t); }
function rd(p) { try { return readFile(p); } catch (e) { return readFile('../' + p); } }
var CONFIG = rd('venueplay/app/vp-quick-config.js'), QJS = rd('venueplay/app/vp-quick.js'), QHTML = rd('venueplay/quick.html'), TRY = rd('venueplay/app/try.html'),
    INDEX = rd('venueplay/index.html'), HELP = rd('venueplay/help.html'), LLMS = rd('venueplay/llms.txt'), SITEMAP = rd('venueplay/sitemap.xml'), REDIR = rd('venueplay/_redirects'),
    SLOT = rd('venueplay/app/vp-try-slot.js');

section('1. Every old see-a-night link goes to the new flow');
check('the home page hero button is the quick game, with the label setting and a source', /href="\/quick\?src=website"[^>]*data-vpq-label>Play a quick game<\/a>/.test(INDEX));
check('the home page, help, llms.txt and the sitemap no longer link /see-a-night', !/\/see-a-night/.test(INDEX.replace(/<!--[\s\S]*?-->/g, '')) && !/href="\/see-a-night/.test(HELP) && !/see-a-night/.test(LLMS) && !/see-a-night/.test(SITEMAP));
check('/see-a-night and /see-a-night.html are 301s to /quick (cold emails and the autopilot reply that already point there land on the new flow)', /^\/see-a-night\s+\/quick\s+301$/m.test(REDIR) && /^\/see-a-night\.html\s+\/quick\s+301$/m.test(REDIR));
var exists = true; try { rd('venueplay/see-a-night.html'); } catch (e) { exists = false; }
check('the old page file is kept (unlinked) so a rollback is one line', exists);
check('the home page and help load the label setting', /vp-quick-config\.js/.test(INDEX) && /vp-quick-config\.js/.test(HELP));

section('2. The label and the step order are ONE setting each');
var win = this; win.VP_START_API = 'https://api.example'; var posts = [];
win.fetch = function (u, o) { posts.push({ url: u, body: o && o.body ? JSON.parse(o.body) : null, headers: (o && o.headers) || {} }); return { catch: function () {} }; };
(0, eval)(CONFIG);
var Q = win.VPQuick;
check('the label is "Play a quick game" and lives only in the config', Q.cfg.LABEL === 'Play a quick game' && (CONFIG.match(/Play a quick game/g) || []).length === 1);
check('every page default text equals the setting (so a failed script still shows the right words)', (INDEX + HELP + QHTML).match(/data-vpq-label[^>]*>([^<]*)</g).every(function (m) { return />Play a quick game</.test(m); }));
check('the steps after the account are demo, games, choices', JSON.stringify(Q.cfg.STEPS) === '["demo","games","choices"]');
check('next() follows the order and ends on choices', Q.next('demo') === 'games' && Q.next('games') === 'choices' && Q.next('choices') === 'choices' && Q.first() === 'demo');
Q.cfg.STEPS = ['games', 'demo', 'choices'];
check('the LATER release (games before the demo) is one line: swap the array', Q.first() === 'games' && Q.next('games') === 'demo' && Q.next('demo') === 'choices');
check('the try page runs whatever the setting says (no step order of its own)', /quickRun\(VPQuick\.first\(\)\)/.test(TRY) && /quickRun\(VPQuick\.next\(QSTEP\)\)/.test(TRY));

section('3. The form: three boxes, no email, honeypot and bot check');
check('first name, mobile and venue are the boxes; no email box anywhere', /id="qName"/.test(QHTML) && /id="qMobile"/.test(QHTML) && /id="qVenue"/.test(QHTML) && !/type="email"/.test(QHTML) && !/id="[a-zA-Z]*[Ee]mail/.test(QHTML));
check('the suburb and postcode boxes start hidden (the postcode only when the suburb is not recognised)', /id="qSuburbRow" hidden/.test(QHTML) && /id="qPostRow" hidden/.test(QHTML));
check('the hidden honeypot is named website and the page sends it', /name="website"/.test(QHTML) && /website: val\("qWeb"\)/.test(QJS));
check('the bot check is rendered and its token sent', /id="qTs"/.test(QHTML) && /turnstile: tsToken\(\)/.test(QJS));
check('phone autofill: name, tel, organization and one-time-code are declared', /autocomplete="given-name"/.test(QHTML) && /autocomplete="tel"/.test(QHTML) && /autocomplete="one-time-code"/.test(QHTML));
check('the code step sends no email and no kind, to /start/verify, as /start does', /post\("\/start\/verify", \{ start_id: S\.id, code: c \}\)/.test(QJS));
check('after the account the one-tap link opens the demo on their own account', /\/app\/try\.html\?quick=1/.test(QJS) && /vpTryNext/.test(QJS));
check('the hand-off accepts the quick path and nothing else new', (function () {
  win.document = undefined; delete win.VPTrySlot; (0, eval)(SLOT); var T = win.VPTrySlot;
  var ls = { v: null, getItem: function () { var x = this.v; this.v = null; return x; }, removeItem: function () {} };
  ls.v = JSON.stringify({ path: '/app/try.html?quick=1', at: 1000 }); var ok1 = T.nextAfterSignIn(ls, 2000);
  ls.v = JSON.stringify({ path: '/app/try.html?quick=2', at: 1000 }); var no1 = T.nextAfterSignIn(ls, 2000);
  ls.v = JSON.stringify({ path: 'https://evil.example/', at: 1000 }); var no2 = T.nextAfterSignIn(ls, 2000);
  ls.v = JSON.stringify({ path: '/app/try.html?quick=1', at: 1000 }); var no3 = T.nextAfterSignIn(ls, 1000 + 31 * 60000);
  ls.v = JSON.stringify({ path: '/app/try.html?mode=player', at: 1000 }); var ok2 = T.nextAfterSignIn(ls, 2000);
  return ok1 === '/app/try.html?quick=1' && no1 === '/app/' && no2 === '/app/' && no3 === '/app/' && ok2 === '/app/try.html?mode=player';
})());

section('4. After the account: no wizard, the games question, the three choices, a card offer that is never forced');
check('first entry marks the setup guide dismissed (no wizard)', /st\.dismissed=true/.test(TRY.slice(TRY.indexOf('function quickStart'), TRY.indexOf('function quickRun'))));
check('"Set up my venue" is the only thing that brings the guide back', /st\.dismissed=false/.test(TRY) && (TRY.match(/dismissed=false/g) || []).length === 1);
check('what games do you run saves setup_answers (the wizard\'s own question and saver)', /VP\.saveSettings\(S\.venueId, \{ setup_answers:ans \}\)/.test(TRY) && /VPFirstRun/.test(TRY) && /vp-firstrun\.js/.test(TRY));
check('the three choices and the card button exist', /id="qAnother"/.test(TRY) && /id="qInfo"/.test(TRY) && /id="qSetup"/.test(TRY) && /id="qCard"/.test(TRY));
check('more info posts to /quick/more-info and shows only a thank-you (nothing is sent to them)', /bill\("\/quick\/more-info"/.test(TRY) && /Thanks, we'll be in touch/.test(TRY));
check('the card button is one tap to Stripe and is never automatic', /bill\("\/account\/card-link"/.test(TRY) && !/qCard"\)\.click\(\)/.test(TRY) && /location\.href=j\.card_url/.test(TRY));

section('5. The funnel client: step names only, no personal data');
posts.length = 0; win.localStorage = { d: {}, getItem: function (k) { return this.d[k] === undefined ? null : this.d[k]; }, setItem: function (k, v) { this.d[k] = String(v); } };
win.crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } };
(0, eval)(CONFIG); Q = win.VPQuick;
check('an unknown step is refused', Q.track('typed_a_name') === false && posts.length === 0);
check('a known step posts once, with session, step, source and taps only', Q.track('page_opened') === true && posts.length === 1 && Object.keys(posts[0].body).sort().join(',') === 'sid,src,step,taps' && /^[a-f0-9]{24}$/.test(posts[0].body.sid), posts);
check('the same step again on the page posts nothing', Q.track('page_opened') === false && posts.length === 1);
Q.track('signed_in', { token: 'tok' });
check('signed in, the token goes in the header (the Worker takes the venue from it), not the body', posts[1].headers.Authorization === 'Bearer tok' && JSON.stringify(posts[1].body).indexOf('tok') === -1, posts[1]);
check('the session id is one random id kept in this browser', posts[0].body.sid === posts[1].body.sid);
check('the page, the demo and the choices never send a name, mobile or venue name to the funnel', !/track\([^)]*(name|mobile|venue)/.test(QJS + TRY.slice(TRY.indexOf('function qtrack'), TRY.indexOf('function qtrack') + 200)));
check('taps are counted on every press and stored as a number', /pointerdown/.test(CONFIG) && Q.taps() === 0);
var evs = /var EVENTS = \[([^\]]*)\]/.exec(CONFIG)[1];
check('the steps include the demo questions, the podium, the games question, the card and each choice', ['demo_q1', 'demo_q5', 'podium_seen', 'games_answered', 'card_screen_seen', 'card_added', 'choice_another', 'choice_info', 'choice_setup', 'page_left', 'signed_in', 'account_made'].every(function (x) { return evs.indexOf('"' + x + '"') >= 0; }));

section('6. House rules on the words');
var ALL = QHTML + QJS + CONFIG + TRY.slice(TRY.indexOf('PLAY A QUICK GAME'), TRY.indexOf('/* ---- 1. how ---- */'));
check('no em dash or en dash', ALL.indexOf('\u2014') === -1 && ALL.indexOf('\u2013') === -1);
check('venueplay is lowercase in every customer word', !/VenuePlay|Venueplay/.test(ALL.replace(/vpTryNext|VPQuick|VPFirstRun/g, '')));
check('no Gflam, no workers.dev, no .dev link, and no phone number but the support line', !/Gflam|workers\.dev|\.dev\b/i.test(ALL) && !/0[2-9]\s?\d{4}\s?\d{4}|04\d\d\s?\d{3}\s?\d{3}/.test((QHTML + QJS).replace('0400 000 000', '')));
check('one screen, no scroll: the page is a centred 100dvh column', /min-height:100dvh/.test(QHTML) && !/overflow-y:\s*scroll/.test(QHTML));

print('');
if (bad) print(bad + ' of ' + ran + ' checks FAILED'); else print('ALL ' + ran + ' CHECKS PASSED');
