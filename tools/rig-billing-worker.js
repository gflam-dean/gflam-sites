/* A RIG, not a test. Built by the audit of 20 Sep 2026 and kept. load() it from a test, from the
   repo root. It runs the REAL billing Worker (export stripped, nothing else) against a small fake
   PostgREST, a fake Stripe, a fake Resend that records what was sent, and the REAL email
   templates read off disk, so a test sees the email a customer would get.
   FAIL['table:METHOD'] = n makes the next n such requests answer 503, which is how a resumed
   provision is exercised. */
var console = { log: function () {}, warn: function () {}, error: function () {} };
var TPL = {};
['welcome.html', 'welcome-group.html', 'welcome-hq.html', 'venue-onboarding.html'].forEach(function (n) {
  try { TPL[n] = readFile('venueplay/emails/' + n); } catch (e) {}
});
// Minimal PostgREST-like fake: eq/neq filters, or=(), order ignored, offset then limit, max-rows 1000.
var DB={}, sent=[], stripeCalls=[], FAIL={};  // FAIL[table+':'+method] = n times to fail
function tbl(n){return DB[n]||(DB[n]=[]);}
var uid=0; function newId(){uid++;return '00000000-0000-0000-0000-'+('000000000000'+uid).slice(-12);}
function parseQ(qs){var o={};(qs||'').split('&').filter(Boolean).forEach(function(kv){var i=kv.indexOf('=');o[decodeURIComponent(kv.slice(0,i))]=decodeURIComponent(kv.slice(i+1));});return o;}
function match(row,q){
  for(var k in q){ if(['select','order','limit','offset'].indexOf(k)!==-1) continue;
    var v=q[k];
    if(k==='or'){ var parts=v.replace(/^\(|\)$/g,'').split(','); var any=false;
      parts.forEach(function(p){var m=/^([a-z_]+)\.(eq|ilike)\.(.*)$/.exec(p); if(!m) return; var have=String(row[m[1]]==null?'':row[m[1]]);
        if(m[2]==='eq' ? have===m[3] : new RegExp('^'+m[3].replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/_/g,'.')+'$','i').test(have)) any=true;}); if(!any) return false; continue;}
    var m=/^(eq|neq|is|in)\.(.*)$/.exec(v); if(!m) continue;
    if(m[1]==='eq' && String(row[k])!==m[2]) return false;   // case-sensitive, like Postgres text =
    if(m[1]==='neq' && String(row[k])===m[2]) return false;
  } return true;}
function resp(status,body){return {ok:status>=200&&status<300,status:status,json:function(){return Promise.resolve(body)},text:function(){return Promise.resolve(typeof body==='string'?body:JSON.stringify(body))}};}
globalThis.fetch=function(url,opts){
  url=String(url); opts=opts||{}; var method=opts.method||'GET';
  if(url.indexOf('/emails/')!==-1){var n=url.split('/emails/')[1];return Promise.resolve(resp(200,TPL[n]));}
  if(url.indexOf('api.resend.com')!==-1){sent.push(JSON.parse(opts.body));return Promise.resolve(resp(200,{id:'em'}));}
  if(url.indexOf('api.stripe.com')!==-1){stripeCalls.push({url:url,body:String(opts.body||'')});return Promise.resolve(resp(200,{id:'cs_x',url:'https://stripe/checkout',client_secret:'sec'}));}
  if(url.indexOf('/auth/v1/admin/users')!==-1){
    if(method==='POST'){var b=JSON.parse(opts.body);var ex=tbl('auth').filter(function(u){return u.phone===b.phone.replace('+','')})[0];
      if(ex) return Promise.resolve(resp(422,{msg:'Phone number already registered by another user',error_code:'phone_exists'}));
      var u={id:newId(),phone:b.phone.replace('+','')};tbl('auth').push(u);return Promise.resolve(resp(200,u));}
    return Promise.resolve(resp(200,{users:tbl('auth')}));}
  var m=/\/rest\/v1\/([a-zA-Z_\/]+)\??(.*)$/.exec(url); if(!m) return Promise.resolve(resp(404,{}));
  var t=m[1], q=parseQ(m[2]); var key=t+':'+method;
  if(FAIL[key]>0){FAIL[key]--;return Promise.resolve(resp(503,'upstream blip'));}
  if(t.indexOf('rpc/')===0) return Promise.resolve(resp(200,0));
  if(method==='GET'){var rows=tbl(t).filter(function(r){return match(r,q)});var off=parseInt(q.offset||'0',10);var lim=Math.min(parseInt(q.limit||'1000',10),1000);return Promise.resolve(resp(200,rows.slice(off,off+lim)));}
  if(method==='POST'){var o=JSON.parse(opts.body);o.id=o.id||newId();o.created_at=o.created_at||new Date().toISOString();tbl(t).push(o);return Promise.resolve(resp(201,[o]));}
  if(method==='PATCH'){var o2=JSON.parse(opts.body);tbl(t).filter(function(r){return match(r,q)}).forEach(function(r){for(var k in o2)r[k]=o2[k];});return Promise.resolve(resp(204,''));}
  return Promise.resolve(resp(200,[]));
};
var URLSearchParams=function(){this.p=[];}; URLSearchParams.prototype.set=function(k,v){this.p.push([k,v]);}; URLSearchParams.prototype.get=function(k){var r=this.p.filter(function(x){return x[0]===k})[0];return r?r[1]:null;}; URLSearchParams.prototype.toString=function(){return this.p.map(function(x){return encodeURIComponent(x[0])+'='+encodeURIComponent(x[1])}).join('&');};
var ENV={RESEND_API_KEY:'k',SITE_URL:'https://www.venueplay.com.au',SUPABASE_URL:'https://db',SUPABASE_SERVICE_KEY:'s',STRIPE_SECRET_KEY:'x',STRIPE_PRICE_MONTHLY:'price_F_M',STRIPE_PRICE_ANNUAL:'price_F_A',STRIPE_PRICE_STANDARD_MONTHLY:'price_S_M',STRIPE_PRICE_STANDARD_ANNUAL:'price_S_A',FOUNDING_CODES:'QLD-OCT-2026,NSW-OCT-2026'};
function J(o,s){return {status:s||200,body:o};}
function REQ(body){return {text:function(){return Promise.resolve(JSON.stringify(body))},headers:{get:function(){return ''}}};}

(0, eval)(readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, ''));
