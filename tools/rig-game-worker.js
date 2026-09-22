/* A RIG, not a test. Built by the audit of 20 Sep 2026 and kept because it found six faults the
   day it was written. load() it from a test.

   Shared harness: loads the REAL shipped venueplay-game.js into jsc and swaps only the
   network (fetch) for a fake PostgREST that honours eq/neq/in/is/gt/or-(eq|like|ilike)/order/limit/offset and
   enforces max-rows 1000. RPC calls answer 404 so the Worker's own JS fallback paths run. */
var SRC = readFile('venueplay-backend/worker/venueplay-game.js');   // run from the repo root, like every other gate test
SRC = SRC.replace(/export default \{/, 'var __worker = {').replace(/export class /g, 'class ');
var MAX_ROWS = 1000;
var DB = {}, LOG = [], NOWMS = Date.parse('2026-09-19T09:30:00.000Z');
var _D = Date;
function FD(v){ return arguments.length ? new _D(v) : new _D(NOWMS); }
FD.now = function(){ return NOWMS; }; FD.parse = _D.parse; FD.UTC = _D.UTC; FD.prototype = _D.prototype;
Date = FD;
var console = { log:function(){}, warn:function(){}, error:function(){} };
var _seed = 12345;
function prng(){ _seed = (Math.imul(_seed, 1664525) + 1013904223) >>> 0; return _seed; }
globalThis.crypto = { getRandomValues:function(b){ for(var i=0;i<b.length;i++) b[i] = (b instanceof Uint32Array) ? prng() : (prng() & 255); return b; },
                      subtle:{ digest: async function(){ return new ArrayBuffer(32); } } };
function TextEncoder(){} TextEncoder.prototype.encode = function(s){ return new Uint8Array(0); };
function setTimeout(f){ return 0; } function clearTimeout(){}
function URL(u){ this.href=u; var q=u.indexOf('?'); this.pathname=(q<0?u:u.slice(0,q)).replace(/^https?:\/\/[^\/]+/,''); var sp={}; if(q>=0) u.slice(q+1).split('&').forEach(function(p){ var i=p.indexOf('='); sp[decodeURIComponent(p.slice(0,i))]=decodeURIComponent(p.slice(i+1)); }); this.searchParams={ get:function(k){ return sp[k]==null?null:sp[k]; } }; }

function cmp(a,b){ if(a===b) return 0; if(a==null) return 1; if(b==null) return -1; return a>b?1:-1; }
function query(table, qs){
  var out = (DB[table]||[]).slice(), order=null, limit=null, offset=0;
  qs.split('&').forEach(function(part){
    if(!part) return;
    var i=part.indexOf('='), k=part.slice(0,i), v=part.slice(i+1);
    if(k==='select'||k==='on_conflict') return;
    if(k==='order'){ order=v; return; } if(k==='limit'){ limit=+v; return; } if(k==='offset'){ offset=+v; return; }
    if(v.indexOf('eq.')===0){ var val=decodeURIComponent(v.slice(3)); out=out.filter(function(r){ return String(r[k])===val; }); }
    else if(v.indexOf('in.(')===0){ var l=v.slice(4,-1).split(',').map(decodeURIComponent); out=out.filter(function(r){ return l.indexOf(String(r[k]))>=0; }); }
    else if(v.indexOf('neq.')===0){ var nv=decodeURIComponent(v.slice(4)); out=out.filter(function(r){ return String(r[k])!==nv; }); }
    else if(v==='is.null'){ out=out.filter(function(r){ return r[k]==null; }); }
    else if(v==='is.true'){ out=out.filter(function(r){ return r[k]===true; }); }
    else if(k==='or'){ var alts=decodeURIComponent(v).replace(/^\(|\)$/g,'').split(','); out=out.filter(function(r){ return alts.some(function(a){ var m=/^([^.]+)\.(ilike|like|eq)\.(.*)$/.exec(a); if(!m) throw new Error('fake PostgREST cannot answer or-clause "'+a+'"'); var val=String(r[m[1]]==null?'':r[m[1]]); if(m[2]==='eq') return val===m[3]; var re=new RegExp('^'+m[3].replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')+'$', m[2]==='ilike'?'i':''); return re.test(val); }); }); }
    else if(v.indexOf('gt.')===0){ var g=decodeURIComponent(v.slice(3)); out=out.filter(function(r){ return r[k]!=null && (isNaN(+g)? String(r[k])>g : +r[k]>+g); }); }
    else throw new Error('fake PostgREST cannot answer "'+part+'" on '+table);
  });
  if(order){ var keys=order.split(',').map(function(o){ var p=o.split('.'); return {k:p[0],d:p[1]==='desc'?-1:1}; });
    out.sort(function(a,b){ for(var i=0;i<keys.length;i++){ var c=cmp(a[keys[i].k],b[keys[i].k])*keys[i].d; if(c) return c; } return 0; }); }
  out = out.slice(offset);
  var cap = (limit==null) ? MAX_ROWS : Math.min(limit, MAX_ROWS);   // max-rows is enforced whatever the caller asks
  return out.slice(0, cap);
}
var _id=0;
function resp(status, body, headers){ return { ok: status>=200&&status<300, status: status, json: async function(){ return body; }, text: async function(){ return JSON.stringify(body); }, headers:{ get:function(h){ return (headers||{})[h.toLowerCase()]||null; } } }; }
async function fetch(url, opts){
  opts = opts||{}; var m=(opts.method||'GET').toUpperCase();
  var u = String(url), i=u.indexOf('/rest/v1/'); if(i<0) throw new Error('unexpected fetch '+u);
  var rest=u.slice(i+9), q=rest.indexOf('?'), table=q<0?rest:rest.slice(0,q), qs=q<0?'':rest.slice(q+1);
  LOG.push(m+' '+table+(qs?'?'+qs:''));
  if(table.indexOf('rpc/')===0) return resp(404, {message:'no function'});
  if(m==='GET') return resp(200, query(table, qs));
  if(m==='HEAD') return resp(200, null, {'content-range':'0-0/'+query(table, qs.replace(/&limit=\d+/,'')+'&limit=100000000').length});
  if(m==='POST'){ var body=JSON.parse(opts.body); var rows=Array.isArray(body)?body:[body]; DB[table]=DB[table]||[];
    if(table==='vp_trivia_answers'){ var ign=/ignore-duplicates/.test((opts.headers&&opts.headers.Prefer)||''); var keep=[];
      for(var z=0;z<rows.length;z++){ var r0=rows[z]; var clash=DB[table].some(function(x){ return x.game_id===r0.game_id&&x.question_id===r0.question_id&&x.player_id===r0.player_id; });
        if(clash){ if(ign) continue; return resp(409,{message:'duplicate'}); } keep.push(r0); } rows=keep; }
    rows.forEach(function(r){ if(table==='vp_trivia_answers'){ if(r.is_correct===undefined) r.is_correct=null; if(r.points_awarded===undefined) r.points_awarded=null; } if(!r.id) r.id='99999999-9999-4999-8999-'+('000000000000'+(++_id)).slice(-12); if(table==='vp_raffle_results'||table==='vp_member_draw_results'){ if(!r.drawn_at) r.drawn_at=new Date(NOWMS).toISOString(); } DB[table].push(r); });
    return resp(201, rows); }
  if(m==='PATCH'){ var obj=JSON.parse(opts.body); var hit=query(table, qs+'&limit=100000000'); var all=DB[table]||[];
    // query() caps at MAX_ROWS for reads; a PATCH is not capped, so match by identity over the whole table
    var ids=(function(){ var o=(DB[table]||[]).slice(); return o; })();
    var matched=[]; var save=MAX_ROWS; MAX_ROWS=1e9; matched=query(table, qs); MAX_ROWS=save;
    matched.forEach(function(r){ Object.keys(obj).forEach(function(k){ r[k]=obj[k]; }); });
    return resp(200, matched); }
  if(m==='DELETE'){ var save2=MAX_ROWS; MAX_ROWS=1e9; var gone=query(table, qs); MAX_ROWS=save2; DB[table]=(DB[table]||[]).filter(function(r){ return gone.indexOf(r)<0; }); return resp(204, null); }
  throw new Error('method '+m);
}
SRC += '\n;globalThis.__VenueRoom = VenueRoom;';
function Response(body, init){ this._b=body; this.status=(init&&init.status)||200; this.ok=this.status>=200&&this.status<300; }
Response.prototype.json=async function(){ return JSON.parse(this._b); };
(0, eval)(SRC);
var HOST='11111111-1111-4111-8111-111111111111', VENUE='22222222-2222-4222-8222-222222222222';
var ENV={ SUPABASE_URL:'https://fake.supabase.co', SUPABASE_SERVICE_KEY:'x', IP_HASH_SALT:'s' };
var BODY={};
verifyHostJwt = async function(){ return HOST; };
readJson = async function(){ return BODY; };
requireStaff = async function(env, uid, venueId){ return { id:'staff-1', role:'owner', venue_id: venueId, auth_user_id: uid }; };
emitEvent = async function(env, session, type, payload){ LOG.push('EVENT '+type); (DB.__events=DB.__events||[]).push({type:type,payload:payload}); };
function json(o, status){ return { status: status||200, body:o }; }
var ran=0, bad=0;
function show(n, c, extra){ ran++; print((c?'  ok   ':'  FAIL ')+n+(extra?'   -> '+extra:'')); if(!c) bad++; }
