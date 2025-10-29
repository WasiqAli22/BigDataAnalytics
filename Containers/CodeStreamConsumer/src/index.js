const express = require('express');
const formidable = require('formidable');
const fs = require('fs/promises');
const app = express();
const PORT = 3000;

const Timer = require('./Timer');
const CloneDetector = require('./CloneDetector');
const CloneStorage = require('./CloneStorage');
const FileStorage = require('./FileStorage');

// ---- Timing history (new) ----
const statsHistory = [];
const MAX_SAMPLES = 5000; // keep last N files
function recordStatsSample(file) {
    try {
        const timers = Timer.getTimers(file);           // BigInt nanoseconds
        const total_us = Number(timers.total / 1000n);  // µs
        const match_us = Number(timers.match / 1000n);
        const loc = (file.contents.match(/\n/g) || []).length + 1;

        statsHistory.push({
            name: file.name,
            loc,
            total_us,
            match_us,
            us_per_loc: loc ? match_us / loc : 0
        });

        if (statsHistory.length > MAX_SAMPLES) statsHistory.shift();
    } catch (e) {
        console.error("Failed to record stats sample:", e.message);
    }
}

// Express and Formidable setup
// --------------------
const form = formidable({ multiples: false });

app.post('/', fileReceiver);
function fileReceiver(req, res, next) {
    form.parse(req, (err, fields, files) => {

        if (!files || !files.data || !files.data.filepath) {
            console.error("⚠️  Skipping upload: 'files.data.filepath' undefined");
            return res.end('');
        }

        fs.readFile(files.data.filepath, { encoding: 'utf8' })
            .then(data => processFile(fields.name, data))
            .catch(err => console.error("File read failed:", err.message));
    });
    return res.end('');
}

app.get('/', viewClones);

// New endpoints for timing stats
app.get('/timers.json', (req, res) => {
    res.json({ samples: statsHistory });
});

// Endpoint: View visual timing statistics
app.get('/timers', (req, res) => {
    const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

    // Collect stats arrays
    const totals = statsHistory.map(s => s.total_us);
    const matches = statsHistory.map(s => s.match_us);
    const norm = statsHistory.map(s => s.us_per_loc);

    const recent = statsHistory.slice(-100); // limit for clarity and rendering speed

    let html = `
    <html>
    <head>
        <title>Clone Detector - Timing Dashboard</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
            /* --- Clean and modern UI --- */
            body {
                font-family: "Inter", system-ui, -apple-system, sans-serif;
                background: #f4f5f7;
                margin: 0;
                padding: 32px;
                color: #1f2937;
            }
            h1 {
                font-size: 1.8rem;
                margin-bottom: 0.3rem;
            }
            /* new header text style */
            p.summary {
                color: #4b5563;
                margin-bottom: 2rem;
                background: #eef2ff;
                padding: 10px 16px;
                border-left: 4px solid #6366f1;
                border-radius: 4px;
            }
            .chart-box {
                background: #fff;
                border-radius: 1rem;
                box-shadow: 0 2px 10px rgba(0,0,0,0.05);
                padding: 20px;
                margin-bottom: 2rem;
            }
            .chart-box h2 {
                margin: 0 0 1rem 0;
                font-size: 1.2rem;
                color: #1f2937;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                background: #fff;
                border-radius: 1rem;
                overflow: hidden;
                box-shadow: 0 1px 6px rgba(0,0,0,0.05);
            }
            th, td {
                text-align: left;
                padding: 8px 12px;
                border-bottom: 1px solid #e5e7eb;
            }
            th {
                background: #f9fafb;
                font-weight: 600;
            }
            tr:last-child td {
                border-bottom: none;
            }
            a { color: #2563eb; text-decoration: none; }
        </style>
    </head>
    <body>
        <h1>Processing Performance Overview</h1>
        <!-- 🧍🏻 Human-readable summary of current performance -->
        <p class="summary">
            <strong>${statsHistory.length}</strong> files processed so far.  
            Average total time per file: <strong>${avg(totals).toFixed(1)} µs</strong>,  
            Matching phase average: <strong>${avg(matches).toFixed(1)} µs</strong>,  
            Efficiency: <strong>${avg(norm).toFixed(3)} µs per LOC</strong>.  
            (<a href="/timers.json">Download raw data</a>)
        </p>

        <div class="chart-box">
            <h2>Recent Processing Times (Last ${recent.length} files)</h2>
            <canvas id="barChart"></canvas>
        </div>

        <!-- 🧾 Table of last processed files for reference -->
        <table>
            <thead>
                <tr>
                    <th>File</th>
                    <th>LOC</th>
                    <th>Total (µs)</th>
                    <th>Match (µs)</th>
                    <th>Match/LOC (µs)</th>
                </tr>
            </thead>
            <tbody>
    `;

    // dynamically populate table rows
    for (const s of recent.slice().reverse()) {
        html += `<tr>
            <td>${s.name}</td>
            <td>${s.loc}</td>
            <td>${s.total_us.toFixed(0)}</td>
            <td>${s.match_us.toFixed(0)}</td>
            <td>${s.us_per_loc.toFixed(2)}</td>
        </tr>`;
    }

    html += `
            </tbody>
        </table>

        <script>
            // --- Chart.js Configuration ---
            const data = ${JSON.stringify(recent)};
            const labels = data.map(s => s.name.split('/').pop());
            const total = data.map(s => s.total_us);
            const match = data.map(s => s.match_us);

            // create a bar chart showing total and match times
            const ctx = document.getElementById('barChart').getContext('2d');
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Total Time (µs)',
                            data: total,
                            backgroundColor: 'rgba(59,130,246,0.7)',
                            borderRadius: 6
                        },
                        {
                            label: 'Match Time (µs)',
                            data: match,
                            backgroundColor: 'rgba(239,68,68,0.7)',
                            borderRadius: 6
                        }
                    ]
                },
                options: {
                    responsive: true,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        x: {
                            ticks: { display: false },
                            grid: { display: false }
                        },
                        y: {
                            beginAtZero: true,
                            title: { display: true, text: 'Time (µs)' }
                        }
                    },
                    plugins: {
                        legend: { position: 'bottom' },
                        title: {
                            display: true,
                            text: 'Performance per File'
                        }
                    }
                }
            });
        </script>
    </body>
    </html>`;

    res.send(html);
});



const server = app.listen(PORT, () => {
    console.log('Listening for files on port', PORT);
});

// Page generation
// --------------------
function getStatistics() {
    let cloneStore = CloneStorage.getInstance();
    let fileStore = FileStorage.getInstance();
    return 'Processed ' + fileStore.numberOfFiles + ' files containing ' + cloneStore.numberOfClones + ' clones.';
}

function lastFileTimersHTML() {
    if (!lastFile) return '';
    let output = '<p>Timers for last file processed:</p>\n<ul>\n';
    let timers = Timer.getTimers(lastFile);
    for (let t in timers) {
        output += '<li>' + t + ': ' + (timers[t] / (1000n)) + ' µs\n';
    }
    output += '</ul>\n';
    return output;
}

function listClonesHTML() {
    let cloneStore = CloneStorage.getInstance();
    let output = '';

    // 🩹 FIX #2 — guard for undefined or empty clone arrays
    if (!cloneStore || !Array.isArray(cloneStore.clones) || cloneStore.clones.length === 0) {
        return "<p>No clone data found or unable to load clones.</p>";
    }

    cloneStore.clones.forEach(clone => {
        if (!clone || !clone.sourceName || !Array.isArray(clone.targets)) return; // skip invalid entries

        output += '<hr>\n';
        output += '<h2>Source File: ' + clone.sourceName + '</h2>\n';
        output += '<p>Starting at line: ' + clone.sourceStart + ' , ending at line: ' + clone.sourceEnd + '</p>\n';
        output += '<ul>';
        clone.targets.forEach(target => {
            if (!target || !target.name) return;
            output += '<li>Found in ' + target.name + ' starting at line ' + (target.startLine || '?') + '\n';
        });
        output += '</ul>\n';
        output += '<h3>Contents:</h3>\n<pre><code>\n';
        output += clone.originalCode || '';
        output += '</code></pre>\n';
    });

    return output;
}

function listProcessedFilesHTML() {
    let fs = FileStorage.getInstance();
    let output = '<HR>\n<H2>Processed Files</H2>\n';
    output += fs.filenames.reduce((out, name) => {
        out += '<li>' + name + '\n';
        return out;
    }, '<ul>\n');
    output += '</ul>\n';
    return output;
}

function viewClones(req, res, next) {
    let page = '<HTML><HEAD><TITLE>CodeStream Clone Detector</TITLE></HEAD>\n';
    page += '<BODY><H1>CodeStream Clone Detector</H1>\n';
    page += '<P>' + getStatistics() + '</P>\n';
    page += lastFileTimersHTML() + '\n';
    page += listClonesHTML() + '\n';
    page += listProcessedFilesHTML() + '\n';
    page += '</BODY></HTML>';
    res.send(page);
}

// Helpers
// --------------------
PASS = fn => d => {
    try {
        fn(d);
        return d;
    } catch (e) {
        throw e;
    }
};

const STATS_FREQ = 100;
const URL = process.env.URL || 'http://localhost:8080/';
let lastFile = null;

function maybePrintStatistics(file, cloneDetector, cloneStore) {
    if (0 == cloneDetector.numberOfProcessedFiles % STATS_FREQ) {
        console.log('Processed', cloneDetector.numberOfProcessedFiles, 'files and found', cloneStore.numberOfClones, 'clones.');
        let timers = Timer.getTimers(file);
        let str = 'Timers for last file processed: ';
        for (let t in timers) {
            str += t + ': ' + (timers[t] / (1000n)) + ' µs ';
        }
        console.log(str);
        console.log('List of found clones available at', URL);
    }
    return file;
}

// Processing pipeline
// --------------------
function processFile(filename, contents) {
    let cd = new CloneDetector();
    let cloneStore = CloneStorage.getInstance();

    return Promise.resolve({ name: filename, contents: contents })
        .then(file => Timer.startTimer(file, 'total'))
        .then(file => cd.preprocess(file))
        .then(file => cd.transform(file))
        .then(file => Timer.startTimer(file, 'match'))
        .then(file => cd.matchDetect(file))
        .then(file => cloneStore.storeClones(file))
        .then(file => Timer.endTimer(file, 'match'))
        .then(file => cd.storeFile(file))
        .then(file => Timer.endTimer(file, 'total'))
        .then(file => { recordStatsSample(file); return file; }) // 🆕 record timing stats
        .then(PASS(file => lastFile = file))
        .then(PASS(file => maybePrintStatistics(file, cd, cloneStore)))
        .catch(console.log);
}

/*
Pipeline:
1. Preprocessing: Remove uninteresting code.
2. Transformation: Transform to intermediate representation.
3. Match Detection: Compare transformed units for similarity.
4. Formatting: Map identified clones to original code lines.
5. Post-Processing: Filter false positives, visualize results.
6. Aggregation: Combine clones into families for analysis.
*/
