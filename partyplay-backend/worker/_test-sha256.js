/* Compact SHA-256 + HMAC, only so the harness can forge a valid Stripe signature.
   Verified against Python hmac before any test relies on it. */
var SHA = (function(){
  var K=[];
  (function(){var n=2,i=0;function isP(x){for(var d=2;d*d<=x;d++)if(x%d===0)return false;return true;}
   while(i<64){if(isP(n)){K[i]=(Math.pow(n,1/3)%1*4294967296)|0;i++;}n++;}})();
  function rotr(x,n){return (x>>>n)|(x<<(32-n));}
  function sha256(bytes){
    var H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var l=bytes.length, bitLen=l*8;
    var withPad=bytes.slice(); withPad.push(0x80);
    while(withPad.length%64!==56) withPad.push(0);
    for(var i=7;i>=0;i--) withPad.push((bitLen/Math.pow(2,8*i))&0xff);
    var w=new Array(64);
    for(var off=0;off<withPad.length;off+=64){
      for(var t=0;t<16;t++) w[t]=(withPad[off+4*t]<<24)|(withPad[off+4*t+1]<<16)|(withPad[off+4*t+2]<<8)|withPad[off+4*t+3];
      for(t=16;t<64;t++){
        var s0=rotr(w[t-15],7)^rotr(w[t-15],18)^(w[t-15]>>>3);
        var s1=rotr(w[t-2],17)^rotr(w[t-2],19)^(w[t-2]>>>10);
        w[t]=(w[t-16]+s0+w[t-7]+s1)|0;
      }
      var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for(t=0;t<64;t++){
        var S1=rotr(e,6)^rotr(e,11)^rotr(e,25), ch=(e&f)^(~e&g);
        var t1=(h+S1+ch+K[t]+w[t])|0;
        var S0=rotr(a,2)^rotr(a,13)^rotr(a,22), maj=(a&b)^(a&c)^(b&c);
        var t2=(S0+maj)|0;
        h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
      }
      H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;
      H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
    }
    var out=[];
    for(i=0;i<8;i++){out.push((H[i]>>>24)&0xff,(H[i]>>>16)&0xff,(H[i]>>>8)&0xff,H[i]&0xff);}
    return out;
  }
  function utf8(s){var o=[];for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);
    if(c<128)o.push(c);else if(c<2048){o.push(192|(c>>6),128|(c&63));}
    else{o.push(224|(c>>12),128|((c>>6)&63),128|(c&63));}}return o;}
  function hmac(keyStr,msgStr){
    var key=utf8(keyStr);
    if(key.length>64) key=sha256(key);
    while(key.length<64) key.push(0);
    var o=[],inr=[];
    for(var i=0;i<64;i++){o.push(key[i]^0x5c);inr.push(key[i]^0x36);}
    var inner=sha256(inr.concat(utf8(msgStr)));
    return sha256(o.concat(inner));
  }
  function hex(b){return b.map(function(x){return ('0'+x.toString(16)).slice(-2);}).join('');}
  return {sha256:sha256,hmac:hmac,hex:hex,utf8:utf8};
})();
