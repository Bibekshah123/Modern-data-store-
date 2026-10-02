# Rebuilding IoThings-Report-v2

The source is `../../IoThings-Report-v2.md`. After editing it:

```bash
cd report/tools/v2
npm install                          # once: installs the docx library
python3 build.py ../../IoThings-Report-v2.md
```

This writes `IoThings-Report-v2.docx` (contents list filled in by Word when you open it and accept "update fields")
and `IoThings-Report-v2.pdf` (contents list with page numbers, built by LibreOffice in two passes).

Needs Node.js, Python 3, LibreOffice (`soffice`) and Poppler (`pdftotext`, `pdfinfo`).
Figures: `figures/architecture-v2.png` is `../architecture-v2.html` rendered with
`google-chrome --headless=new --window-size=1200,620 --force-device-scale-factor=2 --screenshot=...`;
`figures/swagger-v2.png` is a screenshot of http://localhost:4000/docs.
