/* The two billing emails, rendered from the real functions, against Jess's real invoice. */
var bad=0, ran=0;
function pass(n,c,x){ if(typeof n!=="string")throw new Error("name first");
  if(typeof c!=="boolean")throw new Error("condition must be a boolean: "+n);
  ran++; print((c?"  ok   ":"  FAIL ")+n+(x?"   "+x:"")); if(!c)bad++; }
function find(rel){ var t=[rel,"../"+rel]; for(var i=0;i<t.length;i++){ try{var s=readFile(t[i]); if(s&&s.length>500) return s;}catch(e){} } throw new Error("cannot find "+rel); }
function lift(src,name){ var m=new RegExp("(?:async\\s+)?function\\s+"+name+"\\s*\\(").exec(src); if(!m)return null;
  var i=src.indexOf("{",m.index),d=0; for(var j=i;j<src.length;j++){ if(src[j]==="{")d++; else if(src[j]==="}"){d--; if(!d) return src.slice(m.index,j+1);} } return null; }
var BILL=find("venueplay-backend/worker/venueplay-api-FULL.js");
var GAME=find("venueplay-backend/worker/venueplay-game.js");
var abn=/const VP_ABN = '([^']+)'/.exec(BILL);
pass("the ABN is defined once in the Worker", !!abn, abn?abn[1]:"not found");
var VP_ABN = abn?abn[1]:"";
eval(lift(BILL,"vpaEsc"));
eval(lift(BILL,"vpaInvoiceLinesHtml"));
eval(lift(BILL,"vpaTaxSummaryHtml"));

// Jess's actual invoice, as Stripe returned it.
var jess = { amount_paid: 1000, number: "9FGBRAJG-0008", lines: { data: [
  { description: "Not jess: 1 extra player, full month", amount: 250 },
  { description: "Not jess: 1 extra player, full month", amount: 250 },
  { description: "The Jolly Jess: 1 extra player, full month", amount: 250 },
  { description: "1 Player × Founding Membership (Monthly) (at $2.50 / month)", amount: 250 }
]}};

var lines = vpaInvoiceLinesHtml(jess);
pass("every line on her bill is listed", (lines.match(/full month/g)||[]).length === 3,
     "found " + ((lines.match(/full month/g)||[]).length) + " of the 3 extra-player lines");
pass("the subscription line is there too", lines.indexOf("Founding Membership") !== -1);
pass("each venue is named, which is what a group account needs", lines.indexOf("Not jess") !== -1 && lines.indexOf("The Jolly Jess") !== -1);
/* Count the AMOUNT CELLS, not the string. The subscription line's own description
   contains "(at $2.50 / month)", so a naive search finds five and the check failed on
   its own sloppiness rather than on anything wrong with the email. */
var cells = (lines.match(/>\$2\.50<\/td>/g)||[]).length;
pass("the amounts add up to what she paid", cells === 4,
     "found " + cells + " amount cells at $2.50; four of them make the $10.00");

var tax = vpaTaxSummaryHtml(jess);
pass("GST is shown", tax.indexOf("GST") !== -1);
pass("GST is the INCLUSIVE component, $0.91 of $10", tax.indexOf("$0.91") !== -1,
     "prices include GST, so it is total/11, not 10% added on top");
pass("the ex-GST subtotal is $9.09", tax.indexOf("$9.09") !== -1);
pass("the total paid is $10.00", tax.indexOf("$10.00") !== -1);
pass("it calls itself a tax invoice", tax.toLowerCase().indexOf("tax invoice") !== -1);
pass("the ABN is on it", tax.indexOf(VP_ABN) !== -1);

pass("a $0 trial invoice gets no tax block at all",
     vpaTaxSummaryHtml({ amount_paid: 0, lines:{data:[]} }) === "");
pass("an invoice with no lines does not render an empty table",
     vpaInvoiceLinesHtml({ lines: { data: [] } }) === "");


print("\nTRANSPARENCY ABOUT THE AUTOMATIC UPGRADE");
eval(lift(BILL,"vpaUpliftNoticeHtml"));

var upgraded = { amount_paid: 900, lines: { data: [
  { description: "The Jolly Jess - Extra Player - 04/10/2026 (3rd big night, plan moved up)", amount: 300 },
  { description: "1 Player \u00d7 Founding Membership (Monthly)", amount: 250 }
]}};
var notice = vpaUpliftNoticeHtml(upgraded);
pass("an invoice that upgraded the plan says so", notice.indexOf("plan has moved up") !== -1);
pass("it explains WHY that night was half price", notice.toLowerCase().indexOf("half price") !== -1);
pass("it says the rate per player has not changed", notice.indexOf("rate per player has not changed") !== -1);
pass("and that it starts from the next invoice", notice.indexOf("next invoice") !== -1);

var ordinary = { amount_paid: 600, lines: { data: [
  { description: "The Jolly Jess - Extra Player - 2026-09-27", amount: 600 }
]}};
pass("an ordinary big night does NOT claim the plan moved", vpaUpliftNoticeHtml(ordinary) === "",
     "a venue told its plan changed when it did not is worse than saying nothing");
pass("a plain subscription invoice says nothing about upgrades",
     vpaUpliftNoticeHtml({ lines: { data: [{ description: "1 Player x Founding Membership", amount: 250 }] } }) === "");

print("\nTHE NEW INVOICE LINE FORMAT");
pass("the big night line is quantity x unit price, not one lump",
     /quantity: overage,/.test(GAME) && /unit_amount: Math\.round\(rateDollars \* 100\)/.test(GAME),
     "so the invoice shows 3 x $2.00 rather than a single figure");
pass("and it names the venue and the night",
     /description: \(venue\.name \|\| 'Venue'\) \+ ' - Extra Player - ' \+ when/.test(GAME));
pass("the plan-change line does the same in the billing Worker",
     /quantity: n, unit_amount: Math\.round\(rate \* 100\)/.test(BILL));


print("\nTHE DATE ON THE LINE IS THE NIGHT THEY PLAYED, IN AUSTRALIAN ORDER");
eval(lift(GAME,"brisbaneNightKey"));
function au(ms){ return brisbaneNightKey(ms).split('-').reverse().join('/'); }

var sat9pm   = Date.parse('2026-09-12T11:00:00Z');   // Sat 12 Sep, 9pm Brisbane
var sweep3am = Date.parse('2026-09-12T17:00:00Z');   // Sun 13 Sep, 3am Brisbane
var sat1am   = Date.parse('2026-09-12T15:30:00Z');   // Sun 13 Sep 1:30am Brisbane, still Saturday night

pass("a date reads day/month/year", /^\d{2}\/\d{2}\/\d{4}$/.test(au(sat9pm)), au(sat9pm));
pass("a Saturday night is dated Saturday", au(sat9pm) === "12/09/2026");
pass("a 1:30am finish is still that Saturday night", au(sat1am) === "12/09/2026",
     "the 2am rollover, so a late finish is not billed as the next day");
pass("and it is NOT dated from when the sweep ran", au(sat9pm) !== au(sweep3am),
     "the 3am sweep would have labelled Saturday's game " + au(sweep3am));
/* There used to be a regex here demanding `Date.parse(session.opened_at || session.started_at`
   in the game Worker. That text WAS the live bug: it sat inside applyOverageCharge, which has no
   `session`, and threw on every active venue. The regex was green the whole time. The date now
   comes from o.openedAt and overage-charge.test.js RUNS the charge for a Saturday night swept
   on Sunday and reads the date off the Stripe request. Behaviour there, not text here. */
pass("the billing Worker also uses Brisbane, not UTC",
     /Date\.now\(\) \+ 36000000/.test(BILL));

print("");
print(bad?(bad+" OF "+ran+" FAILED"):("ALL "+ran+" CHECKS PASSED"));
