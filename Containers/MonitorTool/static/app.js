const fmt = (n) => n == null ? "—" : Intl.NumberFormat().format(n);

let countsChart, ratesChart, tpuChart;
let lastUpdatesFetch = null;

function lineCfg(label, dataKey) {
  return {
    label,
    parsing: { xAxisKey: "ts", yAxisKey: dataKey },
    data: [],
    pointRadius: 0,
    borderWidth: 2,
    tension: 0.25,
  };
}

function mkChart(ctx, datasets, yTitle = "", stacked = false) {
  return new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      animation: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { type: "time", time: { tooltipFormat: "HH:mm:ss" } },
        y: {
          beginAtZero: true,
          stacked,
          title: { display: !!yTitle, text: yTitle },
        },
      },
      plugins: {
        legend: { position: "bottom" },
      },
    },
  });
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function refresh() {
  // last 360 points by default (~3h @30s); adjust ?n= if needed
  const stats = await fetchJSON("/api/stats?n=360");
  document.getElementById("points").textContent = fmt(stats.length);

  if (stats.length) {
    const last = stats[stats.length - 1];
    document.getElementById("lastTs").textContent = last.ts.replace("T"," ").slice(0,19);
    document.getElementById("kpiFiles").textContent = fmt(last.files);
    document.getElementById("kpiChunks").textContent = fmt(last.chunks);
    document.getElementById("kpiCandidates").textContent = fmt(last.candidates);
    document.getElementById("kpiClones").textContent = fmt(last.clones);
  }

  // init charts once
  if (!countsChart) {
    countsChart = mkChart(
      document.getElementById("counts"),
      [
        lineCfg("files", "files"),
        lineCfg("chunks", "chunks"),
        lineCfg("candidates", "candidates"),
        lineCfg("clones", "clones"),
      ],
      "count",
      false
    );
    ratesChart = mkChart(
      document.getElementById("rates"),
      [
        lineCfg("files/sec", "files_per_sec"),
        lineCfg("chunks/sec", "chunks_per_sec"),
        lineCfg("candidates/sec", "candidates_per_sec"),
        lineCfg("clones/sec", "clones_per_sec"),
      ],
      "units per second",
      false
    );
    tpuChart = mkChart(
      document.getElementById("tpu"),
      [
        lineCfg("files sec/unit", "files_sec_per_unit"),
        lineCfg("chunks sec/unit", "chunks_sec_per_unit"),
        lineCfg("candidates sec/unit", "candidates_sec_per_unit"),
        lineCfg("clones sec/unit", "clones_sec_per_unit"),
      ],
      "seconds per unit (lower is better)",
      false
    );
  }

  // update datasets
  const ds = countsChart.data.datasets;
  ds[0].data = stats;
  ds[1].data = stats;
  ds[2].data = stats;
  ds[3].data = stats;
  countsChart.update();

  const rs = ratesChart.data.datasets;
  rs[0].data = stats;
  rs[1].data = stats;
  rs[2].data = stats;
  rs[3].data = stats;
  ratesChart.update();

  const tp = tpuChart.data.datasets;
  tp[0].data = stats;
  tp[1].data = stats;
  tp[2].data = stats;
  tp[3].data = stats;
  tpuChart.update();

  // fetch new updates
  let url = "/api/updates";
  if (lastUpdatesFetch) url += `?since=${encodeURIComponent(lastUpdatesFetch)}`;
  const updates = await fetchJSON(url);
  lastUpdatesFetch = new Date().toISOString();

  if (updates.length) {
    const el = document.getElementById("updates");
    const lines = updates.map(u => `[${u.ts}] ${u.message}`);
    el.textContent = (el.textContent ? (el.textContent + "\n") : "") + lines.join("\n");
    el.scrollTop = el.scrollHeight;
  }
}

async function bootstrap() {
  // one-time snapshot to display sampling meta
  const snap = await fetchJSON("/api/snapshot");
  const sampleSec = parseInt(new URLSearchParams(window.location.search).get("sample") || (window.SAMPLE_SEC || 30));
  document.getElementById("sampleSec").textContent = sampleSec;

  await refresh();
  // poll every 10s
  setInterval(refresh, 10000);
}

bootstrap().catch(err => console.error("bootstrap error", err));
