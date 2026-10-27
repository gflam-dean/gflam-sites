/* The Terms put gaming compliance on the venue, clause by clause, and the tick everyone sees is
   the one the Worker records.

   Anisimoff Legal 9380, 1 Oct 2026: point 3 (compliance and every permit on the venue; an
   indemnity for regulatory action; an active tick), point 7 (NSW raffle for a charity under its
   written authorisation), point 9 (say VP is not responsible for or involved with the conduct),
   point 12 (in-person attendance), point 13 (age rules), point 14 (privacy, consent and winner
   records), point 15 (advertising). 8 Oct 2026: point 1(a) (the Victorian permit warranty),
   point 8 (minors in VIC and ACT). And point 11 of the NSW letter for PartyPlay: social housie
   is not for licensed premises.

   TWO HALVES, AND WHY ONE OF THEM IS A TEXT CHECK (27 Oct 2026, the testing audit's finding 7).
   Part A reads venueplay/terms.html and partyplay/terms.html and looks for sentences. That is the
   right tool: the Terms are prose a lawyer wrote for a human to read, there is no code to run,
   and the fault these checks exist for is a clause quietly deleted or reworded during a tidy-up.
   They are scoped to section 6 (and the music licence to section 7) because a whole-file search
   for "permit" or "indemnify" cannot fail in a document this long. The four prove-checks rows
   under "section 6 carries every clause the lawyer asked for" delete the conductor sentence, the
   indemnity, the onboarding sentence and the PartyPlay licensed-premises line, and each goes red.
   The compliance sentence itself is compared as text across the Worker constant and both pages
   for the same reason: it is a label a human reads beside a tick box, and nothing at runtime
   can see whether the three copies match.

   Part B RUNS the code. It lifts the real click handler off venueplay/app/hq.html and
   venueplay/app/onboard.html, drives each with a filled-in form against a fake DOM and a fetch
   that records what was posted, and then hands the body the page built to the REAL
   vpaHandleVenue in the billing Worker (tools/rig-billing-worker.js, fake PostgREST). So the
   checks are: an unticked box posts nothing and shows the right error; a ticked box with no name
   posts nothing; a ticked box posts compliance {accepted:true, by:<name>} and the club-or-pub
   answer as entity_type (settings-tidy, audit 20 Oct C4: the signup question replaced the seven
   kinds); the Worker then writes compliance_accepted_by, entity_type and the venue_kind it implies
   from that body; and the same body with the tick stripped, with no club-or-pub answer, or with a
   venue_kind outside the seven, is refused with no venue row written.
   Until 27 Oct 2026 those were regexes over the page source and the Worker source.

   Run from the repo root:  jsc tools/test-terms-put-compliance-on-the-venue.js
*/
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + (typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 300))); fails++; } }

/* ============================ PART A: THE TERMS, AS TEXT ============================ */
var terms = readFile('venueplay/terms.html');
function section(n) {
  var a = terms.search(new RegExp('<h2>' + n + '\\.\\s'));
  var b = terms.search(new RegExp('<h2>' + (n + 1) + '\\.\\s'));
  return (a >= 0 && b > a) ? terms.slice(a, b) : '';
}
var s6 = section(6), s7 = section(7);
function has(label, rx, where) { check(label, rx.test(where || s6), (where || s6).length ? 'not found' : 'section missing'); }

print('section 6 of the Terms, clause by clause');
check('section 6 exists and is headed Your responsibilities', /<h2>6\.\s*Your responsibilities<\/h2>/.test(s6), s6.slice(0, 80));
check('it is numbered 6.1 to 6.14, in order', (function () {
  var nums = (s6.match(/<strong>6\.(\d+)/g) || []).map(function (m) { return parseInt(m.replace('<strong>6.', ''), 10); });
  return nums.length === 14 && nums.every(function (n, i) { return n === i + 1; });
})(), (s6.match(/<strong>6\.(\d+)/g) || []).join(' '));
has('the venue is the conductor', /You are the conductor of every gaming activity/);
has('VenuePlay is not responsible for or in any way involved with the conduct or organisation (Anisimoff 1 Oct, point 9)', /VenuePlay is not responsible for or in any way involved with the conduct or organisation of the gaming activity/);
has('compliance with all applicable legislation is the venue\'s (point 3)', /responsible for complying with every law that applies to a gaming activity/);
has('the Interactive Gambling Act is named (point 12)', /Interactive Gambling Act 2001/);
has('the tick is described, with when and who recorded', /ticking a box, and we record when and who/);
has('every permit, licence or authority is the venue\'s to obtain and hold (point 3)', /obtaining and holding every permit, licence, authority or approval/);
has('recording a permit does not make a game lawful', /recording it does not make a game lawful/);
has('the Victorian permit warranty (8 Oct, point 1(a), s8.4.4)', /If your venue is in Victoria, you warrant[\s\S]*minor gaming permit from the VGCCC/);
has('Victoria: no bingo tickets on phones', /will not use VenuePlay to issue bingo tickets to players' phones/);
has('Victoria: why we rely on the warranty (supplying without a permit is banned)', /bans supplying bingo tickets or a random number generator to anyone without a permit/);
has('running a raffle for a charity needs its written authorisation (1 Oct, point 7)', /charity's written authorisation/);
has('in NSW the charity holds the authority and the venue runs under it', /in New South Wales the charity holds the authority and you run the raffle under it/);
has('in-person attendance is the venue\'s (point 12)', /physically present at your venue/);
has('age restrictions are the venue\'s (point 13; 8 Oct point 8)', /every age restriction that applies/);
has('the VIC, ACT and TAS minors facts are stated', /Victoria excludes minors from all gambling; ACT excludes them from housie that needs a permit; Tasmania excludes them from raffles/);
has('the phone age tick does not move the responsibility', /does not move this responsibility to us/);
has('the Privacy Act and the Spam Act are the venue\'s to meet (point 14)', /Privacy Act 1988 \(Cth\) and the Spam Act 2003 \(Cth\)/);
has('marketing consent is the venue\'s', /consent the law requires before you send marketing/);
has('winner and draw records are the venue\'s to keep', /winner and draw records/);
has('the venue tells us what it is', /Tell us accurately whether your venue is a non-profit/);
has('advertising is the venue\'s (point 15; 8 Oct point 10)', /Any advertising of a gaming activity is yours/);
has('what we show is not advice; the free-entry offer is a courtesy', /offer to start a game as free entry instead, that is a courtesy/);
has('the indemnity, covering regulatory action (point 3)', /You indemnify VenuePlay and Gflam Group Pty Ltd[\s\S]*regulatory action/);
has('the indemnity survives', /This indemnity survives the end of these Terms/);
has('we may act on a venue running outside its limits (1 Oct, point 5)', /we may suspend or end your subscription/);
has('the state rules summary paragraph is still there, after the clauses', /we show you a summary of the gaming rules for your state and record that you have seen it/);
has('the music licence stays in section 7 (unchanged)', /responsible for holding the appropriate music licences/, s7);

print('house rules, on the whole document');
check('no em dash anywhere in the Terms', terms.indexOf('—') === -1);
check('never "the ACT"', !/\bthe ACT\b/.test(terms));
check('the effective date moved with the change', /Effective date: 15 October 2026/.test(terms));

print('the tick is one sentence, in the Worker and on both onboarding pages (text: a label a human reads)');
var api = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
var m = /const VPA_COMPLIANCE_TICK = '([^']+)';/.exec(api);
var tick = m && m[1];
check('the Worker holds the sentence', !!tick && /responsible for complying with the gaming laws/.test(tick), tick);
check('it names permits, age limits and attendance, and says software only',
  !!tick && /permit, licence or authority/.test(tick) && /age limits/.test(tick) && /attendance/.test(tick) && /software only/.test(tick), tick);
var hqSrc = readFile('venueplay/app/hq.html'), onbSrc = readFile('venueplay/app/onboard.html');
check('venueplay/app/hq.html shows exactly that sentence beside its tick box', !!tick && hqSrc.indexOf(tick) !== -1, 'hq.html');
check('venueplay/app/onboard.html shows exactly that sentence beside its tick box', !!tick && onbSrc.indexOf(tick) !== -1, 'onboard.html');
/* The two options are markup a human picks from: the same two-option question signup asks
   (audit 20 Oct 2026, C4). What the handler DOES with the answer is run in Part B. */
[['venueplay/app/hq.html', hqSrc], ['venueplay/app/onboard.html', onbSrc]].forEach(function (fp) {
  check(fp[0] + ' asks club or pub, the signup question, with exactly those two options',
        /<option value="non_profit">Club \(RSL, bowls, leagues, non-profit\)<\/option>/.test(fp[1]) &&
        /<option value="for_profit">Pub \(hotel or tavern\)<\/option>/.test(fp[1]), fp[0]);
});

print('PartyPlay: not at a pub, club or other licensed venue (NSW social housie, 1 Oct point 11)');
var pp = readFile('partyplay/terms.html');
var ppPrivate = (function () { var a = pp.indexOf('<h2>Private use only</h2>'); var b = pp.indexOf('<h2>', a + 10); return a >= 0 ? pp.slice(a, b) : ''; })();
check('the private-use section says not at a pub, club or other licensed venue', /not for use at a pub, club or other licensed venue/.test(ppPrivate), ppPrivate.slice(0, 120));
check('and still says nobody pays to enter', /must not be used to run a game that anybody pays to enter/.test(ppPrivate));

/* ============================ PART B: THE TICK, RUN ============================ */
/* The real billing Worker over a fake PostgREST. Loading the rig defines DB, sent, FAIL, ENV, J
   and every Worker function as a global. */
load('tools/rig-billing-worker.js');
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
vpaFireHqWelcome = async function () { return true; };

/* Lift one click handler off a page: from "<marker>function(){" to its balanced close. Strings
   and comments are skipped while counting braces, so a brace inside an error message does not
   end the function early. The lifted text is evaluated as a function, so a page whose handler
   no longer parses fails here rather than passing by accident. */
function liftHandler(src, marker) {
  var at = src.indexOf(marker);
  if (at < 0) throw new Error('handler not found: ' + marker);
  var i = at + marker.length - 1;            // the "{" that opens the function body
  if (src[i] !== '{') throw new Error('marker must end at the opening brace: ' + marker);
  var depth = 0, inStr = null, j = i;
  for (; j < src.length; j++) {
    var c = src[j];
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); continue; }
    if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j) + 1; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  var fnText = 'function()' + src.slice(i, j + 1);
  return (0, eval)('(' + fnText + ')');
}
function liftSlugify(src) {
  var mm = /function slugify\(s\)\{[^\n]*\}/.exec(src);
  if (!mm) throw new Error('slugify not found');
  return (0, eval)('(' + mm[0].replace(/^function slugify/, 'function') + ')');
}

/* A fake DOM: $(id) answers an element with value, checked, textContent, disabled and a
   classList. Unknown ids come back blank rather than crashing, so a missing field reads as the
   empty string a real blank field would give. */
function fakeDom(fields) {
  var els = {};
  function el(id) {
    if (!els[id]) els[id] = { id: id, value: '', checked: false, textContent: '', disabled: false, innerHTML: '',
                              classList: { contains: function () { return false; }, toggle: function () {} },
                              addEventListener: function () {} };
    return els[id];
  }
  Object.keys(fields).forEach(function (k) { var v = fields[k]; if (typeof v === 'boolean') el(k).checked = v; else el(k).value = v; });
  return { $: el, els: els };
}

var POSTS = [], ERRORS = [];
workerPost = function (path, body) { POSTS.push({ path: path, body: JSON.parse(JSON.stringify(body)) }); return new Promise(function () {}); };
errFlash = function (id, msg) { ERRORS.push(msg); };
flash = function () {};
loadAll = function () {};
nvBingoNote = function () {};
addManagerByMobile = function () { return Promise.resolve({ skipped: true }); };
client = { from: function () { return { insert: function () { return Promise.resolve({}); } }; } };
var hqSlugify = liftSlugify(hqSrc), onbSlugify = liftSlugify(onbSrc);
var hqSubmit = liftHandler(hqSrc, '$("addVenueSubmit").addEventListener("click", function(){');
var onbSubmit = liftHandler(onbSrc, '$("createBtn").addEventListener("click", function(){');

var BY = 'Jane Smith, licensee';
function hqForm(over) {
  var f = { nvName: 'The New Tavern', nvSlug: 'new-tavern-2000', nvTz: 'Australia/Sydney', nvBill: 'founding',
            nvMobile: '0412 345 678', nvPostcode: '2000', nvKind: 'for_profit', nvCompliance: true, nvComplianceBy: BY,
            nvEmail: 'tavern@example.com', nvMax: '80', nvPlan: 'monthly', nvComp: false, nvWelcome: true };
  for (var k in (over || {})) f[k] = over[k];
  return f;
}
function onbForm(over) {
  var f = { vname: 'The New Tavern', vslug: 'new-tavern-2000', vtz: 'Australia/Sydney', vpostcode: '2000',
            vbill: 'founding', vfounding: 'f-orphan', vkind: 'for_profit', vcompliance: true, vcomplianceby: BY,
            mgruid: '', mgrname: '', mgrmobile: '' };
  for (var k in (over || {})) f[k] = over[k];
  return f;
}
/* onboard.html reads the billing choice through a variable the handler closes over on the real
   page (bill), set by its own change listener; here it is read off the form like the rest. */
function runHq(fields) {
  POSTS = []; ERRORS = [];
  var dom = fakeDom(fields); $ = dom.$; slugify = hqSlugify;
  hqSubmit.call(dom.$('addVenueSubmit'));
  return { posts: POSTS.slice(), errors: ERRORS.slice(), dom: dom };
}
function runOnb(fields) {
  POSTS = []; ERRORS = [];
  var dom = fakeDom(fields); $ = dom.$; slugify = onbSlugify; bill = fields.vbill;
  onbSubmit.call(dom.$('createBtn'));
  return { posts: POSTS.slice(), errors: [dom.$('err').textContent].filter(Boolean), dom: dom };
}
function rightShape(p) {
  return p && p.path === '/admin/venue' && p.body && p.body.compliance && p.body.compliance.accepted === true
    && p.body.compliance.by === BY && p.body.entity_type === 'for_profit';
}

print('hq.html: the add-venue click posts the tick and club or pub, and nothing without them');
var r = runHq(hqForm());
check('filled in and ticked: ONE post to /admin/venue', r.posts.length === 1 && r.posts[0].path === '/admin/venue', r.posts);
check('it carries compliance {accepted:true, by:<the name typed>}', r.posts.length === 1 && rightShape(r.posts[0]), r.posts[0] && r.posts[0].body.compliance);
check('and the club-or-pub answer, as entity_type', r.posts.length === 1 && r.posts[0].body.entity_type === 'for_profit', r.posts[0] && r.posts[0].body.entity_type);
var hqBody = r.posts.length === 1 ? r.posts[0].body : null;
r = runHq(hqForm({ nvCompliance: false }));
check('box NOT ticked: nothing is posted', r.posts.length === 0, r.posts);
check('and HQ is told to read them the compliance line', r.errors.length === 1 && /compliance line/.test(r.errors[0]), r.errors);
r = runHq(hqForm({ nvComplianceBy: '   ' }));
check('ticked but nobody named: nothing is posted, and the error asks for the name', r.posts.length === 0 && /name/.test(r.errors[0] || ''), [r.posts, r.errors]);
r = runHq(hqForm({ nvKind: '' }));
check('no club-or-pub answer: nothing is posted, and the error says to ask club or pub', r.posts.length === 0 && /club or a pub/.test(r.errors[0] || ''), [r.posts, r.errors]);
r = runHq(hqForm({ nvKind: 'hotel' }));
check('an old seven-kinds answer (hotel): nothing is posted', r.posts.length === 0 && /club or a pub/.test(r.errors[0] || ''), [r.posts, r.errors]);
r = runHq(hqForm({ nvKind: 'non_profit' }));
check('club: posted as entity_type non_profit', r.posts.length === 1 && r.posts[0].body.entity_type === 'non_profit', r.posts);

print('onboard.html: the same, on the customer-facing page');
r = runOnb(onbForm());
check('filled in and ticked: ONE post to /admin/venue', r.posts.length === 1 && r.posts[0].path === '/admin/venue', r.posts);
check('it carries compliance {accepted:true, by:<the name typed>}', r.posts.length === 1 && rightShape(r.posts[0]), r.posts[0] && r.posts[0].body.compliance);
check('and the club-or-pub answer, as entity_type', r.posts.length === 1 && r.posts[0].body.entity_type === 'for_profit', r.posts[0] && r.posts[0].body.entity_type);
var onbBody = r.posts.length === 1 ? r.posts[0].body : null;
r = runOnb(onbForm({ vcompliance: false }));
check('box NOT ticked: nothing is posted', r.posts.length === 0, r.posts);
check('and the page says to read them the compliance line', r.errors.length === 1 && /compliance line/.test(r.errors[0]), r.errors);
r = runOnb(onbForm({ vcomplianceby: '' }));
check('ticked but nobody named: nothing is posted', r.posts.length === 0 && /name/.test(r.errors[0] || ''), [r.posts, r.errors]);
r = runOnb(onbForm({ vkind: '' }));
check('no club-or-pub answer: nothing is posted', r.posts.length === 0 && /club or a pub/.test(r.errors[0] || ''), [r.posts, r.errors]);
r = runOnb(onbForm({ vkind: 'non_profit' }));
check('club: posted as entity_type non_profit', r.posts.length === 1 && r.posts[0].body.entity_type === 'non_profit', r.posts);

/* Now the body each page built goes to the REAL Worker route. */
function U(n) { return '50000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var ADMIN = U(9);
function as(user, body) {
  var txt = JSON.stringify(body || {});
  return { url: 'https://api/x', headers: { get: function (k) { return k === 'Authorization' ? 'Bearer ' + user : ''; } },
           text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
function world() {
  DB = {}; sent.length = 0; FAIL = {};
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }];
  DB.venueplay_founding = [{ id: 'f-orphan', contact_email: 'orphan@example.com', plan: 'annual', status: 'active', max_seats: 120 }];
  DB.vp_venues = []; DB.vp_venue_staff = []; DB.vp_admin_audit = []; DB.vp_gaming_declarations = [];
  DB.vp_venue_settings = []; DB.vp_screens = [];
}
function created() { return DB.vp_venues.filter(function (v) { return v.slug === 'new-tavern-2000'; }); }
function strip(body, what) { var b = JSON.parse(JSON.stringify(body)); if (what === 'compliance') delete b.compliance; else if (what === 'entity') delete b.entity_type; else b.venue_kind = what; return b; }
function withTick(body, comp) { var b = JSON.parse(JSON.stringify(body)); b.compliance = comp; return b; }
/* The refusal must be the TICK's own sentence. A stale page that sends a name and no tick, or
   a tick that is a string, used to be caught by the name guard instead if the tick guard went
   soft, and "compliance" appears in that message too; so the check looks for the first guard's
   words, not the word. */
var TICK_REFUSED = /^Tick the compliance line first/;

var finished = false;
(async function () {
  var pages = [['hq.html', hqBody], ['onboard.html', onbBody]];
  for (var p = 0; p < pages.length; p++) {
    var name = pages[p][0], body = pages[p][1];
    print('the Worker records what ' + name + ' sent, and refuses the same body without it');
    if (!body) { check(name + ' built a body to send', false, 'no post captured above'); continue; }
    world();
    var res = await vpaHandleVenue(as(ADMIN, body), ENV, J);
    check(name + ': the body the page built is accepted', res.status === 200 && res.body.ok === true, res);
    var row = created()[0] || {};
    check(name + ': compliance_accepted_by is the name typed on the page', row.compliance_accepted_by === BY, row.compliance_accepted_by);
    check(name + ': entity_type is the club-or-pub answer chosen on the page', row.entity_type === 'for_profit', row.entity_type);
    check(name + ': venue_kind is what that answer implies (pub)', row.venue_kind === 'pub', row.venue_kind);
    check(name + ': a pub starts with paid entry off', row.paid_entry_enabled === false, row.paid_entry_enabled);
    check(name + ': compliance_accepted_at is a timestamp', /^\d{4}-\d{2}-\d{2}T/.test(String(row.compliance_accepted_at)), row.compliance_accepted_at);
    world();
    res = await vpaHandleVenue(as(ADMIN, strip(body, 'compliance')), ENV, J);
    check(name + ': the same body with the tick stripped is refused by the tick guard itself (400)',
          res.status === 400 && TICK_REFUSED.test(res.body.error || ''), res);
    check(name + ': and no venue row was written', created().length === 0, DB.vp_venues);
    world();
    res = await vpaHandleVenue(as(ADMIN, withTick(body, { by: BY })), ENV, J);
    check(name + ': a name with no tick (a stale page) is refused by the tick guard, nothing written',
          res.status === 400 && TICK_REFUSED.test(res.body.error || '') && created().length === 0, res);
    world();
    res = await vpaHandleVenue(as(ADMIN, withTick(body, { accepted: 'yes', by: BY })), ENV, J);
    check(name + ': a tick that is the string "yes" is refused, nothing written',
          res.status === 400 && TICK_REFUSED.test(res.body.error || '') && created().length === 0, res);
    world();
    res = await vpaHandleVenue(as(ADMIN, strip(body, 'nightclub')), ENV, J);
    check(name + ': a kind outside the seven is refused, nothing written',
          res.status === 400 && /pub, hotel, club/.test(res.body.error || '') && created().length === 0, res);
    world();
    res = await vpaHandleVenue(as(ADMIN, strip(body, 'entity')), ENV, J);
    check(name + ': the same body with no club-or-pub answer is refused, nothing written',
          res.status === 400 && /club \(RSL, bowls, leagues, non-profit\) or a pub/.test(res.body.error || '') && created().length === 0, res);
  }
  finished = true;
})().catch(function (e) { print('FAIL ' + (e && e.stack || e)); fails++; finished = true; });

/* jsc exits 0 on an unhandled rejection, so the verdict is given synchronously after the
   microtasks have run: a suite that never finished, or failed anything, exits non-zero. */
drainMicrotasks();
if (!finished) { print('FAIL the Worker half never finished'); fails++; }
if (fails) throw new Error('terms: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
