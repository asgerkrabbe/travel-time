const fs = require('fs');
const crypto = require('crypto');

// Load the test fixtures
const TEST_FIXTURES = require('./deploy/test-fixtures');

console.log('=== Diagnostic Report ===\n');

TEST_FIXTURES.forEach((fixture, index) => {
  console.log(`\nFixture ${index + 1}: ${fixture.slug}`);
  console.log(`Expected filename: ${fixture.filename}`);
  console.log(`Base64 string length: ${fixture.base64.length}`);
  console.log(`Base64 first 20 chars: ${fixture.base64.substring(0, 20)}`);
  console.log(`Base64 last 20 chars: ${fixture.base64.substring(fixture.base64.length - 20)}`);
  
  // Check for whitespace or line breaks in base64
  const hasWhitespace = /\s/.test(fixture.base64);
  console.log(`Contains whitespace: ${hasWhitespace}`);
  
  if (hasWhitespace) {
    console.log('⚠️  WARNING: Base64 string contains whitespace!');
    console.log('Whitespace characters found:', fixture.base64.match(/\s/g));
  }
  
  // Decode and check
  try {
    const buffer = Buffer.from(fixture.base64, 'base64');
    console.log(`Decoded buffer length: ${buffer.length} bytes`);
    console.log(`SHA256 hash: ${crypto.createHash('sha256').update(buffer).digest('hex')}`);
    
    // Check PNG header
    const header = Array.from(buffer.slice(0, 8)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
    console.log(`PNG header: ${header}`);
    
    const expectedHeader = '0x89 0x50 0x4e 0x47 0x0d 0x0a 0x1a 0x0a';
    if (header === expectedHeader) {
      console.log('✓ Valid PNG header');
    } else {
      console.log(`❌ INVALID PNG header! Expected: ${expectedHeader}`);
    }
    
  } catch (err) {
    console.log(`❌ ERROR decoding: ${err.message}`);
  }
});

console.log('\n\n=== Check existing files ===');
const PHOTO_DIR = process.env.PHOTO_DIR || 'photos';
const files = ['fixture-red.png', 'fixture-green.png', 'fixture-blue.png'];

files.forEach(filename => {
  const filepath = `${PHOTO_DIR}/${filename}`;
  try {
    if (fs.existsSync(filepath)) {
      const stats = fs.statSync(filepath);
      const buffer = fs.readFileSync(filepath);
      console.log(`\n${filename}:`);
      console.log(`  Size: ${stats.size} bytes`);
      console.log(`  SHA256: ${crypto.createHash('sha256').update(buffer).digest('hex')}`);
      console.log(`  First 8 bytes: ${Array.from(buffer.slice(0, 8)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
    } else {
      console.log(`\n${filename}: NOT FOUND`);
    }
  } catch (err) {
    console.log(`\n${filename}: ERROR - ${err.message}`);
  }
});
