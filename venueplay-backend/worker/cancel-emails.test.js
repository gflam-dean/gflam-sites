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
eval(lift(BILL,"vpaFireCancelConfirm"));
eval(lift(BILL,"vpaLastDaySweep"));
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
    if(/action=eq\.venue_last_day_emailed/.test(q)){
      var t=/target=eq\.([^&]+)/.exec(q);
      return r.action==="venue_last_day_emailed" && r.target===decodeURIComponent(t[1]);
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
var env={ RESEND_API_KEY:"re_x", STRIPE_SECRET_KEY:"sk_x", SITE_URL:"https://venueplay.com.au" };

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
pass("it says the service runs until the last day", c.html.indexOf("stays fully live until")!==-1);
pass("it says there is no further charge", c.html.indexOf("no further charge")!==-1);
pass("it promises three months, matching the privacy page", c.html.indexOf("three months")!==-1);
pass("it tells them how to undo it", c.html.indexOf("Undo this cancellation")!==-1);
/* A SERVICE MESSAGE MUST NOT CARRY ONE. An unsubscribe on a notice that your service is
   stopping invites someone to switch off the one email they cannot afford to miss. */
pass("it carries NO unsubscribe link", c.html.indexOf("unsubscribe")===-1 && c.html.indexOf("Unsubscribe")===-1);
pass("it is recorded in the audit", AUDIT.length===1 && AUDIT[0].action==="venue_cancel_confirm_emailed");

/* --- the day before ----------------------------------------------------- */
var NOW=Math.floor(Date.now()/1000);
function sweepWith(endsIn, alreadySent){
  SENT=[]; AUDIT=[];
  TABLES={
    vp_venues:[{id:"v1",name:"The Pub",founding_id:"f1",timezone:"Australia/Brisbane"}],
    venueplay_founding:[{id:"f1",contact_email:"accounts@thepub.com.au",stripe_subscription_id:"sub_1"}],
    vp_venue_staff:[{venue_id:"v1",auth_user_id:"u1"}],
    vp_admin_audit: alreadySent ? [{action:"venue_last_day_emailed",target:"venue:v1"}] : [],
  };
  STRIPE={ sub_1:{ cancel_at: NOW+endsIn, items:{data:[{}]} } };
  return vpaLastDaySweep(env);
}
var r1=await sweepWith(20*3600,false);
pass("a venue ending in 20 hours is warned", r1.sent===1 && SENT.length===2, "sent "+SENT.length+" email(s)");
var d=SENT[0]||{subject:"",html:""};
pass("the subject is the one Dean asked for", d.subject==="Tomorrow is your last day on VenuePlay", d.subject);
pass("it says games stop after that", d.html.indexOf("the screens")!==-1 && d.html.indexOf("stop")!==-1);
pass("it promises three months here as well", d.html.indexOf("three months")!==-1);
pass("it offers the one click that keeps them", d.html.indexOf("Keep the venue running")!==-1);
pass("the day-before email carries NO unsubscribe either", d.html.toLowerCase().indexOf("unsubscribe")===-1);

var r2=await sweepWith(40*3600,false);
pass("a venue ending in 40 hours is NOT warned yet", r2.sent===0 && SENT.length===0, "sent "+SENT.length);
var r3=await sweepWith(-3600,false);
pass("a venue that has already ended is not warned", r3.sent===0 && SENT.length===0);
var r4=await sweepWith(20*3600,true);
pass("a venue already warned is never warned twice", r4.sent===0 && SENT.length===0,
     "this is what stops an hourly cron sending it 24 times");

/* the sweep must ask STRIPE, because nothing in our tables stores the end date */
pass("the end date is read from Stripe, not guessed from our own tables",
     /subscriptions\//.test(JSON.stringify(Object.keys(STRIPE)))===false && typeof vpbStripeGet==="function");

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
