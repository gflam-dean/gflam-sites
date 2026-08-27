#!/bin/bash
# PartyPlay end to end smoke test. Run it after any deploy.
#   ./smoke-test.sh                      tests partyplay.com.au
#   ./smoke-test.sh https://x.pages.dev  tests a preview
BASE="${1:-https://partyplay.com.au}"
cd "$(dirname "$0")"
echo "Testing $BASE"
echo
echo "── unit tests ──"
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
tot=0; bad=0
for t in lib/*.test.js worker/*.test.js; do
  out=$("$JSC" "$t" 2>&1 | tail -1)
  case "$out" in ALL*) st="ok  "; tot=$((tot+$(echo "$out"|grep -oE '[0-9]+'|head -1)));; *) st="FAIL"; bad=$((bad+1));; esac
  printf "  %s %-28s %s\n" "$st" "$(basename $t)" "$out"
done
echo "  $tot checks, $bad suites failing"
echo
echo "── pages ──"
for p in "" start booked host run tv play album setup terms privacy admin; do
  c=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 12 "$BASE/$p")
  [ "$c" = "200" ] && printf "  ok   /%s\n" "$p" || { printf "  FAIL /%s -> %s\n" "$p" "$c"; bad=$((bad+1)); }
done
echo
# api.partyplay.com.au has no DNS record and nothing uses it: pp-config.js points
# at the workers.dev address on purpose. Reporting it as a failure buried the one
# that mattered, so it is noted, not failed.
echo "── the Worker ──"
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://api.partyplay.com.au/health)" = "000" ]; then
  echo "  note api.partyplay.com.au is still not set up. Nothing uses it, so this is tidy-up."
fi
for a in "https://partyplay-api.dean-tindale.workers.dev"; do
  c=$(curl -sS -o /tmp/pp-health.json -w "%{http_code}" --max-time 12 "$a/health" 2>/dev/null)
  if [ "$c" = "200" ]; then
    echo "  ok   $a/health"
    python3 -c "import json;d=json.load(open('/tmp/pp-health.json'));print('       configured:',d.get('ok'), '' if d.get('ok') else ('missing: '+', '.join(d.get('missing',[]))))" 2>/dev/null
  elif [ "$c" = "503" ]; then
    echo "  WARN $a is up but not fully configured:"
    python3 -c "import json;d=json.load(open('/tmp/pp-health.json'));print('       missing:', ', '.join(d.get('missing',[])))" 2>/dev/null
  else
    echo "  FAIL $a/health -> $c  (not deployed, or DNS not set)"
  fi
done

# The reply has to name the origin the browser asked from. When it always said
# the apex, the site worked on partyplay.com.au and every guest on
# www.partyplay.com.au got "Load failed" the second they pressed Join.
echo "── who the Worker lets in ──"
API="https://partyplay-api.dean-tindale.workers.dev"
for o in "https://partyplay.com.au" "https://www.partyplay.com.au"; do
  got=$(curl -sS -D- -o /dev/null --max-time 12 -X OPTIONS \
        -H "Origin: $o" -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: content-type" "$API/join" 2>/dev/null \
        | grep -i "^access-control-allow-origin:" | tr -d "\r" | awk "{print \$2}")
  if [ "$got" = "$o" ]; then
    printf "  ok   %s\n" "$o"
  else
    printf "  FAIL %s was answered with '%s'  (a browser there sees Load failed)\n" "$o" "$got"
    bad=$((bad+1))
  fi
done
# and an origin we do not know must NOT be waved through. partyplay.pages.dev is
# tested here on purpose: it looks like ours and is not, it belongs to somebody
# else's Cloudflare Pages project, and it was wrongly on the allow-list for a day.
for o in "https://evil.example" "https://partyplay.pages.dev"; do
  got=$(curl -sS -D- -o /dev/null --max-time 12 -X OPTIONS -H "Origin: $o" \
        -H "Access-Control-Request-Method: POST" "$API/join" 2>/dev/null \
        | grep -i "^access-control-allow-origin:" | tr -d "\r" | awk "{print \$2}")
  if [ "$got" = "$o" ]; then
    printf "  FAIL %s was allowed in, and it is not ours\n" "$o"; bad=$((bad+1))
  else
    printf "  ok   %s is refused\n" "$o"
  fi
done
_unused=$(curl -sS -D- -o /dev/null --max-time 12 -X OPTIONS -H "Origin: https://evil.example" \
      -H "Access-Control-Request-Method: POST" "$API/join" 2>/dev/null \
      | grep -i "^access-control-allow-origin:" | tr -d "\r" | awk "{print \$2}")
if [ "$got" = "https://evil.example" ]; then
  echo "  FAIL an unknown origin was allowed in"; bad=$((bad+1))
else
  echo "  ok   an unknown origin is refused"
fi
echo

echo "── called but never defined ──"
# The Worker by name, because the checker used to glob site/*.html and ignore its
# arguments, so running it on the Worker reported "ok" without opening the file.
python3 check-defs.py site/*.html site/lib/*.js worker/SOURCE-do-not-paste-partyplay-api.js || bad=$((bad+1))

echo
echo "── house rules ──"
for p in "" start terms privacy; do
  s=$(curl -sS --max-time 12 "$BASE/$p")
  echo "$s" | grep -q "—" && echo "  FAIL em dash on /$p"
  echo "$s" | grep -q "the ACT" && echo "  FAIL 'the ACT' on /$p"
done
echo "  checked em dashes and 'the ACT'"
echo
[ "$bad" = "0" ] && echo "ALL GOOD (bar anything marked FAIL above)" || echo "$bad problems above"
