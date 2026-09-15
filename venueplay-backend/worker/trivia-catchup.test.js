/* A PUNTER WHOSE PHONE WAS IN THEIR POCKET LOSES THE QUESTION, AND NOBODY TELLS THEM.

   The big screen has been caught up since the day it sat on a join QR through a live
   question. A PHONE never was. iOS throws away a backgrounded tab as a matter of routine,
   which venueplay/play.html already says out loud about bingo, so a punter who pocketed
   their phone came back to "Watch the big screen, your questions will pop up here" while
   the telly counted down. They lost 100 points plus up to 50 for speed and were told
   nothing. Anyone joining a minute late got the same.

   The fix has a trap in it, and this exists for the trap as much as the fix. The catch-up
   goes down the channel the WHOLE ROOM is on. Send it untagged and one person
   reconnecting re-renders the live question on forty phones and wipes the answer they had
   already given. So it carries the pid that asked, and every other phone has to let it
   past.

   This lifts the real functions out of the real pages and runs them.

   Run: jsc venueplay-backend/worker/trivia-catchup.test.js
*/
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 5000) return t; } catch (e) {}
  }
  throw new Error('cannot open ' + rel);
}
function lift(src, n) {
  var i = src.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('cannot find ' + n + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k) + '\n';
}

var host = find('venueplay/app/trivia/host.html');
var phone = find('venueplay/app/trivia/play.html');

var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; print('  FAIL  ' + m); } }

print('== the host catches up whoever asked ==');

/* Drive the real replayState with a live question on. */
var toTv = [], toRoom = [];
var G = { status: 'question', gameId: 'g1', qtotal: 10, colour: true, board: [], split: [],
          current: { qseq: 4, qi: 3, text: 'Which Australian city hosted the 2000 Olympics?',
                     options: ['Melbourne', 'Sydney', 'Brisbane', 'Perth'],
                     endsAt: 1789999999999, correctIndex: 1, imageUrl: '' } };
var env = {
  G: G,
  send: function (o) { toTv.push(o); },
  gsend: function (o) { toRoom.push(o); },
  remainingSecs: function () { return 12; },
};
var fn = new Function('G', 'send', 'gsend', 'remainingSecs',
  lift(host, 'replayState') + '; return replayState;')(env.G, env.send, env.gsend, env.remainingSecs);

fn(null);                       // the television
ok(toTv.length >= 1, 'the screen still gets its replay');
ok(toTv[0].t === 'question', 'and it is the live question, got ' + toTv[0].t);
ok(toTv[0].to === undefined, 'the screen replay is not addressed to a phone');
ok(toRoom.length === 0, 'and nothing went to the room for it');

toTv = []; toRoom = [];
fn('pid-abc');                  // one phone that just announced itself
ok(toRoom.length >= 1, 'a phone that announces itself is caught up at all');
ok(toRoom[0].t === 'question', 'with the live question, got ' + (toRoom[0] && toRoom[0].t));
ok(toRoom[0].to === 'pid-abc', 'addressed to the phone that asked, got ' + toRoom[0].to);
ok(toRoom[0].text.indexOf('Olympics') >= 0, 'carrying the real question text');
ok(toRoom[0].endsAt === 1789999999999,
   'and the REAL deadline, or their countdown lies to them, got ' + toRoom[0].endsAt);
ok(toTv.length === 0, 'a phone catch-up does not also repaint the television');

/* Nothing on at all: say nothing rather than something empty. */
toTv = []; toRoom = [];
G.status = 'setup'; G.current = null;
fn('pid-abc');
ok(toRoom.length === 0, 'nothing is on, so nobody is sent a blank question');

/* AND THE FUNCTION HAS TO BE WIRED TO THE JOIN, which the checks above cannot see.
   Deleting the call from the join handler left all of them green, because they drive
   replayState directly. That is the original fault exactly: the function was never the
   problem, nothing calling it was. So read the join branch itself, and only that branch. */
var joinBlock = host.match(/if\(m\.t==="join"\)\{([\s\S]*?)\n    \}/);
ok(!!joinBlock, 'the join handler can be found at all');
ok(joinBlock && joinBlock[1].indexOf('replayState(m.pid)') >= 0,
   'THE JOIN HANDLER CATCHES THE PHONE UP. Without this the function is perfect and '
   + 'never runs, which is the fault this whole file exists for');

print('== and every other phone lets it past ==');

/* The phone's own handler, lifted whole, with a fake render it records. */
var rendered = [];
var P = { joined: true, pid: 'pid-me', ended: true, q: null };
function renderQuestion(m) { rendered.push(m); }
var body = phone.match(/else if\(m\.t==="question"\)\{([\s\S]*?)\n    \}/);
if (!body) throw new Error('cannot find the question handler on the phone');
var handle = new Function('m', 'P', 'renderQuestion',
  'if(false){}' + 'else if(m.t==="question"){' + body[1] + '\n}');

rendered = []; handle({ t: 'question', text: 'q' }, P, renderQuestion);
ok(rendered.length === 1, 'a normal broadcast still renders for everybody');

rendered = []; handle({ t: 'question', text: 'q', to: 'pid-me' }, P, renderQuestion);
ok(rendered.length === 1, 'a catch-up addressed to me renders');

rendered = []; handle({ t: 'question', text: 'q', to: 'pid-someone-else' }, P, renderQuestion);
ok(rendered.length === 0,
   'A CATCH-UP FOR SOMEBODY ELSE MUST NOT RENDER, or one reconnect wipes the room');

rendered = []; P.joined = false; handle({ t: 'question', text: 'q' }, P, renderQuestion);
ok(rendered.length === 0, 'and somebody who has not joined still gets nothing');

print('');
if (fail) { print(fail + ' OF ' + (pass + fail) + ' CHECKS FAILED'); throw new Error(fail + ' failed'); }
print('ALL ' + pass + ' CHECKS PASSED');
