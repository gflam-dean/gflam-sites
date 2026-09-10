/* The two billing emails, rendered from the real functions, against Jess's real invoice. */
var bad=0, ran=0;
function pass(n,c,x){ if(typeof n!=="string")throw new Error("name first");
  if(typeof c!=="boolean")throw new Error("condition must be a boolean: "+n);
  ran++; print((c?"  ok   ":"  FAIL ")+n+(x?"   "+x:"")); if(!c)bad++; }
function find(rel){ var t=[rel,"../"+rel]; for(var i=0;i<t.length;i++){ try{var s=readFile(t[i]); if(s&&s.length>500) return s;}catch(e){} } throw new Error("cannot find "+rel); }
function lift(src,name){ var m=new RegExp("(?:async\\s+)?function\\s+"+name+"\\s*\\(").exec(src); if(!m)return null;
  var i=src.indexOf("{",m.index),d=0; for(var j=i;j<src.length;j++){ if(src[j]==="{")d++; else if(src[j]==="}"){d--; if(!d) return src.slice(m.index,j+1);} } return null; }
var BILL=find("venueplay-backend/worker/venueplay-api-FULL.js");
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

print("");
print(bad?(bad+" OF "+ran+" FAILED"):("ALL "+ran+" CHECKS PASSED"));
