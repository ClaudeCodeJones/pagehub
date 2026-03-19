const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// Serve static assets (CSS, JS, images).
// index:false prevents express from auto-serving public/index.html for GET /
// so the explicit routes below control which HTML file each path gets.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ─── Page routes ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback — send landing page for any unmatched GET
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// ─── Local dev ────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => console.log(`PageHub running on http://localhost:${PORT}`));
}

module.exports = app;
