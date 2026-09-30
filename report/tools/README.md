# Rebuilding the report

The report source is `../IoThings-Report.md`. To rebuild the HTML and PDF after editing it:

```bash
cd report
pip install markdown                         # once
python3 tools/build.py                       # writes IoThings-Report.html
google-chrome --headless=new --no-pdf-header-footer \
  --print-to-pdf=IoThings-Report.pdf "file://$PWD/IoThings-Report.html"
```

Figures:
- `figures/architecture.png`: screenshot of `tools/architecture.html` at 1200×620, scale 2
- `figures/chart-storage.png`, `figures/chart-activity.png`: run `node tools/charts.mjs tools`, then screenshot the generated HTML files
- `figures/swagger-overview.png`: screenshot of http://localhost:4000/docs
