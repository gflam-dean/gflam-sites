/* HQ MENU, STEP 1: Venues / Sales / Support / Reporting, RUN AND NOT WORD-SEARCHED (Dean, 29 Oct 2026; design
   reports/hq-menu-18nov, 18 Nov 2026; branch feature/hq-menu-step1, started from fix/hq-menu-restructure's test).

   Runs the REAL venueplay/app/vp-hq-menu.js on a small fake page built from the REAL tab buttons in hq.html, reads where
   every block now lives in the REAL hq.html, and runs the REAL cancelled-venue phone helper lifted out of hq.html:
     1. every tab HQ had on 18 Nov (origin/main efc35a34) plus the help desk is still a button and is in a section; the
        four sections hold exactly the tabs the design names, in its order, with the three new names
     2. opening each section shows its tabs and nothing else; Cancelled is in Venues and Sales; a tab with no section stays
     3. every tab is reachable by a click, and each old link (#billing, #prospects ...) lands on that tab and its section
     4. the menu follows goPane and the help desk, role-hidden and not-yet-on tabs are not offered, section counts add up
        only the counts the design names
     5. every block that moved (Flagged split four ways, Set up a prospect, Venues that have left, Coaster) is in its new
        pane and nowhere else, and the Owner and Accounts rule still covers what came off Flagged
     6. the cancelled venue's card shows the contact's own phone, tap to ring, owner or accounts only
     7. no HQ page reads a contact mobile from the database; loadContacts asks the Worker for owner and accounts only
        (the Worker's own refusal of every other role is run in tools/test-hq-venue-contacts.js)

   Run from the repo root:  jsc tools/test-hq-menu.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }
function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}

/* ---- a page small enough to trust: elements, classes, attributes, bubbling clicks ---- */
function El(tag) {
  var e = { tag: tag, attrs: {}, children: [], parent: null, handlers: {}, style: {}, _text: '', _cls: {} };
  e.classList = { toggle: function (c, on) { if (on === undefined) on = !e._cls[c]; if (on) e._cls[c] = true; else delete e._cls[c]; },
    contains: function (c) { return !!e._cls[c]; } };
  Object.defineProperty(e, 'className', { get: function () { return Object.keys(e._cls).join(' '); }, set: function (v) { e._cls = {}; String(v).split(/\s+/).forEach(function (c) { if (c) e._cls[c] = true; }); } });
  Object.defineProperty(e, 'textContent', { get: function () { return e._text + e.children.map(function (c) { return c.textContent; }).join(''); }, set: function (v) { e._text = String(v); e.children = []; } });
  Object.defineProperty(e, 'firstChild', { get: function () { return e.children[0] || null; } });
  e.setAttribute = function (k, v) { e.attrs[k] = String(v); };
  e.getAttribute = function (k) { return k in e.attrs ? e.attrs[k] : null; };
  e.hasAttribute = function (k) { return k in e.attrs; };
  e.removeAttribute = function (k) { delete e.attrs[k]; };
  e.appendChild = function (c) { c.parent = e; e.children.push(c); return c; };
  e.insertBefore = function (c, ref) { c.parent = e; var i = ref ? e.children.indexOf(ref) : -1; if (i < 0) e.children.push(c); else e.children.splice(i, 0, c); return c; };
  e.addEventListener = function (t, f) { (e.handlers[t] = e.handlers[t] || []).push(f); };
  e.closest = function (sel) { for (var x = e; x; x = x.parent) if (x.tag === sel) return x; return null; };
  e.walk = function (f) { e.children.forEach(function (c) { f(c); c.walk(f); }); };
  e.querySelectorAll = function (sel) {
    var out = [], m = /^button\[data-pane\]$/.test(sel), cls = /^\.(\w+)$/.exec(sel);
    e.walk(function (c) { if (m ? (c.tag === 'button' && c.hasAttribute('data-pane')) : (cls && c._cls[cls[1]])) out.push(c); });
    return out;
  };
  e.querySelector = function (sel) { return e.querySelectorAll(sel)[0] || null; };
  e.click = function () { var ev = { target: e }; for (var x = e; x; x = x.parent) (x.handlers.click || []).forEach(function (f) { f(ev); }); };
  return e;
}
var HQ = readFile('venueplay/app/hq.html');
var MENU_SRC = readFile('venueplay/app/vp-hq-menu.js');
var COASTER_SRC = readFile('venueplay/app/vp-coaster-hq.js');
var PROSPECTS_SRC = readFile('venueplay/app/vp-prospects-hq.js');
var navHtml = HQ.slice(HQ.indexOf('<div class="navpills" id="hqNav">'), HQ.indexOf('<!-- ============ VENUES ============ -->'));
var tabs = []; navHtml.replace(/<button data-pane="(\w+)"([^>]*)>([^<]*)</g, function (_, p, rest, label) { tabs.push({ pane: p, hidden: /\bhidden\b/.test(rest), label: label.replace(/&amp;/g, '&').trim() }); });
function labelOf(p) { for (var i = 0; i < tabs.length; i++) if (tabs[i].pane === p) return tabs[i].label; return null; }

/* THE BEFORE: every tab on origin/main efc35a34 (18 Nov 2026), and the help desk's own. Kept here on purpose: the job is that
   none of these is lost, so the list cannot be read from the file being changed. */
var OLD_TABS = ['venues', 'prospects', 'subscribers', 'live', 'screens', 'quiet', 'cancelled', 'billing', 'groups', 'usage', 'reports', 'team', 'flagged', 'audit', 'helpdesk'];
/* THE DESIGN (reports/hq-menu-18nov "The new menu"), section by section, in its order. Journey has no tab on main yet. */
var DESIGN = {
  venues: ['venues', 'live', 'quiet', 'groups', 'screens', 'cancelled'],
  sales: ['prospects', 'coaster', 'journey', 'flagged', 'subscribers', 'cancelled'],
  support: ['helpdesk', 'privacy', 'team'],
  reporting: ['billing', 'usage', 'reports', 'audit']
};
/* Reporting: the design's "group nights nobody has billed" needs a Billing tab count that nothing sets in step 1, so Reporting
   counts nothing until step 2 (review of 18 Nov 2026: a count that can never show is a promise, not a count). */
var DESIGN_COUNTS = { venues: ['quiet'], sales: ['prospects', 'flagged', 'cancelled'], support: ['helpdesk'], reporting: [] };

var win, doc, nav, bar, ELS, clicks;
function build(extra) {
  clicks = []; ELS = {};
  nav = El('div'); bar = El('div');
  var sw = El('label'); sw.setAttribute('id', 'showTestWrap'); bar.appendChild(sw);
  var byId = { hqNav: nav, hqGroups: bar, app: (function () { var a = El('div'); a.style.display = 'block'; return a; })() };
  tabs.concat(extra || []).forEach(function (o) {
    var b = El('button'); b.setAttribute('data-pane', o.pane); if (o.hidden) b.setAttribute('hidden', ''); ELS[o.pane] = b; nav.appendChild(b);
    b.handlers.click = [function () { clicks.push(o.pane); }];   // what goPane would be told
  });
  doc = { getElementById: function (i) { return byId[i] || null; }, createElement: El, createTextNode: function (t) { var e = El('#text'); e._text = t; return e; } };
  win = { document: doc, location: { hash: '' }, setTimeout: function (f) { f(); }, addEventListener: function (t, f) { win['on' + t] = f; } };
  var rootObj = {};   // no document on it, so the file does not start itself: the test starts it, once, with start()
  var M = (new Function('window', MENU_SRC + '\nreturn window.VPHQMenu;'))(rootObj); win.VPHQMenu = M;
  return M;
}
function allOn() { Object.keys(ELS).forEach(function (p) { ELS[p].removeAttribute('hidden'); ELS[p].style.display = ''; }); }
function shown() { return Object.keys(ELS).filter(function (p) { return !ELS[p]._cls['vpm-off'] && !ELS[p].hasAttribute('hidden') && ELS[p].style.display !== 'none'; }); }
function shownInOrder() { return shown().sort(function (a, b) { return Number(ELS[a].style.order) - Number(ELS[b].style.order); }); }
function groupBtn(g) { return bar.children.filter(function (b) { return b.getAttribute('data-group') === g; })[0]; }
function tapGroup(g) { groupBtn(g).click(); }
function withHelpdesk() { return [{ pane: 'helpdesk' }]; }

section('1. no tab is lost, and the four sections hold what the design names');
var M = build(withHelpdesk());
var G = {}; M.GROUPS.forEach(function (g) { G[g.id] = g; });
check('hq.html has its tab buttons to test against (a test with none cannot fail)', tabs.length >= 15, tabs.length);
check('four sections, in the design\'s order: Venues, Sales, Support, Reporting', M.GROUPS.map(function (g) { return g.label; }).join(',') === 'Venues,Sales,Support,Reporting', M.GROUPS.map(function (g) { return g.label; }));
var noBtn = OLD_TABS.filter(function (p) { return p !== 'helpdesk' && !labelOf(p); });
check('every tab HQ had on 18 Nov is still a button in #hqNav (the help desk adds its own)', noBtn.length === 0, noBtn);
var lost = OLD_TABS.concat(tabs.map(function (t) { return t.pane; })).filter(function (p) { return M.groupsOf(p).length === 0; });
check('no tab, old or new, is left without a section', lost.length === 0, lost);
Object.keys(DESIGN).forEach(function (g) {
  check(g + ' holds exactly ' + DESIGN[g].join(', ') + ', in that order', G[g] && G[g].panes.join() === DESIGN[g].join(), G[g] && G[g].panes);
  check(g + '\'s red count adds up ' + (DESIGN_COUNTS[g].join(', ') || 'no tab') + ' and nothing else', G[g] && G[g].counts.join() === DESIGN_COUNTS[g].join(), G[g] && G[g].counts);
});
var every = OLD_TABS.concat(['coaster', 'privacy', 'journey']);
check('Cancelled is in both Venues and Sales, and nothing else is in two sections', M.groupsOf('cancelled').join() === 'venues,sales' && every.filter(function (p) { return M.groupsOf(p).length > 1; }).join() === 'cancelled', every.map(function (p) { return p + ':' + M.groupsOf(p).join('/'); }));
check('Flagged sign-ups is under Sales, not Support (design question 2, its suggested yes)', M.groupsOf('flagged').join() === 'sales');
check('the tab names: All venues, Website sign-ups (was Subscribers), Monthly reports (was Reports), Flagged sign-ups, Coaster, Players & privacy',
  labelOf('venues') === 'All venues' && labelOf('subscribers') === 'Website sign-ups' && labelOf('reports') === 'Monthly reports' && labelOf('flagged') === 'Flagged sign-ups' &&
  labelOf('coaster') === 'Coaster' && labelOf('privacy') === 'Players & privacy', tabs.map(function (t) { return t.pane + '=' + t.label; }));
check('every other tab keeps its name', ['live', 'screens', 'quiet', 'cancelled', 'billing', 'groups', 'usage', 'team', 'audit', 'prospects'].every(function (p) {
  return labelOf(p) === { live: 'Live now', screens: 'Screens', quiet: 'Quiet', cancelled: 'Cancelled', billing: 'Billing', groups: 'Groups', usage: 'Usage', team: 'Team', audit: 'Audit', prospects: 'Prospects' }[p]; }), tabs);
check('Prospects, Coaster and Website sign-ups start off and are turned on by their own scripts (owner and accounts)', tabs.filter(function (t) { return t.hidden; }).map(function (t) { return t.pane; }).sort().join() === 'coaster,prospects,subscribers', tabs);

section('2. a section shows its own tabs and only those, in the design\'s order');
M = build(withHelpdesk()); allOn();
var menu = M.start(doc, win);
check('the section row has the four buttons, before the Show test venues switch', bar.children.map(function (b) { return b.getAttribute('data-group') || b.getAttribute('id'); }).join('|') === 'venues|sales|support|reporting|showTestWrap', bar.children.map(function (b) { return b.getAttribute('data-group') || b.getAttribute('id'); }));
check('it opens on Venues', menu.current() === 'venues' && groupBtn('venues')._cls.on === true);
['venues', 'sales', 'support', 'reporting'].forEach(function (g) {
  tapGroup(g);
  var want = DESIGN[g].filter(function (p) { return ELS[p]; });
  check(g + ': shows exactly its tabs, in order (' + want.join(', ') + ')', shownInOrder().join() === want.join(), shownInOrder());
  check(g + ': that section is the highlighted one and no other', M.GROUPS.every(function (x) { return !!groupBtn(x.id)._cls.on === (x.id === g); }));
});
var odd = El('button'); odd.setAttribute('data-pane', 'newthing'); nav.appendChild(odd); ELS.newthing = odd; menu.refresh();
['venues', 'sales', 'support', 'reporting'].forEach(function (g) { tapGroup(g); check('a tab no section knows (added later) is still on show under ' + g + ', at the end', !odd._cls['vpm-off'] && odd.style.order === '99'); });
/* On a tree where hq.html already has the Journey tab (INBOX 413), the real button is used; otherwise one is added, as on main. */
if (!ELS.journey) { var jr = El('button'); jr.setAttribute('data-pane', 'journey'); nav.appendChild(jr); ELS.journey = jr; } menu.refresh(); tapGroup('sales');
check('the day the Journey tab lands it slots into Sales after Coaster, with no change here', shownInOrder().slice(0, 4).join() === 'prospects,coaster,journey,flagged', shownInOrder());

section('3. every tab is reachable, and every link lands right');
M = build(withHelpdesk()); allOn();
menu = M.start(doc, win);
var unreachable = [];
tabs.concat(withHelpdesk()).forEach(function (o) {
  var g = M.groupsOf(o.pane)[0]; tapGroup(g); clicks = [];
  if (ELS[o.pane]._cls['vpm-off']) { unreachable.push(o.pane + ' hidden in ' + g); return; }
  ELS[o.pane].click();
  if (clicks.join() !== o.pane) unreachable.push(o.pane + ' click ' + clicks);
});
check('from its own section every tab is on show and a click reaches it (' + (tabs.length + 1) + ' tabs)', unreachable.length === 0, unreachable);
var linkBad = [];
OLD_TABS.concat(['coaster', 'privacy']).filter(function (p) { return p !== 'helpdesk'; }).forEach(function (p) {
  M = build(withHelpdesk()); allOn(); menu = M.start(doc, win); clicks = [];
  var ok = menu.route('#' + p);
  if (!ok || clicks.join() !== p || M.groupsOf(p).indexOf(menu.current()) < 0 || ELS[p]._cls['vpm-off']) linkBad.push(p + ' -> ' + clicks + ' in ' + menu.current());
});
check('every old #tab link (and #coaster, #privacy) opens that tab, in a section that holds it, with its tab on show', linkBad.length === 0, linkBad);
M = build(withHelpdesk()); allOn(); menu = M.start(doc, win); clicks = [];
menu.route('#billing');
check('#billing opens Billing under Reporting', clicks.join() === 'billing' && menu.current() === 'reporting', [clicks, menu.current()]);
menu.route('#subscribers');
check('#subscribers (the old name) still opens Website sign-ups under Sales', clicks[clicks.length - 1] === 'subscribers' && menu.current() === 'sales', [clicks, menu.current()]);
menu.route('#flagged');
check('#flagged still opens Flagged sign-ups, under Sales', clicks[clicks.length - 1] === 'flagged' && menu.current() === 'sales', [clicks, menu.current()]);
menu.route('#support');
check('#support opens the Support section on its first tab (Help desk)', menu.current() === 'support' && clicks[clicks.length - 1] === 'helpdesk', [menu.current(), clicks]);
tapGroup('venues'); clicks = []; menu.route('#cancelled');
check('#cancelled while in Venues stays in Venues (one list, two doors)', menu.current() === 'venues' && clicks.join() === 'cancelled', [menu.current(), clicks]);
tapGroup('sales'); clicks = []; menu.route('#cancelled');
check('#cancelled while in Sales stays in Sales', menu.current() === 'sales' && clicks.join() === 'cancelled', [menu.current(), clicks]);
M = build(withHelpdesk()); allOn(); ELS.coaster.setAttribute('hidden', ''); menu = M.start(doc, win); clicks = [];
check('a link to a tab that is not on yet (Coaster before the prospects list) says so, so the link on load waits for it', menu.route('#coaster') === false && clicks.length === 0, clicks);
ELS.coaster.removeAttribute('hidden');
check('...and opens it once it is on', menu.route('#coaster') === true && clicks.join() === 'coaster' && menu.current() === 'sales', [clicks, menu.current()]);
check('#helpdesk and #help-12 are left to the help desk (nothing opens twice)', M.parseHash('#helpdesk') === null && M.parseHash('#help-12') === null && menu.route('#help-12') === false);
check('an unknown or empty hash does nothing', M.parseHash('#nope') === null && M.parseHash('') === null && M.parseHash('#') === null);
tapGroup('venues'); clicks = [];
tapGroup('reporting');
check('tapping a section opens a tab in it (its first), so the screen never shows one section over another\'s list', clicks.join() === 'billing', clicks);
ELS.usage.click(); tapGroup('venues'); tapGroup('reporting');
check('going back to a section returns to the tab you were last on', clicks[clicks.length - 1] === 'usage', clicks);

section('4. the menu follows goPane, roles, the help desk and counts');
M = build(); allOn(); menu = M.start(doc, win);
win.VPHQMenu.sync('billing');
check('goPane("billing") (the Billing links elsewhere in HQ) moves the menu to Reporting', menu.current() === 'reporting' && groupBtn('reporting')._cls.on === true, menu.current());
win.VPHQMenu.sync('prospects');
check('goPane("prospects") (Make it a normal prospect, from Coaster) moves it to Sales', menu.current() === 'sales');
win.VPHQMenu.sync('venues');
check('goPane("venues") moves it back to Venues', menu.current() === 'venues');
var hd = El('button'); hd.setAttribute('data-pane', 'helpdesk'); nav.appendChild(hd); ELS.helpdesk = hd; menu.refresh();
check('the help desk button added later is hidden outside Support', hd._cls['vpm-off'] === true);
hd.click();
check('opening the help desk (its own script, not goPane) moves the menu to Support and shows its tab', menu.current() === 'support' && !hd._cls['vpm-off'], menu.current());
check('Support shows Help desk, Players & privacy and Team, in that order', shownInOrder().join() === 'helpdesk,privacy,team', shownInOrder());
function badge(el, n) { var sp = El('span'); sp.className = 'hdbadge tabcount'; sp.textContent = String(n); el.appendChild(sp); return sp; }
function gcount(g) { var sp = groupBtn(g).querySelector('.hdbadge'); return sp.hasAttribute('hidden') ? '' : sp.textContent; }
badge(hd, 3); badge(ELS.cancelled, 4); badge(ELS.quiet, 2); badge(ELS.prospects, 1); badge(ELS.flagged, 5); badge(ELS.subscribers, 7); badge(ELS.screens, 9);
menu.refresh();
check('Support wears the help desk\'s 3', gcount('support') === '3', gcount('support'));
check('Venues wears only Quiet\'s 2 (Cancelled\'s count is Sales\' job, Screens has none in the design)', gcount('venues') === '2', gcount('venues'));
check('Sales adds Prospects 1, Flagged sign-ups 5 and Cancelled 4 to 10, and leaves out the 7 new website sign-ups', gcount('sales') === '10', gcount('sales'));
check('Reporting has nothing to count and says nothing', gcount('reporting') === '', gcount('reporting'));
var billBadge = badge(ELS.billing, 6); menu.refresh();
check('a count on the Billing tab is not added to Reporting (step 1 counts nothing there)', gcount('reporting') === '', gcount('reporting'));
ELS.billing.children.splice(ELS.billing.children.indexOf(billBadge), 1); menu.refresh();
ELS.flagged.style.display = 'none'; menu.refresh();
check('a count on a tab this role cannot see is not added (Flagged hidden: Sales 5)', gcount('sales') === '5', gcount('sales'));
M = build(); ['flagged', 'audit', 'privacy'].forEach(function (p) { ELS[p].style.display = 'none'; }); ELS.team.style.display = 'none';
/* Journey (INBOX 413) has no hidden start; off here too, so the Sales checks below stay about Cancelled alone. */
if (ELS.journey) ELS.journey.style.display = 'none';
menu = M.start(doc, win); tapGroup('sales');
check('a tab its own script has not turned on (Prospects, Coaster, Website sign-ups) is not offered', ['prospects', 'coaster', 'subscribers'].every(function (p) { return shown().indexOf(p) < 0; }), shown());
check('Sales, before Prospects arrives, still has Cancelled, so it is shown', !groupBtn('sales')._cls['vpm-off']);
ELS.cancelled.setAttribute('hidden', ''); menu.refresh();
check('...and with Cancelled off too, Sales is not shown at all', groupBtn('sales')._cls['vpm-off'] === true);
check('a role that cannot see Players & privacy or Team gets no Support section until the help desk arrives', groupBtn('support')._cls['vpm-off'] === true);
check('a role that cannot see Audit still sees Reporting\'s other tabs', (tapGroup('reporting'), shown().indexOf('billing') >= 0 && shown().indexOf('audit') < 0), shown());
M = build();
check('with no section row on the page the menu does nothing and every tab stays', (function () { var d2 = { getElementById: function (i) { return i === 'hqNav' ? nav : null; } }; return M.create(d2, win) === null && tabs.every(function (o) { return !ELS[o.pane]._cls['vpm-off']; }); })());
check('hq.html has the section row with the Show test venues switch in it, loads vp-hq-menu.js after the tab scripts, and goPane tells the menu',
  /<div class="navpills" id="hqGroups" aria-label="HQ sections">\s*<!--[\s\S]*?-->\s*<label id="showTestWrap"/.test(HQ) && navHtml.indexOf('showTestWrap') < 0 &&
  HQ.indexOf('<script src="vp-hq-menu.js"></script>') > HQ.indexOf('vp-subscribers-hq.js"></script>') && /function goPane\(pane\)\{[\s\S]*?VPHQMenu\.sync\(pane\)/.test(HQ));
var HD_SRC = readFile('venueplay/app/vp-helpdesk-hq.js');
(function () {
  /* RUN the help desk's own addTab on a nav whose Show test switch now lives in another row: a real DOM throws on
     insertBefore with a node that is not a child, so this fake does too. */
  var src = lift(HD_SRC, 'addTab');
  var navX = El('div'), rowX = El('div'), labX = El('label'); labX.setAttribute('id', 'showTestWrap'); rowX.appendChild(labX);
  navX.insertBefore = function (c, ref) { if (ref && ref.parent !== navX) throw new Error('NotFoundError: ref is not a child'); c.parent = navX; navX.children.push(c); return c; };
  var byIdX = { hqNav: navX, showTestWrap: labX };
  var docX = { createElement: function (t) { var e = El(t); Object.defineProperty(e, 'id', { set: function (v) { byIdX[v] = e; }, get: function () { return ''; } }); Object.defineProperty(e, 'innerHTML', { set: function () {}, get: function () { return ''; } }); return e; } };
  var threw = null;
  try { (new Function('$', 'doc', 'showPane', 'load', src + '\naddTab();'))(function (i) { return byIdX[i] || null; }, docX, function () {}, function () {}); } catch (e) { threw = String(e); }
  check('run: the help desk still adds its tab now the Show test switch is in the section row (no throw, the button is in #hqNav)', !threw && navX.children.length === 1 && navX.children[0].getAttribute('data-pane') === 'helpdesk', threw || navX.children.length);
})();
check('goPane knows the two new panes', /var PANES=\[[^\]]*"coaster"[^\]]*"privacy"/.test(HQ));
check('one copy: the section names and their tabs are only in vp-hq-menu.js, the tab names only on hq.html\'s buttons',
  !/"Reporting"|"Support"/.test(HQ) && !/Monthly reports|Website sign-ups|Flagged sign-ups|Players &/.test(MENU_SRC));
check('no em dash and no "roster" in what the menu says', !/[\u2014\u2013]/.test(MENU_SRC) && !/roster/i.test(MENU_SRC) && !/[\u2014\u2013]/.test(navHtml));
check('on a phone the sections are two to a row and the switch takes its own row', /@media \(max-width:520px\)\{\s*#hqGroups\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(HQ) && /#hqGroups #showTestWrap\{grid-column:1 \/ -1;margin-left:0\}/.test(HQ));

section('5. every block that moved is in its new tab, and only there');
/* Which pane an element sits in: walk out from its id to the nearest <div id="paneX">, counting divs. */
function paneOf(id) {
  var at = HQ.indexOf('id="' + id + '"'); if (at < 0) return null;
  var re = /<div id="(pane\w+)"/g, m, best = null;
  while ((m = re.exec(HQ)) && m.index < at) {
    var depth = 0, k = m.index, rx = /<div\b|<\/div>/g; rx.lastIndex = k; var t, end = -1;
    while ((t = rx.exec(HQ))) { depth += t[0] === '</div>' ? -1 : 1; if (depth === 0) { end = t.index; break; } }
    if (end > at) best = m[1];
  }
  return best;
}
var WHERE = {
  prospectToggle: 'paneProspects', prospectPanel: 'paneProspects', ppGo: 'paneProspects', prSlot: 'paneProspects', vmExport: 'paneProspects',
  ppWaitingWrap: 'paneVenues', addVenueToggle: 'paneVenues',
  archiveCheck: 'paneCancelled', archiveRun: 'paneCancelled', cxList: 'paneCancelled',
  quietRows: 'paneQuiet',
  paperRows: 'paneUsage', paperWrap: 'paneUsage', usageRows: 'paneUsage',
  rpQuery: 'panePrivacy', rpFind: 'panePrivacy', rlQuery: 'panePrivacy', rlFind: 'panePrivacy',
  flaggedRows: 'paneFlagged', optinRows: 'paneFlagged'
};
var misplaced = Object.keys(WHERE).filter(function (id) { return paneOf(id) !== WHERE[id]; }).map(function (id) { return id + ' in ' + paneOf(id); });
check('Flagged split four ways, Set up a prospect to Prospects, Welcome emails kept on Venues, Venues that have left to Cancelled', misplaced.length === 0, misplaced);
var once = Object.keys(WHERE).filter(function (id) { return HQ.split('id="' + id + '"').length !== 2; });
check('each moved block is on the page once (moved, never copied)', once.length === 0, once);
check('the Flagged pane says Flagged sign-ups and holds only the sign-ups and the every-account table',
  /<div id="paneFlagged" class="hidden">\s*<div class="lblk" style="margin-top:0">Flagged sign-ups<\/div>/.test(HQ) && !/Paper play|Remove a player|Venues who want to hear/.test(HQ.slice(HQ.indexOf('<div id="paneFlagged"'), HQ.indexOf('<script src="/app/vendor/supabase'))));
check('the panes the menu opens all exist: Prospects, Coaster and Players & privacy are on the page', /<div id="paneProspects" class="hidden">/.test(HQ) && /<div id="paneCoaster" class="hidden"><\/div>/.test(HQ) && /<div id="panePrivacy" class="hidden">/.test(HQ));
check('Players & privacy and Paper play keep Flagged\'s rule: Owner and Accounts only', /\['audit','flagged','privacy'\]\.forEach\(function\(p\)\{[^}]*style\.display="none"; \}\); show\("paperWrap", false\); \}/.test(HQ) &&
  /if\(!\(S\.adminRole==="owner"\|\|S\.adminRole==="accounts"\)\)\{ \['audit','flagged','privacy'\]/.test(HQ));
check('Make it a normal prospect opens the form on Prospects, where it now lives', /window\.hqProspectPrefill=function\(o\)\{\s*o=o\|\|\{\};\s*goPane\("prospects"\);/.test(HQ));
check('the welcome emails list loads when Venues opens and when HQ first opens on it, for owner and accounts', /if\(pane==="venues" && canBilling\(\)\) ppLoadWaiting\(\);/.test(HQ) &&
  /\$\("app"\)\.style\.display="block";\s*loadAll\(\);\s*if\(canBilling\(\)\) ppLoadWaiting\(\);/.test(HQ));
check('the set-up result points at Welcome emails on Venues, not "below"', /Cancel it or send it now in Welcome emails, on Venues > All venues\./.test(HQ) && !/Cancel it or send it now below/.test(HQ));
check('Flagged sign-ups waiting is a count on its tab, so it adds up on Sales', /var rows=flaggedAccounts\(\);\s*setTabBadge\("flagged", rows\.length\);/.test(HQ));
check('the Coaster sections draw in their own pane and load on their own tab', /var host = \$\("paneCoaster"\); if \(!host\) return null;/.test(COASTER_SRC) && /getAttribute\("data-pane"\) === "coaster"\) load\(\)/.test(COASTER_SRC) &&
  !/getAttribute\("data-pane"\) === "prospects"\) load\(\)/.test(COASTER_SRC) && /doc\.addEventListener\("vp-prospects", function \(\) \{ var t = \$\("cqTab"\); if \(t\) t\.hidden = false; \}\);/.test(COASTER_SRC));
check('the prospects list goes into hq.html\'s slot when it is there', /var slot = \$\("prSlot"\), p = slot;/.test(PROSPECTS_SRC) && /if \(!slot\) host\.insertBefore\(p, \$\("paneLive"\) \|\| null\);/.test(PROSPECTS_SRC));
/* ...and run it: a page with the slot gets the list in the slot, a page without one gets its own pane, as before. */
(function () {
  function mk(id) { return { id: id, innerHTML: '', className: '', kids: [], ls: {}, appendChild: function (c) { this.kids.push(c); return c; }, insertBefore: function (c) { this.kids.push(c); return c; }, addEventListener: function (t, f) { this.ls[t] = f; }, parentNode: null }; }
  function run(withSlot) {
    var E = { hqNav: mk('hqNav'), paneVenues: mk('paneVenues'), paneLive: mk('paneLive') }, body = mk('body');
    E.paneVenues.parentNode = body;
    if (withSlot) { E.paneProspects = mk('paneProspects'); E.prSlot = mk('prSlot'); }
    var W = { setTimeout: function () {}, document: { readyState: 'complete', body: body, getElementById: function (i) { return E[i] || null; }, createElement: function () { var e = mk(''); return e; }, addEventListener: function () {}, dispatchEvent: function () {} } };
    W.document.createElement = function () { var e = mk(''); Object.defineProperty(e, 'id', { set: function (v) { this._id = v; E[v] = this; }, get: function () { return this._id; } }); return e; };
    (new Function('window', PROSPECTS_SRC))(W);
    return { E: E, body: body };
  }
  var a = run(true);
  check('run: with hq.html\'s slot, the list (#prBody) is drawn in #prSlot and no second Prospects pane is made', /id="prBody"/.test(a.E.prSlot.innerHTML) && a.body.kids.length === 0 && typeof a.E.prSlot.ls.click === 'function', [a.E.prSlot.innerHTML.slice(-80), a.body.kids.length]);
  var b = run(false);
  check('run: with no slot (an older page), it makes its own #paneProspects as before', b.body.kids.length === 1 && b.E.paneProspects && /id="prBody"/.test(b.E.paneProspects.innerHTML), b.body.kids.length);
})();

section('6. a cancelled venue shows its contact\'s phone');
var CX = new Function('S', 'esc', 'canBilling', lift(HQ, 'cxContactHtml') + '\nreturn cxContactHtml;');
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
var S = { contacts: { F1: { name: 'Sam Pub', phone: '0412 345 678' }, F2: { name: 'No Number', phone: '' }, F3: { name: 'Bad <b>', phone: '07 5555 0100' }, F4: { name: 'Odd', phone: '<img src=x>12345678' } } };
var role = true, cx = CX(S, esc, function () { return role; });
var h1 = cx({ v: { founding_id: 'F1' } });
check('a cancelled venue\'s card shows the contact\'s own number', /0412 345 678/.test(h1) && /Sam Pub/.test(h1), h1);
check('it is tap to ring: a tel: link with the digits only', /href="tel:0412345678"/.test(h1), h1);
check('a landline works the same way, and the name is escaped', /href="tel:0755550100"/.test(cx({ v: { founding_id: 'F3' } })) && /Bad &lt;b&gt;/.test(cx({ v: { founding_id: 'F3' } })), cx({ v: { founding_id: 'F3' } }));
check('the number shown is escaped, never markup', !/<img/.test(cx({ v: { founding_id: 'F4' } })) && /&lt;img/.test(cx({ v: { founding_id: 'F4' } })), cx({ v: { founding_id: 'F4' } }));
check('a contact with no number says "none on file" and offers no link', /none on file/.test(cx({ v: { founding_id: 'F2' } })) && !/href=/.test(cx({ v: { founding_id: 'F2' } })));
check('a venue with no account row says "none on file" too, never a blank or an error', /none on file/.test(cx({ v: {} })) && /none on file/.test(cx({ v: { founding_id: 'ZZ' } })));
check('with the contacts query refused (S.contacts missing) the card still draws and says none on file', /none on file/.test(CX({}, esc, function () { return true; })({ v: { founding_id: 'F1' } })));
role = false;
check('a role that is not owner or accounts sees no number at all (same check as the rest of the screen)', cx({ v: { founding_id: 'F1' } }) === '');
role = true;
check('the number comes from the venue\'s contact, never a number baked into the page', !/0[4]\d\d ?\d{3} ?\d{3}/.test(lift(HQ, 'cxContactHtml')) && /\(S\.contacts\|\|\{\}\)/.test(lift(HQ, 'cxContactHtml')));
check('the card calls it', /\+ cxContactHtml\(st\)/.test(HQ));

section('7. contact mobiles reach owner and accounts only, from the Worker (review 18 Nov 2026)');
/* No HQ page asks the database for a venue contact's mobile: every HQ login could make that read, so it would put
   every number in a staff login's memory and network log. Scanned over hq.html and every HQ tab script. */
var HQ_SRCS = { 'hq.html': HQ, 'vp-hq-menu.js': MENU_SRC, 'vp-coaster-hq.js': COASTER_SRC, 'vp-prospects-hq.js': PROSPECTS_SRC };
['vp-helpdesk-hq.js', 'vp-logins-hq.js', 'vp-reports-hq.js', 'vp-subscribers-hq.js'].forEach(function (f) { HQ_SRCS[f] = readFile('venueplay/app/' + f); });
var founderMobile = [];
Object.keys(HQ_SRCS).forEach(function (f) {
  var re = /from\(\s*["']venueplay_founding["']\s*\)\s*\.select\(\s*["']([^"']*)["']/g, m;
  while ((m = re.exec(HQ_SRCS[f]))) if (/(^|,)\s*(mobile|\*)\s*(,|$)/.test(m[1])) founderMobile.push(f + ': ' + m[1]);
});
check('no HQ page reads venueplay_founding.mobile (or *) from the database itself', founderMobile.length === 0, founderMobile);
check('the venue list load asks for the contacts once, through loadContacts', (HQ.match(/\n\s*loadContacts\(\);/g) || []).length === 1 &&
  /S\.accounts=\(r\[13\][^\n]*\n\s*loadContacts\(\);/.test(HQ));
var LC = new Function('S', 'canBilling', 'workerPost', 'renderCancelled', lift(HQ, 'loadContacts') + '\nreturn loadContacts;');
function runLC(isBilling, answer, withAudit) {
  var st = { contacts: { OLD: { name: 'stale', phone: '0400 000 000' } }, cancelAudit: withAudit ? [] : null }, calls = [], drawn = 0;
  var p = LC(st, function () { return isBilling; }, function (path, body) { calls.push(path); return Promise.resolve(answer); }, function () { drawn++; })();
  if (p && p.then) p.then(function () {}); drainMicrotasks();
  return { S: st, calls: calls, drawn: drawn };
}
var GOOD = { ok: true, contacts: { F1: { name: 'Sam Pub', phone: '0412 345 678' } } };
var st1 = runLC(false, GOOD, true);
check('a staff login (not owner or accounts) never asks the Worker and holds no numbers', st1.calls.length === 0 && JSON.stringify(st1.S.contacts) === '{}', st1);
var st2 = runLC(true, GOOD, true);
check('owner or accounts asks /admin/venue-contacts once and holds what it answered', st2.calls.join() === '/admin/venue-contacts' && st2.S.contacts.F1 && st2.S.contacts.F1.phone === '0412 345 678', st2);
check('...and a cancelled list already drawn is drawn again with the numbers', st2.drawn === 1, st2.drawn);
check('...and when the cancelled list has not been read yet nothing is drawn early', runLC(true, GOOD, false).drawn === 0);
var st3 = runLC(true, { error: 'Your role (staff) is not permitted to do this.' }, true);
check('a refusal leaves no numbers (the old ones are cleared too), so each card says none on file', JSON.stringify(st3.S.contacts) === '{}' && st3.drawn === 0, st3);
var st4 = runLC(true, { degraded: true, error: 'Backend endpoint /admin/venue-contacts is not deployed yet.' }, true);
check('a Worker without the route (older deploy) leaves no numbers and no error on screen', JSON.stringify(st4.S.contacts) === '{}', st4);

check('no em dash in what the phone line says', !/[\u2014\u2013]/.test(lift(HQ, 'cxContactHtml')));

print(''); print(ran + ' checks, ' + bad + ' failed');
if (bad) throw new Error(bad + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
