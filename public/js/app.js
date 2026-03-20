/* ══════════════════════════════════════════════════════════════════════════════
   PageHub — app.js  (fully client-side, no server API calls)
══════════════════════════════════════════════════════════════════════════════ */

/* ── Theme persistence — runs before any render ─────────────────────────────── */
(function () {
  if (localStorage.getItem('pagehub-theme') === 'dark')
    document.documentElement.setAttribute('data-theme', 'dark');
})();

/* ── CDN globals (null-safe destructure) ────────────────────────────────────── */
let PDFDocument, rgb, StandardFonts, degrees;
if (typeof PDFLib !== 'undefined') {
  ({ PDFDocument, rgb, StandardFonts, degrees } = PDFLib);
} else {
  console.error('pdf-lib failed to load from CDN');
}

if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ── Navigation ──────────────────────────────────────────────────────────────── */
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const next    = document.getElementById('view-' + btn.dataset.tool);
    const current = document.querySelector('.tool-view.active');
    if (!next || current === next) return;

    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (current) {
      current.classList.add('view-exit');
      setTimeout(() => {
        current.classList.remove('active', 'view-exit');
        next.classList.add('active');
        next.closest('.main')?.scrollTo({ top: 0, behavior: 'instant' });
      }, 140);
    } else {
      next.classList.add('active');
    }
  });
});

/* ── Home dashboard card clicks ─────────────────────────────────────────────── */
document.querySelectorAll('.home-card').forEach(card => {
  card.addEventListener('click', () => navigateTo(card.dataset.tool));
});

/* ── Colour preset buttons ──────────────────────────────────────────────────── */
document.querySelectorAll('.color-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.for);
    if (input) {
      input.value = btn.dataset.color;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    btn.closest('.color-row').querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════════════════ */

function fmt(bytes) {
  if (bytes < 1024)    return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return rgb(r, g, b);
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/* Render PDF page 1 to a <canvas> using pdfjs CDN.
   Returns true on success, false if pdfjs unavailable or render fails. */
async function renderPageToCanvas(arrayBuffer, canvasEl, maxWidth = 280) {
  if (typeof pdfjsLib === 'undefined') return false;
  try {
    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const page   = await pdfDoc.getPage(1);
    const vp0    = page.getViewport({ scale: 1 });
    const scale  = maxWidth / vp0.width;
    const vp     = page.getViewport({ scale });
    canvasEl.width  = Math.floor(vp.width);
    canvasEl.height = Math.floor(vp.height);
    await page.render({ canvasContext: canvasEl.getContext('2d'), viewport: vp }).promise;
    return true;
  } catch (e) {
    console.warn('Preview render failed:', e.message);
    return false;
  }
}

/* Update drop zone appearance once a file is selected — gives clear feedback */
function setDropZoneFile(dropEl, file) {
  dropEl.classList.add('has-file');
  const icon = dropEl.querySelector('.drop-icon');
  const p    = dropEl.querySelector('p');
  const hint = dropEl.querySelector('.drop-hint');
  if (icon) icon.textContent = '📄';
  if (p)    p.innerHTML = `<strong style="color:var(--text-primary)">${file.name}</strong>`;
  if (hint) hint.textContent = fmt(file.size) + ' · click or drop to replace';
}

/* Reset a drop zone back to empty state */
function resetDropZone(dropEl, iconText, mainHtml, hintText) {
  dropEl.classList.remove('has-file', 'dragover');
  const icon = dropEl.querySelector('.drop-icon');
  const p    = dropEl.querySelector('p');
  const hint = dropEl.querySelector('.drop-hint');
  if (icon) icon.textContent = iconText;
  if (p)    p.innerHTML = mainHtml;
  if (hint) hint.textContent = hintText;
}

function showLoading(el, msg = 'Processing…') {
  el.innerHTML = `<div class="loading-card"><div class="spinner"></div>${msg}</div>`;
}

function showLoadingCancelable(el, msg, onCancel) {
  el.innerHTML = `<div class="loading-card">
    <div class="spinner"></div>
    <span style="flex:1">${msg}</span>
    <button class="btn btn-ghost btn-sm cancel-btn">Cancel</button>
  </div>`;
  el.querySelector('.cancel-btn').addEventListener('click', onCancel);
}

function showResult(el, title, sub, bytes, filename, mimeType = 'application/pdf') {
  const blob = new Blob([bytes], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  el.innerHTML = `<div class="result-card">
    <div class="result-icon">✅</div>
    <div class="result-text">
      <div class="result-title">${title}</div>
      <div class="result-sub">${sub}</div>
    </div>
    <a class="btn btn-success" href="${url}" download="${filename}">Download</a>
  </div>`;
}

function showError(el, msg) {
  el.innerHTML = `<div class="error-card">⚠ ${msg}</div>`;
}

/* ── Drop-zone factory ──────────────────────────────────────────────────────── */
/*  Key fix: entire drop zone is clickable — no reliance on <label for="...">.
    File inputs use style="display:none" (not `hidden`) for reliable click().  */
function setupDropZone(dropEl, inputEl, callback, multiple = false) {
  dropEl.addEventListener('click', () => inputEl.click());

  dropEl.addEventListener('dragover', e => {
    e.preventDefault();
    dropEl.classList.add('dragover');
  });
  dropEl.addEventListener('dragleave', e => {
    if (!dropEl.contains(e.relatedTarget)) dropEl.classList.remove('dragover');
  });
  dropEl.addEventListener('drop', e => {
    e.preventDefault();
    dropEl.classList.remove('dragover');
    const files = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (files.length) callback(multiple ? files : [files[0]]);
  });
  inputEl.addEventListener('change', () => {
    if (inputEl.files.length) {
      callback(multiple ? [...inputEl.files] : [inputEl.files[0]]);
      inputEl.value = ''; // allow re-selecting same file
    }
  });
}

/* ── Drag-to-reorder ────────────────────────────────────────────────────────── */
function makeSortable(list) {
  let dragged = null;
  list.addEventListener('dragstart', e => {
    dragged = e.target.closest('.file-item');
    setTimeout(() => dragged?.classList.add('dragging'), 0);
  });
  list.addEventListener('dragend', () => dragged?.classList.remove('dragging'));
  list.addEventListener('dragover', e => {
    e.preventDefault();
    const over = e.target.closest('.file-item');
    if (over && over !== dragged) {
      const mid = over.getBoundingClientRect().top + over.getBoundingClientRect().height / 2;
      list.insertBefore(dragged, e.clientY < mid ? over : over.nextSibling);
    }
  });
}

/* ── Page range parser ──────────────────────────────────────────────────────── */
function parsePageRange(str, total) {
  const indices = new Set();
  str.split(',').forEach(part => {
    part = part.trim();
    const m = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (m) {
      const a = parseInt(m[1]), b = parseInt(m[2]);
      for (let i = Math.max(1, a); i <= Math.min(total, b); i++) indices.add(i - 1);
    } else {
      const n = parseInt(part);
      if (!isNaN(n) && n >= 1 && n <= total) indices.add(n - 1);
    }
  });
  return [...indices].sort((a, b) => a - b);
}

/* ── Direct tool navigation ─────────────────────────────────────────────────── */
function navigateTo(tool) {
  const next    = document.getElementById('view-' + tool);
  const current = document.querySelector('.tool-view.active');
  if (!next || current === next) return;
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  if (current) current.classList.remove('active');
  next.classList.add('active');
}

/* ── requirePDFLib guard ────────────────────────────────────────────────────── */
function requirePDFLib(resultEl) {
  if (!PDFDocument) {
    showError(resultEl, 'PDF library not loaded. Check your internet connection and refresh the page.');
    return false;
  }
  return true;
}

/* ── Usage tracking ─────────────────────────────────────────────────────────── */
const USAGE_KEY = 'pagehub-usage';

function getUsage() {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { merge: 0, split: 0, rotate: 0, pagenumbers: 0, headerfooter: 0,
           watermark: 0, compress: 0, redact: 0, formfiller: 0, pdfinfo: 0,
           organiser: 0, sign: 0, edit: 0, lastUpdated: null };
}

function trackUsage(key) {
  const data = getUsage();
  data[key] = (data[key] || 0) + 1;
  data.lastUpdated = new Date().toISOString();
  localStorage.setItem(USAGE_KEY, JSON.stringify(data));
}

/* ══════════════════════════════════════════════════════════════════════════════
   1. MERGE
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const dropEl   = document.getElementById('merge-drop');
  const inputEl  = document.getElementById('merge-input');
  const list     = document.getElementById('merge-list');
  const actions  = document.getElementById('merge-actions');
  const btn      = document.getElementById('merge-btn');
  const result   = document.getElementById('merge-result');
  const clearBtn = document.getElementById('merge-clear');
  let files = [];
  let aborted = false;

  makeSortable(list);

  function renderList() {
    list.innerHTML = '';
    files.forEach((f, i) => {
      const li = document.createElement('li');
      li.className  = 'file-item';
      li.draggable  = true;
      li.dataset.idx = i;
      li.innerHTML  = `<span class="drag-handle">⠿</span>
        <span class="file-name">${f.name}</span>
        <span class="file-size">${fmt(f.size)}</span>
        <button class="remove-btn" data-i="${i}">×</button>`;
      list.appendChild(li);
    });
    actions.style.display = files.length >= 2 ? '' : 'none';
    if (clearBtn) clearBtn.style.display = files.length ? '' : 'none';
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      files = [];
      aborted = true;
      result.innerHTML = '';
      resetDropZone(dropEl, '⊕', 'Drop PDF files here or <span class="link-label">browse</span>', 'Accepts multiple files — drag to reorder');
      renderList();
    });
  }

  list.addEventListener('click', e => {
    const rb = e.target.closest('.remove-btn');
    if (rb) { files.splice(+rb.dataset.i, 1); renderList(); }
  });

  setupDropZone(dropEl, inputEl, newFiles => {
    files.push(...newFiles);
    renderList();
  }, true);

  btn.addEventListener('click', async () => {
    if (!requirePDFLib(result)) return;
    const orderedFiles = [...list.querySelectorAll('.file-item')].map(li => files[+li.dataset.idx]);
    const filename = document.getElementById('merge-filename').value.trim() || 'merged.pdf';
    const large    = orderedFiles.some(f => f.size > 5 * 1024 * 1024);
    aborted = false;
    trackUsage('merge');

    if (large) {
      showLoadingCancelable(result, 'Merging PDFs…', () => { aborted = true; result.innerHTML = ''; });
    } else {
      showLoading(result, 'Merging PDFs…');
    }

    try {
      const merged = await PDFDocument.create();
      for (const f of orderedFiles) {
        if (aborted) return;
        const buf  = await readFile(f);
        const doc  = await PDFDocument.load(buf);
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      }
      if (aborted) return;
      const bytes = await merged.save();
      if (aborted) return;
      showResult(result, 'PDFs merged!', `${fmt(bytes.length)} · ${filename}`, bytes, filename);
    } catch (e) {
      if (!aborted) showError(result, e.message || 'Failed to merge PDFs');
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   2. SPLIT  — multi-range, individual PDF downloads (no zip)
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const dropEl     = document.getElementById('split-drop');
  const inputEl    = document.getElementById('split-input');
  const opts       = document.getElementById('split-options');
  const rangesList = document.getElementById('split-ranges-list');
  const result     = document.getElementById('split-result');
  const clearBtn   = document.getElementById('split-clear');
  let file = null;
  let srcPageCount = 0;
  let aborted = false;

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      file = null; srcPageCount = 0; aborted = true;
      opts.style.display = 'none';
      result.innerHTML = '';
      rangesList.innerHTML = '';
      resetDropZone(dropEl, '⊖', 'Drop a PDF here or <span class="link-label">browse</span>', 'Single PDF file');
      clearBtn.style.display = 'none';
    });
  }

  setupDropZone(dropEl, inputEl, async files => {
    file = files[0];
    setDropZoneFile(dropEl, file);
    if (clearBtn) clearBtn.style.display = '';
    showLoading(result, 'Reading…');
    try {
      const buf = await readFile(file);
      const doc = await PDFDocument.load(buf);
      srcPageCount = doc.getPageCount();
      result.innerHTML = '';
      opts.style.display = '';
      if (!rangesList.children.length) {
        addRange('1', 'part-1.pdf');
        addRange('2-' + srcPageCount, 'part-2.pdf');
      }
    } catch (e) {
      showError(result, e.message || 'Could not read PDF');
    }
  });

  function addRange(defaultPages = '', defaultName = '') {
    const idx  = rangesList.children.length + 1;
    const item = document.createElement('div');
    item.className = 'split-range-item';
    item.innerHTML = `
      <div class="split-range-field">
        <label>Pages</label>
        <input type="text" class="text-input range-pages" value="${defaultPages}" placeholder="e.g. 1-3, 5" />
      </div>
      <div class="split-range-field">
        <label>Output filename</label>
        <input type="text" class="text-input wide range-filename" value="${defaultName || 'part-' + idx + '.pdf'}" />
      </div>
      <button class="btn-danger-ghost" title="Remove">×</button>`;
    item.querySelector('.btn-danger-ghost').addEventListener('click', () => item.remove());
    rangesList.appendChild(item);
  }

  document.getElementById('split-add-range').addEventListener('click', () => addRange());

  document.getElementById('split-btn').addEventListener('click', async () => {
    if (!requirePDFLib(result)) return;
    if (!file) { showError(result, 'Upload a PDF first'); return; }

    const items = [...rangesList.querySelectorAll('.split-range-item')];
    if (!items.length) { showError(result, 'Add at least one range'); return; }

    aborted = false;
    trackUsage('split');
    const large = file.size > 5 * 1024 * 1024;
    if (large) {
      showLoadingCancelable(result, `Building ${items.length} PDF${items.length > 1 ? 's' : ''}…`, () => {
        aborted = true; result.innerHTML = '';
      });
    } else {
      showLoading(result, `Building ${items.length} PDF${items.length > 1 ? 's' : ''}…`);
    }

    try {
      const buf = await readFile(file);
      if (aborted) return;
      const src = await PDFDocument.load(buf);
      const pc  = src.getPageCount();

      const downloads = [];
      for (const item of items) {
        if (aborted) return;
        const pagesStr = item.querySelector('.range-pages').value.trim();
        const filename = item.querySelector('.range-filename').value.trim() || 'output.pdf';
        const indices  = pagesStr ? parsePageRange(pagesStr, pc) : Array.from({ length: pc }, (_, i) => i);
        if (!indices.length) continue;

        const out   = await PDFDocument.create();
        const pages = await out.copyPages(src, indices);
        pages.forEach(p => out.addPage(p));
        const bytes = await out.save();
        downloads.push({ bytes, filename, pages: indices.length });
      }

      if (aborted || !downloads.length) {
        if (!aborted) showError(result, 'No valid page ranges');
        return;
      }

      for (let i = 0; i < downloads.length; i++) {
        const { bytes, filename } = downloads[i];
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        if (i < downloads.length - 1) await new Promise(r => setTimeout(r, 200));
      }

      result.innerHTML = `<div class="result-list">
        ${downloads.map(d => `
          <div class="result-list-item">
            <span>✅</span>
            <span class="result-name">${d.filename}</span>
            <span class="result-pages">${d.pages} page${d.pages !== 1 ? 's' : ''} · ${fmt(d.bytes.length)}</span>
          </div>`).join('')}
      </div>`;
    } catch (e) {
      if (!aborted) showError(result, e.message || 'Failed to split PDF');
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   3. ROTATE  — fixed file selection + odd/even + live canvas preview
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const dropEl   = document.getElementById('rotate-drop');
  const inputEl  = document.getElementById('rotate-input');
  const opts     = document.getElementById('rotate-options');
  const rangeRow = document.getElementById('rotate-range-row');
  const result   = document.getElementById('rotate-result');
  const prevCanvas   = document.getElementById('rotate-preview-canvas');
  const prevPh       = document.getElementById('rotate-preview-placeholder');
  const prevLabel    = document.getElementById('rotate-preview-label');
  const clearBtn     = document.getElementById('rotate-clear');
  let file = null;
  let aborted = false;
  let rawBuf  = null; // keep ArrayBuffer for re-render

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      file = null; rawBuf = null; aborted = true;
      opts.style.display = 'none';
      result.innerHTML = '';
      prevCanvas.style.display = 'none';
      prevCanvas.style.transform = '';
      if (prevPh) prevPh.style.display = '';
      if (prevLabel) prevLabel.textContent = '';
      resetDropZone(dropEl, '↻', 'Drop a PDF here or <span class="link-label">browse</span>', 'Single PDF file');
      clearBtn.style.display = 'none';
    });
  }

  /* ── Preview helpers ── */
  function updateRotateAngleLabel() {
    const val   = document.querySelector('input[name="rotate-angle"]:checked')?.value || '90';
    const isReset = val === 'reset';
    const angle   = isReset ? 0 : parseInt(val);
    if (prevLabel)  prevLabel.textContent = isReset ? 'Page 1 · rotation removed (0°)' : `Page 1 · ${angle}° rotation applied`;
    if (prevCanvas) prevCanvas.style.transform = `rotate(${angle}deg)`;
  }

  async function loadPreview(buf) {
    const ok = await renderPageToCanvas(buf, prevCanvas, 260);
    if (ok) {
      prevCanvas.style.display = '';
      if (prevPh) prevPh.style.display = 'none';
      updateRotateAngleLabel();
    }
  }

  /* ── Drop zone ── */
  setupDropZone(dropEl, inputEl, async files => {
    file = files[0];
    setDropZoneFile(dropEl, file);
    if (clearBtn) clearBtn.style.display = '';
    opts.style.display = '';
    rawBuf = await readFile(file).catch(() => null);
    if (rawBuf) loadPreview(rawBuf);
  });

  /* ── Range visibility ── */
  document.querySelectorAll('input[name="rotate-target"]').forEach(r => {
    r.addEventListener('change', () => {
      rangeRow.style.display = r.value === 'custom' ? '' : 'none';
    });
  });

  /* ── Angle change → update preview rotation ── */
  document.querySelectorAll('input[name="rotate-angle"]').forEach(r => {
    r.addEventListener('change', updateRotateAngleLabel);
  });

  /* ── Process ── */
  document.getElementById('rotate-btn').addEventListener('click', async () => {
    if (!requirePDFLib(result)) return;
    if (!file) { showError(result, 'Please upload a PDF first'); return; }

    const angleVal  = document.querySelector('input[name="rotate-angle"]:checked').value;
    const isReset   = angleVal === 'reset';
    const angleDeg  = isReset ? 0 : parseInt(angleVal);
    const target    = document.querySelector('input[name="rotate-target"]:checked').value;
    const filename  = document.getElementById('rotate-filename').value.trim() || 'rotated.pdf';
    const large     = file.size > 5 * 1024 * 1024;
    aborted = false;
    trackUsage('rotate');

    if (large) {
      showLoadingCancelable(result, isReset ? 'Removing rotation…' : 'Rotating pages…', () => { aborted = true; result.innerHTML = ''; });
    } else {
      showLoading(result, isReset ? 'Removing rotation…' : 'Rotating pages…');
    }

    try {
      const buf = await readFile(file);
      if (aborted) return;
      const doc = await PDFDocument.load(buf);
      if (aborted) return;
      const pc  = doc.getPageCount();

      let indices;
      if      (target === 'all')    indices = Array.from({ length: pc }, (_, i) => i);
      else if (target === 'odd')    indices = Array.from({ length: pc }, (_, i) => i).filter(i => i % 2 === 0);
      else if (target === 'even')   indices = Array.from({ length: pc }, (_, i) => i).filter(i => i % 2 === 1);
      else                          indices = parsePageRange(document.getElementById('rotate-range').value, pc);

      indices.forEach(i => {
        const page = doc.getPage(i);
        if (isReset) {
          // Absolute reset — force 0° regardless of current rotation
          page.setRotation(degrees(0));
        } else {
          // Additive rotation
          page.setRotation(degrees((page.getRotation().angle + angleDeg) % 360));
        }
      });

      if (aborted) return;
      const bytes = await doc.save();
      if (aborted) return;
      const resultLabel = isReset ? 'Rotation removed!' : 'Pages rotated!';
      showResult(result, resultLabel, `${fmt(bytes.length)} · ${filename}`, bytes, filename);
    } catch (e) {
      if (!aborted) showError(result, e.message || 'Failed to rotate PDF');
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   4. PAGE NUMBERS  — with live mock page preview
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const dropEl = document.getElementById('pn-drop');
  const inputEl= document.getElementById('pn-input');
  const opts   = document.getElementById('pn-options');
  const result = document.getElementById('pn-result');
  const mockNum = document.getElementById('pn-mock-number');
  const clearBtn = document.getElementById('pn-clear');
  let file = null;
  let selectedPos = 'top-center';
  let aborted = false;

  const POS_MAP = {
    'top-left':      { top: '12px', left: '12px',  right: 'auto', bottom: 'auto', transform: 'none' },
    'top-center':    { top: '12px', left: '50%',   right: 'auto', bottom: 'auto', transform: 'translateX(-50%)' },
    'top-right':     { top: '12px', right: '12px', left: 'auto',  bottom: 'auto', transform: 'none' },
    'bottom-left':   { bottom: '12px', left: '12px',  top: 'auto', right: 'auto', transform: 'none' },
    'bottom-center': { bottom: '12px', left: '50%',   top: 'auto', right: 'auto', transform: 'translateX(-50%)' },
    'bottom-right':  { bottom: '12px', right: '12px', top: 'auto', left: 'auto',  transform: 'none' },
  };

  function updateMock() {
    if (!mockNum) return;
    const format   = document.getElementById('pn-format').value;
    const startNum = parseInt(document.getElementById('pn-start').value) || 1;
    const color    = document.getElementById('pn-color').value;
    const label    = format.replace('{n}', startNum).replace('{total}', '?');
    mockNum.textContent = label;
    mockNum.style.color = color;
    const pos = POS_MAP[selectedPos] || POS_MAP['top-center'];
    Object.assign(mockNum.style, pos);
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      file = null; aborted = true;
      opts.style.display = 'none';
      result.innerHTML = '';
      resetDropZone(dropEl, '#', 'Drop a PDF here or <span class="link-label">browse</span>', 'Single PDF file');
      clearBtn.style.display = 'none';
    });
  }

  setupDropZone(dropEl, inputEl, files => {
    file = files[0];
    setDropZoneFile(dropEl, file);
    if (clearBtn) clearBtn.style.display = '';
    opts.style.display = '';
    updateMock();
  });

  document.querySelectorAll('.pos-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedPos = btn.dataset.pos;
      updateMock();
    });
  });

  ['pn-format', 'pn-start', 'pn-color'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateMock);
    if (el) el.addEventListener('change', updateMock);
  });

  document.getElementById('pn-btn').addEventListener('click', async () => {
    if (!requirePDFLib(result)) return;
    if (!file) { showError(result, 'Upload a PDF first'); return; }

    const format   = document.getElementById('pn-format').value;
    const startNum = parseInt(document.getElementById('pn-start').value) || 1;
    const color    = hexToRgb(document.getElementById('pn-color').value || '#000000');
    const filename = document.getElementById('pn-filename').value.trim() || 'numbered.pdf';
    const large    = file.size > 5 * 1024 * 1024;
    aborted = false;
    trackUsage('pagenumbers');

    if (large) {
      showLoadingCancelable(result, 'Adding page numbers…', () => { aborted = true; result.innerHTML = ''; });
    } else {
      showLoading(result, 'Adding page numbers…');
    }

    try {
      const buf       = await readFile(file);
      if (aborted) return;
      const doc       = await PDFDocument.load(buf);
      if (aborted) return;
      const font      = await doc.embedFont(StandardFonts.Helvetica);
      const fontSize  = 11;
      const margin    = 28;
      const pageCount = doc.getPageCount();

      doc.getPages().forEach((page, i) => {
        const { width, height } = page.getSize();
        const label     = format.replace('{n}', startNum + i).replace('{total}', pageCount);
        const textWidth = font.widthOfTextAtSize(label, fontSize);
        const [vPos, hPos] = selectedPos.split('-');
        const y = vPos === 'top' ? height - margin : margin - fontSize;
        const x = hPos === 'left' ? margin : hPos === 'right' ? width - textWidth - margin : (width - textWidth) / 2;
        page.drawText(label, { x, y, size: fontSize, font, color });
      });

      if (aborted) return;
      const bytes = await doc.save();
      if (aborted) return;
      showResult(result, 'Page numbers added!', `${fmt(bytes.length)} · ${filename}`, bytes, filename);
    } catch (e) {
      if (!aborted) showError(result, e.message || 'Failed to add page numbers');
    }
  });

  updateMock();
})();

/* ══════════════════════════════════════════════════════════════════════════════
   5. HEADERS & FOOTERS  — with live mock page preview
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const dropEl = document.getElementById('hf-drop');
  const inputEl= document.getElementById('hf-input');
  const opts   = document.getElementById('hf-options');
  const result = document.getElementById('hf-result');
  const mockHeader = document.getElementById('hf-mock-header');
  const mockFooter = document.getElementById('hf-mock-footer');
  const clearBtn   = document.getElementById('hf-clear');
  let file = null;
  let aborted = false;

  function updateMock() {
    const headerText = document.getElementById('hf-header').value;
    const footerText = document.getElementById('hf-footer').value;
    const color      = document.getElementById('hf-color').value;

    if (mockHeader) { mockHeader.textContent = headerText; mockHeader.style.color = color; }
    if (mockFooter) { mockFooter.textContent = footerText; mockFooter.style.color = color; }
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      file = null; aborted = true;
      opts.style.display = 'none';
      result.innerHTML = '';
      resetDropZone(dropEl, '≡', 'Drop a PDF here or <span class="link-label">browse</span>', 'Single PDF file');
      clearBtn.style.display = 'none';
    });
  }

  setupDropZone(dropEl, inputEl, files => {
    file = files[0];
    setDropZoneFile(dropEl, file);
    if (clearBtn) clearBtn.style.display = '';
    opts.style.display = '';
  });

  ['hf-header', 'hf-footer', 'hf-color', 'hf-font-size'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', updateMock); el.addEventListener('change', updateMock); }
  });

  document.getElementById('hf-btn').addEventListener('click', async () => {
    if (!requirePDFLib(result)) return;
    if (!file) { showError(result, 'Upload a PDF first'); return; }

    const headerText = document.getElementById('hf-header').value;
    const footerText = document.getElementById('hf-footer').value;
    const fontSize   = parseFloat(document.getElementById('hf-font-size').value) || 10;
    const color      = hexToRgb(document.getElementById('hf-color').value || '#000000');
    const filename   = document.getElementById('hf-filename').value.trim() || 'headerfooter.pdf';
    const large      = file.size > 5 * 1024 * 1024;
    aborted = false;
    trackUsage('headerfooter');

    if (large) {
      showLoadingCancelable(result, 'Applying header/footer…', () => { aborted = true; result.innerHTML = ''; });
    } else {
      showLoading(result, 'Applying header/footer…');
    }

    try {
      const buf  = await readFile(file);
      if (aborted) return;
      const doc  = await PDFDocument.load(buf);
      if (aborted) return;
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const margin = 24;

      doc.getPages().forEach(page => {
        const { width, height } = page.getSize();
        if (headerText) {
          const tw = font.widthOfTextAtSize(headerText, fontSize);
          page.drawText(headerText, { x: (width - tw) / 2, y: height - margin, size: fontSize, font, color });
        }
        if (footerText) {
          const tw = font.widthOfTextAtSize(footerText, fontSize);
          page.drawText(footerText, { x: (width - tw) / 2, y: margin - fontSize, size: fontSize, font, color });
        }
      });

      if (aborted) return;
      const bytes = await doc.save();
      if (aborted) return;
      showResult(result, 'Header & footer applied!', `${fmt(bytes.length)} · ${filename}`, bytes, filename);
    } catch (e) {
      if (!aborted) showError(result, e.message || 'Failed to apply header/footer');
    }
  });

  updateMock();
})();

/* ══════════════════════════════════════════════════════════════════════════════
   6. WATERMARK  — with live canvas preview (Canvas 2D overlay)
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const dropEl  = document.getElementById('wm-drop');
  const inputEl = document.getElementById('wm-input');
  const opts    = document.getElementById('wm-options');
  const result  = document.getElementById('wm-result');
  const slider  = document.getElementById('wm-opacity');
  const sliderVal = document.getElementById('wm-opacity-val');
  const prevCanvas = document.getElementById('wm-preview-canvas');
  const prevPh     = document.getElementById('wm-preview-placeholder');
  const clearBtn   = document.getElementById('wm-clear');
  // Hide CSS overlay div if it exists (replaced by Canvas 2D)
  const overlay = document.getElementById('wm-overlay');
  if (overlay) overlay.style.display = 'none';
  let file = null;
  let aborted = false;
  let baseImageData = null; // stored after PDF.js renders

  function drawWatermarkOverlay() {
    if (!baseImageData || !prevCanvas) return;
    const ctx = prevCanvas.getContext('2d');
    ctx.putImageData(baseImageData, 0, 0);

    const text    = (document.getElementById('wm-text').value || 'WATERMARK').trim() || 'WATERMARK';
    const opacity = parseFloat(slider.value) / 100;
    const style   = document.getElementById('wm-style').value;
    const color   = document.getElementById('wm-color').value || '#9CA3AF';
    const cw = prevCanvas.width;
    const ch = prevCanvas.height;
    const fontSize = Math.round(cw * 0.10);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = `${style === 'italic' ? 'italic ' : ''}${style === 'bold' ? 'bold ' : ''}${fontSize}px sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate(45 * Math.PI / 180);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  slider.addEventListener('input', () => {
    sliderVal.textContent = slider.value + '%';
    drawWatermarkOverlay();
  });

  ['wm-text', 'wm-style', 'wm-color'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', drawWatermarkOverlay); el.addEventListener('change', drawWatermarkOverlay); }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      file = null; aborted = true; baseImageData = null;
      opts.style.display = 'none';
      result.innerHTML = '';
      prevCanvas.style.display = 'none';
      if (prevPh) prevPh.style.display = '';
      resetDropZone(dropEl, '◈', 'Drop a PDF here or <span class="link-label">browse</span>', 'Single PDF file');
      clearBtn.style.display = 'none';
    });
  }

  setupDropZone(dropEl, inputEl, async files => {
    file = files[0];
    setDropZoneFile(dropEl, file);
    if (clearBtn) clearBtn.style.display = '';
    opts.style.display = '';

    baseImageData = null;
    const buf = await readFile(file).catch(() => null);
    if (buf) {
      const ok = await renderPageToCanvas(buf, prevCanvas, 320);
      if (ok) {
        prevCanvas.style.display = '';
        if (prevPh) prevPh.style.display = 'none';
        const ctx = prevCanvas.getContext('2d');
        baseImageData = ctx.getImageData(0, 0, prevCanvas.width, prevCanvas.height);
        drawWatermarkOverlay();
      }
    }
  });

  const FONT_MAP = {
    normal: StandardFonts?.Helvetica,
    bold:   StandardFonts?.HelveticaBold,
    italic: StandardFonts?.HelveticaOblique,
  };

  document.getElementById('wm-btn').addEventListener('click', async () => {
    if (!requirePDFLib(result)) return;
    if (!file) { showError(result, 'Upload a PDF first'); return; }

    const text     = document.getElementById('wm-text').value || 'WATERMARK';
    const opacity  = parseFloat(slider.value) / 100;
    const style    = document.getElementById('wm-style').value;
    const color    = hexToRgb(document.getElementById('wm-color').value || '#9CA3AF');
    const filename = document.getElementById('wm-filename').value.trim() || 'watermarked.pdf';
    const large    = file.size > 5 * 1024 * 1024;
    aborted = false;
    trackUsage('watermark');

    if (large) {
      showLoadingCancelable(result, 'Applying watermark…', () => { aborted = true; result.innerHTML = ''; });
    } else {
      showLoading(result, 'Applying watermark…');
    }

    try {
      const buf  = await readFile(file);
      if (aborted) return;
      const doc  = await PDFDocument.load(buf);
      if (aborted) return;
      const fontKey = FONT_MAP[style] || StandardFonts.Helvetica;
      const font    = await doc.embedFont(fontKey);
      const fontSize = 52;

      doc.getPages().forEach(page => {
        const { width, height } = page.getSize();
        const tw = font.widthOfTextAtSize(text, fontSize);
        page.drawText(text, {
          x: (width - tw) / 2,
          y: (height - fontSize) / 2,
          size: fontSize, font, color, opacity,
          rotate: degrees(45),
        });
      });

      if (aborted) return;
      const bytes = await doc.save();
      if (aborted) return;
      showResult(result, 'Watermark applied!', `${fmt(bytes.length)} · ${filename}`, bytes, filename);
    } catch (e) {
      if (!aborted) showError(result, e.message || 'Failed to add watermark');
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   7. COMPRESS
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const dropEl  = document.getElementById('compress-drop');
  const inputEl = document.getElementById('compress-input');
  const opts    = document.getElementById('compress-options');
  const result  = document.getElementById('compress-result');
  const slider  = document.getElementById('compress-target');
  const sliderVal = document.getElementById('compress-target-val');
  const clearBtn  = document.getElementById('compress-clear');
  let file = null;
  let aborted = false;

  slider.addEventListener('input', () => { sliderVal.textContent = slider.value + '%'; });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      file = null; aborted = true;
      opts.style.display = 'none';
      result.innerHTML = '';
      const si = document.getElementById('compress-size-info');
      if (si) si.textContent = '—';
      resetDropZone(dropEl, '⊡', 'Drop a PDF here or <span class="link-label">browse</span>', 'Single PDF file');
      clearBtn.style.display = 'none';
    });
  }

  setupDropZone(dropEl, inputEl, files => {
    file = files[0];
    setDropZoneFile(dropEl, file);
    if (clearBtn) clearBtn.style.display = '';
    opts.style.display = '';
    const si = document.getElementById('compress-size-info');
    if (si) si.textContent = fmt(file.size);
  });

  document.getElementById('compress-btn').addEventListener('click', async () => {
    if (!requirePDFLib(result)) return;
    if (!file) { showError(result, 'Upload a PDF first'); return; }

    const targetPct = parseInt(slider.value) || 30;
    const filename  = document.getElementById('compress-filename').value.trim() || 'compressed.pdf';
    const large     = file.size > 5 * 1024 * 1024;
    aborted = false;
    trackUsage('compress');

    if (large) {
      showLoadingCancelable(result, 'Compressing…', () => { aborted = true; result.innerHTML = ''; });
    } else {
      showLoading(result, 'Compressing…');
    }

    try {
      const buf  = await readFile(file);
      if (aborted) return;
      const doc  = await PDFDocument.load(buf);
      if (aborted) return;

      // Compression strategy based on target
      const saveOptions = { useObjectStreams: true };
      if (targetPct >= 30) {
        // Strip common metadata for extra savings
        try { doc.setTitle(''); } catch (_) {}
        try { doc.setAuthor(''); } catch (_) {}
        try { doc.setSubject(''); } catch (_) {}
        try { doc.setKeywords([]); } catch (_) {}
        try { doc.setCreator(''); } catch (_) {}
        try { doc.setProducer(''); } catch (_) {}
      }

      if (aborted) return;
      const bytes = await doc.save(saveOptions);
      if (aborted) return;

      const saved = file.size - bytes.length;
      const pct   = Math.round((1 - bytes.length / file.size) * 100);

      if (saved > 0) {
        const sub = `${fmt(file.size)} → ${fmt(bytes.length)} (saved ${pct}%) · ${filename}`;
        showResult(result, 'PDF compressed!', sub, bytes, filename);
        const subEl = result.querySelector('.result-sub');
        if (subEl) subEl.style.color = '#166534';
      } else {
        showResult(result, 'PDF compressed!', 'File could not be reduced further', bytes, filename);
        const subEl = result.querySelector('.result-sub');
        if (subEl) subEl.style.color = '#64748b';
      }
    } catch (e) {
      if (!aborted) showError(result, e.message || 'Failed to compress PDF');
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   8. REDACT  — visual canvas-based redact tool
   Draw rectangles on rendered PDF pages; apply via pdf-lib on download.
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const dropEl       = document.getElementById('redact-drop');
  const inputEl      = document.getElementById('redact-input');
  const nav          = document.getElementById('redact-nav');
  const opts         = document.getElementById('redact-options');
  const result       = document.getElementById('redact-result');
  const prevBtn      = document.getElementById('redact-prev');
  const nextBtn      = document.getElementById('redact-next');
  const pageLabel    = document.getElementById('redact-page-label');
  const styleBtnBlack = document.getElementById('redact-style-black');
  const styleBtnPx   = document.getElementById('redact-style-pixelate');
  const rectsList    = document.getElementById('redact-rects-list');
  const emptyHint    = document.getElementById('redact-empty-hint');
  const countEl      = document.getElementById('redact-count');
  const canvasWrap   = document.getElementById('redact-canvas-wrap');
  const canvasPlPh   = document.getElementById('redact-canvas-placeholder');
  const canvas       = document.getElementById('redact-canvas');
  const overlaysEl   = document.getElementById('redact-overlays');
  const canvasCard   = document.getElementById('redact-canvas-card');
  const clearBtn     = document.getElementById('redact-clear');

  const ctx = canvas.getContext('2d');

  let pdfJsDoc    = null;  // pdfjs document object
  let pageCount   = 0;
  let currentPage = 1;
  let pdfFile     = null;
  let aborted     = false;

  // rects[pageNum] = [{ x, y, width, height }] in canvas pixel coordinates
  const rects      = {};
  // canvasDims[pageNum] = { w, h } — stored when each page is rendered
  const canvasDims = {};

  // Drawing state
  let drawing  = false;
  let startX   = 0;
  let startY   = 0;
  let liveRect = null; // div showing the in-progress rectangle

  let redactStyle = 'black';

  /* ── Clear button ── */
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      pdfFile = null; pdfJsDoc = null; aborted = true;
      pageCount = 0; currentPage = 1;
      Object.keys(rects).forEach(k => delete rects[k]);
      Object.keys(canvasDims).forEach(k => delete canvasDims[k]);
      nav.style.display = 'none';
      opts.style.display = 'none';
      result.innerHTML = '';
      canvasWrap.style.display = 'none';
      canvasPlPh.style.display = '';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      overlaysEl.innerHTML = '';
      updateRectsList();
      resetDropZone(dropEl, '▬', 'Drop a PDF here or <span class="link-label">browse</span>', 'Single PDF file');
      clearBtn.style.display = 'none';
    });
  }

  /* ── Style toggle ── */
  [styleBtnBlack, styleBtnPx].forEach(btn => {
    btn.addEventListener('click', () => {
      [styleBtnBlack, styleBtnPx].forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      redactStyle = btn.dataset.style;
    });
  });

  /* ── Drop zone ── */
  setupDropZone(dropEl, inputEl, async files => {
    pdfFile = files[0];
    setDropZoneFile(dropEl, pdfFile);
    if (clearBtn) clearBtn.style.display = '';
    showLoading(result, 'Loading PDF…');

    // Reset saved rectangles from any previous file
    Object.keys(rects).forEach(k => delete rects[k]);
    Object.keys(canvasDims).forEach(k => delete canvasDims[k]);
    updateRectsList();

    try {
      if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js library not loaded — check your connection and refresh.');
      const buf = await readFile(pdfFile);
      pdfJsDoc  = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      pageCount   = pdfJsDoc.numPages;
      currentPage = 1;
      nav.style.display  = '';
      opts.style.display = '';
      result.innerHTML   = '';
      await renderPage(currentPage);
    } catch (e) {
      showError(result, e.message || 'Failed to load PDF');
    }
  });

  /* ── Page navigation ── */
  prevBtn.addEventListener('click', async () => {
    if (currentPage > 1) { currentPage--; await renderPage(currentPage); }
  });
  nextBtn.addEventListener('click', async () => {
    if (currentPage < pageCount) { currentPage++; await renderPage(currentPage); }
  });

  /* ── Render a page onto the canvas ── */
  async function renderPage(pageNum) {
    if (!pdfJsDoc) return;
    const page  = await pdfJsDoc.getPage(pageNum);
    const vp0   = page.getViewport({ scale: 1 });
    // Fit within the card width (subtract card padding)
    const maxW  = Math.max(200, (canvasCard.clientWidth || 560) - 32);
    const scale = Math.min(maxW / vp0.width, 2);
    const vp    = page.getViewport({ scale });

    canvas.width  = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvasDims[pageNum] = { w: canvas.width, h: canvas.height };

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    pageLabel.textContent = `Page ${pageNum} of ${pageCount}`;
    prevBtn.disabled      = pageNum === 1;
    nextBtn.disabled      = pageNum === pageCount;

    // Size the overlay container to match the canvas
    overlaysEl.style.width  = canvas.width  + 'px';
    overlaysEl.style.height = canvas.height + 'px';

    canvasWrap.style.display = '';
    canvasPlPh.style.display = 'none';

    renderOverlays();
  }

  /* ── Re-draw confirmed rectangle overlays for the current page ── */
  function renderOverlays() {
    overlaysEl.innerHTML = '';
    const pageRects = rects[currentPage] || [];
    pageRects.forEach((r, i) => {
      const el = document.createElement('div');
      el.className = 'redact-overlay-rect';
      Object.assign(el.style, {
        left: r.x + 'px', top: r.y + 'px',
        width: r.width + 'px', height: r.height + 'px',
      });
      const removeBtn = document.createElement('button');
      removeBtn.className   = 'rect-remove';
      removeBtn.textContent = '×';
      removeBtn.title       = 'Remove';
      removeBtn.addEventListener('click', () => {
        rects[currentPage].splice(i, 1);
        renderOverlays();
        updateRectsList();
      });
      el.appendChild(removeBtn);
      overlaysEl.appendChild(el);
    });
  }

  /* ── Update the sidebar list of all marked areas ── */
  function updateRectsList() {
    const total = Object.values(rects).reduce((s, arr) => s + arr.length, 0);
    countEl.textContent = total ? `(${total})` : '';

    if (!total) {
      rectsList.innerHTML = '';
      rectsList.appendChild(emptyHint);
      emptyHint.style.display = '';
      return;
    }
    emptyHint.style.display = 'none';
    rectsList.innerHTML = '';

    Object.entries(rects).sort(([a], [b]) => +a - +b).forEach(([pg, pgRects]) => {
      pgRects.forEach((r, i) => {
        const item = document.createElement('div');
        item.className = 'redact-rect-item';
        item.innerHTML = `<span>Page ${pg} — ${Math.round(r.width)}×${Math.round(r.height)}px</span>`;
        const removeBtn = document.createElement('button');
        removeBtn.className   = 'btn-danger-ghost';
        removeBtn.textContent = '×';
        removeBtn.title       = 'Remove';
        removeBtn.style.cssText = 'padding:2px 8px;font-size:14px;line-height:1;flex-shrink:0';
        removeBtn.addEventListener('click', () => {
          rects[pg].splice(i, 1);
          if (!rects[pg].length) delete rects[pg];
          updateRectsList();
          if (+pg === currentPage) renderOverlays();
        });
        item.appendChild(removeBtn);
        rectsList.appendChild(item);
      });
    });
  }

  /* ── Canvas coordinate helper (accounts for CSS scaling) ── */
  function getEventPos(e) {
    if (e.touches && e.touches.length)
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length)
      return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
    return { clientX: e.clientX, clientY: e.clientY };
  }

  function getCanvasPos({ clientX, clientY }) {
    const r      = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / r.width;
    const scaleY = canvas.height / r.height;
    return {
      x: Math.max(0, Math.min(canvas.width,  (clientX - r.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (clientY - r.top)  * scaleY)),
    };
  }

  /* ── Mouse / touch drawing ── */
  function startDraw(e) {
    e.preventDefault();
    if (!pdfJsDoc) return;
    drawing = true;
    const pos = getCanvasPos(getEventPos(e));
    startX = pos.x;
    startY = pos.y;

    liveRect = document.createElement('div');
    liveRect.className = 'redact-overlay-drawing';
    liveRect.style.display = 'none';
    overlaysEl.appendChild(liveRect);
  }

  function moveDraw(e) {
    if (!drawing || !liveRect) return;
    e.preventDefault();
    const pos = getCanvasPos(getEventPos(e));
    const x = Math.min(pos.x, startX);
    const y = Math.min(pos.y, startY);
    const w = Math.abs(pos.x - startX);
    const h = Math.abs(pos.y - startY);
    Object.assign(liveRect.style, {
      left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px',
      display: (w > 2 && h > 2) ? '' : 'none',
    });
  }

  function endDraw(e) {
    if (!drawing) return;
    drawing = false;
    if (liveRect) { liveRect.remove(); liveRect = null; }

    const pos = getCanvasPos(getEventPos(e));
    const x = Math.min(pos.x, startX);
    const y = Math.min(pos.y, startY);
    const w = Math.abs(pos.x - startX);
    const h = Math.abs(pos.y - startY);

    if (w >= 10 && h >= 10) {
      if (!rects[currentPage]) rects[currentPage] = [];
      rects[currentPage].push({ x, y, width: w, height: h });
      renderOverlays();
      updateRectsList();
    }
  }

  canvas.addEventListener('mousedown',  startDraw);
  window.addEventListener('mousemove',  moveDraw);
  window.addEventListener('mouseup',    endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  window.addEventListener('touchmove',  moveDraw,  { passive: false });
  window.addEventListener('touchend',   endDraw);

  /* ── Apply & Download ── */
  document.getElementById('redact-btn').addEventListener('click', async () => {
    if (!requirePDFLib(result)) return;
    if (!pdfFile) { showError(result, 'Upload a PDF first'); return; }

    const totalRects = Object.values(rects).reduce((s, arr) => s + arr.length, 0);
    if (!totalRects) { showError(result, 'Draw at least one rectangle on the canvas to redact'); return; }

    const filename = document.getElementById('redact-filename').value.trim() || 'redacted.pdf';
    aborted = false;
    trackUsage('redact');

    showLoadingCancelable(result, `Applying redactions to page 1 of ${pageCount}…`, () => {
      aborted = true; result.innerHTML = '';
    });

    try {
      const buf = await readFile(pdfFile);
      if (aborted) return;
      const doc = await PDFDocument.load(buf);
      if (aborted) return;

      const pages = doc.getPages();

      for (let pgNum = 1; pgNum <= pages.length; pgNum++) {
        if (aborted) return;
        const pgRects = rects[pgNum];
        if (!pgRects || !pgRects.length) continue;

        // Update progress message
        const msgEl = result.querySelector('.loading-card span');
        if (msgEl) msgEl.textContent = `Applying redactions to page ${pgNum} of ${pageCount}…`;

        const page           = pages[pgNum - 1];
        const { width: pgW, height: pgH } = page.getSize();
        const dims           = canvasDims[pgNum];
        if (!dims) continue; // page was never rendered — skip

        // Convert canvas px coordinates → PDF point coordinates
        // PDF y-axis is inverted (0 = bottom)
        const scaleX = pgW / dims.w;
        const scaleY = pgH / dims.h;

        pgRects.forEach(r => {
          const pdfX = r.x * scaleX;
          const pdfY = pgH - (r.y + r.height) * scaleY;
          const pdfW = r.width  * scaleX;
          const pdfH = r.height * scaleY;

          if (redactStyle === 'black') {
            page.drawRectangle({ x: pdfX, y: pdfY, width: pdfW, height: pdfH, color: rgb(0, 0, 0), opacity: 1 });
          } else {
            console.log('rgb:', typeof rgb);
            const blockSize = 8;
            for (let bx = 0; bx < pdfW; bx += blockSize) {
              for (let by = 0; by < pdfH; by += blockSize) {
                const grey = 0.3 + Math.random() * 0.4;
                const blockW = Math.min(blockSize, pdfW - bx);
                const blockH = Math.min(blockSize, pdfH - by);
                page.drawRectangle({
                  x: pdfX + bx,
                  y: pdfY + by,
                  width: blockW,
                  height: blockH,
                  color: rgb(grey, grey, grey),
                  opacity: 1,
                });
              }
            }
          }
        });
      }

      if (aborted) return;
      const bytes = await doc.save();
      if (aborted) return;

      const styleLabel = redactStyle === 'black' ? 'black box' : 'pixelated';
      showResult(result, 'PDF redacted!',
        `${totalRects} redaction${totalRects !== 1 ? 's' : ''} (${styleLabel}) · ${fmt(bytes.length)} · ${filename}`,
        bytes, filename);
    } catch (e) {
      if (!aborted) showError(result, e.message || 'Failed to redact PDF');
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   9. FORM FILLER  — with Cancel button during scan
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const dropEl    = document.getElementById('form-drop');
  const inputEl   = document.getElementById('form-input');
  const fieldsArea = document.getElementById('form-fields-area');
  const fieldCount = document.getElementById('form-field-count');
  const fieldsList = document.getElementById('form-fields-list');
  const result     = document.getElementById('form-result');
  const clearBtn   = document.getElementById('form-clear');
  let rawBytes  = null;
  let scanAborted = false;

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      rawBytes = null; scanAborted = true;
      fieldsArea.style.display = 'none';
      fieldsList.innerHTML = '';
      result.innerHTML = '';
      resetDropZone(dropEl, '⊟', 'Drop a PDF here or <span class="link-label">browse</span>', 'PDF with interactive form fields');
      clearBtn.style.display = 'none';
    });
  }

  /* ── Get visual sort position from field widget annotation ── */
  function getFieldSortPos(pdfLibField) {
    try {
      const widgets = pdfLibField.acroField.getWidgets();
      if (widgets && widgets.length > 0) {
        const rect = widgets[0].getRectangle();
        if (rect) return { y: rect.y, x: rect.x };
      }
    } catch (_) {}
    return null; // fallback to alphabetical
  }

  setupDropZone(dropEl, inputEl, async files => {
    scanAborted = false;
    setDropZoneFile(dropEl, files[0]);
    if (clearBtn) clearBtn.style.display = '';

    showLoadingCancelable(result, 'Scanning form fields…', () => {
      scanAborted = true;
      rawBytes = null;
      fieldsArea.style.display = 'none';
      result.innerHTML = '';
    });

    try {
      rawBytes = await readFile(files[0]);
      if (scanAborted) return;

      const doc  = await PDFDocument.load(rawBytes);
      if (scanAborted) return;

      const form = doc.getForm();

      // Build field list — detect checkbox by method presence (robust against minification)
      const rawFields = form.getFields().map(f => ({
        name:     f.getName(),
        isCheckBox: typeof f.check === 'function',
        type:     typeof f.check === 'function' ? 'checkbox'
                : typeof f.setText === 'function' ? 'text'
                : typeof f.select === 'function' ? 'select'
                : f.constructor.name.replace('PDF', '').replace('Field', '').toLowerCase(),
        pos:      getFieldSortPos(f),
      }));

      // Sort: y descending (top of page first), then x ascending (left to right)
      // Fields without position info fall back to alphabetical at end
      const fields = rawFields.sort((a, b) => {
        if (a.pos && b.pos) {
          if (Math.abs(a.pos.y - b.pos.y) > 4) return b.pos.y - a.pos.y; // y descending
          return a.pos.x - b.pos.x;                                        // x ascending
        }
        if (a.pos && !b.pos) return -1;
        if (!a.pos && b.pos) return 1;
        return a.name.localeCompare(b.name); // alphabetical fallback
      });

      result.innerHTML = '';

      if (!fields.length) {
        result.innerHTML = '<div class="error-card">No interactive form fields found in this PDF.</div>';
        return;
      }

      fieldCount.textContent = `${fields.length} field${fields.length !== 1 ? 's' : ''} detected`;
      fieldsList.innerHTML = '';

      fields.forEach(f => {
        const row = document.createElement('div');
        row.className = 'form-field-row';

        if (f.isCheckBox) {
          // Render as a styled toggle switch
          row.innerHTML = `<span class="field-label">${f.name}</span>
            <span class="field-type">checkbox</span>
            <label class="toggle-switch">
              <input type="checkbox" data-field="${f.name}" data-type="checkbox">
              <span class="toggle-slider"></span>
            </label>`;
        } else {
          // Render as a text input
          row.innerHTML = `<span class="field-label">${f.name}</span>
            <span class="field-type">${f.type}</span>
            <input class="text-input field-input" data-field="${f.name}" data-type="text" placeholder="Value…" />`;
        }

        fieldsList.appendChild(row);
      });

      fieldsArea.style.display = '';
    } catch (e) {
      if (!scanAborted) showError(result, e.message || 'Failed to scan form fields');
    }
  });

  document.getElementById('form-fill-btn').addEventListener('click', async () => {
    if (!requirePDFLib(result)) return;
    if (!rawBytes) { showError(result, 'Upload a PDF first'); return; }

    const filename = document.getElementById('form-filename').value.trim() || 'filled.pdf';
    trackUsage('formfiller');
    showLoading(result, 'Filling form…');

    try {
      const doc  = await PDFDocument.load(rawBytes);
      const form = doc.getForm();

      // Handle checkboxes
      fieldsList.querySelectorAll('[data-field][data-type="checkbox"]').forEach(input => {
        try {
          const field = form.getField(input.dataset.field);
          if (typeof field.check === 'function') {
            input.checked ? field.check() : field.uncheck();
          }
        } catch (_) { /* skip unsupported field */ }
      });

      // Handle text/select fields
      fieldsList.querySelectorAll('[data-field][data-type="text"]').forEach(input => {
        try {
          if (!input.value) return;
          const field = form.getField(input.dataset.field);
          if (typeof field.setText === 'function')     field.setText(input.value);
          else if (typeof field.select === 'function') field.select(input.value);
        } catch (_) { /* skip unsupported field */ }
      });

      form.flatten();
      const bytes = await doc.save();
      showResult(result, 'Form filled & flattened!', `${fmt(bytes.length)} · ${filename}`, bytes, filename);
    } catch (e) {
      showError(result, e.message || 'Failed to fill form');
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   USAGE STATS PAGE
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const TOOL_LABELS = {
    merge:        'Merge PDFs',
    split:        'Split PDF',
    rotate:       'Rotate Pages',
    pagenumbers:  'Page Numbers',
    headerfooter: 'Headers & Footers',
    watermark:    'Watermark',
    compress:     'Compress PDF',
    redact:       'Redact',
    formfiller:   'Form Filler',
    pdfinfo:      'PDF Info',
    organiser:    'Page Organiser',
    sign:         'Sign PDF',
    edit:         'Edit PDF Text',
  };

  function renderStats() {
    const body = document.getElementById('stats-body');
    if (!body) return;
    const data   = getUsage();
    const counts = Object.entries(TOOL_LABELS).map(([key, label]) => ({ key, label, count: data[key] || 0 }));
    const total  = counts.reduce((s, t) => s + t.count, 0);
    const max    = Math.max(...counts.map(t => t.count), 1);

    if (total === 0) {
      body.innerHTML = '<div class="stats-empty">No tools used yet — get started!</div>';
      return;
    }

    const mostUsed = counts.reduce((a, b) => a.count >= b.count ? a : b);
    const lastUsed = data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : '—';

    const chartHtml = `<div class="stats-chart">${
      counts.map(t => `<div class="stats-bar-row">
        <span class="stats-bar-label">${t.label}</span>
        <div class="stats-bar-track"><div class="stats-bar-fill" data-width="${(t.count / max * 100).toFixed(1)}"></div></div>
        <span class="stats-bar-count">${t.count}</span>
      </div>`).join('')
    }</div>`;

    const summaryHtml = `<div class="stats-summary">
      <div class="stats-summary-item">Total actions: <strong>${total}</strong></div>
      <div class="stats-summary-item">Most used: <strong>${mostUsed.label} (${mostUsed.count} time${mostUsed.count !== 1 ? 's' : ''})</strong></div>
      <div class="stats-summary-item">Last used: <strong>${lastUsed}</strong></div>
    </div>`;

    body.innerHTML = chartHtml + summaryHtml +
      `<div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-ghost btn-sm" id="stats-reset-btn"
          style="color:var(--text-tertiary);border-color:var(--border-color)">Reset stats</button>
        <span id="stats-reset-msg" style="display:none;font-size:12px;color:var(--text-tertiary)">Stats reset ✓</span>
      </div>`;

    // Animate bars in
    requestAnimationFrame(() => setTimeout(() => {
      body.querySelectorAll('.stats-bar-fill').forEach(bar => { bar.style.width = bar.dataset.width + '%'; });
    }, 50));

    document.getElementById('stats-reset-btn').addEventListener('click', () => {
      localStorage.removeItem(USAGE_KEY);
      const msg = document.getElementById('stats-reset-msg');
      const btn = document.getElementById('stats-reset-btn');
      if (msg) msg.style.display = '';
      if (btn) btn.disabled = true;
      setTimeout(() => { renderStats(); }, 2000);
    });
  }

  document.querySelectorAll('.nav-item[data-tool="stats"]').forEach(btn => {
    btn.addEventListener('click', () => setTimeout(renderStats, 160));
  });
})();

/* ── Hash-based navigation (from landing page tool links) ───────────────────── */
(function () {
  const hash = window.location.hash.replace('#', '');
  if (hash) {
    const tabMap = {
      home: 'home',
      merge: 'merge', split: 'split', rotate: 'rotate',
      pagenumbers: 'pagenumbers', headerfooter: 'headerfooter',
      watermark: 'watermark', compress: 'compress',
      redact: 'redact', formfiller: 'formfiller', pdfinfo: 'pdfinfo',
      organiser: 'organiser',
      sign: 'sign',
      edit: 'edit'
    };
    if (tabMap[hash]) navigateTo(tabMap[hash]);
  }
})();

/* ── Dark mode toggle ────────────────────────────────────────────────────────── */
(function () {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  function applyTheme(dark) {
    if (dark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      btn.textContent = '☀️ Light mode';
    } else {
      document.documentElement.removeAttribute('data-theme');
      btn.textContent = '🌙 Dark mode';
    }
    localStorage.setItem('pagehub-theme', dark ? 'dark' : 'light');
  }

  btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark'
    ? '☀️ Light mode' : '🌙 Dark mode';

  btn.addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') !== 'dark');
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   10. PDF INFO  — fixed: shows page count, file size, metadata, per-page table
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const dropEl    = document.getElementById('info-drop');
  const inputEl   = document.getElementById('info-input');
  const status    = document.getElementById('info-status');
  const results   = document.getElementById('info-results');
  const metaGrid  = document.getElementById('info-meta');
  const pagesTbody = document.getElementById('info-pages-tbl').querySelector('tbody');
  const clearBtn   = document.getElementById('info-clear');

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      results.style.display = 'none';
      status.innerHTML = '';
      metaGrid.innerHTML = '';
      pagesTbody.innerHTML = '';
      resetDropZone(dropEl, 'ℹ', 'Drop a PDF here or <span class="link-label">browse</span>', 'Single PDF file');
      clearBtn.style.display = 'none';
    });
  }

  setupDropZone(dropEl, inputEl, async files => {
    const file = files[0];
    setDropZoneFile(dropEl, file);
    if (clearBtn) clearBtn.style.display = '';
    results.style.display = 'none';
    showLoading(status, 'Reading PDF…');

    if (!requirePDFLib(status)) return;

    try {
      const buf = await readFile(file);
      const doc = await PDFDocument.load(buf);

      /* Safe metadata access helpers */
      function safeMeta(fn)  { try { const v = fn(); return v || '—'; } catch (_) { return '—'; } }
      function safeDate(fn)  {
        try { const d = fn(); return d instanceof Date ? d.toLocaleString() : '—'; }
        catch (_) { return '—'; }
      }

      const meta = [
        { label: 'Page Count', value: doc.getPageCount(), large: true },
        { label: 'File Size',  value: fmt(file.size) },
        { label: 'Title',      value: safeMeta(() => doc.getTitle())    },
        { label: 'Author',     value: safeMeta(() => doc.getAuthor())   },
        { label: 'Subject',    value: safeMeta(() => doc.getSubject())  },
        { label: 'Creator',    value: safeMeta(() => doc.getCreator())  },
        { label: 'Producer',   value: safeMeta(() => doc.getProducer()) },
        { label: 'Created',    value: safeDate(() => doc.getCreationDate())     },
        { label: 'Modified',   value: safeDate(() => doc.getModificationDate()) },
      ];

      metaGrid.innerHTML = meta.map(m =>
        `<div class="info-card">
          <div class="info-card-label">${m.label}</div>
          <div class="info-card-value${m.large ? ' large' : ''}">${m.value}</div>
        </div>`
      ).join('');

      pagesTbody.innerHTML = doc.getPages().map((p, i) => {
        const { width, height } = p.getSize();
        return `<tr>
          <td>${i + 1}</td>
          <td>${width.toFixed(1)}</td>
          <td>${height.toFixed(1)}</td>
          <td>${p.getRotation().angle}°</td>
        </tr>`;
      }).join('');

      trackUsage('pdfinfo');
      status.innerHTML = '';
      results.style.display = '';
    } catch (e) {
      showError(status, e.message || 'Failed to read PDF — file may be encrypted or corrupted.');
      results.style.display = 'none';
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   11. PAGE ORGANISER  — thumbnail grid: reorder, rotate, duplicate, delete pages
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const dropEl           = document.getElementById('organiser-drop');
  const inputEl          = document.getElementById('organiser-input');
  const clearBtn         = document.getElementById('organiser-clear');
  const loadingEl        = document.getElementById('organiser-loading');
  const controlsEl       = document.getElementById('organiser-controls');
  const grid             = document.getElementById('organiser-grid');
  const insertPdfBtn     = document.getElementById('organiser-insert-pdf');
  const insertPdfInput   = document.getElementById('organiser-insert-input');
  const insertUi         = document.getElementById('organiser-insert-ui');
  const insertAfterSel   = document.getElementById('organiser-insert-after');
  const insertConfirmBtn = document.getElementById('organiser-insert-confirm');
  const insertCancelBtn  = document.getElementById('organiser-insert-cancel');
  const filenameInput    = document.getElementById('organiser-filename');
  const downloadBtn      = document.getElementById('organiser-download');
  const resultEl         = document.getElementById('organiser-result');

  let pages             = [];   // array of page descriptor objects
  let pdfJsDoc          = null; // pdfjs document for the primary PDF
  let organiserPdfBytes = null; // Uint8Array kept for pdf-lib (separate from pdfjs buffer)
  let dragSrcIdx        = null;

  // Insert-PDF state
  let insertPdfJsDoc        = null;
  let insertPdfBytes        = null;
  let insertPageDescriptors = [];

  /* ── Render one page to a canvas ── */
  async function renderThumb(doc, pageIndex, userRotation, canvasEl, maxWidth = 156) {
    const page   = await doc.getPage(pageIndex + 1);
    const native = page.rotate || 0;
    const rot    = (native + userRotation) % 360;
    const vp0    = page.getViewport({ scale: 1, rotation: rot });
    const scale  = maxWidth / vp0.width;
    const vp     = page.getViewport({ scale, rotation: rot });
    canvasEl.width  = Math.floor(vp.width);
    canvasEl.height = Math.floor(vp.height);
    await page.render({ canvasContext: canvasEl.getContext('2d'), viewport: vp }).promise;
  }

  /* ── Icon button helper ── */
  function makeActionBtn(icon, title, onClick) {
    const btn = document.createElement('button');
    btn.className   = 'organiser-action-btn';
    btn.textContent = icon;
    btn.title       = title;
    btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    return btn;
  }

  /* ── Build one thumbnail card ── */
  function createCard(page, idx) {
    const card = document.createElement('div');
    card.className     = 'organiser-card' + (page.type === 'blank' ? ' blank-page' : '');
    card.draggable     = true;
    card.dataset.index = idx;

    if (page.type === 'blank') {
      const thumb = document.createElement('div');
      thumb.className   = 'organiser-blank-thumb';
      thumb.textContent = 'Blank';
      card.appendChild(thumb);
    } else {
      page.thumbCanvas.className = 'organiser-thumb';
      card.appendChild(page.thumbCanvas);
    }

    const num = document.createElement('div');
    num.className   = 'organiser-page-num';
    num.textContent = `Page ${idx + 1}`;
    card.appendChild(num);

    const actions = document.createElement('div');
    actions.className = 'organiser-card-actions';
    actions.appendChild(makeActionBtn('↺', 'Rotate left 90°',  async () => rotateBy(idx, -90)));
    actions.appendChild(makeActionBtn('↻', 'Rotate right 90°', async () => rotateBy(idx, 90)));
    actions.appendChild(makeActionBtn('⧉', 'Duplicate page',   () => duplicatePage(idx)));
    actions.appendChild(makeActionBtn('×', 'Delete page',      () => deletePage(idx)));
    card.appendChild(actions);

    return card;
  }

  /* ── Re-render the full grid (also updates page numbers) ── */
  function renderGrid() {
    grid.innerHTML = '';
    pages.forEach((page, idx) => grid.appendChild(createCard(page, idx)));
    downloadBtn.disabled = pages.length === 0;
  }

  /* ── Page mutation actions ── */
  async function rotateBy(idx, delta) {
    const page    = pages[idx];
    page.rotation = ((page.rotation || 0) + delta + 360) % 360;
    if (page.type === 'pdf' && page.pdfJsDoc) {
      await renderThumb(page.pdfJsDoc, page.pdfPageIndex, page.rotation, page.thumbCanvas);
    }
    renderGrid();
  }

  function duplicatePage(idx) {
    const orig = pages[idx];
    let copy;
    if (orig.type === 'blank') {
      copy = { type: 'blank', width: orig.width, height: orig.height, rotation: 0 };
    } else {
      const newCanvas  = document.createElement('canvas');
      newCanvas.width  = orig.thumbCanvas.width;
      newCanvas.height = orig.thumbCanvas.height;
      newCanvas.getContext('2d').drawImage(orig.thumbCanvas, 0, 0);
      copy = { type: 'pdf', pdfPageIndex: orig.pdfPageIndex, rotation: orig.rotation,
               thumbCanvas: newCanvas, pageWidth: orig.pageWidth, pageHeight: orig.pageHeight,
               srcBytes: orig.srcBytes, pdfJsDoc: orig.pdfJsDoc };
    }
    pages.splice(idx + 1, 0, copy);
    renderGrid();
  }

  function deletePage(idx) {
    pages.splice(idx, 1);
    renderGrid();
  }

  /* ── Drag-to-reorder ── */
  grid.addEventListener('dragstart', e => {
    const card = e.target.closest('.organiser-card');
    if (!card) return;
    dragSrcIdx = parseInt(card.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('dragging'), 0);
  });

  grid.addEventListener('dragend', () => {
    grid.querySelectorAll('.organiser-card').forEach(c => c.classList.remove('dragging', 'drag-over'));
  });

  grid.addEventListener('dragover', e => {
    e.preventDefault();
    const card = e.target.closest('.organiser-card');
    grid.querySelectorAll('.organiser-card').forEach(c => c.classList.remove('drag-over'));
    if (card && parseInt(card.dataset.index) !== dragSrcIdx) card.classList.add('drag-over');
  });

  grid.addEventListener('drop', e => {
    e.preventDefault();
    const card = e.target.closest('.organiser-card');
    if (!card || dragSrcIdx === null) return;
    const targetIdx = parseInt(card.dataset.index);
    if (targetIdx !== dragSrcIdx) {
      const [moved] = pages.splice(dragSrcIdx, 1);
      pages.splice(targetIdx, 0, moved);
      renderGrid();
    }
    dragSrcIdx = null;
  });

  /* ── Insert PDF Pages ── */
  insertPdfBtn.addEventListener('click', () => insertPdfInput.click());

  insertPdfInput.addEventListener('change', async () => {
    if (!insertPdfInput.files.length) return;
    const file = insertPdfInput.files[0];
    insertPdfInput.value = '';
    showLoading(resultEl, 'Loading PDF…');
    try {
      const originalBuffer = await readFile(file);
      const pdfJsBuffer    = originalBuffer.slice(0);
      insertPdfBytes       = new Uint8Array(originalBuffer.slice(0));
      insertPdfJsDoc       = await pdfjsLib.getDocument({ data: new Uint8Array(pdfJsBuffer) }).promise;
      const srcDoc         = await PDFDocument.load(insertPdfBytes);

      insertPageDescriptors = [];
      for (let i = 0; i < insertPdfJsDoc.numPages; i++) {
        const pdfPage = srcDoc.getPage(i);
        const { width: pw, height: ph } = pdfPage.getSize();
        const canvas = document.createElement('canvas');
        await renderThumb(insertPdfJsDoc, i, 0, canvas);
        insertPageDescriptors.push({ type: 'pdf', pdfPageIndex: i, rotation: 0,
                                     thumbCanvas: canvas, pageWidth: pw, pageHeight: ph,
                                     srcBytes: insertPdfBytes, pdfJsDoc: insertPdfJsDoc });
      }

      resultEl.innerHTML = '';

      // Populate "insert after" dropdown
      insertAfterSel.innerHTML = '';
      const opt0 = document.createElement('option');
      opt0.value = '0'; opt0.textContent = 'Before page 1';
      insertAfterSel.appendChild(opt0);
      for (let i = 1; i <= pages.length; i++) {
        const opt = document.createElement('option');
        opt.value = String(i); opt.textContent = `After page ${i}`;
        insertAfterSel.appendChild(opt);
      }
      insertAfterSel.value = String(pages.length); // default: after last page

      insertUi.style.display = '';
    } catch (e) {
      insertPdfJsDoc = null; insertPdfBytes = null; insertPageDescriptors = [];
      showError(resultEl, e.message || 'Failed to load PDF for insertion');
    }
  });

  insertConfirmBtn.addEventListener('click', () => {
    if (!insertPageDescriptors.length) return;
    const pos = parseInt(insertAfterSel.value);
    pages.splice(pos, 0, ...insertPageDescriptors);
    insertPageDescriptors = []; insertPdfJsDoc = null; insertPdfBytes = null;
    insertUi.style.display = 'none';
    renderGrid();
  });

  insertCancelBtn.addEventListener('click', () => {
    insertPageDescriptors = []; insertPdfJsDoc = null; insertPdfBytes = null;
    insertUi.style.display = 'none';
  });

  /* ── Clear ── */
  clearBtn.addEventListener('click', () => {
    pages = []; pdfJsDoc = null; organiserPdfBytes = null;
    insertPageDescriptors = []; insertPdfJsDoc = null; insertPdfBytes = null;
    grid.innerHTML = '';
    resultEl.innerHTML = '';
    loadingEl.style.display  = 'none';
    controlsEl.style.display = 'none';
    insertUi.style.display   = 'none';
    downloadBtn.disabled = true;
    resetDropZone(dropEl, '⊞', 'Drop a PDF here or <span class="link-label">browse</span>', 'Single PDF file');
    clearBtn.style.display = 'none';
  });

  /* ── Drop zone ── */
  setupDropZone(dropEl, inputEl, async files => {
    const file = files[0];
    pages = []; pdfJsDoc = null; organiserPdfBytes = null;
    insertPageDescriptors = []; insertPdfJsDoc = null; insertPdfBytes = null;
    grid.innerHTML = '';
    resultEl.innerHTML = '';
    setDropZoneFile(dropEl, file);
    clearBtn.style.display   = '';
    loadingEl.style.display  = '';
    controlsEl.style.display = 'none';
    insertUi.style.display   = 'none';

    try {
      if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js not loaded — check your connection and refresh.');
      if (!PDFDocument)                    throw new Error('pdf-lib not loaded — check your connection and refresh.');

      const originalBuffer = await readFile(file);
      const pdfJsBuffer    = originalBuffer.slice(0);
      organiserPdfBytes    = new Uint8Array(originalBuffer.slice(0));
      pdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfJsBuffer) }).promise;
      const srcDoc = await PDFDocument.load(organiserPdfBytes);

      for (let i = 0; i < pdfJsDoc.numPages; i++) {
        const pdfPage = srcDoc.getPage(i);
        const { width: pw, height: ph } = pdfPage.getSize();
        const canvas = document.createElement('canvas');
        await renderThumb(pdfJsDoc, i, 0, canvas);
        pages.push({ type: 'pdf', pdfPageIndex: i, rotation: 0,
                     thumbCanvas: canvas, pageWidth: pw, pageHeight: ph,
                     srcBytes: organiserPdfBytes, pdfJsDoc: pdfJsDoc });
      }

      loadingEl.style.display  = 'none';
      controlsEl.style.display = '';
      renderGrid();
    } catch (e) {
      loadingEl.style.display = 'none';
      showError(resultEl, e.message || 'Failed to load PDF');
    }
  });

  /* ── Download ── */
  downloadBtn.addEventListener('click', async () => {
    if (!requirePDFLib(resultEl)) return;
    if (!pages.length) return;
    const filenameBase = filenameInput.value.trim() || 'organised.pdf';
    const filename     = filenameBase.endsWith('.pdf') ? filenameBase : filenameBase + '.pdf';
    trackUsage('organiser');
    showLoading(resultEl, 'Building PDF…');
    downloadBtn.disabled = true;

    try {
      const outDoc     = await PDFDocument.create();
      const loadedDocs = new Map(); // cache pdf-lib docs keyed by Uint8Array reference

      for (const page of pages) {
        if (page.type === 'blank') {
          outDoc.addPage([page.width, page.height]);
        } else {
          if (!loadedDocs.has(page.srcBytes)) {
            loadedDocs.set(page.srcBytes, await PDFDocument.load(page.srcBytes));
          }
          const srcDoc = loadedDocs.get(page.srcBytes);
          const [copied] = await outDoc.copyPages(srcDoc, [page.pdfPageIndex]);
          const existingRot = copied.getRotation().angle;
          copied.setRotation(degrees((existingRot + page.rotation) % 360));
          outDoc.addPage(copied);
        }
      }

      const bytes = await outDoc.save();
      downloadBtn.disabled = false;
      showResult(resultEl, 'PDF organised!',
        `${pages.length} page${pages.length !== 1 ? 's' : ''} · ${fmt(bytes.length)} · ${filename}`,
        bytes, filename);
    } catch (e) {
      downloadBtn.disabled = false;
      showError(resultEl, e.message || 'Failed to build PDF');
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   12. SIGN PDF  — place signature image on pages, download signed PDF
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const { PDFDocument } = PDFLib;

  // DOM refs
  const dropEl          = document.getElementById('sign-drop');
  const inputEl         = document.getElementById('sign-input');
  const clearBtn        = document.getElementById('sign-clear');
  const pageNavEl       = document.getElementById('sign-page-nav');
  const prevBtn         = document.getElementById('sign-prev');
  const nextBtn         = document.getElementById('sign-next');
  const pageLabel       = document.getElementById('sign-page-label');
  const sigSectionEl    = document.getElementById('sign-sig-section');
  const sigDropEl       = document.getElementById('sign-sig-drop');
  const sigInputEl      = document.getElementById('sign-sig-input');
  const sigPreviewEl    = document.getElementById('sign-sig-preview');
  const pagesSectionEl  = document.getElementById('sign-pages-section');
  const pageChecksEl    = document.getElementById('sign-page-checks');
  const downloadSectionEl = document.getElementById('sign-download-section');
  const filenameInput   = document.getElementById('sign-filename');
  const downloadBtn     = document.getElementById('sign-download');
  const resultEl        = document.getElementById('sign-result');
  const canvasPlaceholder = document.getElementById('sign-canvas-placeholder');
  const canvasWrapEl    = document.getElementById('sign-canvas-wrap');
  const canvas          = document.getElementById('sign-canvas');
  const ctx             = canvas.getContext('2d');
  const overlayEl       = document.getElementById('sign-sig-overlay');
  const sigImgEl        = document.getElementById('sign-sig-img');
  const resizeHandle    = document.getElementById('sign-sig-resize');

  // State
  let pdfJsDoc       = null;
  let pdfBytes       = null;   // Uint8Array for pdf-lib
  let currentPage    = 1;
  let totalPages     = 0;
  let sigDataUrl     = null;   // processed (transparent bg) signature data URL
  // Overlay position in canvas pixels
  let sigX = 0, sigY = 0, sigW = 0, sigH = 0;
  let sigPlaced = false;

  if (!dropEl) return; // guard if section not in DOM

  // ── PDF Drop / Browse ────────────────────────────────────────────────────
  setupDropZone(dropEl, inputEl, async ([file]) => {
    clearBtn.style.display = 'inline-flex';
    pdfBytes = null; pdfJsDoc = null; currentPage = 1; totalPages = 0;

    try {
      const originalBuffer = await readFile(file);
      const pdfJsBuffer    = originalBuffer.slice(0);
      pdfBytes             = new Uint8Array(originalBuffer.slice(0));
      pdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfJsBuffer) }).promise;
      totalPages = pdfJsDoc.numPages;

      // Show preview area
      canvasPlaceholder.style.display = 'none';
      canvasWrapEl.style.display      = 'inline-block';
      pageNavEl.style.display         = 'flex';
      sigSectionEl.style.display      = 'block';

      await renderPage(currentPage);
      buildPageChecks();
      pagesSectionEl.style.display = 'block';
      if (sigDataUrl) {
        downloadSectionEl.style.display = 'block';
        placeSignatureDefault();
      }
    } catch (e) {
      showError(resultEl, e.message || 'Failed to load PDF');
    }
  });

  clearBtn.addEventListener('click', () => {
    pdfJsDoc = null; pdfBytes = null; currentPage = 1; totalPages = 0;
    sigDataUrl = null; sigPlaced = false;
    canvas.width = 0; canvas.height = 0;
    canvasPlaceholder.style.display = '';
    canvasWrapEl.style.display      = 'none';
    overlayEl.style.display         = 'none';
    pageNavEl.style.display         = 'none';
    sigSectionEl.style.display      = 'none';
    sigPreviewEl.style.display      = 'none';
    pagesSectionEl.style.display    = 'none';
    downloadSectionEl.style.display = 'none';
    pageChecksEl.innerHTML          = '';
    resultEl.innerHTML              = '';
    clearBtn.style.display          = 'none';
    dropEl.classList.remove('has-file');
  });

  // ── Page navigation ──────────────────────────────────────────────────────
  prevBtn.addEventListener('click', async () => {
    if (currentPage > 1) { currentPage--; await renderPage(currentPage); }
  });
  nextBtn.addEventListener('click', async () => {
    if (currentPage < totalPages) { currentPage++; await renderPage(currentPage); }
  });

  async function renderPage(num) {
    if (!pdfJsDoc) return;
    const page   = await pdfJsDoc.getPage(num);
    const scale  = 1.5;
    const vp     = page.getViewport({ scale });
    canvas.width  = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pageLabel.textContent = `Page ${num} of ${totalPages}`;
    prevBtn.disabled = num <= 1;
    nextBtn.disabled = num >= totalPages;
    // Re-clamp overlay if already placed
    if (sigPlaced) updateOverlayCSS();
  }

  // ── Signature drop / browse (image files — bypass PDF-only setupDropZone) ──
  function handleSigFile(file) {
    const img = new Image();
    img.onload = () => {
      sigDataUrl = processSignature(img);
      sigImgEl.src = sigDataUrl;
      sigPreviewEl.src = sigDataUrl;
      sigPreviewEl.style.display = 'block';
      if (pdfJsDoc) {
        downloadSectionEl.style.display = 'block';
        placeSignatureDefault();
      }
    };
    img.src = URL.createObjectURL(file);
  }

  sigDropEl.addEventListener('click', () => sigInputEl.click());
  sigDropEl.addEventListener('dragover', e => { e.preventDefault(); sigDropEl.classList.add('dragover'); });
  sigDropEl.addEventListener('dragleave', e => { if (!sigDropEl.contains(e.relatedTarget)) sigDropEl.classList.remove('dragover'); });
  sigDropEl.addEventListener('drop', e => {
    e.preventDefault();
    sigDropEl.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleSigFile(file);
  });
  sigInputEl.addEventListener('change', () => {
    if (sigInputEl.files[0]) { handleSigFile(sigInputEl.files[0]); sigInputEl.value = ''; }
  });

  // White-background removal via canvas pixel manipulation
  function processSignature(imgEl) {
    const offCanvas = document.createElement('canvas');
    offCanvas.width  = imgEl.naturalWidth;
    offCanvas.height = imgEl.naturalHeight;
    const offCtx = offCanvas.getContext('2d');
    offCtx.drawImage(imgEl, 0, 0);
    const imageData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) d[i + 3] = 0;
    }
    offCtx.putImageData(imageData, 0, 0);
    return offCanvas.toDataURL('image/png');
  }

  // ── Default signature placement (bottom-right, 25% width) ───────────────
  function placeSignatureDefault() {
    if (!sigDataUrl || canvas.width === 0) return;
    sigPlaced = true;
    const img = new Image();
    img.onload = () => {
      const aspect = img.naturalHeight / img.naturalWidth;
      sigW = canvas.width * 0.25;
      sigH = sigW * aspect;
      sigX = canvas.width  - sigW - 20;
      sigY = canvas.height - sigH - 20;
      sigImgEl.src = sigDataUrl;
      overlayEl.style.display = 'block';
      updateOverlayCSS();
    };
    img.src = sigDataUrl;
  }

  // Convert canvas-pixel coords to CSS pixels and apply to overlay
  function updateOverlayCSS() {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width  / canvas.width;
    const scaleY = rect.height / canvas.height;
    overlayEl.style.left   = (sigX * scaleX) + 'px';
    overlayEl.style.top    = (sigY * scaleY) + 'px';
    overlayEl.style.width  = (sigW * scaleX) + 'px';
    overlayEl.style.height = (sigH * scaleY) + 'px';
  }

  // ── Drag to move overlay ─────────────────────────────────────────────────
  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target === resizeHandle) return; // handled by resize
    e.preventDefault();
    const rect  = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startSigX   = sigX;
    const startSigY   = sigY;

    function onMove(ev) {
      const dx = (ev.clientX - startMouseX) * scaleX;
      const dy = (ev.clientY - startMouseY) * scaleY;
      sigX = Math.max(0, Math.min(canvas.width  - sigW, startSigX + dx));
      sigY = Math.max(0, Math.min(canvas.height - sigH, startSigY + dy));
      updateOverlayCSS();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  // ── Resize handle ────────────────────────────────────────────────────────
  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startW  = sigW;
    const startH  = sigH;
    const aspect  = sigH / sigW;

    function onMove(ev) {
      const dw = (ev.clientX - startMouseX) * scaleX;
      sigW = Math.max(30, startW + dw);
      sigH = sigW * aspect;
      updateOverlayCSS();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  // ── Page checkboxes ──────────────────────────────────────────────────────
  function buildPageChecks() {
    pageChecksEl.innerHTML = '';
    for (let i = 1; i <= totalPages; i++) {
      const lbl   = document.createElement('label');
      lbl.className = 'sign-page-check-label' + (i === currentPage ? ' checked' : '');
      const cb  = document.createElement('input');
      cb.type   = 'checkbox';
      cb.value  = i;
      cb.checked = (i === currentPage);
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode('p' + i));
      cb.addEventListener('change', () => {
        lbl.classList.toggle('checked', cb.checked);
      });
      pageChecksEl.appendChild(lbl);
    }
  }

  function getCheckedPages() {
    return Array.from(pageChecksEl.querySelectorAll('input[type="checkbox"]:checked'))
      .map(cb => parseInt(cb.value, 10));
  }

  // ── Download ─────────────────────────────────────────────────────────────
  downloadBtn.addEventListener('click', async () => {
    if (!pdfBytes || !sigDataUrl || !sigPlaced) return;
    const pages = getCheckedPages();
    if (pages.length === 0) {
      showError(resultEl, 'Select at least one page to apply the signature to.');
      return;
    }

    downloadBtn.disabled = true;
    resultEl.innerHTML   = '';

    try {
      const doc  = await PDFDocument.load(pdfBytes);
      const sigBytes = dataUrlToBytes(sigDataUrl);
      const pngImage = await doc.embedPng(sigBytes);

      for (const pageNum of pages) {
        const pg   = doc.getPage(pageNum - 1);
        const pgW  = pg.getWidth();
        const pgH  = pg.getHeight();
        const scaleX = pgW / canvas.width;
        const scaleY = pgH / canvas.height;

        const pdfSigW = sigW * scaleX;
        const pdfSigH = sigH * scaleY;
        // PDF y=0 is bottom; canvas y=0 is top
        const pdfSigX = sigX * scaleX;
        const pdfSigY = pgH - (sigY * scaleY) - pdfSigH;

        pg.drawImage(pngImage, {
          x: pdfSigX,
          y: pdfSigY,
          width:  pdfSigW,
          height: pdfSigH,
        });
      }

      const outBytes = await doc.save();
      const blob     = new Blob([outBytes], { type: 'application/pdf' });
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      let fname      = filenameInput.value.trim() || 'signed.pdf';
      if (!fname.endsWith('.pdf')) fname += '.pdf';
      a.href = url; a.download = fname; a.click();
      URL.revokeObjectURL(url);

      trackUsage('sign');
      resultEl.innerHTML = `<div class="result-card"><div class="result-icon">✅</div><div class="result-text"><div class="result-title">Signed PDF downloaded.</div></div></div>`;
    } catch (e) {
      showError(resultEl, e.message || 'Failed to sign PDF');
    } finally {
      downloadBtn.disabled = false;
    }
  });

  // ── Helper: data URL to Uint8Array (no fetch needed) ────────────────────
  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
})();

/* ══════════════════════════════════════════════════════════════════════════════
   13. EDIT PDF TEXT  — draw whiteout boxes, type replacement text, download
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const dropEl            = document.getElementById('edit-drop');
  const inputEl           = document.getElementById('edit-input');
  const clearBtn          = document.getElementById('edit-clear');
  const pageNavEl         = document.getElementById('edit-page-nav');
  const prevBtn           = document.getElementById('edit-prev');
  const nextBtn           = document.getElementById('edit-next');
  const pageLabel         = document.getElementById('edit-page-label');
  const toolbarEl         = document.getElementById('edit-toolbar');
  const fontSizeSelect    = document.getElementById('edit-font-size');
  const fontFamilySelect  = document.getElementById('edit-font-family');
  const editsListEl       = document.getElementById('edit-edits-list');
  const editsBodyEl       = document.getElementById('edit-edits-body');
  const downloadSectionEl = document.getElementById('edit-download-section');
  const filenameInput     = document.getElementById('edit-filename');
  const downloadBtn       = document.getElementById('edit-download');
  const resultEl          = document.getElementById('edit-result');
  const placeholder       = document.getElementById('edit-canvas-placeholder');
  const canvasWrapEl      = document.getElementById('edit-canvas-wrap');
  const canvas            = document.getElementById('edit-canvas');
  const ctx               = canvas ? canvas.getContext('2d') : null;
  const dragRectEl        = document.getElementById('edit-drag-rect');

  if (!dropEl) return;

  // ── State ─────────────────────────────────────────────────────────────────
  let pdfJsDoc       = null;
  let pdfBytes       = null;
  let currentPage    = 1;
  let totalPages     = 0;
  let selectedColor  = '#000000';
  let selectedFontSz  = 11;
  let selectedFont    = 'Helvetica';

  // Maps select value → CSS font-family for canvas preview
  const CSS_FONT = {
    Helvetica:    'sans-serif',
    HelveticaBold:'sans-serif',
    TimesRoman:   'serif',
    Courier:      'monospace',
  };
  const CSS_WEIGHT = { HelveticaBold: 'bold' };
  // edits[pageNum] = [{ x, y, w, h, text, color, fontSize, canvasW, canvasH }]
  let edits = {};

  // ── PDF upload ────────────────────────────────────────────────────────────
  setupDropZone(dropEl, inputEl, async ([file]) => {
    clearBtn.style.display = 'inline-flex';
    pdfBytes = null; pdfJsDoc = null; currentPage = 1; totalPages = 0; edits = {};
    try {
      const originalBuffer = await readFile(file);
      const pdfJsBuffer    = originalBuffer.slice(0);
      pdfBytes             = new Uint8Array(originalBuffer.slice(0));
      pdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfJsBuffer) }).promise;
      totalPages = pdfJsDoc.numPages;

      placeholder.style.display       = 'none';
      canvasWrapEl.style.display      = 'block';
      pageNavEl.style.display         = 'flex';
      toolbarEl.style.display         = 'flex';
      editsListEl.style.display       = 'block';
      downloadSectionEl.style.display = 'block';

      await renderPage(currentPage);
      renderEditsList();
    } catch (e) {
      showError(resultEl, e.message || 'Failed to load PDF');
    }
  });

  // ── Clear ─────────────────────────────────────────────────────────────────
  clearBtn.addEventListener('click', () => {
    pdfJsDoc = null; pdfBytes = null; currentPage = 1; totalPages = 0; edits = {};
    canvas.width = 0; canvas.height = 0;
    placeholder.style.display       = '';
    canvasWrapEl.style.display      = 'none';
    pageNavEl.style.display         = 'none';
    toolbarEl.style.display         = 'none';
    editsListEl.style.display       = 'none';
    downloadSectionEl.style.display = 'none';
    resultEl.innerHTML              = '';
    clearBtn.style.display          = 'none';
    dropEl.classList.remove('has-file');
  });

  // ── Page navigation ───────────────────────────────────────────────────────
  prevBtn.addEventListener('click', async () => {
    if (currentPage > 1) { currentPage--; await renderPage(currentPage); }
  });
  nextBtn.addEventListener('click', async () => {
    if (currentPage < totalPages) { currentPage++; await renderPage(currentPage); }
  });

  async function renderPage(num) {
    if (!pdfJsDoc) return;
    const page = await pdfJsDoc.getPage(num);
    const vp   = page.getViewport({ scale: 1.5 });
    canvas.width  = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pageLabel.textContent = `Page ${num} of ${totalPages}`;
    prevBtn.disabled = num <= 1;
    nextBtn.disabled = num >= totalPages;
    drawEditsOnCanvas(num);
  }

  function drawEditsOnCanvas(pageNum) {
    for (const edit of (edits[pageNum] || [])) {
      // Scale stored coords to current canvas if page size differs
      const sX = canvas.width  / edit.canvasW;
      const sY = canvas.height / edit.canvasH;
      const x = edit.x * sX, y = edit.y * sY;
      const w = edit.w * sX, h = edit.h * sY;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle    = edit.color;
      const weight     = CSS_WEIGHT[edit.font] || 'normal';
      ctx.font         = `${weight} ${edit.fontSize * 1.5}px ${CSS_FONT[edit.font] || 'sans-serif'}`;
      ctx.textBaseline = 'top';
      ctx.fillText(edit.text, x + 3, y + 3, w - 6);
    }
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────
  fontSizeSelect.addEventListener('change', () => {
    selectedFontSz = parseInt(fontSizeSelect.value, 10);
  });
  fontFamilySelect.addEventListener('change', () => {
    selectedFont = fontFamilySelect.value;
  });

  document.querySelectorAll('.edit-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.edit-color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.dataset.color;
    });
  });

  // ── Canvas draw interaction ───────────────────────────────────────────────
  let drawing = false;
  let startX = 0, startY = 0;

  canvas.addEventListener('mousedown', e => {
    if (!pdfJsDoc) return;
    const r = canvas.getBoundingClientRect();
    const sX = canvas.width  / r.width;
    const sY = canvas.height / r.height;
    startX = (e.clientX - r.left) * sX;
    startY = (e.clientY - r.top)  * sY;
    drawing = true;
    dragRectEl.style.display = 'block';
    positionDragRect(startX, startY, 0, 0);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
  });

  function onMouseMove(e) {
    if (!drawing) return;
    const r  = canvas.getBoundingClientRect();
    const sX = canvas.width  / r.width;
    const sY = canvas.height / r.height;
    const cx = (e.clientX - r.left) * sX;
    const cy = (e.clientY - r.top)  * sY;
    positionDragRect(Math.min(startX, cx), Math.min(startY, cy),
                     Math.abs(cx - startX), Math.abs(cy - startY));
  }

  function onMouseUp(e) {
    if (!drawing) return;
    drawing = false;
    dragRectEl.style.display = 'none';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);

    const r  = canvas.getBoundingClientRect();
    const sX = canvas.width  / r.width;
    const sY = canvas.height / r.height;
    const cx = (e.clientX - r.left) * sX;
    const cy = (e.clientY - r.top)  * sY;
    const x  = Math.min(startX, cx);
    const y  = Math.min(startY, cy);
    const w  = Math.abs(cx - startX);
    const h  = Math.abs(cy - startY);
    if (w < 6 || h < 6) return;
    showTextInput(x, y, w, h);
  }

  function positionDragRect(x, y, w, h) {
    const r  = canvas.getBoundingClientRect();
    const sX = r.width  / canvas.width;
    const sY = r.height / canvas.height;
    dragRectEl.style.left   = (x * sX) + 'px';
    dragRectEl.style.top    = (y * sY) + 'px';
    dragRectEl.style.width  = (w * sX) + 'px';
    dragRectEl.style.height = (h * sY) + 'px';
  }

  function showTextInput(x, y, w, h) {
    const r  = canvas.getBoundingClientRect();
    const sX = r.width  / canvas.width;
    const sY = r.height / canvas.height;

    const input         = document.createElement('input');
    input.type          = 'text';
    input.placeholder   = 'Type replacement text…';
    input.className     = 'edit-text-overlay';
    input.style.left    = (x * sX) + 'px';
    input.style.top     = (y * sY) + 'px';
    input.style.width   = (w * sX) + 'px';
    input.style.height  = (h * sY) + 'px';
    input.style.fontSize   = selectedFontSz + 'pt';
    input.style.color      = selectedColor;
    input.style.fontFamily = CSS_FONT[selectedFont] || 'sans-serif';
    input.style.fontWeight = CSS_WEIGHT[selectedFont] || 'normal';
    canvasWrapEl.appendChild(input);
    input.focus();

    let confirmed = false;
    function confirm() {
      if (confirmed) return;
      confirmed = true;
      const text = input.value.trim();
      if (canvasWrapEl.contains(input)) canvasWrapEl.removeChild(input);
      if (text) {
        if (!edits[currentPage]) edits[currentPage] = [];
        edits[currentPage].push({
          x, y, w, h, text,
          color: selectedColor, fontSize: selectedFontSz, font: selectedFont,
          canvasW: canvas.width, canvasH: canvas.height,
        });
        renderPage(currentPage);
        renderEditsList();
      }
    }

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') { confirmed = true; if (canvasWrapEl.contains(input)) canvasWrapEl.removeChild(input); }
    });
    input.addEventListener('blur', confirm);
  }

  // ── Edits list ────────────────────────────────────────────────────────────
  function renderEditsList() {
    editsBodyEl.innerHTML = '';
    let hasAny = false;
    const pageNums = Object.keys(edits).map(Number).sort((a, b) => a - b);
    for (const pg of pageNums) {
      for (let i = 0; i < edits[pg].length; i++) {
        hasAny = true;
        const edit    = edits[pg][i];
        const preview = edit.text.length > 20 ? edit.text.slice(0, 20) + '…' : edit.text;
        const row     = document.createElement('div');
        row.className = 'edit-edits-item';
        row.innerHTML =
          `<span class="edit-edits-label">Page ${pg} &mdash; <em>${preview}</em></span>` +
          `<button class="edit-edits-delete" data-page="${pg}" data-idx="${i}" title="Remove">&times;</button>`;
        editsBodyEl.appendChild(row);
      }
    }
    if (!hasAny) {
      editsBodyEl.innerHTML = '<p class="edit-edits-empty">No edits yet</p>';
    }
    editsBodyEl.querySelectorAll('.edit-edits-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const pg  = parseInt(btn.dataset.page, 10);
        const idx = parseInt(btn.dataset.idx,  10);
        edits[pg].splice(idx, 1);
        if (edits[pg].length === 0) delete edits[pg];
        if (pg === currentPage) renderPage(currentPage);
        renderEditsList();
      });
    });
  }

  // ── Download ──────────────────────────────────────────────────────────────
  downloadBtn.addEventListener('click', async () => {
    if (!pdfBytes) return;
    downloadBtn.disabled = true;
    resultEl.innerHTML   = '';
    try {
      const doc = await PDFDocument.load(pdfBytes);

      // Cache embedded fonts — each unique font key embedded once
      const fontCache = {};
      async function getFont(key) {
        if (!fontCache[key]) fontCache[key] = await doc.embedFont(StandardFonts[key] || StandardFonts.Helvetica);
        return fontCache[key];
      }

      for (const [pgStr, pageEdits] of Object.entries(edits)) {
        const pgNum = parseInt(pgStr, 10);
        const pg    = doc.getPage(pgNum - 1);
        const pgW   = pg.getWidth();
        const pgH   = pg.getHeight();

        for (const edit of pageEdits) {
          // Convert canvas px → PDF pts using dimensions stored at draw time
          const sX     = pgW / edit.canvasW;
          const sY     = pgH / edit.canvasH;
          const pdfX   = edit.x * sX;
          const pdfW   = edit.w * sX;
          const pdfH   = edit.h * sY;
          // PDF y=0 is bottom; canvas y=0 is top
          const pdfY   = pgH - (edit.y * sY) - pdfH;

          // White rectangle
          pg.drawRectangle({ x: pdfX, y: pdfY, width: pdfW, height: pdfH, color: rgb(1, 1, 1) });

          // Replacement text (baseline near top of box)
          const [r, g, b] = hexToRgb(edit.color);
          const font = await getFont(edit.font || 'Helvetica');
          pg.drawText(edit.text, {
            x: pdfX + 2,
            y: pdfY + pdfH - edit.fontSize - 2,
            size:  edit.fontSize,
            font,
            color: rgb(r, g, b),
            maxWidth: pdfW - 4,
          });
        }
      }

      const outBytes = await doc.save();
      const blob     = new Blob([outBytes], { type: 'application/pdf' });
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      let fname      = filenameInput.value.trim() || 'edited.pdf';
      if (!fname.endsWith('.pdf')) fname += '.pdf';
      a.href = url; a.download = fname; a.click();
      URL.revokeObjectURL(url);

      trackUsage('edit');
      resultEl.innerHTML = `<div class="result-card"><div class="result-icon">✅</div><div class="result-text"><div class="result-title">Edited PDF downloaded.</div></div></div>`;
    } catch (e) {
      showError(resultEl, e.message || 'Failed to create PDF');
    } finally {
      downloadBtn.disabled = false;
    }
  });

  function hexToRgb(hex) {
    return [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ];
  }
})();
