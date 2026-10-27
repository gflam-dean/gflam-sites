/* THE FOUR GAME SCREENS GET THEIR CHANNEL BACK AFTER A DROP, AND SAY SO.

   Audit, 27 Sep 2026. The trivia, musical, raffle and members walls each subscribed ONE
   channel. When it dropped they said "Reconnecting" and did nothing else, and supabase-js
   never rejoins a channel that has CLOSED. So one wifi blip that ended in CLOSED left a pub's
   wall deaf to its own host for the rest of the night, while looking fine.

   This lifts each screen's REAL channel block out of the shipped page (from `var ch=` to the
   end of its `ch.subscribe(...)`), runs it with the REAL /app/vp-channel.js against a fake
   client that keeps the library's rules (tools/rig-channel.js), and asserts what the wall
   does: says Reconnecting, rebuilds, says hello to the host again, hears the host, does not
   flap, and lets a channel that healed by itself keep going.

   Run from the repo root:  jsc tools/test-channel-recovery-screens.js
*/
load('tools/rig-channel.js');
var check = RIG.check;

var SCREENS = ['trivia', 'musical', 'raffle', 'members'];

function liftBlock(html, file) {
  var a = html.indexOf('var ch=');
  var s = html.indexOf('if(!VP_DEMO) ch.subscribe(function(status){', a);
  if (a < 0 || s < 0) throw new Error('cannot find the channel block in ' + file);
  var end = RIG.braceEnd(html, html.indexOf('{', s));
  var close = html.indexOf(');', end);
  return html.slice(a, close + 2);
}

function boot(file, helper) {
  var html = readFile(file);
  var block = liftBlock(html, file);
  var tvStatusSrc = RIG.lift(html, 'tvStatus');
  var dom = RIG.makeDom();
  var world = RIG.makeClient();
  var heard = [];
  var win = { VPChannel: helper };
  var f = new Function('client', 'CODE', 'vpGate', 'onMsg', 'reloadVenueLogo', '$', 'document', 'VP_DEMO', 'window', 'VPChannel',
    '"use strict";\n' + (block.indexOf('function tvStatus') < 0 ? tvStatusSrc + '\n' : '') + block +
    '\nreturn { ch: function(){ return ch; }, sub: function(){ return tvSubscribed; } };');
  var page = f(world.client, 'ACDEFG', function (p, cb) { cb(p); }, function (m) { heard.push(m); }, function () {},
               dom.$, dom.document, false, win, helper);
  return { world: world, page: page, dom: dom, heard: heard, html: html,
           status: function () { return dom.el('statusText').textContent; } };
}

var helper = RIG.loadHelper({ console: { log: function () {} } });
check('the shared script defines VPChannel.keep', !!(helper && typeof helper.keep === 'function'));

SCREENS.forEach(function (game) {
  var file = 'venueplay/app/' + game + '/screen.html';
  print('\n' + game + ' screen');
  var t = boot(file, helper), w = t.world;
  check(game + ': the page loads /app/vp-channel.js in a real script tag', RIG.loadsScript(t.html, 'vp-channel.js'));

  RIG.advance(200);
  check(game + ': CONTROL: it joins once and is quiet about it', w.joins === 1 && t.page.sub() === true && t.status() === 'Connected', [w.joins, t.page.sub(), t.status()]);
  var hello = function (c) { return c.sent.some(function (m) { return m.payload && m.payload.t === 'tv_here'; }); };
  check(game + ': and it told the host it is here', hello(w.joined()[0]));

  print('  the server closes the channel');
  w.drop(w.joined()[0], 'CLOSED');
  check(game + ': it stops believing it is connected, and says Reconnecting', t.page.sub() === false && t.status() === 'Reconnecting', [t.page.sub(), t.status()]);
  RIG.advance(2010);   // the first retry is due at two seconds; the new channel answers 40ms later
  var k = t.page.ch();
  check(game + ': rebuilding does not book a SECOND retry off the old channel\'s goodbye (the 3,588-join flap)',
        !!(k && k.retrying) && k.retrying() === false && w.live('vp-ACDEFG').length === 1, k && k.retrying ? k.retrying() : 'no retry at all');
  RIG.advance(3000);
  var live = w.live('vp-ACDEFG');
  check(game + ': A NEW CHANNEL IS JOINED. It used to sit on Reconnecting for the rest of the night', w.joins === 2 && live.length === 1 && live[0].state === 'joined', [w.joins, live.length]);
  check(game + ': it says hello to the host on the new channel, and the pill goes quiet', live.length === 1 && hello(live[0]) && t.status() === 'Connected' && t.page.sub() === true, t.status());
  if (live.length) w.emit(live[0], { t: 'state', n: 1 });
  check(game + ': and it hears the host on it', t.heard.some(function (m) { return m && m.t === 'state' && m.n === 1; }), t.heard);

  var settled = w.joins;
  RIG.advance(30 * 60 * 1000);
  check(game + ': half an hour later it has not joined again: no flap', w.joins === settled && w.live('vp-ACDEFG').length === 1, w.joins - settled);

  print('  an error that heals by itself (a fresh screen)');
  var h = boot(file, helper);
  RIG.advance(200);
  var cur = h.world.joined()[0];
  h.world.drop(cur, 'CHANNEL_ERROR');
  check(game + ': an error says Reconnecting too', h.status() === 'Reconnecting' && h.page.sub() === false);
  RIG.advance(60 * 1000);
  check(game + ': it healed before the retry, so the retry was cancelled and the working channel kept',
        h.world.joins === 1 && !cur.removed && cur.state === 'joined' && h.status() === 'Connected', [h.world.joins, cur.removed, h.status()]);
  try { h.page.ch().unsubscribe(); } catch (e) {}

  print('  a ten minute outage');
  w.up = false;
  w.dropAll('CLOSED');
  var before = w.joins;
  RIG.advance(10 * 60 * 1000);
  var tries = w.joins - before;
  check(game + ': it keeps trying through the outage, backing off to one try in 30 seconds', tries >= 15 && tries <= 30, tries);
  check(game + ': never more than one channel at a time', w.live('vp-ACDEFG').length <= 1, w.live('vp-ACDEFG').length);
  w.up = true;
  RIG.advance(60 * 1000);
  check(game + ': the network returns and so does the wall', w.joined('vp-ACDEFG').length === 1 && w.live('vp-ACDEFG').length === 1 && t.status() === 'Connected', t.status());
  try { t.page.ch().unsubscribe(); } catch (e) {}   // hang this screen up before the next one
  RIG.advance(100);
});

RIG.done('channel recovery, screens');
