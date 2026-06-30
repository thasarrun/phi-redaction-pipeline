// ---------------------------------------------------------------
// PHI Shield — frontend demo logic
//
// mockDetectPHI() is a regex-based stand-in for the real detector.
// It exists so the UI is fully clickable/testable before the backend
// NER model is wired up. Swap the body of this function for a call
// to your real detection service and everything else keeps working.
// ---------------------------------------------------------------

const SAMPLE_NOTE = `Patient: John Carter
DOB: 04/12/1981
SSN: 011-22-3344
MRN: 0049213
Phone: (415) 555-0148

Pt is a 44 y/o male presenting with persistent cough x2 weeks,
mild fever, no shortness of breath. Reports recent travel.
Seen previously by Dr. Susan Lee on 02/03/2026 for similar symptoms.
Plan: chest x-ray, CBC, follow up in 1 week.`;

const PATTERNS = [
  { label: "SSN",    type: "ssn",   regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { label: "MRN",    type: "mrn",   regex: /\bMRN:?\s?\d{4,10}\b/gi },
  { label: "Phone",  type: "phone", regex: /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g },
  { label: "Date",   type: "date",  regex: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  // Title-case name pairs (e.g. "John Carter", "Susan Lee") — crude stand-in for NER.
  // Skipped if preceded by "Dr." since that's handled as a separate, lower-risk case below.
  { label: "Name",   type: "name",  regex: /\b(?<!Dr\.\s)[A-Z][a-z]+\s[A-Z][a-z]+\b/g },
];

function mockDetectPHI(text) {
  const matches = [];
  for (const { label, type, regex } of PATTERNS) {
    let m;
    const re = new RegExp(regex); // fresh instance, regex objects are stateful
    while ((m = re.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, label, type, value: m[0] });
    }
  }
  // Sort by position, drop overlaps (keep the first/longest match found at a position)
  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const clean = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      clean.push(m);
      lastEnd = m.end;
    }
  }
  return clean;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderRedacted(text, matches) {
  if (matches.length === 0) return escapeHtml(text);
  let out = "";
  let cursor = 0;
  matches.forEach((m, i) => {
    out += escapeHtml(text.slice(cursor, m.start));
    const bar = "█".repeat(Math.max(4, Math.min(m.value.length, 14)));
    out += `<span class="redaction-bar" style="animation-delay:${i * 0.05}s">${bar}</span>`;
    cursor = m.end;
  });
  out += escapeHtml(text.slice(cursor));
  return out;
}

function tallyByType(matches) {
  const counts = {};
  for (const m of matches) counts[m.label] = (counts[m.label] || 0) + 1;
  return counts;
}

function runScan() {
  const input = document.getElementById("noteInput");
  const outputArea = document.getElementById("outputArea");
  const detectedPanel = document.getElementById("detectedPanel");
  const detectedList = document.getElementById("detectedList");
  const stamp = document.getElementById("stamp");
  const statusDot = document.querySelector(".status-dot");
  const statusText = document.querySelector(".status-text");

  const text = input.value;

  if (!text.trim()) {
    outputArea.innerHTML = `<p class="output-empty">Nothing to scan yet — type or paste a note on the left.</p>`;
    detectedPanel.hidden = true;
    stamp.hidden = true;
    return;
  }

  const matches = mockDetectPHI(text);
  outputArea.innerHTML = renderRedacted(text, matches);

  detectedList.innerHTML = "";
  if (matches.length === 0) {
    detectedList.innerHTML = `<li class="is-empty">No PHI patterns matched</li>`;
  } else {
    const counts = tallyByType(matches);
    for (const [label, count] of Object.entries(counts)) {
      const li = document.createElement("li");
      li.textContent = `${label} · ${count}`;
      detectedList.appendChild(li);
    }
  }
  detectedPanel.hidden = false;

  // restart stamp animation
  stamp.hidden = false;
  stamp.style.animation = "none";
  requestAnimationFrame(() => { stamp.style.animation = ""; });

  if (matches.length > 0) {
    statusDot.classList.add("tripped");
    statusText.textContent = `Barrier active — ${matches.length} item${matches.length === 1 ? "" : "s"} caught before export`;
  } else {
    statusDot.classList.remove("tripped");
    statusText.textContent = "Barrier active — nothing caught in this note";
  }
}

document.getElementById("scanBtn").addEventListener("click", runScan);

document.getElementById("sampleBtn").addEventListener("click", () => {
  document.getElementById("noteInput").value = SAMPLE_NOTE;
  runScan();
});
