# Builds the report: Word file (with Word's automatic contents field) and a PDF whose contents
# list carries real page numbers, found by locating each heading in a first-pass PDF.
#   python3 build.py report.md
import json, os, re, subprocess, sys

here = os.path.dirname(os.path.abspath(__file__))
md = os.path.abspath(sys.argv[1])
base = os.path.splitext(md)[0]
work = os.path.join(here, 'work')
os.makedirs(work, exist_ok=True)
toc_json = os.path.join(work, 'toc.json')

text = open(md, encoding='utf-8').read()
text = text[text.index('\n---\n'):]  # skip the cover
headings = [m.group(2) for m in re.finditer(r'^(##|###) (.*)$', text, re.M) if m.group(2) != 'Contents']

def run(*cmd, env=None):
    subprocess.run(cmd, check=True, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def build(docx, pages):
    json.dump(pages, open(toc_json, 'w'))
    run('node', os.path.join(here, 'md2docx.js'), md, docx, env={**os.environ, 'TOC_JSON': toc_json})
    run('soffice', '--headless', '--convert-to', 'pdf', '--outdir', work, docx)
    return os.path.join(work, os.path.basename(docx).replace('.docx', '.pdf'))

def page_of_headings(pdf):
    n = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout).group(1))
    texts = [subprocess.run(['pdftotext', '-layout', '-f', str(p), '-l', str(p), pdf, '-'], capture_output=True, text=True).stdout
             for p in range(1, n + 1)]
    norm = lambda s: re.sub(r'\s+', ' ', s).strip()
    pages, start = {}, 3  # skip the cover and the contents pages
    for h in headings:
        key = norm(h)[:38]
        for p in range(start, n + 1):
            if any(norm(line).startswith(key) for line in texts[p - 1].splitlines()):
                pages[h] = p
                start = p
                break
    return pages, n

pdf_docx = os.path.join(work, 'pass.docx')
pages = {h: '00' for h in headings}           # pass 1: same layout, placeholder numbers
for attempt in range(3):
    pdf = build(pdf_docx, pages)
    found, n = page_of_headings(pdf)
    missing = [h for h in headings if h not in found]
    if found == pages:
        break
    pages = found
print('pages:', n, '| headings located:', len(found), 'of', len(headings), '| missing:', missing or 'none')

os.replace(pdf, base + '.pdf')
run('node', os.path.join(here, 'md2docx.js'), md, base + '.docx')  # Word file keeps the automatic field
print('wrote', base + '.docx', 'and', base + '.pdf')
