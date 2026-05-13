pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let selectedFile = null;
let currentClauses = [];

// ─────────────────────────────────────────────
// FILE HANDLING
// ─────────────────────────────────────────────

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const filePreview = document.getElementById('filePreview');

// ─────────────────────────────────────────────
// DEMO DOCS
// ─────────────────────────────────────────────

async function loadDemo(docId) {
  clearAll();
  setLoading(true);
  
  // fake processing delay so it feels real
  await new Promise(r => setTimeout(r, 2000));
  
  try {
    const res = await fetch(`/demo/${docId}`);
    const result = await res.json();
    
    const clauses = Array.isArray(result.clauses) ? result.clauses : [];
    const fairness = result.fairness ?? {
      fairness_score: 0,
      classification: { label: 'Unknown' },
      market_comparison: { interest_rate: {}, processing_fee: {} },
      major_risks: []
    };
    
    currentClauses = clauses;
    renderResults(clauses, fairness);
  } catch(e) {
    showError('Could not load demo document.');
  } finally {
    setLoading(false);
  }
}

function formatSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return Math.round(b / 1024) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function showFile(file) {
  selectedFile = file;
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = formatSize(file.size);
  filePreview.style.display = 'flex';
  dropZone.style.opacity = '0.5';
  dropZone.style.pointerEvents = 'none';
}

function clearFile() {
  selectedFile = null;
  fileInput.value = '';
  filePreview.style.display = 'none';
  dropZone.style.opacity = '1';
  dropZone.style.pointerEvents = 'auto';
}

document.getElementById('removeBtn').addEventListener('click', clearFile);

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) showFile(e.target.files[0]);
});

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type === 'application/pdf') {
    showFile(f);
  } else {
    showError('Please drop a PDF file.');
  }
});

// ─────────────────────────────────────────────
// PDF EXTRACTION
// ─────────────────────────────────────────────

async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText;
}

// ─────────────────────────────────────────────
// API CALL
// ─────────────────────────────────────────────

async function analyzeLoan(text, language) {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || 'Server error');
  return data;
}

// ─────────────────────────────────────────────
// OVERALL RISK
// ─────────────────────────────────────────────

function calculateOverallRisk(clauses) {
  const red = clauses.filter(c => c.risk === 'red').length;
  const yellow = clauses.filter(c => c.risk === 'yellow').length;
  if (red >= 2) return { label: 'High Risk', cls: 'high', emoji: '🔴' };
  if (red === 1 || yellow >= 3) return { label: 'Moderate Risk', cls: 'moderate', emoji: '🟡' };
  return { label: 'Safe to Sign', cls: 'safe', emoji: '🟢' };
}

// ─────────────────────────────────────────────
// SORT CLAUSES
// ─────────────────────────────────────────────

function sortClauses(clauses) {
  const order = { red: 0, yellow: 1, green: 2 };
  return [...clauses].sort((a, b) => order[a.risk] - order[b.risk]);
}

// ─────────────────────────────────────────────
// CARD TOGGLE
// ─────────────────────────────────────────────

function toggleCard(card) {
  card.classList.toggle('open');
}

// ─────────────────────────────────────────────
// ESCAPE HTML
// ─────────────────────────────────────────────

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────
// RENDER RESULTS
// ─────────────────────────────────────────────

function renderResults(clauses, fairness, extracted = {}) {
  console.log('renderResults fired — clauses:', clauses?.length, 'score:', fairness?.fairness_score);
  try {
  const sorted = sortClauses(clauses);
  
  const overall =
    calculateOverallRisk(clauses) || {
      label: 'Unknown',
      cls: 'safe',
      emoji: '🟢'
    };



  const red    = clauses.filter(c => c.risk === 'red').length;
  const yellow = clauses.filter(c => c.risk === 'yellow').length;
  const green  = clauses.filter(c => c.risk === 'green').length;

  // ── COUNTS ──
  document.getElementById('redCount').textContent    = red;
  document.getElementById('yellowCount').textContent = yellow;
  document.getElementById('greenCount').textContent  = green;
  document.getElementById('clauseCount').textContent = clauses.length + ' clauses';

  // ── OVERALL RISK ──
  const pill = document.getElementById('overallRiskPill');
 
  if (pill) {
    pill.className =
      'risk-pill ' + (overall.cls || 'safe');
  } 


  
  const riskEmoji =
    document.getElementById('riskEmoji');

  if (riskEmoji) {
    riskEmoji.textContent =
      overall.emoji || '🟢';
  }

  document.getElementById('riskLabel').textContent   = overall.label;
  document.getElementById('riskSubtext').textContent =
    `${clauses.length} clauses analyzed · ${red} flagged as high risk`;

  // ── FAIRNESS PANEL ──
  document.getElementById('fairnessNumber').textContent =
    fairness?.fairness_score ?? 0;

  document.getElementById('fairnessLabel').textContent =
    fairness?.classification?.label ?? 'Unknown';

  // Null-safe market comparison
  const ir = fairness?.market_comparison?.interest_rate ?? {};
  const pf = fairness?.market_comparison?.processing_fee ?? {};

  document.getElementById('interestComparison').textContent =
    `Interest Rate: ${ir.loan_value != null ? ir.loan_value + '%' : 'N/A'} | Typical: ${ir.typical_range ?? 'N/A'}`;

  document.getElementById('feeComparison').textContent =
    `Processing Fee: ${pf.loan_value != null ? pf.loan_value + '%' : 'N/A'} | Typical: ${pf.typical_range ?? 'N/A'}`;

  // ── MAJOR RISKS ──
  const risksContainer = document.getElementById('majorRisks');
  const majorRisks = Array.isArray(fairness?.major_risks) ? fairness.major_risks : [];
  risksContainer.innerHTML = majorRisks.length
    ? majorRisks.map(risk => `<div class="risk-chip">⚠ ${escapeHtml(risk)}</div>`).join('')
    : '<div style="font-size:13px;color:var(--text-muted)">No major risks detected.</div>';

  // ── CLAUSE CARDS ──
  const container = document.getElementById('clauseCards');
  container.innerHTML = '';

  sorted.forEach((item, i) => {
    const riskWord =
      item.risk === 'red' ? 'High Risk' :
      item.risk === 'yellow' ? 'Moderate' : 'Safe';

    const explanationText = item.explanation || item.clause || 'No explanation available';
    const preview = escapeHtml(explanationText.slice(0, 80)) + '…';

    const card = document.createElement('div');
    card.className = `clause-card ${item.risk || 'green'}`;
    card.dataset.risk = item.risk || 'green';
    card.style.animationDelay = (i * 0.05) + 's';

    card.innerHTML = `
      <div class="clause-header">
        <div class="clause-header-left">
          <div class="risk-dot ${item.risk || 'green'}"></div>
          <span class="risk-label ${item.risk || 'green'}">${riskWord}</span>
          <span class="clause-preview">${preview}</span>
        </div>
        <svg class="clause-chevron" width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="clause-divider"></div>
      <div class="clause-body">
        <div class="clause-original">${escapeHtml(item.clause || '')}</div>
        <div class="clause-explanation">${escapeHtml(item.explanation || '')}</div>
        <div class="clause-reason">${escapeHtml(item.reason || '')}</div>
      </div>
    `;

    card.querySelector('.clause-header').addEventListener('click', () => toggleCard(card));
    container.appendChild(card);
  });

  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) {
    console.error('renderResults crashed at:', e);
  }
}

// ─────────────────────────────────────────────
// ERROR
// ─────────────────────────────────────────────

function showError(msg) {
  const toast = document.getElementById('errorToast');
  document.getElementById('errorMsg').textContent = msg;
  toast.style.display = 'flex';
  setTimeout(() => { toast.style.display = 'none'; }, 5000);
}

// ─────────────────────────────────────────────
// LOADING
// ─────────────────────────────────────────────

const loadingMsgs = [
  'Reading your document…',
  'Extracting loan terms…',
  'Comparing market benchmarks…',
  'Calculating fairness score…',
  'Almost done…'
];

let loadingInterval;

function setLoading(on) {
  const btn    = document.getElementById('analyzeBtn');
  const loader = document.getElementById('loadingState');
  btn.disabled = on;
  loader.style.display = on ? 'flex' : 'none';
  document.getElementById('errorToast').style.display = 'none';

  if (on) {
    let i = 0;
    document.getElementById('loadingText').textContent = loadingMsgs[0];
    loadingInterval = setInterval(() => {
      i = (i + 1) % loadingMsgs.length;
      document.getElementById('loadingText').textContent = loadingMsgs[i];
    }, 1800);
  } else {
    clearInterval(loadingInterval);
  }
}

// ─────────────────────────────────────────────
// MAIN ANALYSIS
// ─────────────────────────────────────────────

async function runAnalysis() {
  let text = document.getElementById('loanText').value.trim();

  if (selectedFile) {
    setLoading(true);
    try {
      text = await extractTextFromPDF(selectedFile);
      if (!text || text.trim().length < 50) {
        showError('Could not extract text from this PDF.');
        setLoading(false);
        return;
      }
    } catch (e) {
      showError('PDF extraction failed: ' + e.message);
      setLoading(false);
      return;
    }
  } else if (!text) {
    showError('Please upload a PDF or paste loan text.');
    return;
  }

  const language = document.getElementById('langSelect').value;
  setLoading(true);

  try {
    const result = await analyzeLoan(text, language);

    const clauses = Array.isArray(result.clauses) ? result.clauses : [];
    const fairness = result.fairness ?? {
      fairness_score: 0,
      classification: { label: 'Unknown' },
      market_comparison: { interest_rate: {}, processing_fee: {} },
      major_risks: []
    };

    if (!clauses.length) {
      showError('Analysis failed. Please try again.');
      setLoading(false);
      return;
    }

    currentClauses = clauses;
    console.log('About to call renderResults...');
    renderResults(clauses, fairness, result.extracted);

  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(false);
  }
}

// ─────────────────────────────────────────────
// LANGUAGE RE-RUN
// ─────────────────────────────────────────────

document.getElementById('langSelect').addEventListener('change', async function () {
  if (currentClauses.length === 0) return;

  let text = document.getElementById('loanText').value.trim();
  if (selectedFile && !text) {
    text = await extractTextFromPDF(selectedFile).catch(() => '');
  }
  if (!text) return;

  const language = this.value;
  setLoading(true);

  try {
    const result = await analyzeLoan(text, language);
    renderResults(
      Array.isArray(result.clauses) ? result.clauses : [],
      result.fairness ?? {
        fairness_score: 0,
        classification: { label: 'Unknown' },
        market_comparison: { interest_rate: {}, processing_fee: {} },
        major_risks: []
      }
    );
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(false);
  }
});

// ─────────────────────────────────────────────
// CLEAR
// ─────────────────────────────────────────────

function clearAll() {
  clearFile();
  document.getElementById('loanText').value = '';
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('errorToast').style.display = 'none';
  currentClauses = [];
}

// ─────────────────────────────────────────────
// EMI CALCULATOR
// ─────────────────────────────────────────────

function calcEMI(principal, annualRate, years) {
  const r = annualRate / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

function formatRupees(amount) {
  if (amount >= 10000000) return '₹' + (amount / 10000000).toFixed(2) + ' Cr';
  if (amount >= 100000)   return '₹' + (amount / 100000).toFixed(2) + ' L';
  return '₹' + Math.round(amount).toLocaleString('en-IN');
}

function runCalc() {
  const pA = parseFloat(document.getElementById('calcPrincipalA').value);
  const rA = parseFloat(document.getElementById('calcRateA').value);
  const tA = parseFloat(document.getElementById('calcTenureA').value);

  const pB = parseFloat(document.getElementById('calcPrincipalB').value);
  const rB = parseFloat(document.getElementById('calcRateB').value);
  const tB = parseFloat(document.getElementById('calcTenureB').value);

  if ([pA,rA,tA,pB,rB,tB].some(isNaN)) {
    showError('Please fill in all fields in the calculator.');
    return;
  }

  const emiA = calcEMI(pA, rA, tA);
  const emiB = calcEMI(pB, rB, tB);

  const totalA    = emiA * tA * 12;
  const totalB    = emiB * tB * 12;
  const interestA = totalA - pA;
  const interestB = totalB - pB;

  document.getElementById('emiA').textContent      = formatRupees(emiA);
  document.getElementById('totalA').textContent    = formatRupees(totalA);
  document.getElementById('interestA').textContent = formatRupees(interestA);

  document.getElementById('emiB').textContent      = formatRupees(emiB);
  document.getElementById('totalB').textContent    = formatRupees(totalB);
  document.getElementById('interestB').textContent = formatRupees(interestB);

  const diff = Math.abs(interestA - interestB);
  const cheaper = interestA < interestB ? 'Loan A' : 'Loan B';
  const dearer  = interestA < interestB ? 'Loan B' : 'Loan A';

  document.getElementById('calcVerdict').innerHTML =
    `<strong>${cheaper}</strong> saves you <strong class="gold">${formatRupees(diff)}</strong> in total interest compared to ${dearer}.`;

  document.getElementById('calcResults').style.display = 'block';
  document.getElementById('calcResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fillCalculator(extracted, slot = 'A') {
  const p = slot === 'A' ? 'calcPrincipalA' : 'calcPrincipalB';
  const r = slot === 'A' ? 'calcRateA'      : 'calcRateB';
  const t = slot === 'A' ? 'calcTenureA'    : 'calcTenureB';

  // principal — use a sensible default if not in doc
  document.getElementById(p).value = 4000000;

  if (extracted?.interest_rate)
    document.getElementById(r).value = extracted.interest_rate;

  // tenure — default 20yr for home loans, 5yr for personal
  const defaultTenure = extracted?.loan_type === 'home_loan' ? 20 : 5;
  document.getElementById(t).value = defaultTenure;
}

let calcSlot = 'A';

async function loadDemo(docId) {
  clearAll();
  setLoading(true);
  
  await new Promise(r => setTimeout(r, 2000));
  
  try {
    const res = await fetch(`/demo/${docId}`);
    const result = await res.json();
    
    const clauses = Array.isArray(result.clauses) ? result.clauses : [];
    const fairness = result.fairness ?? {
      fairness_score: 0,
      classification: { label: 'Unknown' },
      market_comparison: { interest_rate: {}, processing_fee: {} },
      major_risks: []
    };
    
    currentClauses = clauses;
    renderResults(clauses, fairness, result.extracted);
    fillCalculator(result.extracted, calcSlot);
    calcSlot = calcSlot === 'A' ? 'B' : 'A'; // toggle for next click
    
  } catch(e) {
    showError('Could not load demo document.');
  } finally {
    setLoading(false);
  }
}