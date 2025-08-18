const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

/*
 * Configuration
 *
 * These values may be overridden by environment variables. See `.env.example` for
 * details on each option. The defaults here are conservative so that the
 * application will run out‑of‑the‑box in development while still being
 * production ready.
 */
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const PHOTO_DIR = process.env.PHOTO_DIR || path.join(__dirname, 'photos');
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || 'changeme';
const MAX_FILE_BYTES = process.env.MAX_FILE_BYTES ? parseInt(process.env.MAX_FILE_BYTES, 10) : 10 * 1024 * 1024; // 10 MB

// Allowed file extensions for uploaded/served images
const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// Ensure the photo directory exists
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const app = express();

// Rate limiter for upload endpoint. Defaults aim to be conservative on low‑spec
// machines (e.g. Hetzner CX22). Adjust in production via env or config as
// necessary. Each IP is allowed 10 uploads every 15 minutes.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload attempts. Please try again later.' }
});

// Configure multer to store files in memory. We'll perform validation on
// extension and magic number before writing to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES }
});

/**
 * Perform a constant‑time comparison between two secrets. This helps to
 * mitigate timing attacks on the upload token.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEquals(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // If lengths differ, compare against an empty buffer to avoid revealing
  // length via timing.
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Very basic magic‑number sniffing. Reads the beginning of a buffer and checks
 * for common image signatures. This is not exhaustive but covers the formats
 * accepted by this application.
 *
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function isValidImageMagic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return false;
  }
  // JPEG: starts with 0xFF 0xD8 0xFF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return true;
  }
  // GIF: starts with GIF87a or GIF89a
  const ascii6 = buffer.slice(0, 6).toString('ascii');
  if (ascii6 === 'GIF87a' || ascii6 === 'GIF89a') {
    return true;
  }
  // WEBP: RIFF....WEBP (RIFF header, then WEBP signature at offset 8)
  const riff = buffer.slice(0, 4).toString('ascii');
  const webp = buffer.slice(8, 12).toString('ascii');
  if (riff === 'RIFF' && webp === 'WEBP') {
    return true;
  }
  return false;
}

/**
 * Generate a random, timestamped filename while preserving the original
 * extension. Colons and other characters invalid on some file systems are
 * stripped/replaced. Example: 20250101T123456_abcdef123456.jpg
 *
 * @param {string} ext File extension, including the dot (e.g. ".jpg").
 */
function generateFilename(ext) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .substring(0, 15); // YYYYMMDDhhmmss
  const randomPart = crypto.randomBytes(6).toString('hex');
  return `${timestamp}_${randomPart}${ext}`;
}

// API to return the list of images. Reads the directory and filters by
// extension. Does not perform any image manipulation.
app.get('/api/photos', (req, res) => {
  fs.readdir(PHOTO_DIR, (err, files) => {
    if (err) {
      console.error('Unable to list photo directory:', err);
      return res.status(500).json({ error: 'Unable to list photos' });
    }
    const images = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return VALID_EXTENSIONS.includes(ext);
    });
    return res.json(images);
  });
});

// Endpoint to serve individual images. Sends the file from disk with caching
// headers. Only whitelisted extensions are allowed.
app.get('/files/:name', (req, res) => {
  const fileName = req.params.name;
  const ext = path.extname(fileName).toLowerCase();
  if (!VALID_EXTENSIONS.includes(ext)) {
    return res.status(404).send('Not found');
  }
  const filePath = path.join(PHOTO_DIR, fileName);
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      return res.status(404).send('Not found');
    }
    // Set long cache headers to encourage client caching. Files are immutable
    // because we never overwrite; we always generate a new filename.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  });
});

// Upload endpoint. Requires a valid Bearer token in the Authorization header.
app.post('/api/upload', uploadLimiter, upload.single('photo'), (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const providedToken = authHeader.slice(7);
    if (!timingSafeEquals(providedToken, UPLOAD_TOKEN)) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!VALID_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ error: 'Unsupported file type' });
    }
    if (!isValidImageMagic(file.buffer)) {
      return res.status(400).json({ error: 'Uploaded file is not a valid image' });
    }
    const newName = generateFilename(ext);
    const destPath = path.join(PHOTO_DIR, newName);
    fs.writeFile(destPath, file.buffer, err => {
      if (err) {
        console.error('Error saving uploaded file:', err);
        return res.status(500).json({ error: 'Failed to save file' });
      }
      return res.status(200).json({ success: true, filename: newName });
    });
  } catch (e) {
    console.error('Error handling upload:', e);
    return res.status(500).json({ error: 'Unexpected error during upload' });
  }
});

// Serve the static frontend assets from the `public` directory. The index
// contains the gallery UI and upload modal.
app.use(express.static(path.join(__dirname, 'public')));

// Start the server
app.listen(PORT, () => {
  console.log(`Photo app listening on port ${PORT}`);
});