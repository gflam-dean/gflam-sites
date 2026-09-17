/* Which permissions a manager gets when nobody said.

   vpbCan is `!o.perms || o.perms[key] !== false`, so an ABSENT permission reads as GRANTED, and
   both places that normalise a permissions object wrote players_optin the same generous way. That
   is right for advertising, raffles and adding hosts: reversible, and the worst case is a changed
   promo slide. It is wrong for a venue's customer list, where the worst case is a duty manager or
   a travelling host walking off with a room full of contact details and nobody noticing, because
   nothing breaks.

   This RUNS the shipped normalisers, lifted by their surrounding function names so the test
   cannot drift from what ships.

   Run:  jsc tools/test-manager-permissions.js
*/
var SRC = readFile('venueplay-backend/worker/venueplay-api-FULL.js');

/* Both normalisers are identical blocks, on purpose. Pull every one of them out and run them
   all: if a third appears and is written the old way, this goes red rather than testing two
   and cheerfully ignoring it. */
var blocks = SRC.match(/const permissions = \{[\s\S]*?\n  \};/g) || [];
var fails = 0;
function check(name, ok, saw) {
  if (ok) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}
function apply(block, p) {
  var f = new Function('p', block + ' return permissions;');
  return f(p);
}

print('what a manager gets when nobody said');
check('every permissions normaliser in the Worker was found', blocks.length >= 2, blocks.length);

blocks.forEach(function (b, i) {
  var tag = '#' + (i + 1) + ' ';

  /* THE FAULT. Nothing said, so nothing is granted for player data. */
  var silent = apply(b, {});
  check(tag + 'nobody mentioned player data: NOT granted', silent.players_optin === false, silent);
  check(tag + 'nobody mentioned the rest: still granted, which is the point',
    silent.advertising === true && silent.draws_raffles === true && silent.add_hosts === true, silent);

  /* Ticked on purpose. */
  check(tag + 'owner ticked it: granted', apply(b, { players_optin: true }).players_optin === true);
  check(tag + 'owner unticked it: not granted', apply(b, { players_optin: false }).players_optin === false);

  /* A checkbox that arrives as a string, or as 1, is not an owner ticking a box. */
  check(tag + 'a truthy value that is not true does NOT grant it',
    apply(b, { players_optin: 'on' }).players_optin === false && apply(b, { players_optin: 1 }).players_optin === false);

  /* The generous ones stay generous, and stay generous in the same way. */
  check(tag + 'advertising is still true-unless-refused', apply(b, { advertising: false }).advertising === false
    && apply(b, {}).advertising === true);
});

/* And the route that hands the data over agrees with what gets stored. A box that looks ticked
   while the download refuses is its own kind of fault. */
var exportLine = /\|\| !!\(o\.perms && o\.perms\.players_optin === true\)/.test(SRC);
check('the export route requires players_optin === true, matching what is stored', exportLine);

print(fails ? ('FAILED ' + fails) : 'PASS');
if (fails) { throw new Error('manager permissions: ' + fails + ' failed'); }
