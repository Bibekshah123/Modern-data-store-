import re, sys, markdown, html
src = open('IoThings-Report.md', encoding='utf-8').read()
src = re.sub(r'^---\n.*?\n---\n', '', src, count=1, flags=re.S)          # drop YAML front matter
body_md = src
# Split title block (everything before the Executive Summary) for a cover page
cover_md, rest_md = body_md.split('## Executive Summary', 1)
rest_md = '## Executive Summary' + rest_md
md = lambda t: markdown.markdown(t, extensions=['tables', 'fenced_code', 'sane_lists', 'attr_list'])
cover = md(cover_md.replace('\n---\n', '\n'))
rest = md(rest_md)
# images -> figures with captions
rest = re.sub(r'<p><img alt="([^"]*)" src="([^"]*)" ?/?></p>',
              lambda m: f'<figure><img src="{m.group(2)}" alt=""><figcaption>{m.group(1)}</figcaption></figure>', rest)
rest = re.sub(r'<p><em>((?:Figure|Table|\"Units)[^<]*(?:<code>[^<]*</code>[^<]*)*)</em></p>', r'<p class="caption">\1</p>', rest)
# wrap the references section so it gets hanging indents
rest = re.sub(r'(<h2>7\. References</h2>)(.*?)(<h2>Appendix A)', r'\1<div class="refs">\2</div>\3', rest, flags=re.S)
# page breaks before each main section (h2)
rest = rest.replace('<hr />', '')
rest = re.sub(r'<h2>(\d+\. |Appendix A|Contents)', r'<h2 class="pb">\1', rest)
css = """
@page { size: A4; margin: 22mm 20mm 22mm 20mm;
  @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 9pt Arial, sans-serif; color: #555; }
  @top-right { content: "IoThings Sensors Database"; font: 8.5pt Arial, sans-serif; color: #888; } }
@page :first { @bottom-center { content: none; } @top-right { content: none; } }
html { font-family: Calibri, Carlito, 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1d1d1d; }
body { margin: 0; }
h1 { font-size: 26pt; line-height: 1.2; color: #0d3b66; margin: 0 0 8pt; }
h2 { font-size: 16pt; color: #0d3b66; border-bottom: 2px solid #0d3b66; padding-bottom: 3pt; margin: 18pt 0 8pt; }
h3 { font-size: 13pt; color: #144e86; margin: 14pt 0 4pt; }
h4 { font-size: 11.5pt; color: #144e86; margin: 12pt 0 4pt; }
h2.pb { break-before: page; }
p { margin: 0 0 7pt; text-align: justify; }
li { margin-bottom: 3pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.5pt; line-height: 1.35; break-inside: auto; }
th { background: #0d3b66; color: #fff; text-align: left; padding: 4pt 5pt; }
td { border-bottom: 1px solid #d5d9df; padding: 3.5pt 5pt; vertical-align: top; }
tr:nth-child(even) td { background: #f4f6f9; }
tr { break-inside: avoid; }
code { font-family: 'DejaVu Sans Mono', Consolas, monospace; font-size: 8.8pt; background: #f1f3f5; padding: 0 2px; border-radius: 2px; }
pre { background: #0f1b2a; color: #e6edf3; padding: 8pt 10pt; border-radius: 4px; font-size: 8pt; line-height: 1.35;
      white-space: pre-wrap; word-break: break-word; break-inside: avoid; margin: 8pt 0 2pt; }
pre code { background: none; color: inherit; padding: 0; font-size: 8pt; }
p.caption { font-size: 9.5pt; font-style: italic; color: #444; text-align: left; margin: 0 0 10pt; }
.refs p { text-align: left; padding-left: 18pt; text-indent: -18pt; margin-bottom: 5pt; font-size: 10pt; line-height: 1.4; }
figure { margin: 10pt 0 12pt; break-inside: avoid; text-align: center; }
figure img { max-width: 100%; max-height: 190mm; border: 1px solid #d5d9df; }
figcaption { font-size: 9.5pt; font-style: italic; color: #444; margin-top: 4pt; text-align: left; }
strong { color: #0d2a4a; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; }
.cover h1 { font-size: 34pt; }
.cover p { font-size: 15pt; color: #144e86; text-align: left; }
.cover table { font-size: 11pt; width: 70%; margin-top: 30pt; }
.cover th { display: none; }
.cover td:first-child { width: 38%; }
"""
out = f"""<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>IoThings Sensors Database Report</title>
<style>{css}</style></head><body><section class="cover">{cover}</section>{rest}</body></html>"""
open('IoThings-Report.html', 'w', encoding='utf-8').write(out)
print('html written', len(out))
