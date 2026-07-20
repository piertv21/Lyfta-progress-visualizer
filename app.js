// ------------------------------------------------------------------
// Lyfta - Load Progress Tracker
// Loads a CSV/XLSX export from Lyfta, groups the sets by exercise,
// and shows the load progression over time with Chart.js
// ------------------------------------------------------------------

const fileInput = document.getElementById('fileInput');
const fileDrop = document.getElementById('fileDrop');
const fileDropText = document.getElementById('fileDropText');
const fileStatus = document.getElementById('fileStatus');

const controlsSection = document.getElementById('controls-section');
const exerciseSearch = document.getElementById('exerciseSearch');
const exerciseDropdown = document.getElementById('exerciseDropdown');
const warmupToggle = document.getElementById('warmupToggle');

const statsSection = document.getElementById('stats-section');
const chartSection = document.getElementById('chart-section');
const emptyState = document.getElementById('empty-state');
const canvas = document.getElementById('loadChart');
const resetZoomBtn = document.getElementById('resetZoomBtn');

let allRows = [];          // normalized rows from the file
let exerciseMap = new Map(); // exerciseName -> array of rows
let exerciseNames = [];    // sorted list of exercise names
let currentExercise = null;
let chartInstance = null;

// The chartjs-plugin-zoom UMD build usually self-registers when it detects a
// global Chart, but we register it defensively in case it doesn't - this is
// a no-op if it's already registered.
(function registerZoomPlugin() {
  if (typeof Chart === 'undefined') return;
  const candidate = window.ChartZoom || window.chartjsPluginZoom || window['chartjs-plugin-zoom'];
  if (candidate && typeof Chart.register === 'function') {
    try { Chart.register(candidate); } catch (e) { /* already registered, ignore */ }
  }
  // Chart.js renders text on <canvas>, so it doesn't inherit the page's
  // CSS font-family - set it explicitly to match the rest of the site.
  if (Chart.defaults && Chart.defaults.font) {
    Chart.defaults.font.family = "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif";
  }
})();

// ---------- File handling ----------

// The <label for="fileInput"> already opens the native file picker on click
// (both via the "for" attribute and by wrapping the input) - adding a
// manual fileInput.click() handler here double-triggers the picker on
// iOS Safari, which discards the selected file. So we don't add one.

fileDrop.addEventListener('dragover', (e) => {
  e.preventDefault();
  fileDrop.classList.add('dragover');
});
fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('dragover'));
fileDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  fileDrop.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

function handleFile(file) {
  const name = file.name.toLowerCase();
  fileDropText.innerHTML = `📄 ${escapeHtml(file.name)}`;
  setStatus('Lettura del file in corso...', false);

  if (name.endsWith('.csv')) {
    const reader = new FileReader();
    reader.onload = (evt) => parseCsv(evt.target.result);
    reader.onerror = () => setStatus('Errore nella lettura del file.', true);
    reader.readAsText(file, 'utf-8');
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const reader = new FileReader();
    reader.onload = (evt) => parseXlsx(evt.target.result);
    reader.onerror = () => setStatus('Errore nella lettura del file.', true);
    reader.readAsArrayBuffer(file);
  } else {
    setStatus('Formato non supportato. Usa un file .csv o .xlsx esportato da Lyfta.', true);
  }
}

function parseCsv(text) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  processRows(result.data);
}

function parseXlsx(arrayBuffer) {
  try {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    processRows(data);
  } catch (err) {
    console.error(err);
    setStatus('Impossibile leggere il file Excel.', true);
  }
}

// ---------- Normalization ----------

function normalizeKey(k) {
  return String(k).trim().toLowerCase();
}

function processRows(rawRows) {
  if (!rawRows || !rawRows.length) {
    setStatus('Il file non contiene righe valide.', true);
    return;
  }

  // Build a lookup from normalized column name -> original key, using the first row
  const sampleKeys = Object.keys(rawRows[0]);
  const keyLookup = {};
  sampleKeys.forEach(k => { keyLookup[normalizeKey(k)] = k; });

  const getVal = (row, wantedName) => {
    const key = keyLookup[wantedName];
    return key !== undefined ? row[key] : undefined;
  };

  allRows = [];
  exerciseMap = new Map();

  for (const row of rawRows) {
    const exerciseRaw = getVal(row, 'exercise');
    const weightRaw = getVal(row, 'weight');
    const dateRaw = getVal(row, 'date');
    const repsRaw = getVal(row, 'reps');
    const setTypeRaw = getVal(row, 'set type');
    const titleRaw = getVal(row, 'title');

    if (!exerciseRaw || !dateRaw) continue;

    const weight = parseFloat(String(weightRaw).replace(',', '.'));
    if (isNaN(weight) || weight <= 0) continue; // skip sets without a numeric load (e.g. cardio)

    const date = parseLyftaDate(dateRaw);
    if (!date) continue;

    const exercise = String(exerciseRaw).trim();
    const reps = repsRaw !== undefined && repsRaw !== '' ? parseFloat(String(repsRaw).replace(',', '.')) : null;

    const entry = {
      exercise,
      date,
      weight,
      reps,
      setType: setTypeRaw ? String(setTypeRaw).trim() : '',
      title: titleRaw ? String(titleRaw).trim() : '',
    };

    allRows.push(entry);

    if (!exerciseMap.has(exercise)) exerciseMap.set(exercise, []);
    exerciseMap.get(exercise).push(entry);
  }

  if (!exerciseMap.size) {
    setStatus('Nessun dato di carico valido trovato nel file.', true);
    return;
  }

  populateExerciseOptions();
  setStatus(`✅ Caricate ${allRows.length} serie su ${exerciseMap.size} esercizi diversi.`, false);
  controlsSection.classList.remove('hidden');
  emptyState.classList.add('hidden');

  // auto-select the exercise with the most sets logged
  const mostLogged = [...exerciseMap.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  selectExercise(mostLogged);
}

function parseLyftaDate(raw) {
  // Handles "YYYY-MM-DD HH:mm:ss" strings as well as Excel serial dates
  if (raw instanceof Date) return raw;
  if (typeof raw === 'number') {
    // Excel serial date
    const parsed = XLSX.SSF ? XLSX.SSF.parse_date_code(raw) : null;
    if (parsed) {
      return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0);
    }
  }
  const str = String(raw).trim();
  // "2026-07-18 16:31:57" -> make it ISO-friendly
  const isoLike = str.includes('T') ? str : str.replace(' ', 'T');
  let d = new Date(isoLike);
  if (isNaN(d.getTime())) d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function setStatus(msg, isError) {
  fileStatus.textContent = msg;
  fileStatus.classList.toggle('error', !!isError);
}

// ---------- Exercise selection UI (searchable dropdown) ----------

function populateExerciseOptions() {
  exerciseNames = [...exerciseMap.keys()].sort((a, b) => a.localeCompare(b, 'it'));
}

function renderDropdown(filterText) {
  const filter = (filterText || '').trim().toLowerCase();
  const matches = filter
    ? exerciseNames.filter(name => name.toLowerCase().includes(filter))
    : exerciseNames;

  exerciseDropdown.innerHTML = '';

  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'dropdown-empty';
    empty.textContent = 'Nessun esercizio trovato.';
    exerciseDropdown.appendChild(empty);
  } else {
    for (const name of matches) {
      const count = exerciseMap.get(name).length;
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      if (name === currentExercise) item.classList.add('active');

      const label = document.createElement('span');
      label.textContent = name;
      const countEl = document.createElement('span');
      countEl.className = 'count';
      countEl.textContent = `${count} serie`;

      item.appendChild(label);
      item.appendChild(countEl);
      item.addEventListener('mousedown', (e) => {
        // mousedown fires before the input's blur, so the click isn't lost
        e.preventDefault();
        selectExercise(name);
      });
      exerciseDropdown.appendChild(item);
    }
  }

  exerciseDropdown.classList.remove('hidden');
}

function closeDropdown() {
  exerciseDropdown.classList.add('hidden');
}

function selectExercise(name) {
  if (!exerciseMap.has(name)) return;
  currentExercise = name;
  exerciseSearch.value = name;
  closeDropdown();
  renderExercise(name);
}

exerciseSearch.addEventListener('focus', () => renderDropdown(exerciseSearch.value));
exerciseSearch.addEventListener('input', () => renderDropdown(exerciseSearch.value));
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) closeDropdown();
});

warmupToggle.addEventListener('change', () => {
  if (currentExercise) renderExercise(currentExercise);
});

resetZoomBtn.addEventListener('click', () => {
  if (chartInstance && typeof chartInstance.resetZoom === 'function') {
    chartInstance.resetZoom();
  }
});

// ---------- Chart rendering ----------

function renderExercise(exerciseName) {
  if (!exerciseMap.has(exerciseName)) return;

  const includeWarmup = warmupToggle.checked;
  let entries = exerciseMap.get(exerciseName)
    .filter(e => includeWarmup || e.setType !== 'WARMUP_SET')
    .slice()
    .sort((a, b) => a.date - b.date);

  if (!entries.length) {
    setStatus('Nessuna serie disponibile con i filtri correnti.', true);
    chartSection.classList.add('hidden');
    statsSection.classList.add('hidden');
    return;
  }

  // Dataset 1: every single set logged
  const allSetsData = entries.map(e => ({
    x: e.date.getTime(),
    y: e.weight,
    reps: e.reps,
    setType: e.setType,
    title: e.title,
  }));

  // Dataset 2: top set per session (max weight logged that day), used to draw a trend line
  const bySession = new Map();
  for (const e of entries) {
    const dayKey = e.date.toISOString().slice(0, 10) + '|' + e.date.getTime(); // group by exact session timestamp
    // group by session using date+time truncated to the minute the workout started is tricky;
    // instead group by the date (day) which is good enough for a trend line
    const key = e.date.toISOString().slice(0, 10);
    if (!bySession.has(key) || e.weight > bySession.get(key).weight) {
      bySession.set(key, e);
    }
  }
  const topSetData = [...bySession.values()]
    .sort((a, b) => a.date - b.date)
    .map(e => ({ x: e.date.getTime(), y: e.weight, reps: e.reps, setType: e.setType, title: e.title }));

  // Reveal the containers BEFORE drawing the chart: Chart.js measures the
  // canvas's parent size at creation time, and a display:none container
  // has zero size, which produced an invisible/broken chart.
  chartSection.classList.remove('hidden');
  statsSection.classList.remove('hidden');

  drawChart(exerciseName, allSetsData, topSetData);
  renderStats(exerciseName, entries, topSetData);

  if (chartInstance) chartInstance.resize();
}

function drawChart(exerciseName, allSetsData, topSetData) {
  try {
    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Tutte le serie',
          data: allSetsData,
          backgroundColor: 'rgba(79, 140, 255, 0.35)',
          borderColor: 'rgba(79, 140, 255, 0.35)',
          pointRadius: 4,
          pointHoverRadius: 6,
          showLine: false,
          order: 2,
        },
        {
          label: 'Carico massimo per sessione',
          data: topSetData,
          backgroundColor: '#3ecf8e',
          borderColor: '#3ecf8e',
          pointRadius: 5,
          pointHoverRadius: 7,
          showLine: true,
          borderWidth: 2,
          tension: 0.15,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        title: {
          display: true,
          text: exerciseName,
          color: '#e8eaed',
          font: { size: 16, weight: '600' },
        },
        legend: {
          labels: {
            color: '#9aa0ab',
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 9,
            boxHeight: 9,
            padding: 18,
            font: { size: 12.5 },
          },
          onHover: (event) => { event.native.target.style.cursor = 'pointer'; },
          onLeave: (event) => { event.native.target.style.cursor = 'default'; },
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'x',
          },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'x',
          },
          limits: {
            x: { min: 'original', max: 'original' },
          },
        },
        tooltip: {
          filter: (item, index, array) => {
            // When the top set of a session is also plotted as an individual
            // set, both points land on the exact same x/y and both show up
            // in the tooltip. Keep only the "top set" (green) entry then.
            if (item.dataset.label !== 'Tutte le serie') return true;
            const isDuplicateOfTopSet = array.some((other) =>
              other !== item &&
              other.dataset.label === 'Carico massimo per sessione' &&
              other.parsed.x === item.parsed.x &&
              other.parsed.y === item.parsed.y
            );
            return !isDuplicateOfTopSet;
          },
          callbacks: {
            title: (items) => {
              const raw = items[0].raw;
              return new Date(raw.x).toLocaleString('it-IT', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              });
            },
            label: (item) => {
              const raw = item.raw;
              const lines = [`Peso: ${raw.y} kg`];
              if (raw.reps !== null && raw.reps !== undefined && !isNaN(raw.reps)) lines.push(`Reps: ${raw.reps}`);
              if (raw.setType) lines.push(`Tipo: ${raw.setType === 'WARMUP_SET' ? 'Riscaldamento' : 'Normale'}`);
              if (raw.title) lines.push(`Allenamento: ${raw.title}`);
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          ticks: {
            color: '#9aa0ab',
            callback: (value) => new Date(value).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }),
          },
          grid: { color: '#262a33' },
          title: { display: true, text: 'Data', color: '#9aa0ab' },
        },
        y: {
          ticks: { color: '#9aa0ab' },
          grid: { color: '#262a33' },
          title: { display: true, text: 'Peso (kg)', color: '#9aa0ab' },
        },
      },
    },
  });
  } catch (err) {
    console.error('Errore nella creazione del grafico:', err);
    setStatus('Si è verificato un errore nel disegnare il grafico. Controlla la console (F12) per i dettagli.', true);
  }
}

function renderStats(exerciseName, entries, topSetData) {
  const weights = entries.map(e => e.weight);
  const maxWeight = Math.max(...weights);
  const firstDate = entries[0].date;
  const lastDate = entries[entries.length - 1].date;
  const sessions = topSetData.length;
  const progression = topSetData.length > 1
    ? (topSetData[topSetData.length - 1].y - topSetData[0].y)
    : 0;

  const fmt = (d) => d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });

  statsSection.innerHTML = `
    <div class="stat-box"><div class="label">Carico massimo</div><div class="value">${maxWeight} kg</div></div>
    <div class="stat-box"><div class="label">Sessioni</div><div class="value">${sessions}</div></div>
    <div class="stat-box"><div class="label">Prima serie</div><div class="value" style="font-size:1rem">${fmt(firstDate)}</div></div>
    <div class="stat-box"><div class="label">Ultima serie</div><div class="value" style="font-size:1rem">${fmt(lastDate)}</div></div>
    <div class="stat-box"><div class="label">Progressione</div><div class="value" style="color:${progression >= 0 ? '#3ecf8e' : '#ff6b6b'}">${progression >= 0 ? '+' : ''}${progression.toFixed(1)} kg</div></div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
