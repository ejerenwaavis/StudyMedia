require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./server/config/db');
const studyRoutes = require('./server/routes/studyRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Connect to MongoDB Atlas (non-blocking fallback to localStorage if unavailable)
connectDB();

// API routes
app.use('/api', studyRoutes);

// Serve static frontend build from top-level public_html
// dotfiles: 'allow' is required for Let's Encrypt HTTP-01 /.well-known/acme-challenge/*
const staticDir = path.join(__dirname, 'public_html');
app.use(express.static(staticDir, { dotfiles: 'allow' }));

// SPA fallback for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`StudyMedia server running on port ${PORT}`);
});
