/* Never collect what you will not hand back.

   Two gates were asking the same question with two different word lists:

     collecting  gated on the contact EMAIL DOMAIN  (migration 43, widened by 82)
     exporting   gated on the VENUE NAME            (a shorter list in the Worker)

   Eleven words were on one and not the other, so The Mini Bar, on its own domain, could collect
   its customers' details and was then refused its own list back. We hold their data and will not
   give it to them.

   This lifts the gate's real regexes out of the shipped Worker and runs them, and it reads
   migration 82's word list out of the SQL so the two cannot drift apart again.

   Run:  jsc tools/test-optin-export-gate.js
*/
var SRC = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
var SQL = readFile('venueplay-backend/supabase/venueplay-82-optin-gate-bar-lounge.sql');

/* Just the regex definitions, stopping at FREE_MAILBOX_RE. Taking everything down to
   looksLikeVenue swept up an `await vpaSelect(...)` in between, which cannot run outside an
   async function, so the harness blew up before testing anything. */
var block = /const VPA_VENUE_WORDS_LOOSE = [\s\S]*?const FREE_MAILBOX_RE = [^\n]*;/.exec(SRC);
var fails = 0;
function check(name, ok, saw) {
  if (ok) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}
check('the export gate was found in the Worker', !!block);
if (!block) { print('FAILED 1'); throw new Error('gate not found'); }

/* Run the REAL regexes, built the way the Worker builds them. */
var f = new Function(block[0] + ' return { VENUE_RE: VENUE_RE, DOMAIN_RE: DOMAIN_RE, FREE: FREE_MAILBOX_RE, WORDS: VPA_VENUE_WORDS };');
var G = f();
function nameOk(n){ return G.VENUE_RE.test(n); }
function domainOk(d){ return !!d && !G.FREE.test(d) && G.DOMAIN_RE.test(d); }

print('never collect what you will not hand back');

/* 1. THE FAULT, named. Each of these could collect and could not export. */
['theminibar.com.au','lizardloungesportsbar.com.au','thebistro.com.au','thecellars.com.au',
 'brightwinery.com.au','thetaphouse.com.au','thealehouse.com.au','fortitudebrewery.com.au',
 'gflamhospitality.com.au'].forEach(function (d) {
  check('domain ' + d + ': can export now', domainOk(d), d);
});

/* 2. The traps CLAUDE.md records: never match a word INSIDE a domain. */
['barossavalleywines.com.au','barbershopquartet.com.au','loungefurniture.com.au'].forEach(function (d) {
  check('domain ' + d + ': still refused, the anchoring holds', !domainOk(d), d);
});

/* AND THE OTHER DIRECTION, which caught me out. Migration 82 leaves the ORIGINAL words
   unanchored on purpose, so these DO pass the collection gate. Export must therefore pass them
   too, however much they look like a mistake: a gate that is stricter than the one that let the
   data in is the exact fault this change exists to remove. */
['publicsydney.com.au','innisfailrealestate.com.au'].forEach(function (d) {
  check('domain ' + d + ': loose like the SQL, so it can still get its own data back', domainOk(d), d);
});

/* 3. A free mailbox says nothing about who owns the customers, whatever it is called. */
['gmail.com','hotmail.com','bigpond.com.au','outlook.com'].forEach(function (d) {
  check('free mailbox ' + d + ': never qualifies on the domain alone', !domainOk(d), d);
});

/* 4. Venue names are spaced words, so whole-word matching, and the old list still works. */
check('name "Wellshot Hotel": qualifies', nameOk('Wellshot Hotel'));
check('name "The Mini Bar": qualifies now', nameOk('The Mini Bar'));
check('name "Tugun Bowls Club": qualifies', nameOk('Tugun Bowls Club'));
check('name "Barossa Valley Wines": does NOT', !nameOk('Barossa Valley Wines'));
check('name "Smith Accounting": does NOT', !nameOk('Smith Accounting'));

/* 5. A gmail venue with a real venue NAME still gets its own data back. Being wrong on this side
      costs a real venue a day waiting for a human; being wrong on the collection side lets a
      stranger harvest a room. The generosity belongs here. */
check('gmail account named "Wellshot Hotel": exports on the name', nameOk('Wellshot Hotel') && !domainOk('gmail.com'));

/* 6. THE INVARIANT. Every word the collection gate accepts must be a word the export gate
      accepts, or we are keeping data we let somebody collect. Read straight out of the SQL. */
var m = SQL.match(/edomain ~ '\(([a-z|?]+)\)/g) || [];
var sqlWords = [];
m.forEach(function (chunk) {
  var inner = /\(([a-z|?]+)\)/.exec(chunk);
  if (inner) sqlWords = sqlWords.concat(inner[1].split('|'));
});
check('migration 82 word list was readable', sqlWords.length > 10, sqlWords.length);
var workerWords = G.WORDS.split('|');
var missing = sqlWords.filter(function (w) { return workerWords.indexOf(w) === -1; });
check('every word the COLLECTION gate accepts, the EXPORT gate accepts too', missing.length === 0, missing);

/* 7. THE DECISION ITSELF, not just the regexes that feed it.
      Found by mutation: deleting the whole domain branch and going back to name-only left every
      check above green, because they all exercised the regexes in isolation and never the line
      that combines them. A test that cannot fail is worse than no test. So this lifts the real
      looksLikeVenue line out of the Worker and runs it. */
var decide = /const looksLikeVenue = [^\n]*;/.exec(SRC);
check('the decision line was found', !!decide, decide && decide[0]);
if (decide) {
  var d = new Function('o', 'VENUE_RE', 'domainLooksLikeVenue', decide[0] + ' return looksLikeVenue;');
  check('venue NAME alone is enough',
    d({ venues: [{ name: 'Wellshot Hotel' }] }, G.VENUE_RE, false) === true);
  check('venue DOMAIN alone is enough, even when the name says nothing',
    d({ venues: [{ name: 'Trading Co' }] }, G.VENUE_RE, true) === true);
  check('neither: refused, and held for a human',
    d({ venues: [{ name: 'Trading Co' }] }, G.VENUE_RE, false) === false);
  check('one venue in a group qualifying is enough',
    d({ venues: [{ name: 'Trading Co' }, { name: 'The Royal Hotel' }] }, G.VENUE_RE, false) === true);
  check('no venues at all: refused rather than waved through',
    d({ venues: [] }, G.VENUE_RE, false) === false);
}

print(fails ? ('FAILED ' + fails) : 'PASS');
if (fails) { throw new Error('optin export gate: ' + fails + ' failed'); }
