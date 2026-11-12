/* MUSICAL BINGO CLIPS FADE IN AND OUT (INBOX 260, Dean 11 Nov 2026), RUN, not read.

   /app/vp-fade.js, the one copy the TV (app/musical/screen.html) and the console (host.html) load:
     - every clip fades IN over 1.5 s and OUT over its last 2.5 s, on the clip's own clock
     - Next or Pause mid-clip fades out in half a second, then switches or pauses
     - the level SCALES the Room volume slider (gain = slider x level), never overrides it
     - a new clip always starts from 0 and is never left at 0 by the last one
     - a clip shorter than its fades still rises, peaks and falls
   On a fake clock and a fake <audio>, then the two pages' own glue lifted out and run.

   Run: jsc tools/test-vp-fade.js   (from the repo root) */
var bad = 0, ran = 0;
function pass(n, c, why){ ran++; print((c ? "  ok   " : "  FAIL ") + n + (c || why === undefined ? "" : "   saw: " + why)); if(!c) bad++; }
function near(a, b, e){ return Math.abs(a - b) <= (e === undefined ? 0.002 : e); }
var window = {};
eval(readFile("venueplay/app/vp-fade.js"));
var F = window.VPFade;
var HOST = readFile("venueplay/app/musical/host.html");
var SCREEN = readFile("venueplay/app/musical/screen.html");

// ---- a fake clock and a fake <audio> --------------------------------------------------------------
function Clock(){
  var c = { t: 0, timers: [], seq: 0 };
  c.now = function(){ return c.t; };
  c.setTimeout = function(f, ms){ var id = ++c.seq; c.timers.push({ id: id, at: c.t + ms / 1000, f: f, every: 0 }); return id; };
  c.setInterval = function(f, ms){ var id = ++c.seq; c.timers.push({ id: id, at: c.t + ms / 1000, f: f, every: ms / 1000 }); return id; };
  c.clearTimeout = c.clearInterval = function(id){ c.timers = c.timers.filter(function(x){ return x.id !== id; }); };
  c.advance = function(secs, el){   // move the clock (and a playing clip's own clock) on, running timers in order
    var end = c.t + secs;
    for(;;){
      var due = null;
      c.timers.forEach(function(x){ if(x.at <= end + 1e-9 && (!due || x.at < due.at)) due = x; });
      if(!due) break;
      if(el && !el.paused) el.currentTime = Math.min(el.duration || 1e9, el.currentTime + (due.at - c.t));
      c.t = due.at;
      if(due.every) due.at += due.every; else c.timers = c.timers.filter(function(x){ return x !== due; });
      due.f();
    }
    if(el && !el.paused) el.currentTime = Math.min(el.duration || 1e9, el.currentTime + (end - c.t));
    c.t = end;
  };
  c.ticking = function(){ return c.timers.some(function(x){ return x.every > 0; }); };
  return c;
}
function Audio(dur){
  var a = { paused: true, ended: false, muted: false, currentTime: 0, duration: dur, src: "", volume: 1, L: {} };
  a.getAttribute = function(k){ return k === "src" ? (a.src || null) : null; };
  a.addEventListener = function(ev, f){ (a.L[ev] = a.L[ev] || []).push(f); };
  a.fire = function(ev){ (a.L[ev] || []).forEach(function(f){ f(); }); };
  a.play = function(){ var was = a.paused; a.paused = false; if(was) a.fire("play"); return { then: function(f){ return { "catch": function(){} }; }, "catch": function(){} }; };
  a.pause = function(){ a.paused = true; a.fire("pause"); };
  return a;
}
function rig(dur, slider){
  var c = Clock(), el = Audio(dur), out = { level: -1, slider: slider === undefined ? 1 : slider };
  var f = F.create({ el: el, now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, setInterval: c.setInterval, clearInterval: c.clearInterval,
                     apply: function(lv){ out.level = lv; out.gain = out.slider * lv; } });
  return { c: c, el: el, f: f, out: out,
           play: function(src){ el.src = src || "clip.m4a"; el.currentTime = 0; el.ended = false; f.start(); el.play(); },
           at: function(t){ c.advance(t - el.currentTime, el); f._tick(); return out.level; } };   // sample exactly at t (the page itself samples every 40 ms)
}

print("\n1. THE ENVELOPE OF A 30 SECOND CLIP (1.5 s in, 2.5 s out)");
pass("t=0: silent", F.envelope(0, 30) === 0, F.envelope(0, 30));
pass("t=0.75: on the way up, a quarter (the square of half: an even rise to the ear)", near(F.envelope(0.75, 30), 0.25), F.envelope(0.75, 30));
pass("t=1.5: full", F.envelope(1.5, 30) === 1, F.envelope(1.5, 30));
pass("t=15 (the middle): full", F.envelope(15, 30) === 1, F.envelope(15, 30));
pass("t=27.5 (end minus 2.5): still full, the fade out starts here", F.envelope(27.5, 30) === 1, F.envelope(27.5, 30));
pass("t=27 (end minus 3): full", F.envelope(27, 30) === 1, F.envelope(27, 30));
pass("t=28.75 (half way down): a quarter", near(F.envelope(28.75, 30), 0.25), F.envelope(28.75, 30));
pass("t=28.5 (end minus 1.5): on the way down, below full", F.envelope(28.5, 30) > 0.3 && F.envelope(28.5, 30) < 0.5, F.envelope(28.5, 30));
pass("t=30 (the end): silent", F.envelope(30, 30) === 0, F.envelope(30, 30));
pass("rises all the way up: every 0.1 s louder than the last", (function(){ for(var t = 0.1; t <= 1.5; t += 0.1) if(!(F.envelope(t, 30) > F.envelope(t - 0.1, 30))) return false; return true; })());
pass("falls all the way down: every 0.1 s quieter than the last", (function(){ for(var t = 27.6; t <= 30; t += 0.1) if(!(F.envelope(t, 30) < F.envelope(t - 0.1, 30))) return false; return true; })());
pass("a length the browser does not know yet is the 30 s preview", F.envelope(15, NaN) === 1 && F.envelope(28.75, NaN) === F.envelope(28.75, 30) && F.envelope(1, Infinity) === F.envelope(1, 30));
pass("never below 0 or above 1, before the start or past the end", F.envelope(-3, 30) === 0 && F.envelope(31, 30) === 0 && F.envelope(10, 30) <= 1);

print("\n2. A CLIP SHORTER THAN ITS FADES still rises, peaks and falls");
(function(){
  var d = 3, peak = 0, at = 0;
  for(var t = 0; t <= d; t += 0.01){ var v = F.envelope(t, d); if(v > peak){ peak = v; at = t; } }
  pass("a 3 s clip reaches full", near(peak, 1, 0.01), peak);
  pass("and both fades fit inside it (80% of it), so there is a moment at full", F.envelope(d * 0.8 * 1.5 / 4 + 0.01, d) === 1, F.envelope(d * 0.8 * 1.5 / 4 + 0.01, d));
  pass("starts silent and ends silent", F.envelope(0, d) === 0 && F.envelope(d, d) === 0);
  pass("a 0.5 s clip is not silent all the way through", F.envelope(0.25, 0.5) > 0.5, F.envelope(0.25, 0.5));
})();

print("\n3. A REAL CLIP ON THE FAKE CLOCK");
(function(){
  var r = rig(30);
  r.play();
  pass("at the start the level put on the audio is 0 (reset at clip start)", r.out.level === 0, r.out.level);
  pass("the fade keeps itself ticking while the clip plays", r.c.ticking());
  pass("t=0.75: a quarter", near(r.at(0.75), 0.25, 0.01), r.out.level);
  pass("t=1.5: full", near(r.at(1.5), 1, 0.001), r.out.level);
  pass("the middle: full", r.at(15) === 1, r.out.level);
  pass("end minus 3: full", r.at(27) === 1, r.out.level);
  pass("end minus 1.5: on the way down", (function(v){ return v > 0.3 && v < 0.5; })(r.at(28.5)), r.out.level);
  r.at(30); r.el.paused = true; r.el.ended = true; r.c.advance(0.1);
  pass("the end: 0", r.out.level === 0, r.out.level);
  pass("and stops ticking when the clip has ended", !r.c.ticking());
})();

print("\n4. NEXT MID-CLIP: half a second out, then the next clip from 0");
(function(){
  var r = rig(30), switched = 0;
  r.play("a.m4a"); r.at(10);
  var t0 = r.c.t;
  r.f.out(function(){ switched++; r.play("b.m4a"); }, "switch");
  pass("the switch waits for the fade (it is pending)", r.f.pending() === "switch" && switched === 0, r.f.pending());
  r.c.advance(0.25, r.el);
  pass("a quarter second in: on the way down (between 0 and full)", r.out.level > 0 && r.out.level < 1, r.out.level);
  r.c.advance(0.15, r.el);
  pass("still the old clip at 0.4 s", switched === 0 && r.el.src === "a.m4a");
  r.c.advance(0.2, r.el);
  pass("by 0.6 s the next clip is on", switched === 1 && r.el.src === "b.m4a", [switched, r.el.src]);
  pass("and it starts from 0: never full level at its first sample", r.out.level === 0 || r.el.currentTime > 0 && r.out.level < 0.05, r.out.level);
  pass("it fades in like any clip (t=1.5: full, the quick fade does not stick)", near(r.at(1.5), 1, 0.001), r.out.level);
  pass("the fade took about half a second, not a cut and not a long fade", near(r.c.t - t0, 0.5 + 1.5, 0.11), r.c.t - t0);
})();
(function(){
  var r = rig(30), n = 0;
  r.play("a.m4a"); r.at(0.75);
  var before = r.out.level;
  r.f.out(function(){ n++; r.play("b.m4a"); }, "switch");
  r.c.advance(0.1, r.el);
  pass("Next during the fade-in: the level goes down from where it was, never jumps up to full", r.out.level < before + 0.1 && r.out.level < 0.6, [before, r.out.level]);
  r.c.advance(0.5, r.el);
  pass("and the next clip lands", n === 1 && r.el.src === "b.m4a");
})();
(function(){
  var r = rig(30), got = [];
  r.play("a.m4a"); r.at(5);
  r.f.out(function(){ got.push("b"); r.play("b.m4a"); }, "switch");
  r.c.advance(0.2, r.el);
  r.f.out(function(){ got.push("c"); r.play("c.m4a"); }, "switch");
  r.c.advance(0.6, r.el);
  pass("Next twice inside the half second: only the last song lands, once", got.join() === "c" && r.el.src === "c.m4a", got.join());
})();
(function(){
  var r = rig(30), n = 0;
  r.play("a.m4a"); r.at(5); r.el.pause();
  r.f.out(function(){ n++; }, "switch");
  pass("a clip nobody hears (paused) switches at once, inside the host's own tap", n === 1 && r.f.pending() === "");
  var m = rig(30), k = 0; m.play(); m.at(5); m.el.muted = true;
  m.f.out(function(){ k++; }, "switch");
  pass("so does a muted one (the console when the TV is the sound)", k === 1);
  var e = rig(30), j = 0; e.el.src = "";
  e.f.out(function(){ j++; }, "switch");
  pass("and the first song of the night (no clip yet)", j === 1);
})();

print("\n5. PAUSE, THEN PLAY");
(function(){
  var r = rig(30);
  r.play(); r.at(10);
  r.f.out(function(){ r.el.pause(); }, "pause");
  r.c.advance(0.25, r.el);
  pass("Pause: on the way down at 0.25 s, still playing", r.out.level > 0 && r.out.level < 1 && !r.el.paused, [r.out.level, r.el.paused]);
  r.c.advance(0.35, r.el);
  pass("paused by 0.6 s, at 0", r.el.paused && r.out.level === 0, [r.el.paused, r.out.level]);
  var t = r.el.currentTime;
  r.c.advance(5);
  pass("the clip's place holds while paused", r.el.currentTime === t);
  r.f.resume(); r.el.play();
  r.c.advance(0.25, r.el);
  pass("Play: back up over half a second (between 0 and full at 0.25 s)", r.out.level > 0 && r.out.level < 1, r.out.level);
  r.c.advance(0.35, r.el);
  pass("full again by 0.6 s", r.out.level === 1, r.out.level);
})();
(function(){
  var r = rig(30);
  r.play(); r.at(10);
  r.f.out(function(){ r.el.pause(); }, "pause");
  r.c.advance(0.2, r.el);
  r.f.resume();
  r.c.advance(1, r.el);
  pass("Play inside the Pause's half second: the pause is dropped, the clip plays on at full", !r.el.paused && r.out.level === 1, [r.el.paused, r.out.level]);
})();
(function(){
  var r = rig(30);
  r.play(); r.at(10);
  r.f.out(function(){ r.el.pause(); }, "pause");
  r.c.advance(0.6, r.el);
  r.el.play();   // a claim's Play on, a click to turn the sound on: straight at the element
  r.c.advance(0.6, r.el);
  pass("anything that plays the element straight (a claim's Play on) never plays it at 0", r.out.level === 1, r.out.level);
})();
(function(){
  var r = rig(30), n = 0;
  r.play("a.m4a"); r.at(8);
  r.f.out(function(){ n++; r.play("b.m4a"); }, "switch");
  pass("Pause during Next's half second does not cancel the next song", r.f.out(function(){ r.el.pause(); }, "pause") === false && r.f.pending() === "switch");
  pass("nor does Play", r.f.resume() === false && r.f.pending() === "switch");
  pass("the console can land it at once (flush)", r.f.flush() === true && n === 1 && r.el.src === "b.m4a");
})();

print("\n6. THE ROOM VOLUME SLIDER IS SCALED, NEVER OVERRIDDEN");
(function(){
  var r = rig(30, 0.4);
  r.play();
  r.at(0.75);
  pass("slider at 40%: a quarter of the way in, the room gets 40% x 0.25", near(r.out.gain, 0.1, 0.005), r.out.gain);
  r.at(15);
  pass("slider at 40%: the middle is 40%, not 100%", near(r.out.gain, 0.4, 0.0001), r.out.gain);
  r.out.slider = 2.4; r.f._tick();
  pass("the slider moved to 240% mid-clip: 240%, the fade does not hold it down", near(r.out.gain, 2.4, 0.0001), r.out.gain);
})();

print("\n7. RESET AT THE NEXT CLIP'S START, AND STOP");
(function(){
  var r = rig(30);
  r.play("a.m4a"); r.at(10);
  r.f.out(function(){ r.el.pause(); }, "pause"); r.c.advance(0.6, r.el);
  pass("paused at 0", r.out.level === 0);
  r.play("b.m4a");
  pass("the next clip starts with the quick fade gone (only its own fade-in holds it at 0)", near(r.at(1.5), 1, 0.001), r.out.level);
  r.f.out(function(){ r.el.pause(); }, "pause"); r.c.advance(0.2, r.el);
  r.f.stop();
  r.c.advance(1, r.el);
  pass("stop (end of game, a win): the waiting pause is dropped", !r.el.paused && r.f.pending() === "", r.f.pending());
  pass("and nothing left ticking", !r.c.ticking());
  r.play("c.m4a");
  pass("after a stop the next clip fades in normally", near(r.at(1.5), 1, 0.001), r.out.level);
})();

print("\n8. THE TV'S OWN GLUE (screen.html), lifted out and run");
(function(){
  function grab(name, src){
    var i = src.indexOf("function " + name + "("); if(i < 0) throw new Error("cannot find " + name);
    var d = 0, st = false;
    for(var j = i; j < src.length; j++){ if(src[j] === "{"){ d++; st = true; } else if(src[j] === "}"){ d--; if(st && d === 0) return src.slice(i, j + 1); } }
    throw new Error("unclosed " + name);
  }
  pass("the TV loads /app/vp-fade.js before its own script", /<script src="\/app\/vp-fade\.js"><\/script>/.test(SCREEN) && SCREEN.indexOf('/app/vp-fade.js') < SCREEN.indexOf("function applyFade("));
  pass("the console loads it too", /<script src="\/app\/vp-fade\.js"><\/script>/.test(HOST) && HOST.indexOf('/app/vp-fade.js') < HOST.indexOf("function hostApplyFade("));
  var c = Clock(), el = Audio(30), gainNode = { gain: { value: 0 } };
  var api = new Function("clipAudio", "VPFade", "c", "gainNode",
    "var _boostNode=null, _boost=2.4, _hostPaused=false, played=[];\n" +
    grab("applyFade", SCREEN) + "\n" + grab("setBoost", SCREEN) + "\n" +
    "var _clipFade=VPFade.create({ el:clipAudio, apply:applyFade, now:c.now, setTimeout:c.setTimeout, clearTimeout:c.clearTimeout, setInterval:c.setInterval, clearInterval:c.clearInterval });\n" +
    grab("fadeLevel", SCREEN) + "\n" +
    "function startClip(url){ clipAudio.src=url; clipAudio.currentTime=0; _clipFade.start(); if(_hostPaused) return; clipAudio.play(); played.push(url); }\n" +
    grab("playClip", SCREEN).replace(/\n/g, "\n") + "\n" +
    "return { playClip: playClip, setBoost: setBoost, graph: function(){ _boostNode=gainNode; applyFade(fadeLevel()); }, pause: function(){ _hostPaused=true; _clipFade.out(function(){ clipAudio.pause(); }, 'pause'); }, f: _clipFade, played: played };"
  )(el, F, c, gainNode);
  api.playClip("a.m4a");
  pass("TV, before the boost graph exists: the fade is on the element's own volume (0 at the start)", el.volume === 0, el.volume);
  c.advance(0.75, el);
  pass("TV, element volume a quarter at 0.75 s", near(el.volume, 0.25, 0.02), el.volume);
  api.graph();
  /* INBOX 282.7 (12 Nov 2026): the fade STAYS on the element once the graph is built, and the gain is the Room volume
     only. A Tizen TV plays the element straight out of its own player, so a fade on the gain was never heard there. */
  pass("TV, once the graph is built: the fade stays on the element (0 to 1) and the gain is the Room volume only", near(el.volume, F.envelope(el.currentTime, 30), 0.01) && el.volume <= 1 && near(gainNode.gain.value, 2.4, 0.0001), [el.volume, gainNode.gain.value]);
  c.advance(5, el);
  pass("TV, the middle: gain = Room volume (240%)", near(gainNode.gain.value, 2.4, 0.0001), gainNode.gain.value);
  api.setBoost(1.0);
  pass("TV, the host turns the room down to 100% mid-clip: gain 1.0, the fade does not override it", near(gainNode.gain.value, 1.0, 0.0001), gainNode.gain.value);
  api.setBoost(2.4);
  api.playClip("b.m4a");
  pass("TV, Next mid-clip: the old clip is still on for the half second", el.src === "a.m4a" && api.played.join() === "a.m4a");
  c.advance(0.6, el);
  pass("TV, then the next clip, from 0 on the element (the gain stays the Room volume)", el.src === "b.m4a" && api.played.join() === "a.m4a,b.m4a" && el.volume < 0.2 && near(gainNode.gain.value, 2.4, 0.0001), [el.src, el.volume, gainNode.gain.value]);
  c.advance(3, el);
  api.playClip("c.m4a"); api.pause();
  c.advance(0.6, el);
  pass("TV, Pause during Next's half second: the next song lands, loaded and waiting, not playing", el.src === "c.m4a" && api.played.join() === "a.m4a,b.m4a", [el.src, api.played.join()]);
})();

print("\n9. THE CONSOLE'S OWN GLUE (host.html), lifted out and run");
(function(){
  function grab(name, src){
    var i = src.indexOf("function " + name + "("); if(i < 0) throw new Error("cannot find " + name);
    var d = 0, st = false;
    for(var j = i; j < src.length; j++){ if(src[j] === "{"){ d++; st = true; } else if(src[j] === "}"){ d--; if(st && d === 0) return src.slice(i, j + 1); } }
    throw new Error("unclosed " + name);
  }
  var c = Clock(), el = Audio(30), gainNode = { gain: { value: 0 } }, sent = [];
  var api = new Function("audio", "VPFade", "c", "gainNode", "sent",
    "var _hgain=null, _hboost=2.4, lbl={textContent:''};\n" +
    "function $(id){ return lbl; } var localStorage={ setItem:function(){} }; function bcast(m){ sent.push(m); }\n" +
    grab("hostApplyFade", HOST) + "\n" + grab("setRoomVolume", HOST) + "\n" +
    "var _hostFade=VPFade.create({ el:audio, apply:hostApplyFade, now:c.now, setTimeout:c.setTimeout, clearTimeout:c.clearTimeout, setInterval:c.setInterval, clearInterval:c.clearInterval });\n" +
    grab("hostFadeLevel", HOST) + "\n" +
    "return { lbl: lbl, vol: setRoomVolume, graph: function(){ _hgain=gainNode; hostApplyFade(hostFadeLevel()); }, f: _hostFade };"
  )(el, F, c, gainNode, sent);
  el.src = "a.m4a"; el.currentTime = 0; api.f.start(); el.play();
  pass("console, before the graph: the fade is on the element (0 at the start)", el.volume === 0, el.volume);
  c.advance(5, el); api.graph();
  pass("console, once the graph is built: element 1, gain = Room volume (240%) in the middle", el.volume === 1 && near(gainNode.gain.value, 2.4, 0.0001), [el.volume, gainNode.gain.value]);
  api.vol(150);
  pass("console, the slider to 150% mid-clip: gain 1.5, and the TV is told 1.5", near(gainNode.gain.value, 1.5, 0.0001) && sent[sent.length - 1].level === 1.5, [gainNode.gain.value, JSON.stringify(sent)]);
  api.f.out(function(){ el.pause(); }, "pause"); c.advance(0.25, el); api.f._tick();
  pass("console, Pause: the gain falls from 150% (scaled, the slider is the ceiling)", gainNode.gain.value > 0 && gainNode.gain.value < 1.5, gainNode.gain.value);
  c.advance(0.4, el);
  pass("console, paused at 0 (and the slider is still 150%)", el.paused && gainNode.gain.value === 0 && api.lbl.textContent === "150%", [el.paused, gainNode.gain.value, api.lbl.textContent]);
})();

print("\n" + (ran - bad) + " of " + ran + " checks passed");
if(bad) throw new Error(bad + " failed");
