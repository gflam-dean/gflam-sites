"""WAIT ON THE PAGE, NOT ON LUCK (4 Nov 2026).

Shared by both Chrome rigs (rig.Rig and admin_site.Site) and importable by a suite that drives
Chrome on its own. Every helper takes `js`, a callable `js(expr) -> value` that answers the way
the rigs do: the value, 'HUNG' when the page has stopped, or {'__threw': reason} when the
expression threw.

Why this file exists: the 4 Nov 2026 gate went red on four Chrome suites, none for a product
fault, each for the same three shapes of fragile reading:

  - a value read ONCE after a fixed sleep, before the page had finished (reconnect-layout read
    the TV's "------" placeholder as the lobby code);
  - json.loads() around a raw rig answer: when the page's expression threw (an element the new
    console no longer has), the rig answered {'__threw': ...}, json.loads raised "the JSON object
    must be str, bytes or bytearray, not dict", and the one line that said WHY was lost
    (account-structure);
  - a header pinned by its neighbours ("Help's next sibling says Account") and a field pinned to
    a layout that was folded away on purpose (help-desk-pages, console-paid-and-draw-max).

The helpers here make the robust shape the easy one. None of them weakens a check: a condition
that is never met still comes back False and the suite still goes red, with a better reason.
"""
import json
import time

# What a page shows before it knows. A read that equals one of these is not a value yet.
PLACEHOLDERS = ('------', '…', '...', 'Loading', 'Loading...', 'loading', '–', '-', '')


class PageThrew(Exception):
    """The page's own expression threw (or the page hung) while a suite was reading it. Raised
    with the page's reason and the start of the expression, so the suite's last line says what
    went wrong on the page, never a Python TypeError about the shape of the answer."""


def threw(v):
    """The page's reason when `v` is a rig answer that says the expression threw, else None."""
    if isinstance(v, dict) and '__threw' in v:
        r = v['__threw']
        try:
            d = json.loads(r) if isinstance(r, str) else r
            ex = d.get('exception') or {}
            return (ex.get('description') or d.get('text') or str(r))[:300]
        except Exception:
            return str(r)[:300]
    return None


def as_json(v, default=None, what=''):
    """A rig answer as a Python value, whatever shape the page sent it in.

    A page may `return JSON.stringify(obj)` (a string) or `return obj` (already a dict or list
    by the time CDP hands it over): both parse to the same thing here. A null or empty answer is
    `default`. A thrown expression or a hung page RAISES PageThrew with the page's reason.
    json.loads(S.js(...)) did the first of these and crashed on the other two."""
    reason = threw(v)
    if reason is not None:
        raise PageThrew('the page threw while answering%s: %s' % ((' ' + what) if what else '', reason))
    if v == 'HUNG':
        raise PageThrew('the page hung while answering%s' % ((' ' + what) if what else ''))
    if v is None or v == '':
        return default
    if isinstance(v, (dict, list, int, float, bool)):
        return v
    if isinstance(v, (bytes, bytearray)):
        v = v.decode('utf-8', 'replace')
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return v


def is_placeholder(text):
    """True when a read is what the page shows BEFORE it has the real value."""
    if text is None:
        return True
    t = str(text).strip()
    return t in PLACEHOLDERS or (len(t) > 0 and set(t) <= set('-–—.… '))


class Never(int):
    """What `until` gives back when the page never answered yes. It IS zero (an int subclass), so it is
    false in every test a suite writes (`if`, `is True`, `== False`, `not`), json.dumps() can print it,
    and its own printed form carries the page's last answer or the reason its expression threw, so the
    FAIL line says why instead of "False"."""
    def __new__(cls, reason):
        self = int.__new__(cls, 0)
        self.reason = reason
        return self

    def __repr__(self):
        return 'never (%s)' % self.reason
    __str__ = __repr__


def until(js, expr, secs=15, every=0.2):
    """The first truthy answer to `expr` inside `secs`, else a falsy Never that says what the
    page last answered. 'HUNG' is returned as the verdict it is. A thrown expression is not an
    answer: keep asking (an element that is not there yet throws), and keep the page's reason
    from the last try so the FAIL line says why."""
    end = time.time() + secs
    last = None
    while True:
        v = js(expr)
        if v == 'HUNG':
            return v
        if v and threw(v) is None:
            return v
        last = v
        if time.time() >= end:
            break
        time.sleep(every)
    r = threw(last)
    return Never('the page threw: ' + r) if r else Never('last answer %r' % (last,))


def until_text(js, target, secs=15, every=0.2):
    """The REAL text of an element, once it has one: not the placeholder the page paints while it
    waits. `target` is an id, or a CSS selector when it starts with '#', '.' or '['. Returns the
    text, or False after `secs` (with the last placeholder seen available via the page)."""
    sel = target if target[:1] in '#.[' else '#' + target
    expr = '(function(){var e=document.querySelector(%s);return e?String(e.textContent||""):null;})()' % json.dumps(sel)
    end = time.time() + secs
    while True:
        v = js(expr)
        if v == 'HUNG':
            return v
        if isinstance(v, str) and not is_placeholder(v):
            return v
        if time.time() >= end:
            return False
        time.sleep(every)


def settled(js, expr, secs=15, still=0.5, every=0.15):
    """The value of `expr` once it has STOPPED CHANGING for `still` seconds: a layout measured
    mid-animation (a fading pill, a sliding panel, a show that is still landing) is not the
    layout. Returns the settled value, or False when it never settled inside `secs`."""
    end = time.time() + secs
    prev, since = object(), time.time()
    while time.time() < end:
        v = js(expr)
        if v == 'HUNG':
            return v
        key = json.dumps(v, sort_keys=True, default=str) if not isinstance(v, str) else v
        if key != prev:
            prev, since = key, time.time()
        elif time.time() - since >= still and v is not None and threw(v) is None:
            return v
        time.sleep(every)
    return False


# Folds a page may put a control behind: a <details>, the console's accordion heads, anything
# with aria-expanded, and the "more" toggles. Opened the way an owner opens them: by clicking.
REVEAL = r'''(function(sel){
  var e=document.querySelector(sel); if(!e) return {found:false, opened:[]};
  var opened=[], n=e, guard=0;
  while(n && n!==document.body && guard++<40){
    var p=n.parentElement; if(!p) break;
    if(p.tagName==="DETAILS" && !p.open){ p.open=true; opened.push("details"); }
    if(p.classList && p.classList.contains("accbody")){
      var h=p.previousElementSibling; if(h && h.classList && h.classList.contains("acchead") && !h.classList.contains("open")){ h.click(); opened.push("acchead:"+(h.getAttribute("data-acc")||"")); }
    }
    var ctl=p.id ? document.querySelector('[aria-controls="'+p.id+'"][aria-expanded="false"]') : null;
    if(ctl){ ctl.click(); opened.push("aria:"+p.id); }
    n=p;
  }
  var r=e.getBoundingClientRect(), cs=getComputedStyle(e);
  return {found:true, opened:opened, visible: r.width>0 && r.height>0 && cs.visibility!=="hidden" && cs.display!=="none"};
})(%s)'''


def reveal(js, selector, secs=10):
    """Open every fold between `selector` and the page, the way an owner would (click the heading,
    open the <details>), then wait for the element to be VISIBLE. Returns the page's report:
    {'found', 'opened': [...], 'visible'}. A check that cares whether a field is reachable from
    the page asks this; a check that cares whether it is open BY DEFAULT does not call it."""
    first = js(REVEAL % json.dumps(selector))
    if first == 'HUNG' or threw(first) is not None or not isinstance(first, dict):
        return {'found': False, 'opened': [], 'visible': False, 'answer': first}
    if not first.get('found'):
        return first
    expr = '(function(){var e=document.querySelector(%s);if(!e)return false;var r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=="hidden"&&cs.display!=="none";})()' % json.dumps(selector)
    vis = until(js, expr, secs)
    first['visible'] = vis is True
    return first


def header_control(js, control_id, header='header', actions='.hactions'):
    """WHERE A CONTROL IS, BY MEANING. For "a Help control is reachable from the header": the
    control exists, sits inside the header's actions, is visible, and which other actions share
    the row (by id and text), so a check can say "Help and Sign out are both in the header"
    without pinning which one is to the left. Returns None when the control is not there."""
    expr = '''(function(id, hs, as){
      var e=document.getElementById(id); if(!e) return null;
      var h=e.closest(hs), a=e.closest(as), r=e.getBoundingClientRect(), cs=getComputedStyle(e);
      var row=a||h, peers=[];
      if(row) [].forEach.call(row.querySelectorAll("a,button"), function(x){ if(x!==e){ var b=x.getBoundingClientRect(); peers.push({id:x.id||"", text:(x.textContent||"").trim(), top:Math.round(b.top), visible:b.width>0&&b.height>0}); } });
      return {inHeader:!!h, inActions:!!a, visible:r.width>0&&r.height>0&&cs.visibility!=="hidden"&&cs.display!=="none",
              text:(e.textContent||"").trim(), top:Math.round(r.top), peers:peers,
              sameRow:peers.filter(function(p){return p.visible && Math.abs(p.top-Math.round(r.top))<=2;}).map(function(p){return p.id||p.text;})};
    })(%s, %s, %s)''' % (json.dumps(control_id), json.dumps(header), json.dumps(actions))
    v = js(expr)
    if v == 'HUNG' or threw(v) is not None or not isinstance(v, dict):
        return None
    return v
