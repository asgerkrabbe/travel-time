const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
require('dotenv').config();

const PHOTO_DIR = process.env.PHOTO_DIR || path.join(__dirname, 'photos');
const THUMBS_DIR = path.join(PHOTO_DIR, 'thumbs');
const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const fsp = fs.promises;

// Ensure directories exist
fs.mkdirSync(PHOTO_DIR, { recursive: true });
fs.mkdirSync(THUMBS_DIR, { recursive: true });

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

// Test the fixtures
async function testFixtures() {
  const TEST_FIXTURES = require('./deploy/test-fixtures');
  
  console.log(`Testing ${TEST_FIXTURES.length} fixtures\n`);
  
  for (const fixture of TEST_FIXTURES) {
    console.log(`\nProcessing: ${fixture.slug}`);
    try {
      const buffer = Buffer.from(fixture.base64, 'base64');
      console.log(`  Buffer created: ${buffer.length} bytes`);
      
      const result = await storeImageFromBuffer(buffer, fixture.filename, {
        forceBasename: fixture.filename,
        overwrite: false
      });
      
      if (result.error) {
        console.log(`  ❌ ERROR: ${result.error}`);
      } else if (result.item) {
        console.log(`  ✓ SUCCESS: ${result.item.filename}`);
        console.log(`  Thumbnail: ${result.item.thumb}`);
        console.log(`  Skipped: ${result.skipped || false}`);
      }
    } catch (err) {
      console.log(`  ❌ EXCEPTION: ${err.message}`);
      console.log(`  Stack: ${err.stack}`);
    }
  }
  
  console.log('\n\n=== Files created ===');
  const photos = await fsp.readdir(PHOTO_DIR);
  console.log('Photos:', photos.filter(f => !f.endsWith('/')));
  
  const thumbs = await fsp.readdir(THUMBS_DIR);
  console.log('Thumbs:', thumbs);
}

testFixtures().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
