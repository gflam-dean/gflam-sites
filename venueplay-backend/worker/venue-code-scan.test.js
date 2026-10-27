/* THE HOT PATH MUST NOT READ EVERY VENUE.
   On 8 Sep a ramp at 50 requests a second measured p50 413ms and p95 ELEVEN
   SECONDS against production, with zero errors. venueByCode built a map of the
   whole vp_venues table before answering, and a Cloudflare isolate starts with
   that map empty, so every fresh isolate full-scanned the table first. The cost
   also grows with every venue signed, which is the wrong direction for the path
   a television takes. Counting the scans is the only way to see it from here. */
function find(rel){var t=[rel,'../'+rel,'../../'+rel];for(var i=0;i<t.length;i++){try{var x=readFile(t[i]);if(x&&x.length>5000)return x;}catch(e){}}throw new Error('cannot open '+rel);}
var src=find('venueplay-backend/worker/venueplay-game.js');
function lift(n){var i=src.indexOf('async function '+n+'(');if(i<0)i=src.indexOf('function '+n+'(');if(i<0)throw new Error('missing '+n);var d=0,k=src.indexOf('{',i);do{if(src[k]==='{')d++;else if(src[k]==='}')d--;k++;}while(d>0);return src.slice(i,k)+'\n';}
var console={log:function(){}};
var _vcMap=null,_vcAt=0,_vcDupes=[],AMBIGUOUS="__two_venues__";
var scans=0, points=0;
var DB=[{id:'v1',slug:'the-average-joe',join_code:'3A7TES'}];
var sbGetAll=function(){ scans++; return Promise.resolve(DB); };
var enc=encodeURIComponent;
var sbGet=function(e,t,q){ points++; var m=/join_code=eq\.([A-Z0-9]+)/.exec(q);
  return Promise.resolve(DB.filter(function(r){return r.join_code===(m&&m[1]);})); };
eval(lift('fnvVenueCode')+lift('refreshVenueCodes')+lift('venueByCode'));
venueByCode({}, '3A7TES').then(function(h){
  print('  lookup returned: ' + (h||'nothing'));
  print('  full table scans (sbGetAll): ' + scans + (scans===0?'   <- the 11-second path is gone':'   <- STILL SCANNING'));
  print('  single-row reads (sbGet):    ' + points);
  if (h!=='v1') throw new Error('lookup broke');
  if (scans!==0) throw new Error('still scanning the whole table on the hot path');
  print('\n  now a code that is NOT stored, which must still find a legacy venue:');
  scans=0; points=0; _vcMap=null; _vcAt=0;
  DB=[{id:'v2',slug:'old-pub',join_code:null}];
  return venueByCode({}, fnvVenueCode('old-pub'));
}).then(function(h){
  print('  legacy lookup returned: ' + (h||'nothing'));
  print('  scans on the fallback: ' + scans + '  (one is correct - that path still needs the map)');
  if(h!=='v2') throw new Error('a pre-migration venue can no longer be reached');
  print('\nALL 4 CHECKS PASSED');
}).catch(function(e){ print('FAILED: '+e); });
