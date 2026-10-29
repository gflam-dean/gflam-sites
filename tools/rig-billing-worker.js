/* A RIG, not a test. Built by the audit of 20 Sep 2026 and kept. load() it from a test, from the
   repo root. It runs the REAL billing Worker (export stripped, nothing else) against a small fake
   PostgREST, a fake Stripe, a fake Resend that records what was sent, and the REAL email
   templates read off disk, so a test sees the email a customer would get.
   FAIL['table:METHOD'] = n makes the next n such requests answer 503, which is how a resumed
   provision is exercised. */
var console = { log: function () {}, warn: function () {}, error: function () {} };
/* jsc has neither of these and the Worker uses both to put a deadline on a slow lookup. Without
   them every such lookup throws and is swallowed, which reads as "found nothing". */
if (typeof AbortController === 'undefined') { AbortController = function () { this.signal = {}; }; AbortController.prototype.abort = function () {}; }
if (typeof setTimeout === 'undefined') { setTimeout = function () { return 0; }; }
if (typeof clearTimeout === 'undefined') { clearTimeout = function () {}; }   // jsc has setTimeout and NOT clearTimeout
var TPL = {};
['welcome.html', 'welcome-group.html', 'welcome-hq.html', 'venue-onboarding.html', 'welcome-prospect.html', 'prospect-reminder.html'].forEach(function (n) {
  try { TPL[n] = readFile('venueplay/emails/' + n); } catch (e) {}
});
// Minimal PostgREST-like fake: eq/neq filters, or=(), order ignored, offset then limit, max-rows 1000.
var DB={}, sent=[], stripeCalls=[], FAIL={};  // FAIL[table+':'+method] = n times to fail
function tbl(n){return DB[n]||(DB[n]=[]);}
var uid=0; function newId(){uid++;return '00000000-0000-0000-0000-'+('000000000000'+uid).slice(-12);}
function parseQ(qs){var o={};(qs||'').split('&').filter(Boolean).forEach(function(kv){var i=kv.indexOf('=');o[decodeURIComponent(kv.slice(0,i))]=decodeURIComponent(kv.slice(i+1));});return o;}
/* POSTGREST LOGIC, NESTED (21 Oct 2026, for HQ's audit search): and=(a,or(b,c),and(d,e)), with
   col.like.x*, col.not.like.x*, col.in.("a","b"), col.is.null, col.not.is.null, eq/neq/gte/lte/gt/lt.
   Quoted values may hold commas and brackets. like follows SQL LIKE: * or % any run, _ one char. */
function logicSplit(s){ var out=[],d=0,q=false,cur=''; for(var i=0;i<s.length;i++){ var c=s[i];
    if(q){ cur+=c; if(c==='\\'){ cur+=s[++i]; continue; } if(c==='"') q=false; continue; }
    if(c==='"'){ q=true; cur+=c; continue; } if(c==='(') d++; if(c===')') d--;
    if(c===','&&d===0){ out.push(cur); cur=''; continue; } cur+=c; } if(cur) out.push(cur); return out; }
function logicUnq(v){ v=String(v); return /^".*"$/.test(v) ? v.slice(1,-1).replace(/\\(.)/g,'$1') : v; }
function likeRx(p,ci){ var rx=''; for(var i=0;i<p.length;i++){ var c=p[i]; rx += (c==='*'||c==='%')?'.*':(c==='_'?'.':c.replace(/[.+?^${}()|[\]\\]/g,'\\$&')); } return new RegExp('^'+rx+'$',ci?'i':''); }
function logicCmp(have,op,val){
  if(op==='is') return val==='null' ? have==null : String(have)===val;
  if(op==='in'){ var list=logicSplit(val.replace(/^\(|\)$/g,'')).map(logicUnq); return have!=null && list.indexOf(String(have))!==-1; }
  if(op==='like'||op==='ilike') return have!=null && likeRx(logicUnq(val),op==='ilike').test(String(have));
  var v=logicUnq(val);
  if(op==='eq') return have!=null && String(have)===v;
  if(op==='neq') return have==null || String(have)!==v;
  if(have==null) return false;
  var a=Date.parse(have), b=Date.parse(v), cmp=(isFinite(a)&&isFinite(b)&&/\d{4}-\d\d-\d\d/.test(String(have))&&/\d{4}-\d\d-\d\d/.test(v))?(a-b):(String(have)<v?-1:String(have)>v?1:0);
  if(op==='gte') return cmp>=0; if(op==='lte') return cmp<=0; if(op==='gt') return cmp>0; if(op==='lt') return cmp<0;
  throw new Error('the fake database cannot answer the operator '+op);
}
function logicEval(row,node){
  node=String(node).trim(); var neg=false;
  if(/^not\.(and|or)\(/.test(node)){ neg=true; node=node.slice(4); }
  var g=/^(and|or)\((.*)\)$/.exec(node);
  if(g){ var parts=logicSplit(g[2]); var r=g[1]==='and' ? parts.every(function(p){return logicEval(row,p);}) : parts.some(function(p){return logicEval(row,p);}); return neg?!r:r; }
  var m=/^([a-z_]+)\.(not\.)?(eq|neq|gte|lte|gt|lt|like|ilike|in|is)\.([\s\S]*)$/.exec(node);
  if(!m) throw new Error('the fake database cannot answer '+node);
  var r2=logicCmp(row[m[1]],m[3],m[4]); return m[2]?!r2:r2;
}
function match(row,q){
  for(var k in q){ if(['select','order','limit','offset'].indexOf(k)!==-1) continue;
    var v=q[k];
    if(k==='and'||k==='or'){ if(!logicEval(row,k+v)) return false; continue; }
    if(k==='or'){ var parts=v.replace(/^\(|\)$/g,'').split(','); var any=false;
      parts.forEach(function(p){
        /* or=(col.gte.x,...) as /admin/quiet-venues asks it (19 Oct 2026): compared through the same rules as a plain filter. */
        var g=/^([a-z_]+)\.(gte|lte|gt|lt)\.(.*)$/.exec(p); if(g){ var one={}; one[g[1]]=g[2]+'.'+g[3]; if(match(row,one)) any=true; return; }
        var m=/^([a-z_]+)\.(eq|ilike)\.(.*)$/.exec(p); if(!m) return; var have=String(row[m[1]]==null?'':row[m[1]]);
        if(m[2]==='eq' ? have===m[3] : new RegExp('^'+m[3].replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/_/g,'.')+'$','i').test(have)) any=true;}); if(!any) return false; continue;}
    if(k==='and'){ var conds=v.replace(/^\(|\)$/g,'').split(','); var all=true;   // and=(col.op.val,...), as PostgREST
      conds.forEach(function(c){ var mm=/^([a-z_]+)\.(eq|gte|lte|gt|lt)\.(.*)$/.exec(c); if(!mm) throw new Error('the fake database cannot answer and='+v);
        var one={}; one[mm[1]]=mm[2]+'.'+mm[3]; if(!match(row,one)) all=false; }); if(!all) return false; continue; }
    var m=/^(eq|neq|is|in|gte|lte|gt|lt|ilike|like)\.(.*)$/.exec(v); if(!m) throw new Error('the fake database cannot answer '+k+'='+v);
    /* A plain col=like.x* (28 Oct 2026). Until then it threw, and the help desk's once-only acknowledgement
       guard "passed" only because the throw was caught and read as "do not send": prove-checks found the
       guard could be deleted with every check still green. SQL LIKE, case-sensitive, through likeRx. */
    if(m[1]==='like'){ if(!(row[k]!=null && likeRx(m[2],false).test(String(row[k])))) return false; continue; }
    var have=row[k];
    if(m[1]==='in'){ var list=m[2].replace(/^\(|\)$/g,'').split(',').map(function(x){return x.replace(/^"|"$/g,'');}); if(list.indexOf(String(have))===-1) return false; continue; }
    if(m[1]==='gt'){ if(!(have!=null && String(have)>m[2])) return false; continue; }
    /* Timestamps compare as instants, not strings: the help desk sends +10:00 offsets and rows are Z. */
    if(m[1]==='gte'||m[1]==='lte'){ var a1=Date.parse(have), b1=Date.parse(m[2]); var cmp=(isFinite(a1)&&isFinite(b1))?(a1-b1):(String(have)<m[2]?-1:String(have)>m[2]?1:0);
      if(have==null || (m[1]==='gte'?cmp<0:cmp>0)) return false; continue; }
    if(m[1]==='lt'){ if(!(have!=null && String(have)<m[2])) return false; continue; }
    if(m[1]==='is'){ if(m[2]==='null' ? have!=null : String(have)!==m[2]) return false; continue; }
    if(m[1]==='ilike'){ var rx=new RegExp('^'+m[2].replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/_/g,'.')+'$','i'); if(!rx.test(String(have==null?'':have))) return false; continue; }
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
    var one=/\/auth\/v1\/admin\/users\/([0-9a-fA-F-]{36})/.exec(url); if(one){ var hit=tbl('auth').filter(function(u){return u.id===one[1]})[0]; return Promise.resolve(hit?resp(200,hit):resp(404,{msg:'not found'})); }
    return Promise.resolve(resp(200,{users:tbl('auth')}));}
  var m=/\/rest\/v1\/([a-zA-Z_\/]+)\??(.*)$/.exec(url); if(!m) return Promise.resolve(resp(404,{}));
  var t=m[1], q=parseQ(m[2]); var key=t+':'+method;
  if(FAIL[key]>0){FAIL[key]--;return Promise.resolve(resp(503,'upstream blip'));}
  if(t.indexOf('rpc/')===0) return Promise.resolve(resp(200,0));
  if(method==='GET'){var rows=tbl(t).filter(function(r){return match(r,q)});
    /* ORDER, the way PostgREST does it (added 19 Oct 2026 for the help desk, whose whole point is an order HQ
       sets): order=col.asc,col2.desc. Stable, nulls last. Without it an ordering test can neither pass nor fail. */
    if(q.order){ var keys=q.order.split(',').map(function(k){var p=k.split('.');return {c:p[0],d:p[1]==='desc'?-1:1};});
      rows=rows.map(function(r,i){return {r:r,i:i};}).sort(function(x,y){ for(var n=0;n<keys.length;n++){ var a=x.r[keys[n].c], b2=y.r[keys[n].c];
        if(a==null&&b2==null) continue; if(a==null) return 1; if(b2==null) return -1; if(a<b2) return -keys[n].d; if(a>b2) return keys[n].d; } return x.i-y.i; }).map(function(o){return o.r;}); }var off=parseInt(q.offset||'0',10);var lim=Math.min(parseInt(q.limit||'1000',10),1000);return Promise.resolve(resp(200,rows.slice(off,off+lim)));}
  /* vp_help_tickets.ticket_no is a database sequence live; the fake hands out the next one the same way
     (29 Oct 2026: a call logged in the rig showed "#undefined" in a venue's ticket list). */
  if(method==='POST'&&t==='vp_help_tickets'){var o0=JSON.parse(opts.body);if(o0&&!Array.isArray(o0)&&o0.ticket_no==null){o0.ticket_no=tbl(t).reduce(function(m,x){return Math.max(m,+x.ticket_no||1000)},1000)+1;opts=Object.assign({},opts,{body:JSON.stringify(o0)});}}
  if(method==='POST'){var o=JSON.parse(opts.body);o.id=o.id||newId();o.created_at=o.created_at||new Date().toISOString();tbl(t).push(o);return Promise.resolve(resp(201,[o]));}
  if(method==='PATCH'){var o2=JSON.parse(opts.body);tbl(t).filter(function(r){return match(r,q)}).forEach(function(r){for(var k in o2)r[k]=o2[k];});return Promise.resolve(resp(204,''));}
  if(method==='DELETE'){var gone=tbl(t).filter(function(r){return match(r,q)});DB[t]=tbl(t).filter(function(r){return gone.indexOf(r)===-1});return Promise.resolve(resp(200,gone));}
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
