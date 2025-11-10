const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const path = require('path');

// Load the test fixtures
const TEST_FIXTURES = require('./deploy/test-fixtures');
const PHOTO_DIR = process.env.PHOTO_DIR || path.join(__dirname, 'photos');
const THUMBS_DIR = path.join(PHOTO_DIR, 'thumbs');

console.log('=== Sharp Version & Config ===');
console.log('Sharp version:', require('sharp/package.json').version);
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
console.log('PHOTO_DIR:', PHOTO_DIR);
console.log('THUMBS_DIR:', THUMBS_DIR);

async function testSharpProcessing() {
  console.log('\n=== Testing Sharp Processing ===\n');
  
  for (const fixture of TEST_FIXTURES) {
    console.log(`\nProcessing: ${fixture.slug}`);
    
    const buffer = Buffer.from(fixture.base64, 'base64');
    console.log(`Input buffer: ${buffer.length} bytes`);
    console.log(`Input SHA256: ${crypto.createHash('sha256').update(buffer).digest('hex')}`);
    
    try {
      // Test Sharp can read the image
      const metadata = await sharp(buffer).metadata();
      console.log(`Sharp metadata:`, JSON.stringify(metadata, null, 2));
      
      // Test thumbnail generation IN MEMORY
      const thumbBuffer = await sharp(buffer)
        .resize({ width: 450 })
        .jpeg({ quality: 80 })
        .toBuffer();
      
      console.log(`Thumbnail buffer: ${thumbBuffer.length} bytes`);
      console.log(`Thumbnail SHA256: ${crypto.createHash('sha256').update(thumbBuffer).digest('hex')}`);
      
      // Check if files exist on disk
      const originalPath = path.join(PHOTO_DIR, fixture.filename);
      const thumbPath = path.join(THUMBS_DIR, `${path.basename(fixture.filename, '.png')}.thumb.jpg`);
      
      if (fs.existsSync(originalPath)) {
        const diskBuffer = fs.readFileSync(originalPath);
        const diskHash = crypto.createHash('sha256').update(diskBuffer).digest('hex');
        console.log(`✓ Original exists on disk: ${diskBuffer.length} bytes`);
        console.log(`  Disk SHA256: ${diskHash}`);
        
        if (diskHash !== crypto.createHash('sha256').update(buffer).digest('hex')) {
          console.log(`  ❌ WARNING: Disk file DIFFERS from source!`);
          console.log(`  First 8 bytes on disk: ${Array.from(diskBuffer.slice(0, 8)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
        } else {
          console.log(`  ✓ Disk file matches source`);
        }
      } else {
        console.log(`  Original NOT on disk`);
      }
      
      if (fs.existsSync(thumbPath)) {
        const thumbDiskBuffer = fs.readFileSync(thumbPath);
        const thumbDiskHash = crypto.createHash('sha256').update(thumbDiskBuffer).digest('hex');
        console.log(`✓ Thumbnail exists on disk: ${thumbDiskBuffer.length} bytes`);
        console.log(`  Disk SHA256: ${thumbDiskHash}`);
        
        // Decode the thumbnail to see actual pixel colors
        const thumbMeta = await sharp(thumbDiskBuffer).metadata();
        const { data, info } = await sharp(thumbDiskBuffer).raw().toBuffer({ resolveWithObject: true });
        console.log(`  Thumbnail dimensions: ${info.width}x${info.height}`);
        
        // Get the color of the center pixel
        const centerX = Math.floor(info.width / 2);
        const centerY = Math.floor(info.height / 2);
        const pixelIndex = (centerY * info.width + centerX) * info.channels;
        const r = data[pixelIndex];
        const g = data[pixelIndex + 1];
        const b = data[pixelIndex + 2];
        console.log(`  Center pixel RGB: (${r}, ${g}, ${b})`);
      } else {
        console.log(`  Thumbnail NOT on disk`);
      }
      
    } catch (err) {
      console.log(`❌ ERROR processing: ${err.message}`);
      console.log(err.stack);
    }
  }
}

testSharpProcessing().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
