const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 3000;

// Session store for form filling
const formSessions = new Map();

app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer config
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsePageRange(rangeStr, totalPages) {
  const pages = new Set();
  const parts = rangeStr.split(',').map(s => s.trim());
  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      for (let i = start; i <= Math.min(end, totalPages); i++) pages.add(i - 1);
    } else {
      const n = parseInt(part);
      if (!isNaN(n) && n >= 1 && n <= totalPages) pages.add(n - 1);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

async function loadPdf(buffer) {
  return await PDFDocument.load(buffer, { ignoreEncryption: true });
}

// ─── 1. Merge PDFs ────────────────────────────────────────────────────────────
app.post('/api/merge', upload.array('files', 20), async (req, res) => {
  try {
    const merged = await PDFDocument.create();
    for (const file of req.files) {
      const src = await loadPdf(file.buffer);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }
    const bytes = await merged.save();
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="merged.pdf"' });
    res.send(Buffer.from(bytes));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 2. Split PDF ─────────────────────────────────────────────────────────────
app.post('/api/split', upload.single('file'), async (req, res) => {
  try {
    const src = await loadPdf(req.file.buffer);
    const total = src.getPageCount();
    const { mode, range } = req.body; // mode: 'all' | 'range'

    let indices = mode === 'range' ? parsePageRange(range, total) : src.getPageIndices();

    const archive = archiver('zip', { zlib: { level: 6 } });
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="split.zip"' });
    archive.pipe(res);

    for (const idx of indices) {
      const single = await PDFDocument.create();
      const [page] = await single.copyPages(src, [idx]);
      single.addPage(page);
      const bytes = await single.save();
      archive.append(Buffer.from(bytes), { name: `page-${idx + 1}.pdf` });
    }

    await archive.finalize();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 3. Rotate Pages ─────────────────────────────────────────────────────────
app.post('/api/rotate', upload.single('file'), async (req, res) => {
  try {
    const doc = await loadPdf(req.file.buffer);
    const total = doc.getPageCount();
    const { target, angle, range } = req.body; // target: all|odd|even|custom
    const deg = parseInt(angle) || 90;

    let indices = [];
    if (target === 'all') indices = doc.getPageIndices();
    else if (target === 'odd') indices = doc.getPageIndices().filter(i => i % 2 === 0);
    else if (target === 'even') indices = doc.getPageIndices().filter(i => i % 2 === 1);
    else if (target === 'custom') indices = parsePageRange(range, total);

    for (const i of indices) {
      const page = doc.getPage(i);
      page.setRotation(degrees((page.getRotation().angle + deg) % 360));
    }

    const bytes = await doc.save();
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="rotated.pdf"' });
    res.send(Buffer.from(bytes));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 4. Page Numbers ──────────────────────────────────────────────────────────
app.post('/api/pagenumbers', upload.single('file'), async (req, res) => {
  try {
    const doc = await loadPdf(req.file.buffer);
    const total = doc.getPageCount();
    const { position, format, startNum } = req.body;
    // position: bottom-left, bottom-center, bottom-right, top-left, top-center, top-right
    // format: '1' | 'Page 1' | '1/10' | 'Page 1 of 10'
    const start = parseInt(startNum) || 1;
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontSize = 10;
    const margin = 30;

    for (let i = 0; i < total; i++) {
      const page = doc.getPage(i);
      const { width, height } = page.getSize();
      const pageNum = start + i;
      let text = '';
      if (format === '1') text = `${pageNum}`;
      else if (format === 'Page 1') text = `Page ${pageNum}`;
      else if (format === '1/10') text = `${pageNum}/${total}`;
      else text = `Page ${pageNum} of ${total}`;

      const textWidth = font.widthOfTextAtSize(text, fontSize);
      let x, y;
      const isTop = position.startsWith('top');
      y = isTop ? height - margin : margin - fontSize / 2;
      if (position.endsWith('left')) x = margin;
      else if (position.endsWith('right')) x = width - margin - textWidth;
      else x = (width - textWidth) / 2;

      page.drawText(text, { x, y, size: fontSize, font, color: rgb(0, 0, 0) });
    }

    const bytes = await doc.save();
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="numbered.pdf"' });
    res.send(Buffer.from(bytes));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 5. Headers & Footers ─────────────────────────────────────────────────────
app.post('/api/headerfooter', upload.single('file'), async (req, res) => {
  try {
    const doc = await loadPdf(req.file.buffer);
    const total = doc.getPageCount();
    const { headerText, footerText } = req.body;
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontSize = 10;
    const margin = 20;

    for (let i = 0; i < total; i++) {
      const page = doc.getPage(i);
      const { width, height } = page.getSize();

      if (headerText && headerText.trim()) {
        const tw = font.widthOfTextAtSize(headerText, fontSize);
        page.drawText(headerText, { x: (width - tw) / 2, y: height - margin - fontSize, size: fontSize, font, color: rgb(0, 0, 0) });
      }
      if (footerText && footerText.trim()) {
        const tw = font.widthOfTextAtSize(footerText, fontSize);
        page.drawText(footerText, { x: (width - tw) / 2, y: margin, size: fontSize, font, color: rgb(0, 0, 0) });
      }
    }

    const bytes = await doc.save();
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="headerfooter.pdf"' });
    res.send(Buffer.from(bytes));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 6. Images to PDF ─────────────────────────────────────────────────────────
app.post('/api/convert', upload.array('files', 50), async (req, res) => {
  try {
    const doc = await PDFDocument.create();
    for (const file of req.files) {
      const mime = file.mimetype;
      let img;
      if (mime === 'image/jpeg' || mime === 'image/jpg') img = await doc.embedJpg(file.buffer);
      else if (mime === 'image/png') img = await doc.embedPng(file.buffer);
      else continue; // skip unsupported

      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    const bytes = await doc.save();
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="images.pdf"' });
    res.send(Buffer.from(bytes));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 7. Extract Text ──────────────────────────────────────────────────────────
app.post('/api/extract', upload.single('file'), async (req, res) => {
  try {
    const { format } = req.body; // txt | md | html
    // Use pdfjs-dist for text extraction
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(req.file.buffer) });
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;
    const pages = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str).join(' ');
      pages.push(text);
    }

    let output, ext, contentType;
    if (format === 'md') {
      output = pages.map((t, i) => `## Page ${i + 1}\n\n${t}`).join('\n\n---\n\n');
      ext = 'md'; contentType = 'text/markdown';
    } else if (format === 'html') {
      const body = pages.map((t, i) => `<section><h2>Page ${i + 1}</h2><p>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p></section>`).join('\n');
      output = `<!DOCTYPE html><html><body>${body}</body></html>`;
      ext = 'html'; contentType = 'text/html';
    } else {
      output = pages.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join('\n\n');
      ext = 'txt'; contentType = 'text/plain';
    }

    res.set({ 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="extracted.${ext}"` });
    res.send(output);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 8. Compress PDF ─────────────────────────────────────────────────────────
app.post('/api/compress', upload.single('file'), async (req, res) => {
  try {
    const doc = await loadPdf(req.file.buffer);
    // Re-serialise with object streams enabled for compression
    const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="compressed.pdf"' });
    res.send(Buffer.from(bytes));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 9. Watermark ─────────────────────────────────────────────────────────────
app.post('/api/watermark', upload.single('file'), async (req, res) => {
  try {
    const doc = await loadPdf(req.file.buffer);
    const { text, opacity } = req.body;
    const op = parseFloat(opacity) || 0.3;
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const fontSize = 60;
    const watermarkText = text || 'WATERMARK';

    for (let i = 0; i < doc.getPageCount(); i++) {
      const page = doc.getPage(i);
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(watermarkText, fontSize);
      page.drawText(watermarkText, {
        x: (width - textWidth) / 2,
        y: (height - fontSize) / 2,
        size: fontSize,
        font,
        color: rgb(0.5, 0.5, 0.5),
        opacity: op,
        rotate: degrees(45),
      });
    }

    const bytes = await doc.save();
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="watermarked.pdf"' });
    res.send(Buffer.from(bytes));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 10. Redact ───────────────────────────────────────────────────────────────
app.post('/api/redact', upload.single('file'), async (req, res) => {
  try {
    const doc = await loadPdf(req.file.buffer);
    const terms = (req.body.terms || '').split('\n').map(t => t.trim()).filter(Boolean);

    // Use pdfjs to find text positions, then draw black rectangles over them
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(req.file.buffer) });
    const pdfJsDoc = await loadingTask.promise;

    for (let i = 0; i < doc.getPageCount(); i++) {
      const pdfPage = doc.getPage(i);
      const { width, height } = pdfPage.getSize();
      const jsPage = await pdfJsDoc.getPage(i + 1);
      const vp = jsPage.getViewport({ scale: 1 });
      const content = await jsPage.getTextContent();

      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        for (const term of terms) {
          if (item.str.toLowerCase().includes(term.toLowerCase())) {
            const [tx, ty] = [item.transform[4], item.transform[5]];
            const itemWidth = item.width;
            const itemHeight = item.height || 10;
            // pdfjs y is from bottom in viewport coords
            const pdfY = height - ty - itemHeight;
            pdfPage.drawRectangle({
              x: tx, y: pdfY, width: itemWidth, height: itemHeight + 2,
              color: rgb(0, 0, 0),
            });
            break;
          }
        }
      }
    }

    const bytes = await doc.save();
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="redacted.pdf"' });
    res.send(Buffer.from(bytes));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 11. E-Signature ─────────────────────────────────────────────────────────
app.post('/api/sign', upload.fields([{ name: 'file' }, { name: 'signature' }]), async (req, res) => {
  try {
    const doc = await loadPdf(req.files['file'][0].buffer);
    const sigBuffer = req.files['signature'][0].buffer;
    const { page: pageNum, x, y, width: sigWidth, height: sigHeight } = req.body;

    const sigImg = await doc.embedPng(sigBuffer);
    const pageIndex = parseInt(pageNum) - 1 || 0;
    const page = doc.getPage(pageIndex);
    const { height } = page.getSize();

    page.drawImage(sigImg, {
      x: parseFloat(x) || 50,
      y: height - (parseFloat(y) || 100) - (parseFloat(sigHeight) || 80),
      width: parseFloat(sigWidth) || 200,
      height: parseFloat(sigHeight) || 80,
    });

    const bytes = await doc.save();
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="signed.pdf"' });
    res.send(Buffer.from(bytes));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 11b. Draft signature request email via Claude API ───────────────────────
app.post('/api/sign/request', express.json(), async (req, res) => {
  try {
    const { recipientName, recipientEmail, senderName, documentName } = req.body;
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Draft a short, professional email requesting an e-signature.
Sender: ${senderName || 'Sender'}
Recipient: ${recipientName || 'Recipient'} <${recipientEmail || ''}>
Document: ${documentName || 'the attached document'}
Keep it under 150 words. Return only the email body, no subject line.`
      }]
    });

    res.json({ draft: message.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 12. Form Scan ────────────────────────────────────────────────────────────
app.post('/api/form/scan', upload.single('file'), async (req, res) => {
  try {
    const doc = await loadPdf(req.file.buffer);
    const form = doc.getForm();
    const fields = form.getFields().map(f => ({
      name: f.getName(),
      type: f.constructor.name.replace('PDF', '').replace('Field', ''),
    }));
    const sessionId = uuidv4();
    formSessions.set(sessionId, req.file.buffer);
    // Auto-clean after 10 min
    setTimeout(() => formSessions.delete(sessionId), 10 * 60 * 1000);
    res.json({ sessionId, fields });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 12b. Form Fill ───────────────────────────────────────────────────────────
app.post('/api/form/fill', express.json(), async (req, res) => {
  try {
    const { sessionId, values } = req.body;
    const buf = formSessions.get(sessionId);
    if (!buf) return res.status(404).json({ error: 'Session not found or expired' });

    const doc = await loadPdf(buf);
    const form = doc.getForm();

    for (const [name, value] of Object.entries(values)) {
      try {
        const field = form.getField(name);
        const type = field.constructor.name;
        if (type === 'PDFTextField') field.setText(String(value));
        else if (type === 'PDFCheckBox') value ? field.check() : field.uncheck();
        else if (type === 'PDFDropdown') field.select(String(value));
        else if (type === 'PDFRadioGroup') field.select(String(value));
      } catch { /* skip unknown fields */ }
    }

    form.flatten();
    const bytes = await doc.save();
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="filled.pdf"' });
    res.send(Buffer.from(bytes));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 13. PDF Info ─────────────────────────────────────────────────────────────
app.post('/api/info', upload.single('file'), async (req, res) => {
  try {
    const doc = await loadPdf(req.file.buffer);
    const pages = [];
    for (let i = 0; i < doc.getPageCount(); i++) {
      const p = doc.getPage(i);
      const { width, height } = p.getSize();
      pages.push({ page: i + 1, width: Math.round(width), height: Math.round(height), rotation: p.getRotation().angle });
    }
    res.json({
      pageCount: doc.getPageCount(),
      title: doc.getTitle() || null,
      author: doc.getAuthor() || null,
      subject: doc.getSubject() || null,
      creator: doc.getCreator() || null,
      producer: doc.getProducer() || null,
      creationDate: doc.getCreationDate()?.toISOString() || null,
      modDate: doc.getModificationDate()?.toISOString() || null,
      pages,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Local dev: start server only when run directly (not when imported by Vercel)
if (require.main === module) {
  app.listen(PORT, () => console.log(`PageHub running on http://localhost:${PORT}`));
}

module.exports = app;
