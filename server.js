const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const sharp = require('sharp');
const exifParser = require('exif-parser');
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
const EXIF_BUFFER_SIZE = 65536; // 64KB, sufficient for EXIF headers in most images

// Allowed file extensions for uploaded/served images
const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// Ensure the photo directory exists
fs.mkdirSync(PHOTO_DIR, { recursive: true });
// Ensure the thumbnail directory exists
const THUMBS_DIR = path.join(PHOTO_DIR, 'thumbs');
fs.mkdirSync(THUMBS_DIR, { recursive: true });

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
app.get('/api/photos', async (req, res) => {
  const includeMeta = 'meta' in req.query; // use ?meta=1 to get thumb info and date_taken

  try {
    const files = await fs.promises.readdir(PHOTO_DIR);
    const originals = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return VALID_EXTENSIONS.includes(ext);
    });

    // Helper to extract date taken (EXIF DateTimeOriginal) with fallback to mtime
    async function getDateInfoFor(file) {
      const fullPath = path.join(PHOTO_DIR, file);
      let dateMs = null;
      let source = null;
      try {
        // Read only the first 64KB for EXIF headers (sufficient for most images)
        const fileHandle = await fs.promises.open(fullPath, 'r');
        let fileBuf;
        try {
          const buffer = Buffer.alloc(EXIF_BUFFER_SIZE);
          const { bytesRead } = await fileHandle.read(buffer, 0, EXIF_BUFFER_SIZE, 0);
          fileBuf = buffer.slice(0, bytesRead);
        } finally {
          await fileHandle.close();
        }
        
        try {
          const parsed = exifParser.create(fileBuf).parse();
          const tags = parsed && parsed.tags ? parsed.tags : {};
          let ts = null;
          const candidates = [
            tags.DateTimeOriginal,
            tags.CreateDate,
            tags.ModifyDate,
            tags.DateTimeDigitized
          ];
          for (const val of candidates) {
            if (ts) break;
            if (typeof val === 'number') ts = val * 1000; // seconds -> ms
            else if (val instanceof Date) ts = +val;
            else if (typeof val === 'string') {
              const m = val.match(/^([0-9]{4}):([0-9]{2}):([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})$/);
              if (m) {
                // EXIF dates are in local time, not UTC
                const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
                ts = Date.parse(iso);
              }
            }
          }
          if (typeof ts === 'number' && ts > 0) {
            dateMs = ts;
            source = 'exif';
          }
        } catch (e1) {
          // ignore and try sharp metadata fallback
        }

        // As an additional attempt, try sharp's extracted EXIF buffer if present
        if (!dateMs) {
          try {
            const meta = await sharp(fullPath).metadata();
            if (meta && meta.exif && Buffer.isBuffer(meta.exif)) {
              const parsed2 = exifParser.create(meta.exif).parse();
              const tags2 = parsed2 && parsed2.tags ? parsed2.tags : {};
              let ts2 = null;
              const cands2 = [tags2.DateTimeOriginal, tags2.CreateDate, tags2.ModifyDate, tags2.DateTimeDigitized];
              for (const v of cands2) {
                if (ts2) break;
                if (typeof v === 'number') ts2 = v * 1000;
                else if (v instanceof Date) ts2 = +v;
                else if (typeof v === 'string') {
                  const m = v.match(/^([0-9]{4}):([0-9]{2}):([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})$/);
                  if (m) {
                    // EXIF dates are in local time, not UTC
                    ts2 = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
                  }
                }
              }
              if (typeof ts2 === 'number' && ts2 > 0) {
                dateMs = ts2;
                source = 'exif';
              }
            }
          } catch (e2) {
            // ignore
          }
        }
      } catch (fileReadErr) {
        // Couldn't read file; will fall back below
      }
      if (!dateMs) {
        try {
          const stats = await fs.promises.stat(fullPath);
          // Fallback to mtime as a reasonable proxy when EXIF missing
          dateMs = stats.mtimeMs;
          source = 'mtime';
        } catch (statErr) {
          // As a last resort, use 0 to push unknowns to the end
          dateMs = 0;
          source = 'unknown';
        }
      }
      return { dateMs, source };
    }

    // Collect date info for sorting with concurrency limit
    const CONCURRENCY_LIMIT = 10;
    const withDates = [];
    for (let i = 0; i < originals.length; i += CONCURRENCY_LIMIT) {
      const batch = originals.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(
        batch.map(async f => {
          const info = await getDateInfoFor(f);
          return { file: f, dateMs: info.dateMs, source: info.source };
        })
      );
      withDates.push(...batchResults);
    }

    // Sort newest to oldest by dateMs descending
    withDates.sort((a, b) => b.dateMs - a.dateMs);

    if (!includeMeta) {
      // Backward compatible: return array of strings, already sorted
      return res.json(withDates.map(x => x.file));
    }

    // Optional: include thumbnail mapping metadata and date_taken
    let thumbFiles = [];
    try {
      thumbFiles = await fs.promises.readdir(THUMBS_DIR);
    } catch (e) {
      thumbFiles = [];
    }
    const thumbSet = new Set(Array.isArray(thumbFiles) ? thumbFiles : []);

    const images = withDates.map(({ file, dateMs, source }) => {
      const ext = path.extname(file).toLowerCase();
      const base = path.basename(file, ext);
      const candidates = [
        `${base}.thumb.jpg`,
        `${base}.jpg`
      ];
      const found = candidates.find(name => thumbSet.has(name)) || null;
      return {
        original: file,
        thumb: found,
        date_taken: dateMs ? new Date(dateMs).toISOString() : null,
        date_source: source
      };
    });

    return res.json(images);
  } catch (err) {
    console.error('Unable to list photo directory:', err);
    return res.status(500).json({ error: 'Unable to list photos' });
  }
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

// Endpoint to serve thumbnails (with on-demand generation if missing)
app.get('/files/thumbs/:name', async (req, res) => {
  try {
    const inputName = req.params.name;
    const ext = path.extname(inputName).toLowerCase();
    if (!VALID_EXTENSIONS.includes(ext)) {
      return res.status(404).send('Not found');
    }
    // If a direct thumbnail file is requested and exists, serve it.
    const directThumbPath = path.join(THUMBS_DIR, inputName);
    try {
      const directStats = await fs.promises.stat(directThumbPath);
      if (directStats.isFile()) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(directThumbPath);
      }
    } catch (err) {
      // File doesn't exist, continue to mapping logic
    }
    
    // Otherwise, treat inputName as the ORIGINAL filename and try to map to a thumb
    const base = path.basename(inputName, ext);
    const candidates = [
      path.join(THUMBS_DIR, `${base}.thumb.jpg`), // new pattern
      path.join(THUMBS_DIR, `${base}.jpg`) // legacy pattern
    ];
    
    for (const candidatePath of candidates) {
      try {
        const candidateStats = await fs.promises.stat(candidatePath);
        if (candidateStats.isFile()) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return res.sendFile(candidatePath);
        }
      } catch (err) {
        // Continue to next candidate
      }
    }
    
    // On-demand generation: if original exists, create the thumb and serve it
    const originalPath = path.join(PHOTO_DIR, inputName);
    try {
      const originalStats = await fs.promises.stat(originalPath);
      if (originalStats.isFile()) {
        const thumbName = `${base}.thumb.jpg`;
        const thumbPath = path.join(THUMBS_DIR, thumbName);
        try {
          // Ensure thumbs directory exists
          fs.mkdirSync(THUMBS_DIR, { recursive: true });
          await sharp(originalPath)
            .rotate() // respect EXIF orientation
            .resize({ width: 450 })
            .jpeg({ quality: 80 })
            .toFile(thumbPath);
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return res.sendFile(thumbPath);
        } catch (genErr) {
          console.error('Error generating thumbnail on-demand:', genErr);
          return res.status(500).send('Error generating thumbnail');
        }
      }
    } catch (err) {
      // Original doesn't exist
    }
    
    return res.status(404).send('Not found');
  } catch (err) {
    console.error('Error serving thumbnail:', err);
    return res.status(500).send('Unexpected error');
  }
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
        const ext = path.extname(file.originalname).toLowerCase();
        if (!VALID_EXTENSIONS.includes(ext)) {
          errors.push({ original: file.originalname, error: 'Unsupported file type' });
          continue;
        }
        if (!isValidImageMagic(file.buffer)) {
          errors.push({ original: file.originalname, error: 'Uploaded file is not a valid image' });
          continue;
        }
        const newName = generateFilename(ext);
        const destPath = path.join(PHOTO_DIR, newName);
        fs.writeFileSync(destPath, file.buffer);

        const base = path.basename(newName, ext);
        const thumbName = `${base}.thumb.jpg`;
        const thumbPath = path.join(THUMBS_DIR, thumbName);
        try {
          // Ensure thumbs directory exists
          fs.mkdirSync(THUMBS_DIR, { recursive: true });
          await sharp(file.buffer)
            .rotate() // Apply EXIF orientation automatically
            .resize({ width: 450 })
            .jpeg({ quality: 80 })
            .toFile(thumbPath);
        } catch (err) {
          console.error('Error generating thumbnail:', err);
          // Keep item, even if thumb failed
        }
        items.push({ filename: newName, thumb: thumbName });
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

// Serve the static frontend assets from the `public` directory. The index
// contains the gallery UI and upload modal.
app.use(express.static(path.join(__dirname, 'public')));

// Start the server
app.listen(PORT, () => {
  console.log(`Photo app listening on port ${PORT}`);
});