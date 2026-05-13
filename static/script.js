pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let selectedFile = null;
let currentClauses = [];

// ── FILE HANDLING ──
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const filePreview = document.getElementById('filePreview');

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
fileInput.addEventListener('change', e => { if (e.target.files[0]) showFile(e.target.files[0]); });

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type === 'application/pdf') showFile(f);
  else showError('Please drop a PDF file.');
});

// ── PDF TEXT EXTRACTION ──
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

// ── PROMPT BUILDER ──
function buildSystemPrompt(language) {
  return `You are a legal plain-language assistant for low-income Indian borrowers who have no financial or legal background.

Analyze the loan document provided. Identify every significant clause.

For each clause return a JSON array where each item has exactly these fields:
- clause: the original clause text copied verbatim
- explanation: plain language explanation a Class 8 student can understand
- risk: exactly one of these values: "red", "yellow", or "green"
- reason: one sentence explaining why you assigned that risk level

Risk classification guide:
- red: potentially predatory or harmful — high penalty rates, lender discretion clauses, waiver of borrower rights, hidden fees
- yellow: important to understand but not necessarily harmful — prepayment terms, interest calculation method, modification rights
- green: completely standard boilerplate found in every loan agreement

Return ALL explanations in ${language}.
Return ONLY a valid JSON array.
Do NOT use markdown.
Do NOT wrap in code fences.
Do NOT add any text before or after the JSON array.
Start your response with [ and end with ].`;
}

// ── GEMINI API CALL ──
async function callGemini(text, language) {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language })
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || `Server error ${response.status}`);
  }
  return data.result;
}

// ── RESPONSE PARSER ──
function parseResponse(raw) {
  try {
    const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) return null;
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    console.error('Parse error:', e);
    return null;
  }
}

// ── RISK CALCULATOR ──
function calculateOverallRisk(clauses) {
  const red = clauses.filter(c => c.risk === 'red').length;
  const yellow = clauses.filter(c => c.risk === 'yellow').length;
  if (red >= 2) return { label: 'High Risk', cls: 'high', emoji: '🔴' };
  if (red === 1 || yellow >= 3) return { label: 'Moderate Risk', cls: 'moderate', emoji: '🟡' };
  return { label: 'Safe to Sign', cls: 'safe', emoji: '🟢' };
}

// ── SORT CLAUSES ──
function sortClauses(clauses) {
  const order = { red: 0, yellow: 1, green: 2 };
  return [...clauses].sort((a, b) => order[a.risk] - order[b.risk]);
}

// ── ACTIVE TAB STATE ──
let activeTab = 'red';

// ── TAB SWITCHING ──
function switchTab(tab) {
  activeTab = tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  document.querySelectorAll('.clause-card').forEach(card => {
    if (tab === 'all') {
      card.classList.remove('hidden');
    } else {
      card.classList.toggle('hidden', !card.dataset.risk || card.dataset.risk !== tab);
    }
  });
}

// ── COLLAPSIBLE TOGGLE ──
function toggleCard(card) {
  card.classList.toggle('open');
}

// ── RENDER RESULTS ──
function renderResults(clauses) {
  const sorted = sortClauses(clauses);
  const overall = calculateOverallRisk(clauses);

  const red = clauses.filter(c => c.risk === 'red').length;
  const yellow = clauses.filter(c => c.risk === 'yellow').length;
  const green = clauses.filter(c => c.risk === 'green').length;

  document.getElementById('redCount').textContent = red;
  document.getElementById('yellowCount').textContent = yellow;
  document.getElementById('greenCount').textContent = green;
  document.getElementById('clauseCount').textContent = clauses.length;

  const pill = document.getElementById('overallRiskPill');
  pill.className = 'risk-pill ' + overall.cls;
  document.getElementById('riskEmoji').textContent = overall.emoji;
  document.getElementById('riskLabel').textContent = overall.label;
  document.getElementById('riskSubtext').textContent = `${clauses.length} clauses analyzed · ${red} flagged as high risk`;

  const container = document.getElementById('clauseCards');
  container.innerHTML = '';

  sorted.forEach((item, i) => {
    const riskWord = item.risk === 'red' ? 'High Risk' : item.risk === 'yellow' ? 'Moderate' : 'Safe';
    const preview = escapeHtml((item.explanation || item.clause || '').slice(0, 80)) + '…';

    const card = document.createElement('div');
    card.className = `clause-card ${item.risk}`;
    card.dataset.risk = item.risk;
    card.style.animationDelay = (i * 0.05) + 's';
    card.innerHTML = `
      <div class="clause-header">
        <div class="clause-header-left">
          <div class="risk-dot ${item.risk}"></div>
          <span class="risk-label ${item.risk}">${riskWord}</span>
          <span class="clause-preview">${preview}</span>
        </div>
        <svg class="clause-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
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

  // Default to red tab (or all if no red clauses)
  activeTab = red > 0 ? 'red' : yellow > 0 ? 'yellow' : 'all';
  switchTab(activeTab);

  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── WIRE UP TABS ──
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── ERROR ──
function showError(msg) {
  const toast = document.getElementById('errorToast');
  document.getElementById('errorMsg').textContent = msg;
  toast.style.display = 'flex';
  setTimeout(() => toast.style.display = 'none', 5000);
}

// ── LOADING MESSAGES ──
const loadingMsgs = [
  'Reading your document…',
  'Identifying clauses…',
  'Consulting Gemini AI…',
  'Classifying risk levels…',
  'Almost done…'
];
let loadingInterval;

function setLoading(on) {
  const btn = document.getElementById('analyzeBtn');
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

// ── MAIN ANALYSIS ──
async function runAnalysis() {
  let text = document.getElementById('loanText').value.trim();

  if (selectedFile) {
    setLoading(true);
    try {
      text = await extractTextFromPDF(selectedFile);
      if (!text || text.trim().length < 50) {
        showError('Could not extract text from this PDF. Try a digital (not scanned) PDF, or paste the text below.');
        setLoading(false);
        return;
      }
    } catch (e) {
      showError('PDF extraction failed: ' + e.message);
      setLoading(false);
      return;
    }
  } else if (!text) {
    showError('Please upload a PDF or paste loan document text.');
    return;
  }

  const language = document.getElementById('langSelect').value;
  setLoading(true);

  try {
    const raw = await callGemini(text, language);
    const clauses = parseResponse(raw);

    if (!clauses || !Array.isArray(clauses) || clauses.length === 0) {
      showError('Analysis failed — could not parse AI response. Please try again.');
      setLoading(false);
      return;
    }

    currentClauses = clauses;
    renderResults(clauses);
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(false);
  }
}

// ── LANGUAGE RE-ANALYSIS ──
document.getElementById('langSelect').addEventListener('change', async function () {
  if (currentClauses.length === 0) return;
  const text = document.getElementById('loanText').value.trim();
  if (!text && !selectedFile) return;

  const language = this.value;
  setLoading(true);

  let docText = text;
  if (selectedFile && !docText) {
    docText = await extractTextFromPDF(selectedFile).catch(() => '');
  }

  if (!docText) { setLoading(false); return; }

  try {
    const raw = await callGemini(docText, language);
    const clauses = parseResponse(raw);
    if (clauses && clauses.length > 0) {
      currentClauses = clauses;
      renderResults(clauses);
    }
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(false);
  }
});

// ── CLEAR ──
function clearAll() {
  clearFile();
  document.getElementById('loanText').value = '';
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('errorToast').style.display = 'none';
  currentClauses = [];
}
