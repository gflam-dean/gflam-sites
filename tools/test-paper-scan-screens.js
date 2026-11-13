/* THE WORDS ON THE HOST'S PAPER-CARD SCAN SCREENS AND THE PLAYLIST LOCK, RUN, not read (13 Nov 2026; INBOX 335, 340, 345).
   Runs the real venueplay/app/vp-papercheck.js (its pure half: describe, lockWords, lineWords) for every answer the Worker can give.
   The painted screens, "Scan another" in line with "Confirm winner", and fit at 375 to 1280 are tools/paper-cards-v2-in-chrome.test.py.
   Run: jsc tools/test-paper-scan-screens.js   (from the repo root) */
var window = this;
load('venueplay/app/vp-papercheck.js');
var P = this.VPPaperCheck, ran = 0, bad = 0;
function show(n, c, extra){ ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   -> ' + extra : '')); if (!c) bad++; }
function plain(h){ return String(h).replace(/<[^>]+>/g, '').replace(/&#10003;|&#10005;/g, ''); }
var ALL = [
  { state:'win', card_no:7, playlist_name:'Pub Classics', printed_label:'Mon 16 Nov', winning_cells:[10,11,12,13,14], played_cells:[10,11,13,14], win_songs:[{ title:'A', n:4 }, { title:'Free', n:0 }] },
  { state:'notyet', card_no:7, playlist_name:'Pub Classics', printed_label:'Mon 16 Nov', closest:'Row 2 across', to_go:1, still_to_play:['Green and Red of Mayo'] },
  { state:'no_game', card_no:7, playlist_name:'Pub Classics', printed_label:'Mon 16 Nov' },
  { state:'wrong_playlist', card_no:7, playlist_name:'Pub Classics', game_playlist:'80s Night' },
  { state:'replaced', card_no:7, playlist_name:'Pub Classics', printed_label:'Mon 16 Nov', replaced_clock:'7:42 pm', tonight_playlist:'80s Night' },
  { state:'other_night', card_no:7, playlist_name:'Pub Classics', printed_label:'Thu 5 Nov', tonight_playlist:'80s Night', tonight_label:'Mon 16 Nov' },
  { state:'other_venue', card_no:7 }, { state:'mismatch', card_no:7 }, { state:'not_card' }, {}
];
print('\nevery answer is said in plain words');
var all = ALL.map(function(r){ return P.describe(r, { pattern:'One line across' }); });
var text = all.map(function(d){ return plain(d.badge + ' ' + d.title + ' ' + d.sub + ' ' + d.warn + ' ' + d.list.join(' ')); }).join(' | ');
show('no em dash, no "VenuePlay", no .dev, no "bingo", no "roster", no "call out" anywhere', !/[\u2014\u2013]|VenuePlay|\.dev\b/.test(text) && !/bingo|roster|call out/i.test(text), text.slice(0, 100));
var win = all[0];
show('a win leads with Confirm winner (first = confirm); every other answer leads with Scan another', win.first === 'confirm' && all.slice(1).every(function(d){ return d.first === 'scan'; }));
show('a win says which line, the pattern and the printed date', plain(win.sub) === 'Row 3 across, the pattern tonight. Printed Mon 16 Nov.', plain(win.sub));
show('a win lists the songs in order played, with "4th"', win.list[0][1] === '4th');
show('the centre square in a win list reads FREE PLAY, as it does on the card (INBOX 385)', win.list[1][0] === 'FREE PLAY' && win.list[1][1] === '');
show('not yet says "one song to go" and names it, and that nothing was added to claims', /one song to go/.test(all[1].sub) && /Nothing is added to your claims/.test(all[1].sub) && all[1].list[0][0] === 'Still to play: Green and Red of Mayo');
show('no game running says so', /No musical game is running yet/.test(all[2].sub));
show('wrong, replaced, another night and another venue each tell the host not to pay out', [3,4,5,6].every(function(i){ return /Don't pay out/.test(all[i].warn); }));
show('replaced says "Bin them" and when it was replaced', /Bin them/.test(all[4].warn + all[4].badge) && /7:42 pm/.test(all[4].sub));
show('another night names the printed date and tonight\'s playlist', /Thu 5 Nov/.test(all[5].sub) && /80s Night/.test(all[5].sub));
show('a card that is not ours says "This isn\'t a venueplay card"', all[8].title === "This isn't a venueplay card" && all[9].title === "This isn't a venueplay card");
show('a card that cannot be checked by scan says to type its number', /Type its number/.test(all[7].sub));
show('the printed words are HTML-safe: a hostile playlist name cannot inject', P.describe({ state:'notyet', card_no:1, playlist_name:'<img src=x onerror=alert(1)>', closest:'x', to_go:2, still_to_play:[] }, {}).title.indexOf('<img') < 0);

print('\nlines in words');
show('row, column, diagonal, corners', P.lineWords([10,11,12,13,14]) === 'Row 3 across' && P.lineWords([2,7,12,17,22]) === 'Column 3 down' && P.lineWords([0,6,12,18,24]) === 'The diagonal' && P.lineWords([0,4,20,24]) === 'Four corners');
show('songs to go', P.togo(1) === 'one song to go' && P.togo(2) === 'two songs to go' && P.togo(4) === '4 songs to go');

print('\nthe playlist lock');
var st = { printed:6, playlist_name:'Pub Classics', locked:false, printed_label:'Mon 16 Nov' };
var w0 = P.lockWords(st, '');
show('the lock bar says every musical game tonight plays the printed playlist', /Every musical game tonight plays <b>Pub Classics<\/b>/.test(w0.bar) && /Paper cards printed from <b>Pub Classics<\/b>/.test(w0.bar));
show('picking the printed playlist is no warning', P.lockWords(st, 'Pub Classics').warn === '' && P.lockWords(st, 'Pub Classics').blocked === '');
var w1 = P.lockWords(st, '80s Night');
show('picking another before any game is the RED warning: the count of cards, both names, "can\'t win"', /6 paper cards/.test(w1.warn) && /Pub Classics/.test(w1.warn) && /80s Night/.test(w1.warn) && /can't win/.test(w1.warn) && !!w1.warnTitle && w1.blocked === '');
show('one card reads "1 paper card"', /1 paper card</.test(P.lockWords({ printed:1, playlist_name:'Pub Classics', locked:false }, '80s').warn));
var w2 = P.lockWords({ printed:6, playlist_name:'Pub Classics', locked:true }, '80s Night');
show('once a game has been played off the cards, switching is blocked for the night, and says why', /played off your Pub Classics cards/.test(w2.blocked) && /Next week is a fresh night/.test(w2.blocked) && w2.warn === '');
show('nothing printed: no lock at all', P.lockWords({ printed:0 }, '80s') === null && P.lockWords(null, 'x') === null);
print('\n' + ran + ' checks, ' + bad + ' failed');
print(bad ? 'FAILED' : 'ALL ' + ran + ' CHECKS PASSED');
