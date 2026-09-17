/* A venue only keeps what it has agreed to keep, whichever door the player came through.

   Found 17 Sep 2026. There were two doors and only one asked. /capture read vp_venue_settings
   and wrote only enabled fields. /join read nothing and assigned the request straight onto the
   player row, so a crafted POST could write an email, a mobile, a postcode and a marketing_optin
   with a consent timestamp for a venue that collects none of it, going straight round the
   migration 43/82 gate that exists to stop exactly that.

   This RUNS gatedCapture and venueCollectCfg out of the shipped Worker.

   Run:  jsc tools/test-collection-gate.js
*/
var src = readFile('venueplay-backend/worker/venueplay-game.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {} };
(0, eval)(src);

var EVERYTHING = { first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com',
                   mobile: '0400000000', postcode: '4220', marketing_optin: true };

var fails = 0;
function check(name, ok, saw) {
  if (ok) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}

print('a venue only keeps what it agreed to keep');

/* 1. THE FAULT. A venue that collects nothing gets nothing, however much the request sends. */
var off = gatedCapture({}, EVERYTHING);
check('collects nothing: no email kept', off.email === undefined, off);
check('collects nothing: no mobile kept', off.mobile === undefined, off);
check('collects nothing: no postcode kept', off.postcode === undefined, off);
check('collects nothing: NO marketing opt-in, and no consent timestamp',
  off.marketing_optin === undefined && off.marketing_optin_at === undefined, off);
check('collects nothing: no surname kept', off.last_name === undefined, off);
check('collects nothing: a first name IS kept, because a winner needs a name on the screen',
  off.first_name === 'Jane', off);

/* 2. Switched on, one at a time. Each field is its own decision. */
check('email on: email kept, mobile still not',
  (function(){ var r = gatedCapture({ collect_email: true }, EVERYTHING);
    return r.email === 'jane@example.com' && r.mobile === undefined; })());
check('mobile on: mobile kept, email still not',
  (function(){ var r = gatedCapture({ collect_mobile: true }, EVERYTHING);
    return r.mobile === '0400000000' && r.email === undefined; })());
check('postcode on: postcode kept', gatedCapture({ collect_postcode: true }, EVERYTHING).postcode === '4220');
check('surname on: surname kept', gatedCapture({ collect_last_name: true }, EVERYTHING).last_name === 'Smith');

/* 3. Consent. Two things must BOTH be true, and the timestamp only exists with the consent. */
var optOn = gatedCapture({ collect_marketing_optin: true }, EVERYTHING);
check('opt-in on and ticked: recorded, with a timestamp',
  optOn.marketing_optin === true && typeof optOn.marketing_optin_at === 'string', optOn);
check('opt-in on but NOT ticked: nothing recorded',
  gatedCapture({ collect_marketing_optin: true }, { marketing_optin: false }).marketing_optin === undefined);
check('opt-in on, a truthy value that is not true, still nothing',
  gatedCapture({ collect_marketing_optin: true }, { marketing_optin: 'yes' }).marketing_optin === undefined);
check('opt-in off but ticked anyway: nothing recorded, and no timestamp',
  (function(){ var r = gatedCapture({ collect_email: true }, EVERYTHING);
    return r.marketing_optin === undefined && r.marketing_optin_at === undefined; })());

/* 4. First name is on unless explicitly OFF, which is not the same as absent. */
check('first name explicitly off: not kept', gatedCapture({ collect_first_name: false }, EVERYTHING).first_name === undefined);
check('first name absent from settings: kept', gatedCapture({ collect_email: true }, EVERYTHING).first_name === 'Jane');

/* 5. Lengths are per field. A blanket 120 would truncate a real email into a dud one. */
var longMail = 'x'.repeat(190) + '@example.com';
check('a long email is not truncated into a dud',
  gatedCapture({ collect_email: true }, { email: longMail }).email.length === 200);
check('a silly postcode is cut down', gatedCapture({ collect_postcode: true }, { postcode: '4220 '.repeat(9) }).postcode.length <= 10);
check('whitespace only counts as nothing', gatedCapture({ collect_email: true }, { email: '   ' }).email === null);

/* 6. FAILS CLOSED. sbGet answers [] on any non-2xx, so a database wobble must mean "collect
      nothing", never "collect everything". */
var asked = [];
sbGet = function (e, t, q) { asked.push(t); return Promise.resolve([]); };
var cfg = null;
venueCollectCfg({}, 'v1').then(function (c) { cfg = c; });
drainMicrotasks();
check('settings unreadable: comes back as collect-nothing', cfg && Object.keys(cfg).length === 0, cfg);
check('settings unreadable: so nothing sensitive is kept',
  (function(){ var r = gatedCapture(cfg, EVERYTHING);
    return r.email === undefined && r.mobile === undefined && r.marketing_optin === undefined; })());
check('it really asks vp_venue_settings', asked.indexOf('vp_venue_settings') !== -1, asked);

print(fails ? ('FAILED ' + fails) : 'PASS');
if (fails) { throw new Error('collection gate: ' + fails + ' failed'); }
