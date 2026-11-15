/* "PLAY A QUICK GAME": THE PAGE, THE LINKS, THE ONE-SETTING LABEL AND ORDER, THE FUNNEL CLIENT (INBOX 412, 15 Nov 2026).
   Runs vp-quick-config.js and vp-try-slot.js for real and reads the pages. Run from the repo root:  jsc tools/test-quick-page.js */
var bad = 0, ran = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 300) : '')); } }
function section(t) { print(''); print(t); }
function rd(p) { try { return readFile(p); } catch (e) { return readFile('../' + p); } }
var CONFIG = rd('venueplay/app/vp-quick-config.js'), QJS = rd('venueplay/app/vp-quick.js'), QHTML = rd('venueplay/quick.html'), TRY = rd('venueplay/app/play-quick.html'), NSW = rd('venueplay/nsw.html'), SITECSS = rd('venueplay/app/vp-site.css'),
    INDEX = rd('venueplay/index.html'), HELP = rd('venueplay/help.html'), LLMS = rd('venueplay/llms.txt'), SITEMAP = rd('venueplay/sitemap.xml'), REDIR = rd('venueplay/_redirects'),
    SLOT = rd('venueplay/app/vp-try-slot.js');

section('1. Every old see-a-night link goes to the new flow');
check('the home page hero button is the quick game, with the label setting and a source', /href="\/quick\?src=website"[^>]*data-vpq-label>Play a quick game<\/a>/.test(INDEX));
check('the home page, help, llms.txt and the sitemap no longer link /see-a-night', !/\/see-a-night/.test(INDEX.replace(/<!--[\s\S]*?-->/g, '')) && !/href="\/see-a-night/.test(HELP) && !/see-a-night/.test(LLMS) && !/see-a-night/.test(SITEMAP));
check('/see-a-night and /see-a-night.html are 301s to /quick (cold emails and the autopilot reply that already point there land on the new flow)', /^\/see-a-night\s+\/quick\s+301$/m.test(REDIR) && /^\/see-a-night\.html\s+\/quick\s+301$/m.test(REDIR));
var exists = true; try { rd('venueplay/see-a-night.html'); } catch (e) { exists = false; }
check('the old page file is kept (unlinked) so a rollback is one line', exists);
var P404 = rd('venueplay/404.html'), TRAIN = rd('venueplay/training.html'), WK = rd('venueplay-backend/worker/venueplay-api-FULL.js');
/* 15 Nov 2026 (T17 merge): 419 sends the subscriber welcome button to the HOME PAGE with its utm tags (test-vp-subscribers checks the button), not /quick. */
check('the 404 page, the training page and the subscriber welcome email no longer point at /see-a-night', !/href="\/see-a-night/.test(P404) && !/\/see-a-night/.test(TRAIN.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')) && WK.indexOf("site + '/see-a-night") === -1 && /site \+ '\/\?utm_source=subscriber&utm_medium=email&utm_campaign=welcome'/.test(WK));
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
check('the try page runs whatever the setting says (no step order of its own)', /run\(VPQuick\.first\(\)\)/.test(TRY) && /run\(VPQuick\.next\(QSTEP\)\)/.test(TRY));

section('3. The form: three boxes, no email, honeypot and bot check');
check('first name, mobile and venue are the boxes; no email box anywhere', /id="qName"/.test(QHTML) && /id="qMobile"/.test(QHTML) && /id="qVenue"/.test(QHTML) && !/type="email"/.test(QHTML) && !/id="[a-zA-Z]*[Ee]mail/.test(QHTML));
check('the suburb and postcode boxes start hidden (the postcode only when the suburb is not recognised)', /id="qSuburbRow" hidden/.test(QHTML) && /id="qPostRow" hidden/.test(QHTML));
check('the hidden honeypot is named website and the page sends it', /name="website"/.test(QHTML) && /website: val\("qWeb"\)/.test(QJS));
check('the bot check is rendered and its token sent', /id="qTs"/.test(QHTML) && /turnstile: tsToken\(\)/.test(QJS));
check('phone autofill: name, tel, organization and one-time-code are declared', /autocomplete="given-name"/.test(QHTML) && /autocomplete="tel"/.test(QHTML) && /autocomplete="one-time-code"/.test(QHTML));
check('the code step sends no email and no kind, to /start/verify, as /start does', /post\("\/start\/verify", \{ start_id: S\.id, code: c \}\)/.test(QJS));
check('after the account the one-tap link opens the demo on their own account', /\/app\/play-quick\.html/.test(QJS) && /vpTryNext/.test(QJS));
check('the hand-off accepts the quick path and nothing else new', (function () {
  win.document = undefined; delete win.VPTrySlot; (0, eval)(SLOT); var T = win.VPTrySlot;
  var ls = { v: null, getItem: function () { var x = this.v; this.v = null; return x; }, removeItem: function () {} };
  ls.v = JSON.stringify({ path: '/app/play-quick.html', at: 1000 }); var ok1 = T.nextAfterSignIn(ls, 2000);
  ls.v = JSON.stringify({ path: '/app/play-quick.html?x=2', at: 1000 }); var no1 = T.nextAfterSignIn(ls, 2000);
  ls.v = JSON.stringify({ path: 'https://evil.example/', at: 1000 }); var no2 = T.nextAfterSignIn(ls, 2000);
  ls.v = JSON.stringify({ path: '/app/play-quick.html', at: 1000 }); var no3 = T.nextAfterSignIn(ls, 1000 + 31 * 60000);
  ls.v = JSON.stringify({ path: '/app/try.html?mode=player', at: 1000 }); var ok2 = T.nextAfterSignIn(ls, 2000);
  return ok1 === '/app/play-quick.html' && no1 === '/app/' && no2 === '/app/' && no3 === '/app/' && ok2 === '/app/try.html?mode=player';
})());

section('4. After the account: no wizard, the games question, the three choices, a card offer that is never forced');
check('first entry marks the setup guide dismissed (no wizard)', /st\.dismissed=true/.test(TRY.slice(TRY.indexOf('function start()'), TRY.indexOf('function run('))));
check('"Set up my venue" is the only thing that brings the guide back', /st\.dismissed=false/.test(TRY) && (TRY.match(/dismissed=false/g) || []).length === 1);
check('what games do you run saves setup_answers (the wizard\'s own question and saver)', /VP\.saveSettings\(S\.venueId, \{ setup_answers:ans \}\)/.test(TRY) && /VPFirstRun/.test(TRY) && /vp-firstrun\.js/.test(TRY));
check('the three choices and the card button exist', /id="qpAnother"/.test(TRY) && /id="qpInfo"/.test(TRY) && /id="qpSetup"/.test(TRY) && /id="qpCard"/.test(TRY));
check('more info posts to /quick/more-info and shows only a thank-you (nothing is sent to them)', /bill\("\/quick\/more-info"/.test(TRY) && /Thanks, we'll be in touch/.test(TRY));
check('the card button is one tap to Stripe and is never automatic', /bill\("\/account\/card-link"/.test(TRY) && !/qpCard"\)\.click\(\)/.test(TRY) && /location\.href=j\.card_url/.test(TRY));

section('5. The funnel client: step names only, no personal data');
posts.length = 0; win.localStorage = { d: {}, getItem: function (k) { return this.d[k] === undefined ? null : this.d[k]; }, setItem: function (k, v) { this.d[k] = String(v); } };
win.crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } };
(0, eval)(CONFIG); Q = win.VPQuick;
check('an unknown step is refused', Q.track('typed_a_name') === false && posts.length === 0);
check('a known step is passed on once; the page posts nothing itself (the 413 journey store sends it)', Q.track('page_opened') === true && posts.length === 0, posts);
check('the same step again on the page is not passed on again', Q.track('page_opened') === false && posts.length === 0);
check('no route of its own: the config never fetches or beacons anything', !/\.fetch\(|sendBeacon\(/.test(CONFIG));
check('the session id is one random id kept in this browser', /^[a-f0-9]{24}$/.test(Q.sid()) && Q.sid() === Q.sid());
check('the page, the demo and the choices never send a name, mobile or venue name to the funnel', !/track\([^)]*(name|mobile|venue)/.test(QJS + TRY.slice(TRY.indexOf('function qtrack'), TRY.indexOf('function qtrack') + 200)));
check('taps are counted on every press and stored as a number', /pointerdown/.test(CONFIG) && Q.taps() === 0);
var evs = /var EVENTS = \[([^\]]*)\]/.exec(CONFIG)[1];
check('the steps include the demo questions, the podium, the games question, the card and each choice', ['demo_q1', 'demo_q5', 'podium_seen', 'games_answered', 'card_screen_seen', 'card_added', 'choice_another', 'choice_info', 'choice_setup', 'page_left', 'signed_in', 'account_made'].every(function (x) { return evs.indexOf('"' + x + '"') >= 0; }));

section('5b. The tracking door (the contract with the 413 tracking build): window.vpTrackStep(step, props)');
posts.length = 0; delete win.vpTrackStepImpl; delete win.__vpTrackQueue; win.localStorage.d = {};
(0, eval)(CONFIG); Q = win.VPQuick;
check('vpTrackStep is a window function', typeof win.vpTrackStep === 'function');
check('an unknown step is refused and queued nowhere', win.vpTrackStep('typed_a_name', {}) === false && !win.__vpTrackQueue && posts.length === 0);
win.vpTrackStep('page_opened', { x: 1 });
check('before the 413 store is there, a step is QUEUED for it to flush, with the taps count, and nothing is posted', win.__vpTrackQueue && win.__vpTrackQueue.length === 1 && win.__vpTrackQueue[0][0] === 'page_opened' && typeof win.__vpTrackQueue[0][1].taps === 'number' && posts.length === 0, [win.__vpTrackQueue, posts.length]);
var got = []; win.vpTrackStepImpl = function (st, pr) { got.push([st, pr]); };
win.vpTrackStep('form_sent', { a: 1 });
check('once the 413 store defines vpTrackStepImpl, steps go to it, not the queue', got.length === 1 && got[0][0] === 'form_sent' && win.__vpTrackQueue.length === 1, got);
check('the page and the demo fire steps only through that door', !/\bQ\.track\(|VPQuick\.track\(/.test(QJS) && !/VPQuick\.track\(/.test(TRY));


section('7. On brand: the website\'s own look, the real game pages, one set of words, only true statements');
var nswLines = NSW.split('\n'), liftBody = nswLines.slice(34, 419).join('\n');
check('app/vp-site.css IS the website\'s own style, lifted unchanged from nsw.html (so a change to the website is a change here)', SITECSS.indexOf(liftBody) !== -1 && liftBody.length > 15000, [liftBody.length, SITECSS.length]);
check('/quick and the demo pages load it, and bring no look of their own: their style blocks hold layout and the website\'s own colour variables only (no hex colour, no gradient)', /vp-site\.css/.test(QHTML) && /vp-site\.css/.test(TRY) &&
  [QHTML, TRY].every(function (h) { var m = h.match(/<style>[\s\S]*?<\/style>/g) || []; return m.length === 1 && !/#[0-9a-fA-F]{3,8}\b/.test(m[0]) && !/gradient/.test(m[0]); }), [(QHTML.match(/<style>[\s\S]*?<\/style>/g) || []).join('').match(/#[0-9a-fA-F]{3,8}\b/), (TRY.match(/<style>[\s\S]*?<\/style>/g) || []).join('').match(/#[0-9a-fA-F]{3,8}\b/)]);
check('the form is the website\'s start form: its own classes (form-shell, field, st-legal, st-boxes, btn btn-primary), its own legal line, the one h1', /class="form-shell"/.test(QHTML) && /class="st-boxes"/.test(QHTML) && /<p class="st-legal">By starting you agree to the <a href="\/terms">Terms and Conditions<\/a> and <a href="\/privacy">Privacy Policy<\/a>\.<\/p>/.test(QHTML) && (QHTML.match(/<h1/g) || []).length === 1);
check('the form order is first name, mobile, venue (then the suburb and postcode only when asked) and nothing stray after the button', (function () { var a = QHTML.indexOf('id="qName"'), b = QHTML.indexOf('id="qMobile"'), c = QHTML.indexOf('id="qVenue"'), d = QHTML.indexOf('id="qGo"'); return a < b && b < c && c < d && QHTML.slice(d).indexOf('<p class="fine"') === -1; })());
check('the demo draws NO game screen of its own: no QR drawn here, no side panel, no status line, no scoreboard (the real /tv and the real phone page are the only game screens)', !/VPQR|qrcode|<canvas|playStatus|doneBoard|Scan with your phone/i.test(TRY) && /VPDemo\.tvUrl\(S\.slug\)/.test(TRY) && /VPDemo\.playUrl\(code, details\(\)\)/.test(TRY) && /host\.html\?demo=auto/.test(TRY));
check('a hidden thank-you stays hidden: the demo page carries its own [hidden] rule (the website\'s .success.show would show it under the buttons)', /\[hidden\]\{ display:none !important; \}/.test(TRY));
check('after the form, the page heading gives way to the card\'s own heading (no two headings stacked)', /h\.hidden = id !== "qForm"/.test(QJS));
var CONSOLE = rd('venueplay/app/index.html');
check('card_added is sent only when Stripe sends them back (the console on ?card=added), never when the card page opens', !/card_added/.test(TRY) && /card=added/.test(CONSOLE) && /vpTrackStep\("card_added"\)/.test(CONSOLE) && /localStorage\.getItem\("vpqSid"\)/.test(CONSOLE) && /qtrack\("card_screen_seen"\)/.test(TRY));
check('Play another game shows only when a second demo game exists (one constant in the config), and the games question is never asked twice', /DEMO_GAMES: \["trivia"\]/.test(CONFIG) && /\$\("qpAnother"\)\.hidden = \(VPQuick\.cfg\.DEMO_GAMES\|\|\[\]\)\.length < 2/.test(TRY) && /localStorage\.getItem\("vpqGames-"\+S\.venueId\)\) return after\(\)/.test(TRY));
check('a laptop visitor with nobody joined gets a quiet way on after the config wait (the game cannot start with nobody in it)', /SKIP_AFTER_MS: 90000/.test(CONFIG) && /id="qpSkip"/.test(TRY) && /No phone to hand\? Skip the game/.test(TRY));
check('an upright tablet is asked first like a phone, a wide one is the TV', /S\.device==="tablet" && window\.innerHeight>window\.innerWidth/.test(TRY) && /Play on this tablet/.test(TRY));
check('the text button says what it does: Text myself the code', />Text myself the code</.test(TRY) && !/Text me the link/.test(TRY));
check('after more info the page says Got it and keeps Set up my venue and Add my card (no dead end), and a held sign-up has a way back', /<h3>Got it<\/h3>/.test(TRY) && /\$\("qpInfo"\)\.hidden=true/.test(TRY) && /\$\("qpThanks"\)\.hidden=false/.test(TRY) && /Back to venueplay\.com\.au/.test(QHTML));
check('a phone visitor is asked first: Ready for a quick game? with the two buttons, never "scan with your phone"', /Ready for a quick game\?/.test(TRY) && />Play on this phone</.test(TRY) && />I've got a laptop or TV here</.test(TRY) && /needsChoice\(\) \? chooser\(\) : playOnBigScreen\(\)/.test(TRY));
check('the real join screen is pre-filled with first name and mobile and never the login\'s email', /function details\(\)\{ return \{ name:S\.me\.name, mobile:S\.me\.mobile \}; \}/.test(TRY) && !/email/i.test(TRY.slice(TRY.indexOf('function details'), TRY.indexOf('function details') + 160)) && !/mailto/.test(TRY));
check('the games question says exactly what Dean wrote, with the true line, nothing ticked for them', />What games do you run now\?</.test(TRY) && />Tap all that apply\.</.test(TRY) && /We'll show you how each one works on venueplay\./.test(TRY) && !/\.checked\s*=[^=]|setAttribute\("checked"/.test(TRY.slice(TRY.indexOf('function games()'), TRY.indexOf('/* ---- the choices ---- */'))));
check('the choices are one set: Play another game, I\'d like more info, Set up my venue, Add my card; and no "ready to play"', (function () { var i = TRY.indexOf('id="qpAnother"'), seg = TRY.slice(i - 40, i + 700); return />Play another game</.test(seg) && />I'd like more info</.test(seg) && />Set up my venue</.test(seg) && />Add my card</.test(seg); })() && !/ready to play/i.test(TRY) && !/Add your card/.test(TRY));

section('6. House rules on the words');
var ALL = QHTML + QJS + CONFIG + TRY;
check('no em dash or en dash', ALL.indexOf('\u2014') === -1 && ALL.indexOf('\u2013') === -1);
check('venueplay is lowercase in every customer word', !/VenuePlay|Venueplay/.test(ALL.replace(/vpTryNext|VPQuick|VPFirstRun/g, '')));
check('no Gflam, no workers.dev, no .dev link, and no phone number but the support line', !/Gflam|workers\.dev|\.dev\b/i.test(ALL) && !/0[2-9]\s?\d{4}\s?\d{4}|04\d\d\s?\d{3}\s?\d{3}/.test((QHTML + QJS).replace('0400 000 000', '')));
check('one screen, no scroll: the page is a centred 100dvh column', /min-height:100dvh/.test(QHTML) && !/overflow-y:\s*scroll/.test(QHTML));

print('');
if (bad) print(bad + ' of ' + ran + ' checks FAILED'); else print('ALL ' + ran + ' CHECKS PASSED');
