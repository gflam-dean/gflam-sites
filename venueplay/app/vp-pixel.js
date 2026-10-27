/* META PIXEL for VenuePlay. ONE COPY OF THE ID, ON PURPOSE.

   Google Analytics is inlined into fourteen VenuePlay pages and five PartyPlay ones, which
   is fourteen and five copies of a number. This repo's first rule is that the same answer
   lives in one place, so the pixel is a file and every page loads it. Change the id here and
   every page changes.

   WHY IT SITS IN THIS FOLDER rather than beside the pages: the release gate already checks
   every script in here serves as JavaScript and is not the homepage in disguise, which is
   exactly how a pixel fails silently. Cloudflare Pages answers a missing path with the
   homepage and a 200, so a pixel that did not deploy would look fine and track nobody.

   Created 18 Sep 2026. The dataset is "VenuePlay website" in the VenuePlay business portfolio.
   Added after finding VenuePlay already had fbq('track','StartTrial') on the signup-complete
   path, guarded with typeof, firing into nothing because no pixel was ever installed. */
/* NOT ON LOAD: WHEN A PERSON IS HERE (14 Oct 2026). This used to fire PageView the instant the
   page loaded, so every crawler and every mail scanner that opens an emailed link was a Meta
   visitor, while vp-analytics.js had refused those same visits since 25 Sep. It now waits on
   vp-analytics.js's own gate, window.vpWhenHuman(), so the two tags cannot disagree about who
   is a person: the same robot check, team opt-out (?noga=1) and live-site check, and the same
   wait for a touch, mouse move, key or wheel. ONE copy of those rules, in vp-analytics.js.
   Every page loads vp-analytics.js first. If it did not load, the pixel stays off: missing a
   visit beats counting every scanner. window.fbq, not a bare fbq: this runs in a function. */
(function () {
  if (typeof window.vpWhenHuman !== 'function') return;
  window.vpWhenHuman(function () {
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', '1587841132831183');
    window.fbq('track', 'PageView');
  });
})();
