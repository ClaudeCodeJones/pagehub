/* ── Navigation ────────────────────────────────────────────────────────────── */
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tool-view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-' + btn.dataset.tool).classList.add('active');
  });
});

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function fmt(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function showLoading(el, msg = 'Processing…') {
  el.innerHTML = `<div class="loading-card"><div class="spinner"></div>${msg}</div>`;
}

function showResult(el, title, sub, blob, filename) {
  const url = URL.createObjectURL(blob);
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

async function handleResponse(res, el, filename, title) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    showError(el, err.error || 'Server error');
    return;
  }
  const blob = await res.blob();
  showResult(el, title || 'Done!', `${fmt(blob.size)} · ${filename}`, blob, filename);
}

/* ── Drop zone factory ─────────────────────────────────────────────────────── */
function setupDropZone(dropEl, inputEl, callback, multiple = false) {
  dropEl.addEventListener('dragover', e => { e.preventDefault(); dropEl.classList.add('dragover'); });
  dropEl.addEventListener('dragleave', () => dropEl.classList.remove('dragover'));
  dropEl.addEventListener('drop', e => {
    e.preventDefault();
    dropEl.classList.remove('dragover');
    const files = [...e.dataTransfer.files];
    if (files.length) callback(multiple ? files : [files[0]]);
  });
  inputEl.addEventListener('change', () => {
    if (inputEl.files.length) callback(multiple ? [...inputEl.files] : [inputEl.files[0]]);
  });
}

/* ── Drag-to-reorder list ──────────────────────────────────────────────────── */
function makeSortable(list) {
  let dragged = null;
  list.addEventListener('dragstart', e => {
    dragged = e.target.closest('.file-item');
    setTimeout(() => dragged && dragged.classList.add('dragging'), 0);
  });
  list.addEventListener('dragend', () => dragged && dragged.classList.remove('dragging'));
  list.addEventListener('dragover', e => {
    e.preventDefault();
    const over = e.target.closest('.file-item');
    if (over && over !== dragged) {
      const rect = over.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      list.insertBefore(dragged, e.clientY < mid ? over : over.nextSibling);
    }
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
   1. MERGE
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const list = document.getElementById('merge-list');
  const btn = document.getElementById('merge-btn');
  const result = document.getElementById('merge-result');
  let files = [];

  makeSortable(list);

  function renderList() {
    list.innerHTML = '';
    files.forEach((f, i) => {
      const li = document.createElement('li');
      li.className = 'file-item';
      li.draggable = true;
      li.dataset.idx = i;
      li.innerHTML = `<span class="drag-handle">⠿</span>
        <span class="file-name">${f.name}</span>
        <span class="file-size">${fmt(f.size)}</span>
        <button class="remove-btn" data-i="${i}">×</button>`;
      list.appendChild(li);
    });
    btn.disabled = files.length < 2;
  }

  list.addEventListener('click', e => {
    const rb = e.target.closest('.remove-btn');
    if (rb) { files.splice(+rb.dataset.i, 1); renderList(); }
  });

  setupDropZone(
    document.getElementById('merge-drop'),
    document.getElementById('merge-input'),
    newFiles => { files.push(...newFiles); renderList(); },
    true
  );

  btn.addEventListener('click', async () => {
    // Read order from DOM
    const orderedFiles = [...list.querySelectorAll('.file-item')].map(li => files[+li.dataset.idx]);
    const fd = new FormData();
    orderedFiles.forEach(f => fd.append('files', f));
    showLoading(result);
    const res = await fetch('/api/merge', { method: 'POST', body: fd });
    await handleResponse(res, result, 'merged.pdf', 'PDFs merged successfully!');
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   2. SPLIT
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  let file = null;
  const opts = document.getElementById('split-options');
  const rangeRow = document.getElementById('split-range-row');
  const result = document.getElementById('split-result');

  setupDropZone(
    document.getElementById('split-drop'),
    document.getElementById('split-input'),
    files => { file = files[0]; opts.style.display = ''; }
  );

  document.querySelectorAll('input[name="split-mode"]').forEach(r => {
    r.addEventListener('change', () => {
      rangeRow.style.display = r.value === 'range' ? '' : 'none';
    });
  });

  document.getElementById('split-btn').addEventListener('click', async () => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', document.querySelector('input[name="split-mode"]:checked').value);
    fd.append('range', document.getElementById('split-range').value);
    showLoading(result);
    const res = await fetch('/api/split', { method: 'POST', body: fd });
    await handleResponse(res, result, 'split.zip', 'PDF split into pages!');
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   3. ROTATE
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  let file = null;
  const opts = document.getElementById('rotate-options');
  const rangeRow = document.getElementById('rotate-range-row');
  const result = document.getElementById('rotate-result');

  setupDropZone(
    document.getElementById('rotate-drop'),
    document.getElementById('rotate-input'),
    files => { file = files[0]; opts.style.display = ''; }
  );

  document.querySelectorAll('input[name="rotate-target"]').forEach(r => {
    r.addEventListener('change', () => {
      rangeRow.style.display = r.value === 'custom' ? '' : 'none';
    });
  });

  document.getElementById('rotate-btn').addEventListener('click', async () => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('target', document.querySelector('input[name="rotate-target"]:checked').value);
    fd.append('angle', document.querySelector('input[name="rotate-angle"]:checked').value);
    fd.append('range', document.getElementById('rotate-range').value);
    showLoading(result);
    const res = await fetch('/api/rotate', { method: 'POST', body: fd });
    await handleResponse(res, result, 'rotated.pdf', 'Pages rotated!');
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   4. PAGE NUMBERS
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  let file = null;
  let selectedPos = 'top-center';
  const opts = document.getElementById('pn-options');
  const result = document.getElementById('pn-result');

  setupDropZone(
    document.getElementById('pn-drop'),
    document.getElementById('pn-input'),
    files => { file = files[0]; opts.style.display = ''; }
  );

  document.querySelectorAll('.pos-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedPos = btn.dataset.pos;
    });
  });

  document.getElementById('pn-btn').addEventListener('click', async () => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('position', selectedPos);
    fd.append('format', document.getElementById('pn-format').value);
    fd.append('startNum', document.getElementById('pn-start').value);
    showLoading(result);
    const res = await fetch('/api/pagenumbers', { method: 'POST', body: fd });
    await handleResponse(res, result, 'numbered.pdf', 'Page numbers added!');
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   5. HEADERS & FOOTERS
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  let file = null;
  const opts = document.getElementById('hf-options');
  const result = document.getElementById('hf-result');

  setupDropZone(
    document.getElementById('hf-drop'),
    document.getElementById('hf-input'),
    files => { file = files[0]; opts.style.display = ''; }
  );

  document.getElementById('hf-btn').addEventListener('click', async () => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('headerText', document.getElementById('hf-header').value);
    fd.append('footerText', document.getElementById('hf-footer').value);
    showLoading(result);
    const res = await fetch('/api/headerfooter', { method: 'POST', body: fd });
    await handleResponse(res, result, 'headerfooter.pdf', 'Header & footer applied!');
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   6. IMAGES TO PDF
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const list = document.getElementById('convert-list');
  const btn = document.getElementById('convert-btn');
  const result = document.getElementById('convert-result');
  let files = [];

  function renderList() {
    list.innerHTML = '';
    files.forEach((f, i) => {
      const li = document.createElement('li');
      li.className = 'file-item';
      li.innerHTML = `<span class="file-name">${f.name}</span>
        <span class="file-size">${fmt(f.size)}</span>
        <button class="remove-btn" data-i="${i}">×</button>`;
      list.appendChild(li);
    });
    btn.disabled = files.length === 0;
  }

  list.addEventListener('click', e => {
    const rb = e.target.closest('.remove-btn');
    if (rb) { files.splice(+rb.dataset.i, 1); renderList(); }
  });

  setupDropZone(
    document.getElementById('convert-drop'),
    document.getElementById('convert-input'),
    newFiles => { files.push(...newFiles); renderList(); },
    true
  );

  btn.addEventListener('click', async () => {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    showLoading(result);
    const res = await fetch('/api/convert', { method: 'POST', body: fd });
    await handleResponse(res, result, 'images.pdf', 'Images converted to PDF!');
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   7. EXPORT TEXT
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  let file = null;
  const opts = document.getElementById('extract-options');
  const result = document.getElementById('extract-result');

  setupDropZone(
    document.getElementById('extract-drop'),
    document.getElementById('extract-input'),
    files => { file = files[0]; opts.style.display = ''; }
  );

  document.getElementById('extract-btn').addEventListener('click', async () => {
    const format = document.querySelector('input[name="extract-format"]:checked').value;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('format', format);
    showLoading(result);
    const res = await fetch('/api/extract', { method: 'POST', body: fd });
    const ext = format;
    await handleResponse(res, result, `extracted.${ext}`, 'Text extracted!');
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   8. COMPRESS
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  let file = null;
  const opts = document.getElementById('compress-options');
  const result = document.getElementById('compress-result');

  setupDropZone(
    document.getElementById('compress-drop'),
    document.getElementById('compress-input'),
    files => {
      file = files[0];
      opts.style.display = '';
      opts.querySelector('.options-card') || (opts.innerHTML = `<div class="options-card">
        <p style="color:#64748B;margin-bottom:12px">Original size: <strong>${fmt(file.size)}</strong></p>
        <div class="action-row"><button class="btn btn-primary" id="compress-btn">Compress PDF</button></div>
      </div>`);
      setupCompressBtn();
    }
  );

  function setupCompressBtn() {
    document.getElementById('compress-btn').addEventListener('click', async () => {
      const fd = new FormData();
      fd.append('file', file);
      showLoading(result);
      const res = await fetch('/api/compress', { method: 'POST', body: fd });
      await handleResponse(res, result, 'compressed.pdf', 'PDF compressed!');
    });
  }
})();

/* ══════════════════════════════════════════════════════════════════════════════
   9. WATERMARK
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  let file = null;
  const opts = document.getElementById('wm-options');
  const result = document.getElementById('wm-result');
  const slider = document.getElementById('wm-opacity');
  const sliderVal = document.getElementById('wm-opacity-val');

  slider.addEventListener('input', () => { sliderVal.textContent = slider.value + '%'; });

  setupDropZone(
    document.getElementById('wm-drop'),
    document.getElementById('wm-input'),
    files => { file = files[0]; opts.style.display = ''; }
  );

  document.getElementById('wm-btn').addEventListener('click', async () => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('text', document.getElementById('wm-text').value);
    fd.append('opacity', (parseFloat(slider.value) / 100).toFixed(2));
    showLoading(result);
    const res = await fetch('/api/watermark', { method: 'POST', body: fd });
    await handleResponse(res, result, 'watermarked.pdf', 'Watermark applied!');
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   10. REDACT
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  let file = null;
  const opts = document.getElementById('redact-options');
  const result = document.getElementById('redact-result');

  setupDropZone(
    document.getElementById('redact-drop'),
    document.getElementById('redact-input'),
    files => { file = files[0]; opts.style.display = ''; }
  );

  document.getElementById('redact-btn').addEventListener('click', async () => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('terms', document.getElementById('redact-terms').value);
    showLoading(result);
    const res = await fetch('/api/redact', { method: 'POST', body: fd });
    await handleResponse(res, result, 'redacted.pdf', 'PDF redacted!');
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   11. E-SIGNATURE
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  // Tab switching
  document.querySelectorAll('.sign-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sign-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sign-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab + '-tab').classList.add('active');
    });
  });

  // Signature sub-tabs
  document.querySelectorAll('.sig-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sig-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sig-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('sig-' + tab.dataset.sigtab).classList.add('active');
    });
  });

  // Signature canvas
  const canvas = document.getElementById('sig-canvas');
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#1E1B4B';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let drawing = false, hasDrawing = false;

  canvas.addEventListener('pointerdown', e => {
    drawing = true; hasDrawing = true;
    ctx.beginPath();
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    ctx.moveTo((e.clientX - r.left) * scaleX, (e.clientY - r.top) * scaleY);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    ctx.lineTo((e.clientX - r.left) * scaleX, (e.clientY - r.top) * scaleY);
    ctx.stroke();
  });
  canvas.addEventListener('pointerup', () => { drawing = false; });
  document.getElementById('sig-clear').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawing = false;
  });

  // Stamp tab
  let signFile = null;
  const signOpts = document.getElementById('sign-options');
  const signResult = document.getElementById('sign-result');

  setupDropZone(
    document.getElementById('sign-drop'),
    document.getElementById('sign-input'),
    files => { signFile = files[0]; signOpts.style.display = ''; }
  );

  document.getElementById('sign-btn').addEventListener('click', async () => {
    const activeTab = document.querySelector('.sig-tab.active').dataset.sigtab;
    let sigBlob;

    if (activeTab === 'draw') {
      if (!hasDrawing) { showError(signResult, 'Please draw a signature first'); return; }
      sigBlob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    } else {
      // Render typed text to canvas
      const typed = document.getElementById('sig-typed').value;
      if (!typed.trim()) { showError(signResult, 'Please type a signature'); return; }
      const font = document.getElementById('sig-font').value;
      const tc = document.createElement('canvas');
      tc.width = 400; tc.height = 100;
      const tctx = tc.getContext('2d');
      tctx.font = `48px ${font}`;
      tctx.fillStyle = '#1E1B4B';
      tctx.textBaseline = 'middle';
      tctx.fillText(typed, 20, 50);
      sigBlob = await new Promise(res => tc.toBlob(res, 'image/png'));
    }

    const fd = new FormData();
    fd.append('file', signFile);
    fd.append('signature', sigBlob, 'sig.png');
    fd.append('page', document.getElementById('sign-page').value);
    fd.append('x', '50');
    fd.append('y', '100');
    fd.append('width', '200');
    fd.append('height', '80');
    showLoading(signResult);
    const res = await fetch('/api/sign', { method: 'POST', body: fd });
    await handleResponse(res, signResult, 'signed.pdf', 'Signature applied!');
  });

  // Request tab
  document.getElementById('req-btn').addEventListener('click', async () => {
    const result = document.getElementById('req-result');
    showLoading(result, 'Drafting email with AI…');
    const res = await fetch('/api/sign/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderName: document.getElementById('req-sender').value,
        recipientName: document.getElementById('req-recipient').value,
        recipientEmail: document.getElementById('req-email').value,
        documentName: document.getElementById('req-doc').value,
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      showError(result, err.error);
      return;
    }
    const data = await res.json();
    result.innerHTML = `<div class="result-card" style="align-items:flex-start;flex-direction:column;gap:8px">
      <div class="result-title" style="color:#065F46">✅ Email drafted by Claude AI</div>
      <div class="ai-draft">${data.draft.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
    </div>`;
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   12. FORM FILLER
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  let sessionId = null;
  let fields = [];
  const fieldsArea = document.getElementById('form-fields-area');
  const fieldCount = document.getElementById('form-field-count');
  const fieldsList = document.getElementById('form-fields-list');
  const result = document.getElementById('form-result');

  setupDropZone(
    document.getElementById('form-drop'),
    document.getElementById('form-input'),
    async files => {
      showLoading(result, 'Scanning form fields…');
      const fd = new FormData();
      fd.append('file', files[0]);
      const res = await fetch('/api/form/scan', { method: 'POST', body: fd });
      if (!res.ok) { const e = await res.json(); showError(result, e.error); return; }
      const data = await res.json();
      sessionId = data.sessionId;
      fields = data.fields;
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
        row.innerHTML = `<span class="field-label">${f.name}</span>
          <span class="field-type">${f.type}</span>
          <input class="text-input field-input" data-name="${f.name}" placeholder="Value…" />`;
        fieldsList.appendChild(row);
      });
      fieldsArea.style.display = '';
    }
  );

  document.getElementById('form-fill-btn').addEventListener('click', async () => {
    const values = {};
    fieldsList.querySelectorAll('[data-name]').forEach(inp => {
      if (inp.value) values[inp.dataset.name] = inp.value;
    });
    showLoading(result);
    const res = await fetch('/api/form/fill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, values })
    });
    await handleResponse(res, result, 'filled.pdf', 'Form filled & flattened!');
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   13. PDF INFO
══════════════════════════════════════════════════════════════════════════════ */
(function () {
  const infoResults = document.getElementById('info-results');
  const infoMeta = document.getElementById('info-meta');
  const infoTbl = document.getElementById('info-pages-tbl').querySelector('tbody');

  setupDropZone(
    document.getElementById('info-drop'),
    document.getElementById('info-input'),
    async files => {
      const fd = new FormData();
      fd.append('file', files[0]);
      const res = await fetch('/api/info', { method: 'POST', body: fd });
      if (!res.ok) { const e = await res.json(); showError(document.getElementById('info-result'), e.error); return; }
      const d = await res.json();

      const meta = [
        { label: 'Page Count', value: d.pageCount, large: true },
        { label: 'Title', value: d.title || '—' },
        { label: 'Author', value: d.author || '—' },
        { label: 'Subject', value: d.subject || '—' },
        { label: 'Creator', value: d.creator || '—' },
        { label: 'Producer', value: d.producer || '—' },
        { label: 'Created', value: d.creationDate ? new Date(d.creationDate).toLocaleString() : '—' },
        { label: 'Modified', value: d.modDate ? new Date(d.modDate).toLocaleString() : '—' },
      ];

      infoMeta.innerHTML = meta.map(m =>
        `<div class="info-card">
          <div class="info-card-label">${m.label}</div>
          <div class="info-card-value${m.large ? ' large' : ''}">${m.value}</div>
        </div>`
      ).join('');

      infoTbl.innerHTML = d.pages.map(p =>
        `<tr><td>${p.page}</td><td>${p.width}</td><td>${p.height}</td><td>${p.rotation}°</td></tr>`
      ).join('');

      infoResults.style.display = '';
    }
  );
})();
