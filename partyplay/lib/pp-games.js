/* WHAT EACH GAME IS CALLED, in one place.
 *
 * The names lived only in host.html, in the TYPES object that draws the "Add a game" tiles.
 * run.html, which is the screen a host actually runs the night from, had none of them and
 * fell back to the stored format slug. So a host part way through a party was looking at:
 *
 *     bingo90      headstails      truths      draw      charades
 *
 * and worse, run.html sends the same string to the TELEVISION when a game starts, so
 * "headstails" went up in front of the whole room.
 *
 * Nothing was broken in the usual sense. Every game ran. It just told everybody in the
 * house what the database calls it. Found 12 Sep 2026 by running a party rather than by
 * reading the code, because the build page looks perfect: it has the names.
 *
 * So they live here now and both pages ask. A format added to one screen and not the other
 * is the fault this whole file exists to stop.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPGames = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Keyed by the format string stored in pp_games.format. The icon is here too, because the
     one place that knows a game's name is the obvious place to keep the one picture of it,
     and a second map keyed the same way is the next drift waiting to happen. */
  var GAMES = {
    bingo90:    { name: 'Bingo',                  icon: '🎱' },
    trivia:     { name: 'Trivia',                 icon: '🧠' },
    howwell:    { name: 'How well do you know...', icon: '🎂' },
    truths:     { name: 'Two truths and a lie',   icon: '🤔' },
    headstails: { name: 'Heads or tails',         icon: '🪙' },
    whohere:    { name: 'Who here has ever',      icon: '👥' },
    photos:     { name: 'Guess the photo',        icon: '🖼' },
    playlist:   { name: 'The playlist',           icon: '🎶' },
    draw:       { name: 'Prize draw',             icon: '🎫' },
    charades:   { name: 'Charades',               icon: '🎭' },
    guesswho:   { name: 'Who am I?',              icon: '🤔' }
  };

  /* THE HOST'S OWN TITLE WINS. A host who called it "Nan's Round" gets "Nan's Round", which
     is the whole point of letting them name it. Only when they have not named it does the
     catalogue answer, and the raw format is the last resort rather than the first.
     A blank or whitespace-only title counts as not named: an empty text box should not put
     an empty heading on a television. */
  function name(format, title) {
    var t = String(title == null ? '' : title).trim();
    if (t) return t;
    var g = GAMES[format];
    return (g && g.name) || String(format || '');
  }

  function icon(format) {
    var g = GAMES[format];
    return (g && g.icon) || '';
  }

  /* Used by the gate: a format that exists in the product but not here would fall through
     to its slug, on the host's screen and on the television, exactly as before. */
  function formats() {
    var out = [];
    for (var k in GAMES) if (Object.prototype.hasOwnProperty.call(GAMES, k)) out.push(k);
    return out;
  }

  return { GAMES: GAMES, name: name, icon: icon, formats: formats };
}));
