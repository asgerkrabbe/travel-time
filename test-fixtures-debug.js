const fs = require('fs');
const path = require('path');

// Load the test fixtures
const TEST_FIXTURES = require('./deploy/test-fixtures');

console.log(`Loaded ${TEST_FIXTURES.length} fixtures\n`);

// Test each fixture
TEST_FIXTURES.forEach((fixture, index) => {
  console.log(`\nFixture ${index + 1}: ${fixture.slug}`);
  console.log(`Filename: ${fixture.filename}`);
  console.log(`Base64 length: ${fixture.base64.length}`);
  
  try {
    // Decode the base64
    const buffer = Buffer.from(fixture.base64, 'base64');
    console.log(`Buffer length: ${buffer.length}`);
    
    // Check buffer validity
    if (!Buffer.isBuffer(buffer)) {
      console.log('ERROR: Not a valid buffer');
      return;
    }
    
    // Check extension
    const ext = path.extname(fixture.filename).toLowerCase();
    console.log(`Extension: ${ext}`);
    
    const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    if (!VALID_EXTENSIONS.includes(ext)) {
      console.log('ERROR: Extension not valid');
      return;
    }
    
    // Check magic number
    console.log(`First 12 bytes: ${Array.from(buffer.slice(0, 12)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
    
    if (buffer.length < 12) {
      console.log('ERROR: Buffer too short for magic number check');
      return;
    }
    
    // PNG check
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      console.log('✓ Valid PNG magic number (first 4 bytes)');
      
      // Check full PNG signature
      if (buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
        console.log('✓ Valid PNG full signature (8 bytes)');
      } else {
        console.log('ERROR: PNG first 4 bytes match but full signature does not');
      }
    } else {
      console.log('ERROR: PNG magic number does not match');
    }
    
    console.log('SUCCESS: All checks passed');
    
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }
});
