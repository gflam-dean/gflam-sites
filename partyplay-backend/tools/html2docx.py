#!/usr/bin/env python3
"""Turn one of our briefing pages into a real Word document.

Written because textutil silently drops every <table>: it converted the gaming
brief to 5,771 words and nought tables, which is exactly the part a lawyer reads
first. This walks the HTML we actually write (headings, paragraphs, lists and
tables) and emits the WordprocessingML for it, so a table stays a table.

  python3 tools/html2docx.py in.html "out.docx" "Document title"
"""
import io, os, re, sys, zipfile
from html.parser import HTMLParser
from xml.sax.saxutils import escape

# ------------------------------------------------------------------ parsing --
BLOCK = {'h1','h2','h3','h4','p','li','td','th','caption','blockquote'}

class Doc(HTMLParser):
    """Collect a flat list of blocks. Each is (kind, runs) or a table."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.stack, self.buf = [], [], []
        self.bold = 0; self.ital = 0
        self.tbl = None; self.row = None; self.cell = None
        self.skip = 0
        self.listkind = []

    # -- text accumulation --
    def _flush(self, kind):
        runs = [r for r in self.buf if r[0].strip() or len(r[0]) > 0]
        text = ''.join(r[0] for r in runs).strip()
        self.buf = []
        if not text: return None
        # collapse whitespace inside every run, keep the bold/italic flags
        clean, seen_any = [], False
        for t, b, i in runs:
            t = re.sub(r'\s+', ' ', t)
            if not seen_any: t = t.lstrip(); 
            if t: clean.append((t, b, i)); seen_any = True
        while clean and not clean[-1][0].strip(): clean.pop()
        if clean: clean[-1] = (clean[-1][0].rstrip(), clean[-1][1], clean[-1][2])
        return (kind, clean)

    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','head'): self.skip += 1; return
        if self.skip: return
        if tag == 'table':
            self.tbl = {'rows': [], 'head': 0, 'caption': None}
        elif tag == 'tr':
            self.row = []
        elif tag in ('td','th'):
            a = dict(attrs)
            self.cell = {'kind': tag,
                         'span': int(a.get('colspan', 1) or 1),
                         'rows': int(a.get('rowspan', 1) or 1)}
            self.buf = []
        elif tag == 'span':
            # A heading number lives in its own span, so on screen the CSS puts a
            # gap after it. Word has no such CSS, and "1.Purpose" is not a thing
            # to send a lawyer, so put the space back where the markup implied it.
            if dict(attrs).get('class','').find('num') >= 0:
                self._numspan = True
        elif tag in ('b','strong'): self.bold += 1
        elif tag in ('i','em'):     self.ital += 1
        elif tag in ('ul','ol'):    self.listkind.append(tag)
        elif tag in BLOCK:          self.buf = []
        elif tag == 'br':           self.buf.append(('\n', self.bold, self.ital))

    def handle_endtag(self, tag):
        if tag in ('script','style','head'):
            if self.skip: self.skip -= 1
            return
        if self.skip: return
        if tag == 'table':
            if self.tbl and self.tbl['rows']:
                # The caption sits inside <table> in the markup but reads above it
                # on the page, so emit it first. It used to be dropped outright,
                # because every block inside a table was being discarded, which is
                # how "Table 1. Whether a venue may charge for entry" vanished.
                if self.tbl['caption']:
                    self.out.append(('caption', self.tbl['caption']))
                self.out.append(('table', self.tbl))
            self.tbl = None
        elif tag == 'thead':
            if self.tbl: self.tbl['head'] = len(self.tbl['rows'])
        elif tag == 'tr':
            if self.tbl is not None and self.row: self.tbl['rows'].append(self.row)
            self.row = None
        elif tag in ('td','th'):
            blk = self._flush('cell')
            if self.row is not None:
                self.row.append({'runs': blk[1] if blk else [],
                                 'kind': self.cell['kind'] if self.cell else 'td',
                                 'span': self.cell['span'] if self.cell else 1,
                                 'rows': self.cell['rows'] if self.cell else 1})
            self.cell = None
        elif tag == 'span':
            if getattr(self, '_numspan', False):
                self.buf.append((' ', self.bold, self.ital)); self._numspan = False
        elif tag in ('b','strong'): self.bold = max(0, self.bold - 1)
        elif tag in ('i','em'):     self.ital = max(0, self.ital - 1)
        elif tag in ('ul','ol'):
            if self.listkind: self.listkind.pop()
        elif tag == 'li':
            b = self._flush('bullet' if (self.listkind and self.listkind[-1]=='ul') else 'number')
            if b and self.tbl is None: self.out.append(b)
        elif tag == 'caption':
            b = self._flush('caption')
            if b:
                if self.tbl is not None: self.tbl['caption'] = b[1]
                else: self.out.append(b)
        elif tag in BLOCK:
            b = self._flush(tag)
            if b and self.tbl is None: self.out.append(b)

    def handle_data(self, d):
        if self.skip or not d: return
        self.buf.append((d, self.bold, self.ital))

# ------------------------------------------------------------------- output --
def runs_xml(runs, force_bold=False, size=None):
    if not runs: return '<w:r><w:t/></w:r>'
    out = []
    for t, b, i in runs:
        for n, part in enumerate(t.split('\n')):
            props = ''
            if b or force_bold: props += '<w:b/>'
            if i: props += '<w:i/>'
            if size: props += '<w:sz w:val="%d"/>' % size
            pr = '<w:rPr>%s</w:rPr>' % props if props else ''
            brk = '<w:br/>' if n else ''
            out.append('<w:r>%s%s<w:t xml:space="preserve">%s</w:t></w:r>'
                       % (pr, brk, escape(part)))
    return ''.join(out)

def para(style, runs, bold=False, size=None):
    sz = '<w:rPr><w:sz w:val="%d"/></w:rPr>' % size if size else ''
    return ('<w:p><w:pPr><w:pStyle w:val="%s"/>%s</w:pPr>%s</w:p>'
            % (style, sz, runs_xml(runs, bold, size)))

def layout(rows):
    """Place every cell on a grid, filling in the continuation cells that a
    rowspan implies.

    Word has no rowspan. A cell that covers two rows is written twice: once with
    vMerge "restart" and once, in the row below and at the same grid position, as
    an empty vMerge continuation. Skipping that second cell is what shifted the
    second header row of Table 1 one column to the left, so "For-profit" and
    "Non-profit" sat under Jurisdiction and Bingo instead of under Bingo and
    Raffle, and the for-profit raffle column read as missing.
    """
    grid, carry = [], {}          # carry: column -> [rows left, colspan]
    for r in rows:
        line, col, nxt = [], 0, list(r)
        while nxt or col in carry:
            if col in carry:
                left, span = carry[col]
                line.append({'runs': [], 'kind': 'td', 'span': span, 'merge': 'cont'})
                if left - 1 > 0: carry[col] = [left - 1, span]
                else: del carry[col]
                col += span
                continue
            c = nxt.pop(0)
            line.append({'runs': c['runs'], 'kind': c['kind'], 'span': c['span'],
                         'merge': 'restart' if c.get('rows', 1) > 1 else None})
            if c.get('rows', 1) > 1:
                carry[col] = [c['rows'] - 1, c['span']]
            col += c['span']
        grid.append(line)
    return grid


# A4 in twentieths of a point, and the text width left after the margins.
PORTRAIT  = {'w': 11906, 'h': 16838, 'text': 9026}
LANDSCAPE = {'w': 16838, 'h': 11906, 'text': 13958}
CELL_W = PORTRAIT['text']

def sect(page, landscape=False):
    """A section break. Word takes the orientation from the paragraph this is
    attached to, so it ends the run of pages before it."""
    return ('<w:sectPr>'
            '<w:headerReference w:type="default" r:id="rId2"/>'
            '<w:footerReference w:type="default" r:id="rId3"/>'
            '<w:type w:val="nextPage"/>'
            '<w:pgSz w:w="%d" w:h="%d"%s/>'
            '<w:pgMar w:top="1418" w:right="1440" w:bottom="1418" w:left="1440" '
            'w:header="680" w:footer="680" w:gutter="0"/>'
            '</w:sectPr>' % (page['w'], page['h'], ' w:orient="landscape"' if landscape else ''))


def table_xml(t):
    grid = layout(t['rows'])
    head = t['head'] or 0
    ncol = max(sum(c['span'] for c in r) for r in grid)
    # Every row must span the whole table. A row that comes up short means cells
    # have slid left and the headings no longer sit above their own numbers,
    # which is exactly how the for-profit raffle column went missing. Loud, not
    # silent: this document goes to a lawyer.
    for ri, r in enumerate(grid):
        wide = sum(c['span'] for c in r)
        if wide != ncol:
            sys.exit('table row %d covers %d of %d columns, so the cells are '
                     'misaligned. First cell: %r'
                     % (ri, wide, ncol,
                        ''.join(x[0] for x in r[0]['runs'])[:40] if r and r[0]['runs'] else ''))
    # How much room does each column actually want? Counting columns is the wrong
    # question: a nine column grid of bullets fits across A4 easily, while a seven
    # column grid of sentences does not. So measure the content.
    want = [3] * ncol                       # a floor, so a bullet column stays tappable
    for r in grid:
        col = 0
        for c in r:
            n = len(''.join(x[0] for x in c['runs']))
            share = min(n, 30) / float(c['span'])      # a spanning cell wants width from each
            for k in range(col, min(col + c['span'], ncol)):
                if share > want[k]: want[k] = share
            col += c['span']
    total = sum(want)

    # About 95 characters of 8.5pt Calibri fit across the A4 portrait text column.
    # More than that and the page is turned, which is what anyone would do by hand.
    wide = total > 95
    avail = (LANDSCAPE if wide else PORTRAIT)['text']
    size = None if ncol <= 4 else 17        # half-points, so 20 is 10pt
    colw = [max(600, int(avail * x / total)) for x in want]
    w = int(avail / max(1, ncol))           # the fallback, for the grid declaration
    body = []
    for ri, r in enumerate(grid):
        is_head = ri < head or all(c['kind'] == 'th' for c in r)
        cells = []
        col = 0
        for c in r:
            cw = sum(colw[col:col + c['span']]) or (w * c['span'])
            col += c['span']
            shade = '<w:shd w:val="clear" w:fill="E8E8E8"/>' if is_head else ''
            span  = '<w:gridSpan w:val="%d"/>' % c['span'] if c['span'] > 1 else ''
            if c['merge'] == 'restart': merge = '<w:vMerge w:val="restart"/>'
            elif c['merge'] == 'cont':  merge = '<w:vMerge/>'
            else:                       merge = ''
            cells.append(
                '<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>%s%s%s</w:tcPr>%s</w:tc>'
                % (cw, span, merge, shade,
                   para('CellText', c['runs'], bold=is_head, size=size)))
        keep = '<w:trPr><w:tblHeader/></w:trPr>' if is_head else ''
        body.append('<w:tr>%s%s</w:tr>' % (keep, ''.join(cells)))
    borders = ''.join('<w:%s w:val="single" w:sz="6" w:space="0" w:color="808080"/>' % s
                      for s in ('top','left','bottom','right','insideH','insideV'))
    tbl = ('<w:tbl><w:tblPr><w:tblW w:w="%d" w:type="dxa"/>'
           '<w:tblBorders>%s</w:tblBorders></w:tblPr>'
           '<w:tblGrid>%s</w:tblGrid>%s</w:tbl>'
           % (avail, borders,
              ''.join('<w:gridCol w:w="%d"/>' % x for x in colw), ''.join(body)))
    if not wide:
        return tbl + '<w:p/>'
    # Landscape for this table alone: close the portrait run, lay the table on a
    # turned page, then close that so the prose after it comes back upright.
    return ('<w:p><w:pPr>%s</w:pPr></w:p>%s<w:p><w:pPr>%s</w:pPr></w:p>'
            % (sect(PORTRAIT), tbl, sect(LANDSCAPE, True)))


STYLE_FOR = {'h1':'Title','h2':'Heading1','h3':'Heading2','h4':'Heading3',
             'p':'BodyText','caption':'Caption','blockquote':'Quote',
             'bullet':'Bullet','number':'Bullet'}

def build(blocks):
    out = []
    for kind, data in blocks:
        if kind == 'table': out.append(table_xml(data))
        else: out.append(para(STYLE_FOR.get(kind, 'BodyText'), data))
    return ''.join(out)

STYLES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
  <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
  <w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>
  <w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr>
  <w:spacing w:after="220"/></w:pPr><w:rPr><w:b/><w:sz w:val="38"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr>
  <w:keepNext/><w:spacing w:before="380" w:after="120"/>
  <w:pBdr><w:bottom w:val="single" w:sz="6" w:space="3" w:color="999999"/></w:pBdr>
  </w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr>
  <w:keepNext/><w:spacing w:before="260" w:after="90"/></w:pPr>
  <w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr>
  <w:keepNext/><w:spacing w:before="200" w:after="80"/></w:pPr>
  <w:rPr><w:b/><w:i/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>
<w:style w:type="paragraph" w:styleId="Bullet"><w:name w:val="List Paragraph"/><w:pPr>
  <w:ind w:left="420" w:hanging="220"/><w:spacing w:after="80"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="CellText"><w:name w:val="Cell Text"/><w:pPr>
  <w:spacing w:before="50" w:after="50" w:line="252" w:lineRule="auto"/></w:pPr>
  <w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:pPr>
  <w:spacing w:after="80"/></w:pPr><w:rPr><w:i/><w:sz w:val="19"/><w:color w:val="555555"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr>
  <w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="999999"/></w:pBdr>
  </w:pPr><w:rPr><w:i/></w:rPr></w:style>
</w:styles>'''

CT = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>'''

RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>'''

DRELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>'''


W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

def header_xml(left, right):
    """A running head: who it is from on the left, what it is on the right.
    A brief that a lawyer will print and mark up needs to say what it is on
    every page, not only on the first one."""
    rule = ('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="AAAAAA"/></w:pBdr>')
    tabs = '<w:tabs><w:tab w:val="right" w:pos="13958"/></w:tabs>'
    run = ('<w:r><w:rPr><w:sz w:val="17"/><w:color w:val="595959"/></w:rPr>'
           '<w:t xml:space="preserve">%s</w:t></w:r>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:hdr %s><w:p><w:pPr>%s%s<w:spacing w:after="220"/></w:pPr>'
            '%s<w:r><w:tab/></w:r>%s</w:p></w:hdr>'
            % (W_NS, tabs, rule, run % escape(left), run % escape(right)))

def footer_xml(note):
    """Page numbers, because paragraphs are numbered for a reason and someone
    on the other end will want to say "page 4, paragraph 7.4"."""
    tabs = '<w:tabs><w:tab w:val="right" w:pos="13958"/></w:tabs>'
    small = '<w:rPr><w:sz w:val="17"/><w:color w:val="595959"/></w:rPr>'
    page = ('<w:r>%s<w:t xml:space="preserve">Page </w:t></w:r>'
            '<w:r>%s<w:fldChar w:fldCharType="begin"/></w:r>'
            '<w:r>%s<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
            '<w:r>%s<w:fldChar w:fldCharType="separate"/></w:r>'
            '<w:r>%s<w:t>1</w:t></w:r>'
            '<w:r>%s<w:fldChar w:fldCharType="end"/></w:r>'
            '<w:r>%s<w:t xml:space="preserve"> of </w:t></w:r>'
            '<w:r>%s<w:fldChar w:fldCharType="begin"/></w:r>'
            '<w:r>%s<w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>'
            '<w:r>%s<w:fldChar w:fldCharType="separate"/></w:r>'
            '<w:r>%s<w:t>1</w:t></w:r>'
            '<w:r>%s<w:fldChar w:fldCharType="end"/></w:r>' % ((small,) * 12))
    note_run = ('<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % (small, escape(note)))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:ftr %s><w:p><w:pPr>%s<w:spacing w:before="140"/>'
            '<w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="AAAAAA"/></w:pBdr>'
            '</w:pPr>%s<w:r><w:tab/></w:r>%s</w:p></w:ftr>'
            % (W_NS, tabs, note_run, page))

def main():
    src, out = sys.argv[1], sys.argv[2]
    title = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(out)
    html = io.open(src, encoding='utf-8').read()
    d = Doc(); d.feed(html)
    if not d.out: sys.exit('nothing to convert: no blocks found in ' + src)

    tail = sect(PORTRAIT)
    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
           'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
           '<w:body>%s%s</w:body></w:document>' % (build(d.out), tail))
    core = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/">'
            '<dc:title>%s</dc:title><dc:creator>Gflam Group</dc:creator></cp:coreProperties>'
            % escape(title))

    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', CT)
        z.writestr('_rels/.rels', RELS)
        z.writestr('word/_rels/document.xml.rels', DRELS)
        z.writestr('word/styles.xml', STYLES)
        z.writestr('word/document.xml', doc)
        z.writestr('word/header1.xml', header_xml('Gflam Group', title))
        z.writestr('word/footer1.xml', footer_xml('Prepared for Anisimoff Legal'))
        z.writestr('docProps/core.xml', core)

    tables = sum(1 for k, _ in d.out if k == 'table')
    words = sum(len(''.join(r[0] for r in runs).split())
                for k, runs in d.out if k != 'table')
    print('  %s' % out)
    print('  %d blocks, %d tables, about %d words outside the tables' % (len(d.out), tables, words))

if __name__ == '__main__':
    main()
