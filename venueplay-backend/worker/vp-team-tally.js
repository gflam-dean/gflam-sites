/* =====================================================================
 * VP-TEAM-TALLY: WHO TOPPED THE TRIVIA BOARDS. ONE ANSWER, ONE PLACE.
 * =====================================================================
 * Two things ask it (Jobs row 266, 18 Nov 2026):
 *   - the venue's monthly report, "Top teams" (billing Worker, vprMonth);
 *   - "Team of the month" on the venue's TV (game Worker, /screen/team-month).
 * The slide must name the team the report names, so the rule lives here once.
 *
 * HOW IT SHIPS. This file is the source. Each Worker deploys as one file, so it carries a copy of
 * this function, and tools/release-check.py (section A, "vpTeamTally() is the same in all") refuses
 * any copy that differs. Edit here, then paste the same text into venueplay-api-FULL.js and
 * venueplay-game.js. No database reads in here.
 *
 * THE RULE. boards: one list per trivia game, each a list of { display_name, points } rows (test and
 * kicked players already taken out by the caller). A WIN is the top score on a game's board; a tie for
 * the top is a win each, and a board where nobody scored has no winner. Sorted by wins, then total
 * points, then name. One team is one name however it was typed: "The Quizzards" and "the quizzards "
 * are one team. "Player" (what a rude or empty name is turned into at join) is never a team.
 *
 * "PAPER TEAM 3" IS NEVER A TEAM (review 18 Nov 2026). A paper team or card the host scores without typing a name is
 * labelled "Paper team <n>" or "Paper card <n>" (ensurePaperPlayer, game Worker). That is a table number, not a
 * team: table 3 on Thursday and table 3 next week are different people, and merging by name would add them up into
 * one "Paper team 3" that could top the month. Such a row counts towards nobody: it wins nothing, sums nothing and
 * is never listed. It still sets the top score of its board, so a real team that lost to it did not win that game.
 */
function vpTeamTally(boards) {
  const teams = {};
  (boards || []).forEach((board) => {
    const top = board.reduce((m, b) => Math.max(m, parseInt(b.points, 10) || 0), 0);
    const seen = new Set();
    board.forEach((b) => {
      const label = String(b.display_name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const key = label.toLowerCase();
      if (!key || key === 'player' || /^paper (team|card) \d+$/.test(key) || seen.has(key)) return;
      seen.add(key);
      const pts = parseInt(b.points, 10) || 0;
      const t = teams[key] = teams[key] || { name: label, wins: 0, games: 0, points: 0, best: 0 };
      t.games++; t.points += pts; if (pts > t.best) t.best = pts;
      if (top > 0 && pts === top) t.wins++;
    });
  });
  return Object.keys(teams).map((k) => teams[k])
    .sort((a, b) => b.wins - a.wins || b.points - a.points || (a.name < b.name ? -1 : 1));
}
