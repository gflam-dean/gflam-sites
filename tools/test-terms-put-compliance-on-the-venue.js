/* The Terms put gaming compliance on the venue, clause by clause, and the tick everyone sees is
   the one the Worker records.

   Anisimoff Legal 9380, 1 Oct 2026: point 3 (compliance and every permit on the venue; an
   indemnity for regulatory action; an active tick), point 7 (NSW raffle for a charity under its
   written authorisation), point 9 (say VP is not responsible for or involved with the conduct),
   point 12 (in-person attendance), point 13 (age rules), point 14 (privacy, consent and winner
   records), point 15 (advertising). 8 Oct 2026: point 1(a) (the Victorian permit warranty),
   point 8 (minors in VIC and ACT). And point 11 of the NSW letter for PartyPlay: social housie
   is not for licensed premises.

   SCOPED TO SECTION 6. A whole-file word search for "permit" or "indemnify" cannot fail in a
   document this long, so every clause is looked for between the "6." heading and the "7."
   heading, and the music licence between "7." and "8.".

   Run from the repo root:  jsc tools/test-terms-put-compliance-on-the-venue.js
*/
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + String(saw).slice(0, 300))); fails++; } }
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

print('the tick is one sentence, in the Worker and on both onboarding pages');
var api = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
var m = /const VPA_COMPLIANCE_TICK = '([^']+)';/.exec(api);
var tick = m && m[1];
check('the Worker holds the sentence', !!tick && /responsible for complying with the gaming laws/.test(tick), tick);
check('it names permits, age limits and attendance, and says software only',
  !!tick && /permit, licence or authority/.test(tick) && /age limits/.test(tick) && /attendance/.test(tick) && /software only/.test(tick), tick);
['venueplay/app/hq.html', 'venueplay/app/onboard.html'].forEach(function (f) {
  var page = readFile(f);
  check(f + ' shows exactly that sentence beside its tick box', !!tick && page.indexOf(tick) !== -1, f);
  check(f + ' sends compliance accepted:true with a name', /compliance=\{ accepted:true, by:by \}/.test(page), f);
  check(f + ' asks club or pub, the signup question, and sends it as entity_type', /body\.entity_type=kind;/.test(page) &&
        /<option value="non_profit">Club \(RSL, bowls, leagues, non-profit\)<\/option>/.test(page) && /<option value="for_profit">Pub \(hotel or tavern\)<\/option>/.test(page), f);
});
check('the Worker refuses the onboarding without the tick', /if \(comp\.accepted !== true\) \{\s*\n\s*return json\(/.test(api));
check('the Worker refuses an onboarding with no club-or-pub answer', /if \(entityType !== 'non_profit' && entityType !== 'for_profit'\) \{/.test(api));

print('PartyPlay: not at a pub, club or other licensed venue (NSW social housie, 1 Oct point 11)');
var pp = readFile('partyplay/terms.html');
var ppPrivate = (function () { var a = pp.indexOf('<h2>Private use only</h2>'); var b = pp.indexOf('<h2>', a + 10); return a >= 0 ? pp.slice(a, b) : ''; })();
check('the private-use section says not at a pub, club or other licensed venue', /not for use at a pub, club or other licensed venue/.test(ppPrivate), ppPrivate.slice(0, 120));
check('and still says nobody pays to enter', /must not be used to run a game that anybody pays to enter/.test(ppPrivate));

if (fails) throw new Error('terms: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
