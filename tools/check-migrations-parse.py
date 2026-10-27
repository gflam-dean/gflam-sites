#!/usr/bin/env python3
"""EVERY MIGRATION FILE PARSES, BEFORE DEAN PASTES IT (19 Oct 2026).

Migration 106 reached the live SQL editor with a stray line in it: a FAQ answer with a line break
in it had been spliced into the seed twice, so half an answer sat between two INSERTs, and Postgres
stopped at "syntax error at line 294". Nothing broke, because a migration runs in a transaction,
but a migration that does not run is a night that waits for it. Nothing in the gate had ever read
a migration file at all.

This reads every .sql file under venueplay-backend, partyplay-backend and touring-backend /supabase the
way Postgres reads it: single-quoted strings (a doubled '' is a quote inside one), double-quoted
names, -- line comments, /* */ block comments (which nest in Postgres), and $tag$ ... $tag$
bodies. Then it requires:

  - every string, name, comment and $ body is closed by the end of the file
  - brackets balance inside every statement
  - the last statement is ended with ;
  - every statement starts with a word a SQL statement can start with

The last is the one that catches a stray line of text: it is outside any quote, so it becomes the
start of the next statement, and "In some states bingo..." is not a SQL command.

It is not a SQL parser and does not pretend to be one. It cannot see a misspelt column or a wrong
type; the live database is the only judge of those. It catches the class of fault that a splice,
a paste or a careless edit makes, which is the class that got through.

Usage:  python3 tools/check-migrations-parse.py [file ...]
        (no files: every migration in the repo). Exit 1 and FAIL lines on any fault.
"""
import glob, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRS = ['venueplay-backend/supabase', 'partyplay-backend/supabase', 'touring-backend/supabase']

# Words a statement in these files may begin with. Anything else at the start of a statement is
# text that has escaped from a string or a comment.
STARTS = {
    'begin', 'commit', 'rollback', 'start', 'end', 'savepoint', 'release',
    'create', 'alter', 'drop', 'truncate', 'comment', 'grant', 'revoke',
    'insert', 'update', 'delete', 'select', 'with', 'merge', 'copy', 'values', 'table',
    'do', 'set', 'reset', 'notify', 'listen', 'unlisten', 'lock', 'analyze', 'analyse', 'vacuum',
    'refresh', 'reindex', 'cluster', 'call', 'explain', 'security', 'import', 'discard',
}


def scan(text):
    """Split SQL into statements outside strings and comments. Returns (statements, fault)."""
    i, n = 0, len(text)
    stmts, cur, depth = [], [], 0
    line = 1
    stmt_line = None
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ''
        if c == '\n':
            line += 1
        if c == '-' and nxt == '-':                      # line comment
            j = text.find('\n', i)
            i = n if j < 0 else j
            continue
        if c == '/' and nxt == '*':                      # block comment, nested like Postgres
            d, j, start = 1, i + 2, line
            while j < n and d:
                if text.startswith('/*', j):
                    d += 1; j += 2; continue
                if text.startswith('*/', j):
                    d -= 1; j += 2; continue
                if text[j] == '\n':
                    line += 1
                j += 1
            if d:
                return stmts, 'a /* comment opened at line %d is never closed' % start
            i = j
            continue
        if c == "'" or (c in 'eE' and nxt == "'" and (i == 0 or not (text[i - 1].isalnum() or text[i - 1] == '_'))):
            start = line
            j = i + (2 if c != "'" else 1)
            esc = c != "'"
            while j < n:
                if text[j] == '\n':
                    line += 1
                if esc and text[j] == '\\':
                    j += 2; continue
                if text[j] == "'":
                    if j + 1 < n and text[j + 1] == "'":
                        j += 2; continue
                    break
                j += 1
            if j >= n:
                return stmts, "a ' string opened at line %d is never closed" % start
            if stmt_line is None:
                stmt_line = start
            cur.append(text[i:j + 1]); i = j + 1
            continue
        if c == '"':
            start = line
            j = text.find('"', i + 1)
            if j < 0:
                return stmts, 'a " name opened at line %d is never closed' % start
            line += text.count('\n', i, j)
            if stmt_line is None:
                stmt_line = start
            cur.append(text[i:j + 1]); i = j + 1
            continue
        if c == '$':
            m = re.match(r'\$([A-Za-z_][A-Za-z0-9_]*)?\$', text[i:])
            if m and not (i > 0 and (text[i - 1].isalnum() or text[i - 1] == '_')):
                tag = m.group(0)
                start = line
                j = text.find(tag, i + len(tag))
                if j < 0:
                    return stmts, 'a %s body opened at line %d is never closed' % (tag, start)
                line += text.count('\n', i, j)
                if stmt_line is None:
                    stmt_line = start
                cur.append(text[i:j + len(tag)]); i = j + len(tag)
                continue
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth < 0:
                return stmts, 'a ) at line %d closes a bracket that was never opened' % line
        if c == ';':
            if depth:
                return stmts, 'the statement ending at line %d has %d unclosed (' % (line, depth)
            body = ''.join(cur).strip()
            if body:
                stmts.append((stmt_line, body))
            cur, stmt_line = [], None
            i += 1
            continue
        if not c.isspace() and stmt_line is None:
            stmt_line = line
        cur.append(c)
        i += 1
    tail = ''.join(cur).strip()
    if tail:
        return stmts, 'the last statement (from line %d) is never ended with ;' % (stmt_line or line)
    return stmts, None


def check_file(path):
    text = open(path, encoding='utf-8').read()
    stmts, fault = scan(text)
    if fault:
        return fault
    for ln, body in stmts:
        word = re.match(r'[A-Za-z_]+', body)
        if not word or word.group(0).lower() not in STARTS:
            return 'line %d starts a statement with "%s", which is not SQL: text has escaped from a string or a comment' % (ln, body[:50].replace('\n', ' '))
    return None


def main(argv):
    files = argv[1:] or sorted(f for d in DIRS for f in glob.glob(os.path.join(ROOT, d, '*.sql')))
    bad = 0
    for f in files:
        fault = check_file(f)
        name = os.path.relpath(f, ROOT)
        if fault:
            bad += 1
            print('  FAIL %s: %s' % (name, fault))
    print('%d migration file(s) read, %d with a fault' % (len(files), bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
