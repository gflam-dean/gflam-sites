/* FIVE MORE VIEWS THAT READ PAST RLS, FOUND BY ASKING RATHER THAN READING -----

   Migration 46 fixed this exact class twice: a table correctly locked, and a
   VIEW over it handing the data out anyway, because a view runs as its definer
   unless told otherwise. It locked v_vp_player_optins, v_vp_screen_draws and
   v_vp_trivia_leaderboard, and those three still refuse - verified against the
   live project with nothing but the public key that is printed in the source of
   every page.

   The same probe found five it never covered:

     v_vp_prizes_given           HTTP 200, returns a row. Prize and cash totals
                                 given away, per venue.
     v_vp_song_flag_counts       HTTP 200, returns a row.
     v_vp_question_review_queue  HTTP 200.
     v_vp_feedback_by_session    HTTP 200. Added by migration 60, YESTERDAY, by
                                 me: I put RLS on the table and never thought
                                 about the view over it. Exactly the mistake 46
                                 is written about.
     v_vp_trusted                HTTP 200, and DELIBERATELY SO - see below.

   Most return nothing today because there is little data behind them. That is
   not the same as being safe: they hand over whatever accumulates.

   TWO DIFFERENT FIXES, because these views are not used the same way.
   ------------------------------------------------------------------------- */

/* 1. billing.html queries this one FROM THE BROWSER, with the venue's own
      session, filtered by a venue_id the client supplies. It has to stay
      readable by a signed-in user - but as the querying user, so that RLS
      decides which venue's rows come back rather than the client's own .eq().
      security_invoker is exactly that, and is what 46 used for the same shape. */
alter view v_vp_prizes_given set (security_invoker = on);
revoke all on v_vp_prizes_given from anon;

/* 2. These three are read only by the Worker and by tools, both on the service
      role, which bypasses grants entirely. Nothing in a browser needs them. */
revoke all on v_vp_song_flag_counts      from anon, authenticated;
revoke all on v_vp_question_review_queue from anon, authenticated;
revoke all on v_vp_feedback_by_session   from anon, authenticated;

/* 3. v_vp_trusted IS LEFT ALONE, ON PURPOSE. It feeds the "trusted by" logo
      marquee on the PUBLIC homepage (venueplay/index.html), which has no signed
      in user, so anon has to be able to read it. Revoking it here - which is
      what a blanket "lock every view" pass would have done - would have taken
      the logos off the front page. It should only ever expose an active venue's
      name and logo, and a venue that has not opted out; if that ever changes,
      it is the view body that needs fixing, not the grant. */

/* CHECK IT TOOK. From a terminal, with the public key out of any page source:
     curl -s "$SUPABASE_URL/rest/v1/v_vp_prizes_given?select=*&limit=1" \
       -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
   Expect a 401 or an empty array, never a row. And in SQL:
     select relname, reloptions from pg_class
      where relname like 'v_vp_%' and relkind = 'v';
   v_vp_prizes_given should carry security_invoker=on. */
