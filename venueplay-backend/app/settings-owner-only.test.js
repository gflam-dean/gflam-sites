/* A MANAGER MUST NOT SEE THE OWNER-ONLY SETTINGS AT ALL.

   Dean, 10 Sep 2026: "Can we hide those options from the manager so they never see it?"

   They used to be dimmed and left on screen. A greyed-out card still tells a manager
   what the venue collects about its players and invites them to ask for it, and it
   looks like something they broke.

   The bolt underneath is migration 77, which stops a manager WRITING those columns even
   by hand: the account page saves straight to the database with the signed-in person's
   own token, and the policy allowed owner OR manager to write every column. Hiding the
   card is the door; the trigger is the lock. This suite is about the door.

   Run: jsc venueplay-backend/app/settings-owner-only.test.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 500) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
var S = find('venueplay/app/settings.html');
var SQL = find('venueplay-backend/supabase/venueplay-77-owner-only-settings.sql');
var EXPECT = 10;
var ran = 0, bad = 0;
function ok(n, c, extra) {
  ran++;
  if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (extra ? '   ' + extra : '')); }
}

print('== the door ==');
ok('the owner-only cards are hidden outright', /card\.style\.display = "none";/.test(S),
   'dimming still shows a manager what the venue collects about its players');
ok('and not merely dimmed', !/card\.style\.opacity = "\.62";/.test(S));
ok('they are hidden from a screen reader too', /aria-hidden/.test(S));
ok('the save button goes with them', /\$\("saveBtn"\); if \(sb\) sb\.style\.display = "none";/.test(S));
ok('and the page says who to ask instead of losing a section in silence',
   /set by your account owner/.test(S));
ok('the note no longer claims they are shown', !/shown here but cannot be changed/.test(S));

print('== who counts as an owner ==');
ok('owner-ness is the permissions object, not the role word', /!row\.permissions/.test(S),
   "a real owner's row can be stored with role manager at a group");
ok('a page that cannot tell leaves the settings alone', /leave the page as it was rather than lock the owner out/.test(S));

print('== the lock behind the door ==');
ok('migration 77 keeps the old values rather than refusing the save',
   /new\.collect_email\s*:=\s*old\.collect_email;/.test(SQL),
   'refusing would break the parts a manager IS allowed to change');
ok('and it covers every toggle the cards hold',
   ['name_display','collect_first_name','collect_last_name','collect_postcode',
    'collect_email','collect_mobile','collect_marketing_optin'].every(function (c) {
      return new RegExp('new\\.' + c + '\\s*:=\\s*old\\.' + c + ';').test(SQL);
   }));

if (ran !== EXPECT) { print('\nONLY ' + ran + ' OF ' + EXPECT + ' RAN'); throw new Error('incomplete'); }
if (bad) { print('\n' + bad + ' OF ' + EXPECT + ' FAILED'); throw new Error(bad + ' failed'); }
print('\nALL ' + EXPECT + ' CHECKS PASSED');
