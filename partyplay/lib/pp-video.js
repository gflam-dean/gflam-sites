/* A fifteen second video message, recorded in the browser.
 *
 * RECORDED, not picked from the camera roll. That is the whole design decision
 * and it is worth spelling out, because picking a file looks easier:
 *
 *   - A browser cannot transcode video. A picked clip arrives at whatever size
 *     the phone made it, which for 30 seconds of 4K is 200 MB, and no amount of
 *     hoping fixes that.
 *   - Recording lets us set the resolution and the bitrate up front, so a clip
 *     is about 8 MB before it exists rather than after.
 *   - Forty phones on one house wifi is the actual condition. 8 MB finishes.
 *     200 MB sits at 90% and the guest gives up on the whole product.
 *
 * And a message to the birthday girl is better at fifteen seconds anyway.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPVideo = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_SECONDS = 15;
  var TARGET_HEIGHT = 720;
  var VIDEO_BPS = 2500000;          // 2.5 Mbit: about 4.7 MB for fifteen seconds
  var AUDIO_BPS = 96000;
  var HARD_LIMIT = 25 * 1024 * 1024;

  function estimateBytes(seconds, videoBps, audioBps) {
    return Math.round(((videoBps || VIDEO_BPS) + (audioBps || AUDIO_BPS)) / 8 * (seconds || MAX_SECONDS));
  }

  /* Which container this browser will actually give us. Safari says mp4, most
     others say webm, and asking is the only way to know: a hardcoded mimeType
     that a browser does not support makes MediaRecorder throw on construction. */
  function pickMime(candidates) {
    var list = candidates || [
      'video/mp4;codecs=avc1',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ];
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < list.length; i++) {
      if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    }
    return '';
  }

  function constraints(facing) {
    return {
      audio: true,
      video: {
        facingMode: facing || 'user',
        width:  { ideal: Math.round(TARGET_HEIGHT * 16 / 9) },
        height: { ideal: TARGET_HEIGHT },
        frameRate: { ideal: 30, max: 30 }
      }
    };
  }

  function supported() {
    return typeof MediaRecorder !== 'undefined' &&
           typeof navigator !== 'undefined' &&
           !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
           !!pickMime();
  }

  function extFor(mime) {
    return String(mime || '').indexOf('mp4') >= 0 ? 'mp4' : 'webm';
  }

  /* Starts recording and resolves with the blob when it stops, whether that is
     the guest tapping stop or the fifteen seconds running out.
     onTick(secondsElapsed) drives the countdown. */
  function record(stream, onTick, onStop) {
    var mime = pickMime();
    var rec = new MediaRecorder(stream, mime ? {
      mimeType: mime, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS
    } : undefined);
    var chunks = [], t0 = Date.now(), timer = null, stopped = false;

    var done = new Promise(function (resolve, reject) {
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = function () { reject(new Error('The recording stopped unexpectedly.')); };
      rec.onstop = function () {
        clearInterval(timer);
        var blob = new Blob(chunks, { type: mime || 'video/webm' });
        if (blob.size > HARD_LIMIT) { reject(new Error('That clip came out too big to send.')); return; }
        resolve({ blob: blob, mime: mime || 'video/webm', ext: extFor(mime),
                  seconds: Math.round((Date.now() - t0) / 1000) });
      };
    });

    function stop() {
      if (stopped) return;
      stopped = true;
      try { rec.stop(); } catch (e) {}
      /* Let go of the camera. A page that keeps the light on after recording
         makes people close the whole thing and not come back. */
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      if (onStop) onStop();
    }

    rec.start(250);
    timer = setInterval(function () {
      var s = Math.floor((Date.now() - t0) / 1000);
      if (onTick) onTick(Math.min(s, MAX_SECONDS));
      if (s >= MAX_SECONDS) stop();
    }, 250);

    return { stop: stop, done: done, mime: mime };
  }

  function niceSeconds(s) {
    return (s || 0) + (s === 1 ? ' second' : ' seconds');
  }

  return {
    MAX_SECONDS: MAX_SECONDS, TARGET_HEIGHT: TARGET_HEIGHT,
    VIDEO_BPS: VIDEO_BPS, AUDIO_BPS: AUDIO_BPS, HARD_LIMIT: HARD_LIMIT,
    estimateBytes: estimateBytes, pickMime: pickMime, constraints: constraints,
    supported: supported, extFor: extFor, record: record, niceSeconds: niceSeconds
  };
}));
