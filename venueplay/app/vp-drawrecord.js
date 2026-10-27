/* THE DRAW RECORD, AS A FILE. One copy, loaded by the members, raffle and bingo host consoles.

   The venue is the conductor of every draw and keeps the winner and draw records (Anisimoff
   Legal, 1 Oct 2026, points 8 and 14; ACT, 8 Oct 2026 table: "winning ticket must be recorded
   and results must be available to entrants"). The product recorded every draw and handed the
   venue none of it. GET /host/draws/export on the game Worker answers with every members draw
   and raffle result, and every bingo ball called (18 Oct 2026), at the venue as CSV, oldest
   first, a 7 year retention note on the first line. It needs the host's token in the Authorization header, so this is a fetch and a blob,
   not a plain link.

   Written once here because it was about to be pasted into two consoles, and the rule in
   CLAUDE.md is that the same answer lives in one place. Any staff member may download it: the
   host on the floor is who a member asks about last month's draw.

     VPDrawRecord.download({ api, venueId, getToken, button, message })  -> Promise<boolean>
       api       the game Worker origin
       venueId   the venue whose record is wanted
       getToken  () -> Promise<string>   the host's access token
       button    optional element to disable while it runs
       message   optional element for the one-line status
*/
(function (root) {
  'use strict';
  function say(el, text) { if (el) el.textContent = text; }
  function download(opts) {
    opts = opts || {};
    var b = opts.button || null, m = opts.message || null;
    var doc = opts.document || root.document;
    var fetchFn = opts.fetch || root.fetch;
    if (!opts.venueId) { say(m, 'Sign in first.'); return Promise.resolve(false); }
    if (b) b.disabled = true;
    say(m, 'Preparing your draw record…');
    return Promise.resolve(typeof opts.getToken === 'function' ? opts.getToken() : '').then(function (t) {
      return fetchFn(opts.api + '/host/draws/export?venue_id=' + encodeURIComponent(opts.venueId) + '&format=csv',
        { method: 'GET', headers: { 'Authorization': 'Bearer ' + (t || '') } });
    }).then(function (r) {
      if (!r || !r.ok) {
        var status = r ? r.status : 0;
        return Promise.resolve(r && r.json ? r.json().catch(function () { return {}; }) : {}).then(function (d) {
          throw new Error((d && d.error) || ('Could not download (' + status + ')'));
        });
      }
      return r.blob();
    }).then(function (blob) {
      var a = doc.createElement('a'), url = root.URL.createObjectURL(blob);
      a.href = url; a.download = 'venueplay-draw-record-' + new Date().toISOString().slice(0, 10) + '.csv';
      doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
      root.setTimeout(function () { try { root.URL.revokeObjectURL(url); } catch (e) {} }, 4000);
      say(m, 'Downloaded. Keep it with your draw records for at least 7 years.');
      if (b) b.disabled = false;
      return true;
    }).catch(function (e) {
      if (b) b.disabled = false;
      say(m, (e && e.message) || 'Could not download the draw record.');
      return false;
    });
  }
  root.VPDrawRecord = { download: download };
})(typeof window !== 'undefined' ? window : this);
