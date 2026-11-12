/* A REAL AUSTRALIAN OR NEW ZEALAND MOBILE ON THE JOIN SCREEN (Dean, 12 Nov 2026, INBOX 291 note 9: "it allows 20
   characters with no check").

   RUNS venueplay/app/vp-details.js (the one place the three player phones get their details boxes) with a stand-in
   document, and reads the three phones' join() for the guard:
     1. VPDetails.mobile(): Australian 04xx xxx xxx (and +61 4..., 61 4..., 4xx xxx xxx), New Zealand 02x... (and +64 2...),
        spaces, dashes, dots and brackets ignored; anything else (a landline, too short, too long, letters) is ""
     2. VPDetails.mobileError(): nothing for an empty box (it is optional) or a real mobile; the plain sentence otherwise
     3. the box holds at most 16 characters and says inputmode tel
     4. bingo, musical bingo and trivia each stop the join with that sentence before anything is sent
   Run from the repo root:  jsc tools/test-mobile-check.js */
var ran = 0, bad = 0;
function ok(name, cond, saw) { ran++; if (cond) print('  ok   ' + name); else { bad++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + saw : '')); } }
var BOX = { value: '' };
var document = { getElementById: function (id) { return id === 'xMobile' ? BOX : null; } };
var window = {};
(new Function('window', 'document', readFile('venueplay/app/vp-details.js')))(window, document);
var D = window.VPDetails;

print('1. what counts as a mobile');
var GOOD = { '0412 345 678': '+61412345678', '0412345678': '+61412345678', '+61 412 345 678': '+61412345678', '61412345678': '+61412345678',
             '412 345 678': '+61412345678', '(04) 1234-5678': '+61412345678', '021 123 4567': '+64211234567', '+64 21 123 4567': '+64211234567',
             '027 1234567': '+64271234567', '0221234567': '+64221234567' };
Object.keys(GOOD).forEach(function (k) { ok('"' + k + '" is ' + GOOD[k], D.mobile(k) === GOOD[k], D.mobile(k)); });
['07 5228 3667', '0412 345 67', '0412 345 6789', '04123456789012345678', 'abc', '+44 7700 900123', '1300 123 456', '+61 2 9999 0000', '04l2345678'].forEach(function (k) {
  ok('"' + k + '" is not a mobile', D.mobile(k) === '', D.mobile(k));
});

print('2. what the player is told');
BOX.value = ''; ok('an empty box: nothing (the mobile is optional)', D.mobileError() === '');
BOX.value = '0412 345 678'; ok('a real mobile: nothing', D.mobileError() === '');
BOX.value = '04123456789012345678';
ok('twenty digits: "That mobile number doesn’t look right. An Australian mobile starts 04 and has 10 digits; a New Zealand one starts 02."',
   D.mobileError() === 'That mobile number doesn’t look right. An Australian mobile starts 04 and has 10 digits; a New Zealand one starts 02.', D.mobileError());
ok('no em dash in it', !/—|–/.test(D.MOBILE_WRONG));

print('3. the box');
var h = D.html({ mobile: true });
ok('the mobile box holds at most 16 characters and asks for the phone keypad', /id="xMobile"[^>]*maxlength="16"[^>]*inputmode="tel"/.test(h), h);

print('4. every phone checks it before joining');
[['venueplay/play.html', 'bingo'], ['venueplay/app/musical/play.html', 'musical bingo'], ['venueplay/app/trivia/play.html', 'trivia']].forEach(function (c) {
  var t = readFile(c[0]);
  var i = t.indexOf('var _me=(typeof VPDetails==="object" && VPDetails.mobileError) ? VPDetails.mobileError() : "";');
  var j = t.indexOf('if(_me){ $("joinErr").textContent=_me;', i);
  var post = t.indexOf('playerPost("/join"', i);
  ok(c[1] + ': join() says it and stops before it posts /join', i > 0 && j > i && (post < 0 || post > j), [i, j, post]);
});

print('');
print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
