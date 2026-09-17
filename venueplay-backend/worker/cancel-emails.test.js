/* The two emails a leaving venue gets, RUN rather than read.

   Before 16 Sep 2026 a venue that cancelled was told nothing. These checks drive the real
   functions lifted out of the Worker, with Supabase, Stripe and Resend replaced by fakes
   that record what they were asked for, so the thing under test is the shipped code and
   not a description of it. */
var bad=0, ran=0;
function pass(n,c,x){ if(typeof n!=="string")throw new Error("name first");
  if(typeof c!=="boolean")throw new Error("condition must be a boolean: "+n);
  ran++; print((c?"  ok   ":"  FAIL ")+n+(x?"   "+x:"")); if(!c)bad++; }
function find(rel){ var t=[rel,"../"+rel]; for(var i=0;i<t.length;i++){ try{var s=readFile(t[i]); if(s&&s.length>500) return s;}catch(e){} } throw new Error("cannot find "+rel); }
function lift(src,name){ var m=new RegExp("(?:async\\s+)?function\\s+"+name+"\\s*\\(").exec(src); if(!m)return null;
  var i=src.indexOf("{",m.index),d=0; for(var j=i;j<src.length;j++){ if(src[j]==="{")d++; else if(src[j]==="}"){d--; if(!d) return src.slice(m.index,j+1);} } return null; }

var BILL=find("venueplay-backend/worker/venueplay-api-FULL.js");
var VP_ABN=(/const VP_ABN = '([^']+)'/.exec(BILL)||[,""])[1];

eval(lift(BILL,"vpaEsc"));
eval(lift(BILL,"vpaFmtDate"));
eval(lift(BILL,"vpaAccountContacts"));
eval(lift(BILL,"vpaLeavingHtml"));
eval(lift(BILL,"vpaVenueStats"));
eval(lift(BILL,"vpaWrapHtml"));
eval(lift(BILL,"vpaTenureWords"));
eval(lift(BILL,"vpaTenureMonths"));
eval(lift(BILL,"vpaFormatWord"));
eval(lift(BILL,"vpaFireDeliveryFailure"));
eval(lift(BILL,"vpaGreeting"));
eval(lift(BILL,"vpaFirstName"));
eval(lift(BILL,"vpaHello"));
eval(lift(BILL,"vpaGoodbyeHtml"));
/* THE CONSTANTS TOO, and this is not housekeeping. vpaVenueStats reads VPA_NOT_PLAYED and
   is wrapped in its own try/catch so a goodbye email still goes out when the numbers cannot
   be gathered. Lift the functions without the constants and it throws ReferenceError on
   every call, the catch swallows it, ok comes back false, and the wrap silently renders as
   an empty string. The email still sends and every other check stays green: exactly the
   shape of the tvStatus fault that reached a venue TV on 16 Sep. Read from the Worker, not
   retyped, so they cannot drift. */
eval("var VPA_FORMAT_WORDS=" + (/const VPA_FORMAT_WORDS = (\{[\s\S]*?\});/.exec(BILL)||[,"{}"])[1] + ";");
eval("var VPA_NOT_PLAYED=" + (/const VPA_NOT_PLAYED = (new Set\([^;]*\));/.exec(BILL)||[,"new Set()"])[1] + ";");
eval("var VPA_OVERAGE_CENTS=" + (/const VPA_OVERAGE_CENTS = (\d+);/.exec(BILL)||[,"200"])[1] + ";");
eval("var VPA_WRAP_MAX_PER_PLAYER=" + (/const VPA_WRAP_MAX_PER_PLAYER = ([\d.]+);/.exec(BILL)||[,"1"])[1] + ";");
pass("the wrap's constants were lifted, not defaulted",
     typeof VPA_NOT_PLAYED==="object" && VPA_NOT_PLAYED.has("raffle")
     && VPA_FORMAT_WORDS.bingo90==="bingo",
     "a default here would make every wrap check below it meaningless");
eval(lift(BILL,"vpaFireCancelConfirm"));
eval(lift(BILL,"vpaLocalHour"));
eval(lift(BILL,"vpaLocalDate"));
eval(lift(BILL,"vpaLocalWeekday"));
eval(lift(BILL,"vpaDaysBetween"));
eval(lift(BILL,"vpaLastDaySweep"));
eval(lift(BILL,"vpaEndAfterLastNight"));

/* THE REAL ONES, KEPT. Everything lifted above lives at TOP LEVEL, so a stub declared
   inside main() is invisible to it: the function under test resolves vpaLocalHour from
   the scope it was defined in, not from the scope calling it. Eleven checks failed that
   way on the first run and not one of them was the Worker's fault. Stubs are therefore
   assigned over the real bindings out here, and the originals are kept so the date
   arithmetic can still be tested for real. */
var REAL_hour=vpaLocalHour, REAL_date=vpaLocalDate, REAL_weekday=vpaLocalWeekday;
pass("the four new functions are all in the Worker",
     typeof vpaAccountContacts==="function" && typeof vpaLeavingHtml==="function"
     && typeof vpaFireCancelConfirm==="function" && typeof vpaLastDaySweep==="function");

/* --- fakes -------------------------------------------------------------

   EVERY FAKE IS ASYNC. The real vpaSelect, vpaInsert, vpaSendEmail, vpaAuthGetUser and
   vpbStripeGet are all async and the Worker calls .catch() on several of them. A
   synchronous fake returns a plain array, .catch is undefined, and the code under test
   throws inside a try that swallows it, so the emails silently never send and the suite
   reports a pass. The first run of this file did exactly that.
   ---------------------------------------------------------------------- */
var SENT=[], AUDIT=[], SELECTS=[], STRIPE={};
async function vpaSendEmail(env,to,subject,html){ SENT.push({to:to,subject:subject,html:html}); return true; }
async function vpaInsert(env,table,row){ AUDIT.push(row); return {}; }
async function vpaAuthGetUser(env,id){ return USERS[id]||null; }
async function vpbStripeGet(env,path){ var id=path.split("/")[1]; return STRIPE[id]||{}; }
var USERS={}, TABLES={};
async function vpaSelect(env,table,q){
  SELECTS.push(table+"?"+q);
  var rows=TABLES[table]||[];
  return rows.filter(function(r){
    /* THE FAKE HONOURS THE ACTUAL FILTER, action by action. The first version matched any
       row whose action merely started venue_last_day_, so narrowing the Worker's lock back
       to eq.venue_last_day_emailed changed nothing and the check stayed green while a
       refused venue would have been retried every hour for the rest of the day. */
    var am=/action=eq\.([^&]+)/.exec(q), ain=/action=in\.\(([^)]*)\)/.exec(q);
    if(am||ain){
      var want = ain ? ain[1].split(",").map(function(x){return decodeURIComponent(x.trim());})
                     : [decodeURIComponent(am[1])];
      var t=/target=eq\.([^&]+)/.exec(q);
      if(want.indexOf(r.action)===-1) return false;
      return !t || r.target===decodeURIComponent(t[1]);
    }
    /* venue_id is tested BEFORE id. "venue_id=eq.v1" contains the substring "id=eq.v1",
       so an unanchored id test matched the staff query, compared against a column the
       staff rows do not have, and returned nobody. Three checks failed on that and none
       of them were the Worker's fault. */
    var v=/venue_id=eq\.([^&]+)/.exec(q);
    if(v) return r.venue_id===decodeURIComponent(v[1]);
    var m=/(?:^|&|\?)id=eq\.([^&]+)/.exec(q);
    if(m) return r.id===decodeURIComponent(m[1]);
    return true;
  });
}
var env={ RESEND_API_KEY:"re_x", STRIPE_SECRET_KEY:"sk_x", SITE_URL:"https://venueplay.com.au",
          STRIPE_PRICE_MONTHLY:"price_founding_m", STRIPE_PRICE_ANNUAL:"price_founding_a" };

/* Clock stubs, assigned over the real bindings at top level so the lifted functions see
   them. END_TS is a sentinel: the only timestamp the stub calls "the last day". */
var END_TS=1789084740, FAKE_HOUR=8, TODAY="2026-09-16", LASTDAY="2026-09-18";
/* THE STUBS MUST HONOUR tz OR THEY CANNOT CATCH A HARDCODED CLOCK. The first version
   ignored the argument, so replacing the venue's timezone with a literal
   "Australia/Brisbane" inside the sweep passed all 49 checks. Perth is given its own hour
   and its own date here, which is what makes that mutation go red. */
var PERTH_HOUR=6, TODAY_PERTH="2026-09-15";
vpaLocalHour=function(tz){ return tz==="Australia/Perth" ? PERTH_HOUR : FAKE_HOUR; };
vpaLocalDate=function(ts,tz){
  if(ts===END_TS) return LASTDAY;
  return tz==="Australia/Perth" ? TODAY_PERTH : TODAY;
};
vpaLocalWeekday=function(ts,tz){ return "Friday"; };
var PATCHED=[];
async function vpaPatch(env,table,filter,obj){ PATCHED.push({filter:filter,obj:obj}); return {}; }
async function vpaVenuesForCustomer(env,cust){
  return [[{id:"vA",name:"Cancelled",status:"active",cancel_at_period_end:true},
           {id:"vB",name:"Chargeback",status:"active",cancel_at_period_end:false}],{id:"f1"}];
}

/* The functions under test are async. jsc has no top-level await, so the body runs inside
   an async main() and the microtask queue is drained at the end. Without the drain the
   script exits with every check still pending and reports a cheerful zero failures, which
   is the worst possible outcome for a test. */
async function main(){
/* --- who gets told ------------------------------------------------------ */
USERS={ u1:{email:"manager@thepub.com.au"}, u2:{email:"Owner@ThePub.com.au"}, u3:{email:null} };
TABLES={ vp_venue_staff:[ {venue_id:"v1",auth_user_id:"u1"},
                          {venue_id:"v1",auth_user_id:"u2"},
                          {venue_id:"v1",auth_user_id:"u3"} ] };
var who = await vpaAccountContacts(env, {contact_email:"accounts@thepub.com.au"}, "v1");
pass("the billing contact is told", who.indexOf("accounts@thepub.com.au")!==-1, who.join(", "));
pass("every manager login is told too", who.indexOf("manager@thepub.com.au")!==-1 && who.indexOf("owner@thepub.com.au")!==-1);
pass("a login with no email address cannot add an empty recipient", who.length===3, who.length+" recipients");
/* The billing contact IS one of the managers here, in different capitals. Three rows
   describe two people, so two emails go out. The first version of this check expected
   three and was simply wrong about its own fixture. */
var dup = await vpaAccountContacts(env, {contact_email:"MANAGER@thepub.com.au"}, "v1");
pass("the same person under two roles is only emailed once", dup.length===2, dup.join(", "));
pass("and the address is normalised, so capitals cannot sneak a duplicate through",
     dup.indexOf("manager@thepub.com.au")!==-1 && dup.indexOf("MANAGER@thepub.com.au")===-1);

/* --- the confirmation --------------------------------------------------- */
SENT=[]; AUDIT=[];
await vpaFireCancelConfirm(env, {venueId:"v1", name:"The Pub", ends:"18 September 2026",
                           account:{contact_email:"accounts@thepub.com.au"}});
pass("everyone on the account gets the confirmation", SENT.length===3, SENT.length+" sent");
var c=SENT[0]||{subject:"",html:""};
pass("the subject says what it is", c.subject.indexOf("cancellation is confirmed")!==-1, c.subject);
pass("the last day is in the subject, not just buried in the body", c.subject.indexOf("18 September 2026")!==-1);
pass("the body names the venue", c.html.indexOf("The Pub")!==-1);
pass("it says the service runs until the last day", c.html.indexOf("keep playing right through")!==-1);
pass("and that the screens keep earning until close",
     c.html.indexOf("TVs keep showing your advertising")!==-1);
pass("it says there is no further charge", c.html.indexOf("no further charge")!==-1);
/* 90 DAYS, not "three months". Same promise, in the words the privacy page uses, so a venue
   checking one against the other does not have to convert. Change this and you must change
   venueplay/privacy.html too: that is what this check is for. */
pass("it promises 90 days, matching the privacy page", c.html.indexOf("90 days")!==-1);
pass("and links to the privacy page it is quoting", c.html.indexOf("/privacy")!==-1);
pass("it tells them how to undo it", c.html.indexOf("Undo this cancellation")!==-1);
pass("the confirmation has no Gflam Group or ABN either",
     c.html.indexOf("Gflam Group")===-1 && c.html.indexOf("ABN")===-1);
/* The confirmation is sent the second they click, when they have not decided anything
   they can regret yet. The price warning belongs on the one that lands two days out. */
pass("and it does NOT carry the price warning, which belongs on the 48-hour email",
     c.html.indexOf("the rate does not come back")===-1);
/* A SERVICE MESSAGE MUST NOT CARRY ONE. An unsubscribe on a notice that your service is
   stopping invites someone to switch off the one email they cannot afford to miss. */
pass("it carries NO unsubscribe link", c.html.indexOf("unsubscribe")===-1 && c.html.indexOf("Unsubscribe")===-1);
pass("it is recorded in the audit", AUDIT.length===1 && AUDIT[0].action==="venue_cancel_confirm_emailed");
pass("and the audit names who Resend ACCEPTED it for",
     (AUDIT[0].detail.accepted||[]).length===3 && (AUDIT[0].detail.refused||[]).length===0,
     JSON.stringify(AUDIT[0].detail.accepted));

/* --- the real date maths, before anything is stubbed ---------------------- */
/* CANCELLING INSIDE THE LAST TWO DAYS GETS THE GOODBYE, NOT THE CONFIRMATION.
   The sweep only ever fires at exactly two days out, so these venues used to get the plain
   confirmation and never saw the wrap, the price warning or "we are sorry to see you go". */
SENT=[]; AUDIT=[];
/* The same three-address account the confirmation test uses, so "one each, no duplicates"
   is actually testing something: a single recipient could not tell one email per address
   from one email in total. */
USERS={ u1:{email:"manager@thepub.com.au"}, u2:{email:"Owner@ThePub.com.au"}, u3:{email:null} };
TABLES={ venueplay_founding:[{id:"f1",contact_email:"accounts@thepub.com.au",contact_name:"Dean Tindale"}],
         vp_venue_staff:[{venue_id:"v1",auth_user_id:"u1"},{venue_id:"v1",auth_user_id:"u2"},
                         {venue_id:"v1",auth_user_id:"u3"}],
         vp_admin_audit:[] };
await vpaFireCancelConfirm(env, {venueId:"v1", name:"The Pub", ends:"18 September 2026",
  /* The WHOLE account object, the way vpbCancelVenue passes o.account. A bare {id} left the
     billing contact out of the recipients, and that is the person most likely to act on a
     cancellation. The fixture, not the Worker, but a test that quietly drops a recipient is
     a test that would not notice the Worker doing it. */
  account:{id:"f1",contact_email:"accounts@thepub.com.au",contact_name:"Dean Tindale"},
  endTs:END_TS, timezone:"Australia/Brisbane",
  createdAt:new Date(END_TS*1000 - 305*86400000).toISOString(),
  players:20, rateCents:250, rate:"$2.50", founding:true, contactName:"Dean Tindale"});
var near=SENT[0]||{subject:"",html:""};
pass("cancelling one day out sends the GOODBYE, not the confirmation",
     near.subject.indexOf("last day on VenuePlay")!==-1, near.subject);
/* Dean, 17 Sep 2026: "just send the second one if they are inside the window." ONE email,
   not both. Two arriving a second apart, one of them saying less than the other, reads as a
   system with a stutter and buries the one that matters. */
pass("and ONLY that one: no confirmation goes with it",
     SENT.every(function(m){ return m.subject.indexOf("cancellation is confirmed")===-1; }),
     SENT.map(function(m){ return m.subject; }).join(" | "));
/* Not a fixed count: what matters is that each address got it ONCE. Asserting "3" would
   break the day somebody changes the fixture and would say nothing about duplicates. */
pass("each address gets it exactly once",
     SENT.length >= 2 && new Set(SENT.map(function(m){ return String(m.to||"").toLowerCase(); })).size === SENT.length,
     SENT.map(function(m){ return m.to; }).join(" | "));
pass("and it carries the appeal the confirmation does not",
     near.html.indexOf("We are sorry to see you go")!==-1
     && near.html.indexOf("a player a month")!==-1, "sorry + price warning");
pass("it is logged under the SWEEP's action so the sweep cannot send a second one",
     AUDIT.some(function(a){ return a.action==="venue_last_day_emailed"; }),
     JSON.stringify(AUDIT.map(function(a){return a.action;})));
pass("and it wishes them well",
     near.html.indexOf("all the very best")!==-1);

/* THE WEBHOOK ONLY CARES ABOUT THE TWO EMAILS THAT MATTER. A pattern that matched
   everything would fill the audit table at the rate we send; one that matched nothing would
   quietly record no deliveries at all and look identical to a webhook nobody configured. */
eval("var VPA_LEAVING_SUBJECT=" + (/const VPA_LEAVING_SUBJECT = (\/.*\/i);/.exec(BILL)||[,"/$^/"])[1] + ";");
pass("the leaving-subject pattern matches BOTH real subjects",
     VPA_LEAVING_SUBJECT.test("Friday is your last day on VenuePlay")
     && VPA_LEAVING_SUBJECT.test("Your VenuePlay cancellation is confirmed - last day 19 September 2026"));
pass("and does not match the everyday mail",
     !VPA_LEAVING_SUBJECT.test("Your VenuePlay receipt")
     && !VPA_LEAVING_SUBJECT.test("Welcome to VenuePlay")
     && !VPA_LEAVING_SUBJECT.test("Your upcoming payment"));
pass("the webhook records delivery for a leaving email, and ignores the rest",
     /email\.delivered/.test(BILL) && /venue_leaving_email_delivered/.test(BILL)
     && /ignored: 'delivered, not a leaving email'/.test(BILL));

pass("two whole days apart is two, across a month end",
     vpaDaysBetween("2026-09-30","2026-10-02")===2, String(vpaDaysBetween("2026-09-30","2026-10-02")));
pass("the same day is zero", vpaDaysBetween("2026-09-16","2026-09-16")===0);
pass("a past date is negative, so it can never look like 2",
     vpaDaysBetween("2026-09-18","2026-09-16")===-2);
/* 1789084800 is Fri 18 Sep 2026 10:19 Brisbane, which is Wellshot's real cancel_at. */
pass("the weekday is named from the venue's own clock",
     REAL_weekday(1789084740,"Australia/Brisbane")==="Friday",
     REAL_weekday(1789084740,"Australia/Brisbane"));
pass("and Perth reads the same instant as its own day",
     REAL_weekday(1789084740,"Australia/Perth")==="Friday");
/* 15:00 UTC is already the next day in Brisbane and still the previous evening in Perth.
   That two-hour gap is the whole reason the timezone column is used rather than one
   national clock: a single Brisbane clock would end a Perth venue's night on the wrong
   date entirely. The first version of this check used a timestamp where the two agreed,
   so it could not have caught a Brisbane-only implementation. */
pass("a venue's day is its own, not Brisbane's",
     REAL_date(1789657200,"Australia/Brisbane")!==REAL_date(1789657200,"Australia/Perth"),
     REAL_date(1789657200,"Australia/Brisbane")+" vs "+REAL_date(1789657200,"Australia/Perth"));

/* --- the 48-hour warning ------------------------------------------------- */
async function sweepWith(lastDay, hour, alreadySent){
  SENT=[]; AUDIT=[]; LASTDAY=lastDay; FAKE_HOUR=hour;
  TABLES={
    /* A VENUE WITH A HISTORY, because the wrap is now the point of this email.
       created_at and max_players drive "for the last N months" and the per-player figure;
       the sessions, games and players drive everything inside the box. Without them the
       wrap returns an empty string and the checks below cannot tell a broken wrap from a
       venue that never played. Ten months back, so the tenure reads in months not weeks. */
    vp_venues:[{id:"v1",name:"The Pub",founding_id:"f1",timezone:"Australia/Brisbane",
                created_at:new Date(END_TS*1000 - 305*86400000).toISOString(), max_players:20}],
    venueplay_founding:[{id:"f1",contact_email:"accounts@thepub.com.au",stripe_subscription_id:"sub_1"}],
    vp_venue_staff:[{venue_id:"v1",auth_user_id:"u1"}],
    vp_sessions:[{id:"s1",venue_id:"v1",started_at:"2026-08-06T10:00:00.000Z",overage_approved_count:4},
                 {id:"s2",venue_id:"v1",started_at:"2026-08-13T10:00:00.000Z",overage_approved_count:0}],
    vp_games:[{session_id:"s1",format:"bingo90"},{session_id:"s1",format:"trivia"},
              {session_id:"s2",format:"bingo90"},{session_id:"s2",format:"raffle"}],
    vp_players:[{session_id:"s1"},{session_id:"s1"},{session_id:"s1"},
                {session_id:"s2"},{session_id:"s2"},
                {session_id:"s1",is_test:true}],
    vp_admin_audit: alreadySent ? [{action:"venue_last_day_emailed",target:"venue:v1"}] : [],
  };
  STRIPE={ sub_1:{ cancel_at: END_TS, items:{data:[{price:{id:"price_standard_m",unit_amount:300}}]} } };
  return vpaLastDaySweep(env);
}

var r1=await sweepWith("2026-09-18",8,false);
pass("two days out at 8am, they are told", r1.sent===1 && SENT.length===2, "sent "+SENT.length+" email(s)");
var d=SENT[0]||{subject:"",html:""};
pass("the subject NAMES THE DAY, which is what a publican plans around",
     d.subject==="Friday is your last day on VenuePlay", d.subject);
pass("the body names the day too", d.html.indexOf("Friday is your last day")!==-1);
pass("it says they keep that night in full, right through to close",
     d.html.indexOf("keep that night in full")!==-1);
/* The "two days seemed fairer" line was cut on Dean's instruction, 17 Sep 2026. What
   replaced it as the opening is the thing worth protecting: this email exists to be warm
   before it is administrative, so it must still open by being sorry they are going and
   naming how long they stayed. */
/* THE GREETING IS THE VENUE'S OWN CLOCK, and only a real first name. */
pass("it opens with a greeting", /Good (morning|afternoon|evening)/.test(d.html), (d.html.match(/Good (morning|afternoon|evening)[^<]*/)||[""])[0]);
pass("morning, afternoon and evening are told apart by the venue's hour",
     REAL_hour && (function(){
       var save=vpaLocalHour, got=[];
       [8,14,20].forEach(function(h){ vpaLocalHour=function(){ return h; }; got.push(vpaGreeting("Australia/Brisbane")); });
       vpaLocalHour=save;
       return got.join("|")==="Good morning|Good afternoon|Good evening";
     })());
pass("a first name is used, a trading name is not",
     vpaFirstName("Dean Tindale","The Pub")==="Dean"
     && vpaFirstName("The Mini Bar","The Mini Bar")===""
     && vpaFirstName("manager","The Pub")===""
     && vpaFirstName("","The Pub")==="",
     "contact_name holds whatever was typed at signup");
pass("it opens by being sorry to see them go",
     d.html.indexOf("We are sorry to see you go")!==-1);
pass("and says how long they have been with us",
     /pleasure having [^<]*with us for the last <b>/.test(d.html));
pass("it says the screens keep earning to close, not just the games",
     d.html.indexOf("keep playing your advertising until you shut")!==-1);
/* Dean, 16 Sep: "can we put a warning about not getting the same price point?" It is the
   truest reason to think twice, so it must actually be in the email and it must carry
   THEIR rate, read off their own Stripe subscription. */
/* The default fixture is a STANDARD venue at $3, because that is what Wellshot is:
   Stripe has them on STRIPE_PRICE_STANDARD_MONTHLY. Dean caught this. */
pass("a standard venue is quoted ITS OWN rate", d.html.indexOf("$3.00 a player a month")!==-1,
     "a venue on $3 must never be told it is losing $2.50");
pass("a standard venue is NOT promised its rate is held",
     d.html.indexOf("held for as long as you stay")===-1,
     "only the founding rate is locked; saying otherwise invents a promise");
pass("a standard venue is warned the price will not wait",
     d.html.indexOf("the price will not wait for you")!==-1);
/* Dean: "remove gflam group from the bottom of it." */
pass("the holding company and the ABN are NOT on a leaving email",
     d.html.indexOf("Gflam Group")===-1 && d.html.indexOf("ABN")===-1);
pass("it promises 90 days", d.html.indexOf("90 days")!==-1);
/* The wrap is the last appeal, so it has to actually be in there. Counted rather than
   matched on wording, because the copy inside it will keep changing. */
pass("it carries the wrap", d.html.indexOf("And that is a wrap")!==-1);
pass("it offers the one click that keeps them", d.html.indexOf("Keep the venue running")!==-1);
pass("the warning carries NO unsubscribe", d.html.toLowerCase().indexOf("unsubscribe")===-1);

/* And now the founding case, which is the only one allowed to promise the rate is held. */
SENT=[]; AUDIT=[];
TABLES={
  vp_venues:[{id:"v1",name:"The Pub",founding_id:"f1",timezone:"Australia/Brisbane"}],
  venueplay_founding:[{id:"f1",contact_email:"accounts@thepub.com.au",stripe_subscription_id:"sub_1"}],
  vp_venue_staff:[{venue_id:"v1",auth_user_id:"u1"}], vp_admin_audit: [],
};
LASTDAY="2026-09-18"; FAKE_HOUR=8;
STRIPE={ sub_1:{ cancel_at: END_TS, items:{data:[{price:{id:"price_founding_m",unit_amount:250}}]} } };
var rF=await vpaLastDaySweep(env);
var f=SENT[0]||{html:""};
pass("a founding venue IS told its rate is held while it stays",
     rF.sent===1 && f.html.indexOf("held for as long as you stay with us")!==-1);
pass("and it is quoted $2.50, not the standard $3", f.html.indexOf("$2.50 a player a month")!==-1);
pass("a founding venue gets the stronger heading",
     f.html.indexOf("the rate does not come back")!==-1);
pass("and never the standard wording",
     f.html.indexOf("the price will not wait for you")===-1);

/* A QUIET RUN MUST SAY WHY IT WAS QUIET. The first hour this was live was spent unable
   to tell "the cron has not fired" from "it fired and decided not to send". */
var quiet = await sweepWith("2026-09-19",8,false);
pass("three days out, nothing yet", quiet.sent===0);
pass("and it says WHY it sent nothing, rather than looking like a cron that never ran",
     (quiet.why||[]).length===1 && quiet.why[0].indexOf("3 day(s) out, not 2")!==-1,
     JSON.stringify(quiet.why));
pass("the reason names the dates it compared, so a timezone fault is visible",
     (quiet.why[0]||"").indexOf("today 2026-09-16")!==-1 && (quiet.why[0]||"").indexOf("last day 2026-09-19")!==-1);
var early = await sweepWith("2026-09-18",6,false);
pass("waiting for 8am says so, with the local hour it saw",
     (early.why||[]).length===1 && early.why[0].indexOf("local time is 6:00, waiting for 8am")!==-1,
     JSON.stringify(early.why));
var told = await sweepWith("2026-09-18",8,true);
pass("already told says so too", (told.why||[]).join().indexOf("already told")!==-1, JSON.stringify(told.why));
pass("the scheduled handler records EVERY run, not only the ones that send",
     /await vpaAudit\(env, actor, 'last_day_sweep_ran'/.test(BILL));
pass("one day out, the moment has passed and it is not sent late",
     (await sweepWith("2026-09-17",8,false)).sent===0);
pass("the last day itself, nothing", (await sweepWith("2026-09-16",8,false)).sent===0);
pass("two days out but 7am, it waits for 8", (await sweepWith("2026-09-18",7,false)).sent===0);
/* FROM 8am, not AT 8am. An exact hour means a single missed cron run loses the message,
   because the next day the venue is one day out and no longer matches at all. Wellshot
   was 47.9 hours from cancelling when this shipped at 10:13, so an exact test would have
   skipped it for good. Late is fine; never is not. */
pass("two days out at 9am, a missed 8am run still sends it",
     (await sweepWith("2026-09-18",9,false)).sent===1);
pass("two days out at 11pm, it still goes rather than being lost",
     (await sweepWith("2026-09-18",23,false)).sent===1);
pass("but it never fires before 8am, so nobody is woken at 4",
     (await sweepWith("2026-09-18",4,false)).sent===0);
/* TWO VENUES, TWO CLOCKS, AND THE TWO CASES HAVE TO BE SEPARATED.

   A single mixed case cannot tell you which clock is wrong. If Perth differs in BOTH the
   hour and the date, then hardcoding either one still excludes it and the check stays
   green while the code is broken. That happened: replacing the venue's timezone with a
   literal "Australia/Brisbane" in the date lookup passed 51 checks, because the Perth
   venue was being excluded by its hour anyway.

   So: one case where only the DATE differs, one where only the HOUR does. */
function twoVenues(){
  SENT=[]; AUDIT=[];
  TABLES={
    vp_venues:[{id:"v1",name:"The Pub",founding_id:"f1",timezone:"Australia/Brisbane"},
               {id:"v2",name:"The Sandgroper",founding_id:"f1",timezone:"Australia/Perth"}],
    venueplay_founding:[{id:"f1",contact_email:"accounts@thepub.com.au",stripe_subscription_id:"sub_1"}],
    vp_venue_staff:[{venue_id:"v1",auth_user_id:"u1"},{venue_id:"v2",auth_user_id:"u1"}],
    vp_admin_audit: [],
  };
  STRIPE={ sub_1:{ cancel_at: END_TS, items:{data:[{price:{id:"price_standard_m",unit_amount:300}}]} } };
}
/* Same hour in both, different DATE: Brisbane has two days to go, Perth three. */
LASTDAY="2026-09-18"; FAKE_HOUR=8; PERTH_HOUR=8; TODAY="2026-09-16"; TODAY_PERTH="2026-09-15";
twoVenues();
var rDate=await vpaLastDaySweep(env);
pass("the DAY is counted on each venue's own calendar, not one national one",
     rDate.sent===1 && AUDIT.length===1 && AUDIT[0].target==="venue:v1",
     "emailed "+rDate.sent+" venue(s): "+(AUDIT.map(function(a){return a.target;}).join(", ")||"none"));
/* Same date in both, different HOUR: Perth is still at 6am. */
TODAY_PERTH="2026-09-16"; PERTH_HOUR=6;
twoVenues();
var rHour=await vpaLastDaySweep(env);
pass("8am is counted on each venue's own clock, not one national one",
     rHour.sent===1 && AUDIT.length===1 && AUDIT[0].target==="venue:v1",
     "emailed "+rHour.sent+" venue(s): "+(AUDIT.map(function(a){return a.target;}).join(", ")||"none"));
TODAY_PERTH="2026-09-15";

var r4=await sweepWith("2026-09-18",8,true);
pass("a venue already warned is never warned twice", r4.sent===0 && SENT.length===0,
     "this is what stops the hourly cron sending it every hour of that morning");

/* WHEN RESEND REFUSES. The audit row used to say "emailed" regardless, because the return
   value of vpaSendEmail was thrown away at both call sites. A record that cannot be wrong
   is not a record. */
var REALSEND = vpaSendEmail;
vpaSendEmail = async function(env,to,subject,html){ SENT.push({to:to,subject:subject,html:html}); return false; };
var refused = await sweepWith("2026-09-18",8,false);
pass("a venue Resend refused is NOT counted as sent", refused.sent===0, "sent="+refused.sent);
pass("it is filed under its own action so it can be found",
     AUDIT.length===1 && AUDIT[0].action==="venue_last_day_NOT_emailed", AUDIT.length?AUDIT[0].action:"nothing");
pass("the refused addresses are named", (AUDIT[0].detail.refused||[]).length===2,
     JSON.stringify(AUDIT[0].detail.refused));
pass("and the sweep says so in its reasons",
     (refused.why||[]).join().indexOf("Resend refused")!==-1, JSON.stringify(refused.why));
/* and it must not then retry that venue every hour for the rest of the day */
TABLES.vp_admin_audit=[{action:"venue_last_day_NOT_emailed",target:"venue:v1"}];
SENT=[]; AUDIT=[];
var again = await vpaLastDaySweep(env);
pass("a refused venue is not retried every hour", again.sent===0 && SENT.length===0);
vpaSendEmail = REALSEND;

/* --- the last night is kept, and only for a real cancellation ------------- */
SENT=[]; AUDIT=[];
await vpaEndAfterLastNight(env,"cus_1");
var marked=PATCHED.filter(function(p){ return p.obj.suspended_reason==="ending" && !p.obj.status; });
var offNow=PATCHED.filter(function(p){ return p.obj.status==="suspended"; });
pass("a venue the owner cancelled is MARKED, not switched off, so it keeps its last night",
     marked.length===1 && marked[0].filter.indexOf("vA")!==-1, JSON.stringify(marked));
pass("it is left ACTIVE, which is the only thing that lets a game run",
     marked.length===1 && marked[0].obj.status===undefined);
pass("a chargeback is switched off immediately and gets no free night",
     offNow.length===1 && offNow[0].filter.indexOf("vB")!==-1, JSON.stringify(offNow));

/* --- the game Worker ends it, on the same clock as the sessions ----------- */
var GAME=find("venueplay-backend/worker/venueplay-game.js");
pass("the game Worker has the sweep that ends the last night",
     /async function sweepEndingVenues\(env\)/.test(GAME));
pass("it only looks at venues marked 'ending' that are still active",
     /status=eq\.active&suspended_reason=eq\.ending/.test(GAME));
pass("it uses the venue's OWN clock, the same helper the session sweep uses",
     /venueLocalHour\(v\.timezone\)/.test(GAME));
pass("the window is 3 to 5am, so one missed cron cannot buy a free extra night",
     /h >= 3 && h <= 5/.test(GAME));
pass("it runs from the trigger that actually exists, in its own waitUntil",
     /ctx\.waitUntil\(sweepEndingVenues\(env\)/.test(GAME));

/* --- it is actually wired in -------------------------------------------- */
pass("the cancel endpoint calls the confirmation", /vpaFireCancelConfirm\(env, \{/.test(BILL));
pass("the confirmation is NOT sent on an undo", /if \(!undo\) \{\s*await vpaFireCancelConfirm/.test(BILL));
pass("the scheduled handler runs the day-before sweep", /await vpaLastDaySweep\(env\)/.test(BILL));
pass("the sweep has its own try, so a failed archive cannot silence it",
     /try \{\s*const last = await vpaLastDaySweep\(env\)/.test(BILL));

}
var finished=false, failure=null;
main().then(function(){ finished=true; }, function(e){ finished=true; failure=e; });
drainMicrotasks();
pass("the test body actually ran to the end", finished===true,
     "a pending promise here means every check below it silently never ran");
if(failure) { print("  EXCEPTION: "+failure); bad++; }
print((bad?"  "+bad+" FAILED, ":"  ALL ")+ran+" CHECKS"+(bad?"":" PASSED"));
if(bad) throw new Error(bad+" failed");
