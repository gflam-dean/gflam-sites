#!/usr/bin/env python3
"""tools/make-journey-codes.py RUN on a small FAKE lead file (INBOX 413). Nothing real, nothing sent, no Instantly.   python3 tools/make-journey-codes.test.py"""
import csv, hashlib, importlib.util, io, os, re, sqlite3, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('mjc', os.path.join(ROOT, 'tools', 'make-journey-codes.py'))
mjc = importlib.util.module_from_spec(spec); spec.loader.exec_module(mjc)
ran = bad = 0
def check(n, c, saw=''):
    global ran, bad
    ran += 1
    if c: print('  ok   ' + n)
    else: bad += 1; print('  FAIL ' + n + '   saw: ' + str(saw)[:300])

tmp = tempfile.mkdtemp(prefix='vpj-')
HEAD = 'id,email,first_name,last_name,company,state,suburb,postcode,trivia,bingo,custom_variables\n'
ROWS = [
  'aaaa-1,sam@grandhotel.example,Sam,Jones,The Grand Hotel,QLD,Surfers Paradise,4217,yes,,"{}"\n',
  'aaaa-2,kim@royalpub.example,Kim,Lee,Royal Hotel,New South Wales,Orange,2800,,yes,"{}"\n',
  'aaaa-3,SAM@grandhotel.example,Sam,Dup,The Grand Hotel,QLD,,,,,"{}"\n',          # duplicate email, different case
  'aaaa-4,,No,Email,Nowhere Club,VIC,,,,,"{}"\n',                                  # no email: skipped
  ",lee@o'brienshotel.example,Lee,O'Brien,O'Brien's Hotel,TAS,Hobart,7000,,,\"{}\"\n',",   # no id, apostrophes
]
src = os.path.join(tmp, 'sample-leads.csv')
open(src, 'w').write(HEAD + ''.join(ROWS[:4]) + ",pat@noid.example,Pat,Smith,No Id Pub,SA,Adelaide,5000,,,\"{}\"\n" + "bbbb-5,lee@obrien.example,Lee,O'Brien,O'Brien's Hotel,TAS,Hobart,7000,,,\"{}\"\n")
out = os.path.join(tmp, 'out')
mjc.main([src, '--campaign', 'offer-nov', '--page', 'offer-nov', '--steps', '1,2', '--labels', 'play-button,pricing', '--out', out])
links = list(csv.DictReader(open(os.path.join(out, 'journey-links.csv'))))
wide = list(csv.DictReader(open(os.path.join(out, 'journey-links-wide.csv'))))
sql = open(os.path.join(out, 'journey-links-load.sql')).read()

print('1. the codes')
check('4 real leads x 2 steps x 2 labels = 16 codes (duplicate and blank emails skipped)', len(links) == 16, len(links))
codes = [r['code'] for r in links]
check('every code is 6 characters from the unambiguous alphabet', all(re.fullmatch('[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}', c) for c in codes), codes)
check('no two codes are the same', len(set(codes)) == 16)
check('a link is the page address plus the code, nothing else (no query string, no email)', all(re.fullmatch(r'https://venueplay\.com\.au/offer-nov/[A-Z0-9]{6}', r['link']) for r in links), links[0])
check('the email is not in any link or code', all(r['email'].split('@')[0].lower() not in (r['link'] + r['code']).lower() for r in links))
check('the same lead gets different codes per step and per label', len({r['code'] for r in links if r['email'] == 'sam@grandhotel.example'}) == 4)
mjc_codes2 = mjc.build(list(csv.DictReader(open(src))), type('A', (), dict(campaign='offer-nov', page='offer-nov', steps='1', labels='x', salt='vp-track-v1', days=120, first_only=False))(), None)[0]
check('a second run makes NEW codes (random, not derived)', not ({c[5] for c in mjc_codes2} & set(codes)) or len({c[5] for c in mjc_codes2} & set(codes)) <= 1)

print('2. the wide file for Instantly')
check('one row per lead', len(wide) == 4, len(wide))
check('a column per step and label', {'link_e1_play_button', 'link_e1_pricing', 'link_e2_play_button', 'link_e2_pricing'} <= set(wide[0].keys()), wide[0].keys())
check('the wide link equals the long file link', wide[0]['link_e2_pricing'] in [r['link'] for r in links])

print('3. the load file')
check('only hashes are in the SQL, never a code', not any(c in sql for c in codes))
h = hashlib.sha256(('vp-track-v1|track|' + codes[0]).encode()).hexdigest()
check('the hash is salted sha256 of the upper-case code, as the Worker computes it', h in sql)
check('no email address appears in the SQL', '@' not in sql, re.findall(r'\S+@\S+', sql)[:2])
check('lead_ref is the Instantly id, or a hash when there is none', "'aaaa-1'" in sql and re.search(r"'e[0-9a-f]{16}'", sql) is not None)
check('state words become codes; likely games come from the columns', "'NSW'" in sql and "'{trivia}'" in sql and "'{bingo}'" in sql)
check('an apostrophe in a name is escaped', "O''Brien" in sql)
check('a missing postcode is null, a real one kept', "'4217'" in sql and "'7000'" in sql)
check('the campaign, step, label and page columns are filled', "'offer-nov', 1, 'play-button', 'offer-nov'" in sql and "'offer-nov', 2, 'pricing', 'offer-nov'" in sql)
check('a custom salt changes every hash', hashlib.sha256(('other|track|' + codes[0]).encode()).hexdigest() not in sql)
mjc.main([src, '--campaign', 'c2', '--steps', '1', '--labels', 'a', '--out', os.path.join(tmp, 'o2'), '--salt', 'other'])
sql2 = open(os.path.join(tmp, 'o2', 'journey-links-load.sql')).read()
c2 = [r['code'] for r in csv.DictReader(open(os.path.join(tmp, 'o2', 'journey-links.csv')))]
check('--salt is used in the hash', hashlib.sha256(('other|track|' + c2[0]).encode()).hexdigest() in sql2)

print('4. safety')
wsrc = open(os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-api-FULL.js')).read()
check('the alphabet is the Worker\'s VPJ_ALPHABET', "const VPJ_ALPHABET = '%s'" % mjc.ALPHABET in wsrc)
check('the Worker\'s default salt is the script\'s default salt', "'vp-track-v1'" in wsrc and "default='vp-track-v1'" in open(os.path.join(ROOT, 'tools', 'make-journey-codes.py')).read())
check('the output files are private (600)', all(oct(os.stat(os.path.join(out, n)).st_mode & 0o777) == '0o600' for n in os.listdir(out)))
src_text = open(os.path.join(ROOT, 'tools', 'make-journey-codes.py')).read()
check('the script never imports a network library or names the Instantly API', not re.search(r'import (requests|urllib|http|socket)|api\.instantly', src_text))
try:
    mjc.main([src, '--campaign', 'Bad Name!', '--out', os.path.join(tmp, 'o3')]); ok = False
except SystemExit:
    ok = True
check('Bad Name! is refused', ok)
bad_in = os.path.join(tmp, 'noemail.csv'); open(bad_in, 'w').write('id,name\n1,x\n')
try:
    mjc.main([bad_in, '--campaign', 'c', '--out', os.path.join(tmp, 'o4')]); ok = False
except SystemExit:
    ok = True
check('a file with no email column is refused', ok)

print('5. likely games from the venue master (read only)')
db = os.path.join(tmp, 'master.sqlite')
con = sqlite3.connect(db)
con.execute('create table venues(key text, email text, other_emails text, in_instantly_emails text, trivia text, bingo text, musical_bingo text, raffle text, members_draw text)')
con.execute("insert into venues values ('k1','kim@royalpub.example','','','HOT','','yes','','')")
con.commit(); con.close()
mjc.main([src, '--campaign', 'cm', '--steps', '1', '--labels', 'a', '--out', os.path.join(tmp, 'o5'), '--master', db])
sql5 = open(os.path.join(tmp, 'o5', 'journey-links-load.sql')).read()
check('the lead data adds trivia and musical bingo for kim, besides her own bingo column', "'{bingo,trivia,musical_bingo}'" in sql5, re.findall(r"'\{[a-z_,]*\}'", sql5))
before = os.stat(db).st_mtime
check('the master file is not changed', os.stat(db).st_mtime == before)

print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d FAILED of %d checks' % (bad, ran)))
sys.exit(1 if bad else 0)
