/* PUNTERS RECKON'S REAL BOARDS, FOR A SUITE (15 Oct 2026).

   The boards used to be a public script, venueplay/app/topanswers/ta-boards.js. They now live in the
   game Worker as the constant PR_BOARDS, served to a signed-in host's console by GET /host/pr/boards,
   so nobody can read the answers before a night. This lifts that constant out of the Worker file and
   RUNS it, so a suite plays the very boards the Worker hands out, not a copy of them.

   load('tools/pr-boards-from-worker.js'); var boards = prBoardsFromWorker(); */
function prBoardsFromWorker() {
  var src = readFile('venueplay-backend/worker/venueplay-game.js');
  var start = src.indexOf('\nconst PR_BOARDS = [');
  if (start < 0) throw new Error('PR_BOARDS is not in the game Worker: a suite that cannot find its boards cannot fail');
  var end = src.indexOf('\n];\n', start);
  if (end < 0) throw new Error('PR_BOARDS has no end in the game Worker');
  return (new Function(src.slice(start, end + 3) + '\nreturn PR_BOARDS;'))();
}
