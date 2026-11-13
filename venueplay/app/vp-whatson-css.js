/* vp-whatson-css.js  -- THE LOOK OF THE WHAT'S ON WALL, ONE COPY FOR THE TV AND THE EDITOR'S PREVIEW (13 Nov 2026).

   The TV (tv.html) draws the venue's nights, and so does the preview under the editor on the account page, and they must
   be the same card: the same fonts, the same widths, the same fit. So the rules live HERE, once, and this file puts them in
   the page as a <style> (not a <link>): /app/vp-oldtv.js rewrites a page's <style> elements for an older TV (cqw, clamp,
   inset, gap), and a linked sheet it would not touch. Load it in the <head> before /app/vp-oldtv.js on the TV.

   THE RULES OF THE LOOK. Nothing is ever cut: no line clamp, no ellipsis; VPWhatsOn.fit (vp-whatson.js) sets the words
   smaller together until the whole wall fits, down to a floor for each kind of word, and a title takes as many lines as it
   needs. One card for each night: a night with several things lists them in time order with the times down one column.
   A tile is never an empty grey box: a soft lift in the colour, a thin pink to gold line along its top, and the night's
   day ghosted behind the words, so a night with no poster still looks finished. Sizes are plain cqw (a share of the
   wall's width) so an older TV can work them out.
   The first rule is the editor's preview stage: the TV's safe box at its real size, scaled to fit the page.
   ES5. tools/test-whats-on.js and tools/whats-on-in-chrome.test.py check it. */
(function (root) {
  "use strict";
  var d = root.document;
  var CSS = [
    '.vpwo-stage{position:relative;overflow:hidden;container-type:inline-size;background:#050506;color:#E7E7EC;font-family:"Manrope",system-ui,sans-serif;text-align:center;-webkit-font-smoothing:antialiased}',
    '.vpwo-stage .ad-wo{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}',
    '.ad-wo{background:#0A0A0B;padding:0}',
    '.wo-wall{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:.8cqw 4.5cqw 3cqw;overflow:hidden}',
    '.wo-in{position:relative;display:flex;flex-direction:column;align-items:center;width:100%;flex:1;min-height:0}',
    '.wo-top{display:flex;align-items:center;justify-content:flex-start;gap:2cqw;min-height:4.2cqw;flex:none;width:91cqw;padding-right:14cqw}',
    '.wo-logo{display:block;max-height:4.2cqw;max-width:20cqw;width:auto;height:auto;object-fit:contain}',
    '.wo-kick{font-family:"Hanken Grotesk",sans-serif;font-weight:700;font-size:clamp(13px,1.9cqw,36px);color:#C9C9D2}',
    '.wo-head{font-family:"Anton",sans-serif;text-transform:uppercase;font-size:clamp(28px,4.2cqw,80px);line-height:1;color:#fff}',
    '.wo-kick,.wo-head{white-space:nowrap}',
    '.wo-list{display:flex;flex-direction:column;gap:1cqw;margin-top:1.8cqw;width:91cqw;flex:1;min-height:0}',
    '.wo-row{position:relative;flex:1 1 auto;display:grid;grid-template-columns:19cqw minmax(0,1fr);align-items:center;gap:2.4cqw;padding:.8cqw 2.6cqw;border-radius:1.1cqw;background:#1A1A1F;text-align:left;overflow:hidden}',
    '.wo-row.tonight::before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;background:#FF1F8E}',
    '.wo-when2{display:flex;flex-direction:column;gap:.3cqw;min-width:0;position:relative;z-index:1}',
    '.wo-day{font-family:"Hanken Grotesk",sans-serif;font-weight:700;font-size:1.7cqw;color:#C9C9D2;white-space:nowrap}',
    '.wo-row.tonight .wo-day{color:#fff}',
    '.wo-time{font-family:"Anton",sans-serif;font-size:3.4cqw;color:#fff;line-height:1;white-space:nowrap}',
    '.wo-what{min-width:0;position:relative;z-index:1}',
    '.wo-what b{display:block;font-family:"Hanken Grotesk",sans-serif;font-weight:800;font-size:3.6cqw;line-height:1.08;color:#fff;overflow-wrap:break-word}',
    '.wo-what i{display:block;font-style:normal;font-family:"Manrope",sans-serif;font-weight:600;font-size:1.9cqw;line-height:1.25;color:#C9C9D2;margin-top:.3cqw;overflow-wrap:break-word}',
    '.wo-row.game .wo-what i,.wo-it.game .wo-itw i{color:#FF8CC6}',
    '.wo-its{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:1.8cqw;row-gap:.7cqw;align-items:baseline;min-width:0;position:relative;z-index:1}',
    '.wo-it{display:contents}',
    '.wo-itt{font-family:"Anton",sans-serif;color:#fff;line-height:1.1;white-space:nowrap;text-align:left}',
    '.wo-itw{min-width:0}',
    '.wo-itw b{display:block;font-family:"Hanken Grotesk",sans-serif;font-weight:800;color:#fff;line-height:1.1;overflow-wrap:break-word}',
    '.wo-itw i{display:block;font-style:normal;font-family:"Manrope",sans-serif;font-weight:600;color:#C9C9D2;line-height:1.2;overflow-wrap:break-word}',
    '.wo-wall.wo-tiles{padding-top:2.6cqw;padding-bottom:2.6cqw}',
    '.wo-tiles .wo-list{display:grid;grid-auto-rows:1fr;gap:1.4cqw;flex:none;margin:auto 0}',
    '.wo-n1 .wo-list{grid-template-columns:minmax(0,1fr)}',
    '.wo-n2 .wo-list,.wo-n4 .wo-list{grid-template-columns:repeat(2,minmax(0,1fr))}',
    '.wo-n3 .wo-list{grid-template-columns:repeat(3,minmax(0,1fr))}',
    '.wo-n5 .wo-list{grid-template-columns:repeat(6,minmax(0,1fr))}',
    '.wo-n5 .wo-row{grid-column:span 2}',
    '.wo-n5 .wo-row:nth-child(n+4){grid-column:span 3}',
    '.wo-tiles .wo-row{display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch;gap:2.4cqw;min-height:0;padding:3cqw 2.8cqw 3.2cqw;border-radius:1.2cqw;background:linear-gradient(155deg,#23232C 0%,#1A1A20 55%,#15151A 100%)}',
    '.wo-tiles .wo-row::before{content:"";position:absolute;left:0;right:0;top:0;bottom:auto;width:auto;height:.3cqw;background:linear-gradient(90deg,#FF1F8E,#FFC24B);opacity:.5}',
    '.wo-tiles .wo-row.tonight::before{height:6px;opacity:1;background:#FF1F8E}',
    '.wo-tiles .wo-row::after{content:attr(data-wd);position:absolute;right:1.2cqw;bottom:-1.6cqw;font-family:"Anton",sans-serif;line-height:1;color:rgba(255,255,255,.05);pointer-events:none;z-index:0}',
    '.wo-tiles .wo-when2{gap:1cqw}',
    '.wo-tiles .wo-what{display:flex;flex-direction:column;justify-content:flex-start}',
    '.wo-tiles .wo-what b{line-height:1.1}',
    '.wo-tiles .wo-what i{margin-top:.5cqw}',
    '.wo-tiles.wo-n3 .wo-day{font-size:2.6cqw}',
    '.wo-tiles.wo-n3 .wo-time{font-size:8.6cqw}',
    '.wo-tiles.wo-n3 .wo-what b{font-size:5.2cqw}',
    '.wo-tiles.wo-n3 .wo-what i{font-size:2.7cqw}',
    '.wo-tiles.wo-n3 .wo-row::after{font-size:12cqw}',
    '.wo-tiles.wo-n2 .wo-day{font-size:3cqw}',
    '.wo-tiles.wo-n2 .wo-time{font-size:10cqw}',
    '.wo-tiles.wo-n2 .wo-what b{font-size:6cqw}',
    '.wo-tiles.wo-n2 .wo-what i{font-size:3cqw}',
    '.wo-tiles.wo-n2 .wo-row::after{font-size:15cqw}',
    '.wo-tiles.wo-n1 .wo-row{align-items:center;text-align:center}',
    '.wo-tiles.wo-n1 .wo-when2,.wo-tiles.wo-n1 .wo-what{align-items:center}',
    '.wo-tiles.wo-n1 .wo-day{font-size:3.2cqw}',
    '.wo-tiles.wo-n1 .wo-time{font-size:10cqw}',
    '.wo-tiles.wo-n1 .wo-what b{font-size:6.4cqw}',
    '.wo-tiles.wo-n1 .wo-what i{font-size:3.2cqw}',
    '.wo-tiles.wo-n1 .wo-row::after{font-size:20cqw;right:2cqw}',
    '.wo-tiles.wo-n4 .wo-row,.wo-tiles.wo-n5 .wo-row{padding:1.6cqw 2.2cqw 1.8cqw;gap:1cqw}',
    '.wo-tiles.wo-n4 .wo-day,.wo-tiles.wo-n5 .wo-day{font-size:1.9cqw}',
    '.wo-tiles.wo-n4 .wo-time,.wo-tiles.wo-n5 .wo-time{font-size:4.6cqw}',
    '.wo-tiles.wo-n4 .wo-what b,.wo-tiles.wo-n5 .wo-what b{font-size:3.2cqw}',
    '.wo-tiles.wo-n4 .wo-what i,.wo-tiles.wo-n5 .wo-what i{font-size:1.9cqw}',
    '.wo-tiles.wo-n4 .wo-row::after,.wo-tiles.wo-n5 .wo-row::after{font-size:8cqw;bottom:-1cqw}',
    '.wo-tiles .wo-row.multi{justify-content:flex-start}',
    '.wo-tiles.wo-n1 .wo-row.multi{align-items:stretch;text-align:left}',
    '.wo-tiles.wo-n1 .wo-row.multi .wo-when2{align-items:flex-start}',
    '.wo-tiles.wo-n1 .wo-itt{font-size:4.6cqw}.wo-tiles.wo-n1 .wo-itw b{font-size:4.2cqw}.wo-tiles.wo-n1 .wo-itw i{font-size:2.3cqw}',
    '.wo-tiles.wo-n2 .wo-itt{font-size:4.2cqw}.wo-tiles.wo-n2 .wo-itw b{font-size:3.9cqw}.wo-tiles.wo-n2 .wo-itw i{font-size:2.1cqw}',
    '.wo-tiles.wo-n3 .wo-itt{font-size:3.4cqw}.wo-tiles.wo-n3 .wo-itw b{font-size:3.2cqw}.wo-tiles.wo-n3 .wo-itw i{font-size:1.9cqw}',
    '.wo-tiles.wo-n4 .wo-itt,.wo-tiles.wo-n5 .wo-itt{font-size:2.5cqw}.wo-tiles.wo-n4 .wo-itw b,.wo-tiles.wo-n5 .wo-itw b{font-size:2.3cqw}.wo-tiles.wo-n4 .wo-itw i,.wo-tiles.wo-n5 .wo-itw i{font-size:1.45cqw}',
    '.wo-logo.wo-wait{visibility:hidden}',
    '.wo-logo.wo-plate{border-radius:.7cqw}',
    '.wo-b{display:grid;grid-template-columns:41cqw minmax(0,1fr);grid-template-rows:100%;padding:0;align-items:stretch}',
    '.wb-feat{position:relative;overflow:hidden}',
    '.wb-art{position:absolute;left:-8%;right:-8%;top:-8%;bottom:-8%;background-size:cover;background-position:center;filter:blur(40px) brightness(.32) saturate(1.2)}',
    '.wb-pic{position:absolute;left:2.6cqw;right:2.6cqw;top:2.6cqw;bottom:12.4cqw;background-size:contain;background-position:center;background-repeat:no-repeat;filter:drop-shadow(0 1cqw 3cqw rgba(0,0,0,.6))}',
    '.wb-cap{position:absolute;left:2.6cqw;right:2.6cqw;bottom:2.2cqw;display:flex;flex-direction:column;gap:.4cqw;text-align:center}',
    '.wb-when{font-family:"Hanken Grotesk",sans-serif;font-weight:800;font-size:3cqw;line-height:1.1;color:#fff;text-shadow:0 .2cqw 1cqw rgba(0,0,0,.7);overflow-wrap:break-word}',
    '.wb-title{font-family:"Anton",sans-serif;text-transform:uppercase;font-size:3cqw;line-height:1.05;color:#fff;overflow-wrap:break-word}',
    '.wb-when.tn{color:#FFD93D}',
    '.wb-side{display:flex;flex-direction:column;padding:.8cqw 3.4cqw 2.6cqw 2.8cqw;min-width:0;min-height:0}',
    '.wb-side .wo-top{width:auto;padding-right:0;margin-right:12cqw}',
    '.wb-side .wo-top.k .wo-kick{font-size:clamp(11px,1.5cqw,28px)}',
    '.wb-side .wo-list{width:100%;gap:.8cqw;margin-top:1.6cqw}',
    '.wb-side .wo-row{grid-template-columns:13cqw minmax(0,1fr);gap:1.6cqw;padding:.6cqw 1.8cqw;min-height:0}',
    '.wb-side .wo-day{font-size:1.4cqw}',
    '.wb-side .wo-time{font-size:2.7cqw}',
    '.wb-side .wo-what b{font-size:2.3cqw}',
    '.wb-side .wo-what i{font-size:1.35cqw}',
    '.wb-side .wo-row.multi .wo-itt{font-size:1.9cqw}.wb-side .wo-row.multi .wo-itw b{font-size:1.8cqw}.wb-side .wo-row.multi .wo-itw i{font-size:1.2cqw}',
    '.wb-side .wo-row.multi .wo-its{row-gap:.3cqw;column-gap:1.2cqw}',
    '.wo-bl .wb-side .wo-row{grid-template-columns:16cqw minmax(0,1fr)}',
    '.wo-bl .wb-side .wo-day{font-size:1.9cqw}',
    '.wo-bl .wb-side .wo-time{font-size:4cqw}',
    '.wo-bl .wb-side .wo-what b{font-size:3cqw}',
    '.wo-bl .wb-side .wo-what i{font-size:2cqw}',
    '.wo-bl .wb-side .wo-row.multi .wo-itt{font-size:2.8cqw}.wo-bl .wb-side .wo-row.multi .wo-itw b{font-size:2.6cqw}.wo-bl .wb-side .wo-row.multi .wo-itw i{font-size:1.6cqw}',
    '.wo-bxl .wb-side .wo-list{margin-top:4.4cqw;display:grid;grid-auto-rows:1fr;gap:1.4cqw;flex:none;align-content:start}',
    '.wo-bxl .wb-side .wo-row{min-height:13.5cqw;grid-template-columns:15cqw minmax(0,1fr);padding:1.2cqw 1.8cqw}',
    '.wo-bxl .wb-side .wo-day{font-size:1.8cqw}',
    '.wo-bxl .wb-side .wo-time{font-size:4cqw}',
    '.wo-bxl .wb-side .wo-what b{font-size:3.1cqw}',
    '.wo-bxl .wb-side .wo-what i{font-size:1.9cqw}',
    '.wo-bxl .wb-side .wo-row.multi .wo-itt{font-size:3cqw}.wo-bxl .wb-side .wo-row.multi .wo-itw b{font-size:2.8cqw}.wo-bxl .wb-side .wo-row.multi .wo-itw i{font-size:1.7cqw}'
  ].join("\n");
  root.VPWhatsOnCSS = CSS;
  if (!d || !d.head || d.getElementById("vp-wo-css")) return;
  var st = d.createElement("style");
  st.id = "vp-wo-css";
  st.appendChild(d.createTextNode(CSS));
  d.head.appendChild(st);
})(typeof window !== "undefined" ? window : this);
