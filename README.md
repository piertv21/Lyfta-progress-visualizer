# 🏋️ Lyfta Progress Visualizer

A small, dependency-light static site to visualize your workout load progression over time from a [Lyfta](https://lyfta.app) export.

Upload a Lyfta CSV/XLSX export, pick an exercise from the searchable dropdown, and see a chart of the weight used for that exercise over time — every single set plotted, plus a trend line of the top set per session.

## ✨ Features

- 📂 Drag & drop (or click to browse) file upload — accepts `.csv`, `.xlsx`, `.xls`
- 🔍 Searchable exercise picker with set counts
- 📈 Chart.js scatter/line chart:
  - all sets logged for the selected exercise
  - a trend line of the max weight per session
  - hover tooltips with weight, reps, set type, and workout title
- 🔎 Horizontal zoom (mouse wheel / pinch) and pan, with a reset button
- 🔥 Toggle to include/exclude warm-up sets
- 📊 Quick stats panel (max load, sessions, first/last set, total progression)
- ⚡ No build step, no backend — plain HTML/CSS/JS, runs entirely in the browser

## 🚀 Getting started

No installation or build step required.

1. Clone or download this repository.
2. Open `index.html` in a browser (double-click works, or serve it with any static server).
3. Upload your Lyfta export file.

> ⚠️ An internet connection is required on first load, since Chart.js and the other libraries are pulled from a CDN.

## ⚙️ How it works

1. The uploaded file is parsed with [PapaParse](https://www.papaparse.com/) (CSV) or [SheetJS](https://sheetjs.com/) (XLSX).
2. Rows are normalized and grouped by exercise name; rows without a valid numeric weight (e.g. cardio/distance-based exercises) are skipped.
3. Selecting an exercise builds two datasets — all sets, and the max weight per session — and renders them with [Chart.js](https://www.chartjs.org/) using a linear x-axis of timestamps (no external date-adapter dependency).
4. [chartjs-plugin-zoom](https://www.chartjs.org/chartjs-plugin-zoom/) adds wheel-zoom and drag-to-pan on the x-axis.

## 📝 Notes

- 🔒 All data stays in the browser — the file is never uploaded anywhere.
- ✅ Tested against Lyfta's standard export column layout (`Title`, `Date`, `Exercise`, `Weight`, `Reps`, `Set Type`, ...).
