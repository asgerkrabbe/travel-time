const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const sharp = require('sharp');
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
const MAX_FILES_PER_UPLOAD = process.env.MAX_FILES_PER_UPLOAD ? parseInt(process.env.MAX_FILES_PER_UPLOAD, 10) : 10; // per request
const ENABLE_TEST_FIXTURES = (() => {
  const raw = process.env.ENABLE_TEST_FIXTURES;
  if (typeof raw !== 'string') {
    return false;
  }
  return ['1', 'true', 'yes'].includes(raw.toLowerCase());
})();
const TEST_FIXTURE_TOKEN = process.env.TEST_FIXTURE_TOKEN || UPLOAD_TOKEN;

// Allowed file extensions for uploaded/served images
const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// Ensure the photo directory exists
fs.mkdirSync(PHOTO_DIR, { recursive: true });
// Ensure the thumbnail directory exists
const THUMBS_DIR = path.join(PHOTO_DIR, 'thumbs');
fs.mkdirSync(THUMBS_DIR, { recursive: true });

const fsp = fs.promises;
const TEST_FIXTURES = ENABLE_TEST_FIXTURES ? require('./deploy/test-fixtures') : [];

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

async function fileExists(filePath) {
  try {
    const stats = await fsp.stat(filePath);
    return stats.isFile();
  } catch (err) {
    return false;
  }
}

async function storeImageFromBuffer(buffer, originalName, options = {}) {
  const { forceBasename, overwrite = true } = options;

  if (!Buffer.isBuffer(buffer)) {
    return { error: 'Uploaded file is not a valid image buffer', original: originalName };
  }

  const sourceName = forceBasename || originalName || 'upload';
  const ext = path.extname(sourceName).toLowerCase();
  if (!ext) {
    return { error: 'Unable to determine file type', original: originalName };
  }
  if (!VALID_EXTENSIONS.includes(ext)) {
    return { error: 'Unsupported file type', original: originalName };
  }
  if (!isValidImageMagic(buffer)) {
    return { error: 'Uploaded file is not a valid image', original: originalName };
  }

  let targetName;
  if (forceBasename) {
    const safeBase = path.basename(forceBasename, ext);
    targetName = `${safeBase}${ext}`;
  } else {
    targetName = generateFilename(ext);
  }
  const destPath = path.join(PHOTO_DIR, targetName);

  if (!overwrite) {
    if (await fileExists(destPath)) {
      const base = path.basename(targetName, ext);
      const thumbName = `${base}.thumb.jpg`;
      const thumbPath = path.join(THUMBS_DIR, thumbName);
      if (!(await fileExists(thumbPath))) {
        try {
          await sharp(buffer)
            .resize({ width: 450 })
            .jpeg({ quality: 80 })
            .toFile(thumbPath);
        } catch (err) {
          console.error('Error generating thumbnail:', err);
        }
      }
      return { item: { filename: targetName, thumb: thumbName }, skipped: true };
    }
  }

  await fsp.writeFile(destPath, buffer);

  const base = path.basename(targetName, ext);
  const thumbName = `${base}.thumb.jpg`;
  const thumbPath = path.join(THUMBS_DIR, thumbName);
  try {
    await sharp(buffer)
      .resize({ width: 450 })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);
  } catch (err) {
    console.error('Error generating thumbnail:', err);
  }

  return { item: { filename: targetName, thumb: thumbName }, skipped: false };
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
  const includeMeta = 'meta' in req.query; // use ?meta=1 to get thumb info
  fs.readdir(PHOTO_DIR, (err, files) => {
    if (err) {
      console.error('Unable to list photo directory:', err);
      return res.status(500).json({ error: 'Unable to list photos' });
    }
    const originals = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return VALID_EXTENSIONS.includes(ext);
    });
    if (!includeMeta) {
      // Backward compatible: return array of strings
      return res.json(originals);
    }
    // Optional: include thumbnail mapping metadata
    fs.readdir(THUMBS_DIR, (thumbErr, thumbFiles) => {
      const thumbSet = new Set(Array.isArray(thumbFiles) ? thumbFiles : []);
      const images = originals.map(file => {
        const ext = path.extname(file).toLowerCase();
        const base = path.basename(file, ext);
        const candidates = [
          `${base}.thumb.jpg`,
          `${base}.jpg`
        ];
        const found = candidates.find(name => thumbSet.has(name)) || null;
        return { original: file, thumb: found };
      });
      return res.json(images);
    });
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

// Endpoint to serve thumbnails
app.get('/files/thumbs/:name', (req, res) => {
  const inputName = req.params.name;
  const ext = path.extname(inputName).toLowerCase();
  if (!VALID_EXTENSIONS.includes(ext)) {
    return res.status(404).send('Not found');
  }
  // If a direct thumbnail file is requested and exists, serve it.
  const directThumbPath = path.join(THUMBS_DIR, inputName);
  if (fs.existsSync(directThumbPath) && fs.statSync(directThumbPath).isFile()) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(directThumbPath);
  }
  // Otherwise, treat inputName as the ORIGINAL filename and try to map to a thumb
  const base = path.basename(inputName, ext);
  const candidates = [
    path.join(THUMBS_DIR, `${base}.thumb.jpg`), // new pattern
    path.join(THUMBS_DIR, `${base}.jpg`) // legacy pattern
  ];
  const existing = candidates.find(p => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!existing) {
    return res.status(404).send('Not found');
  }
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return res.sendFile(existing);
});

// Upload endpoint. Requires a valid Bearer token in the Authorization header.
app.post('/api/upload', uploadLimiter, upload.array('photo', MAX_FILES_PER_UPLOAD), async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const providedToken = authHeader.slice(7);
    if (!timingSafeEquals(providedToken, UPLOAD_TOKEN)) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const items = [];
    const errors = [];
    for (const file of files) {
      try {
        const result = await storeImageFromBuffer(file.buffer, file.originalname);
        if (result.error) {
          errors.push({ original: file.originalname, error: result.error });
          continue;
        }
        if (result.item) {
          items.push(result.item);
        }
      } catch (err) {
        console.error('Error processing file:', err);
        errors.push({ original: file?.originalname || 'unknown', error: 'Processing failed' });
      }
    }

    if (items.length === 0) {
      return res.status(400).json({ success: false, errors });
    }
    return res.status(200).json({ success: true, items, errors: errors.length ? errors : undefined });

  } catch (e) {
    console.error('Error handling upload:', e);
    return res.status(500).json({ error: 'Unexpected error during upload' });
  }
});

app.post('/api/test/fixtures', async (req, res) => {
  if (!ENABLE_TEST_FIXTURES) {
    return res.status(404).json({ error: 'Not found' });
  }
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const providedToken = authHeader.slice(7);
  if (!timingSafeEquals(providedToken, TEST_FIXTURE_TOKEN)) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const results = [];
  const errors = [];

  for (const fixture of TEST_FIXTURES) {
    try {
      const buffer = Buffer.from(fixture.base64, 'base64');
      const result = await storeImageFromBuffer(buffer, fixture.filename, {
        forceBasename: fixture.filename,
        overwrite: false
      });
      if (result.error) {
        errors.push({ fixture: fixture.slug, error: result.error });
      }
      if (result.item) {
        results.push({
          fixture: fixture.slug,
          filename: result.item.filename,
          thumb: result.item.thumb,
          skipped: Boolean(result.skipped)
        });
      }
    } catch (err) {
      console.error('Error loading test fixture:', err);
      errors.push({ fixture: fixture.slug, error: 'Processing failed' });
    }
  }

  return res.status(200).json({
    success: results.some(item => !item.skipped),
    results,
    errors: errors.length ? errors : undefined
  });
});

// Serve the static frontend assets from the `public` directory. The index
// contains the gallery UI and upload modal.
app.use(express.static(path.join(__dirname, 'public')));

// Start the server
app.listen(PORT, () => {
  console.log(`Photo app listening on port ${PORT}`);
});