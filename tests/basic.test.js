const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-app-test-'));
process.env.PHOTO_DIR = path.join(tmpRoot, 'photos');
process.env.UPLOAD_TOKEN = 'test-token';
process.env.PORT = '0';

const app = require('../server');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  if (server) {
    server.close();
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAuMBg5v4vBYAAAAASUVORK5CYII=';

async function uploadSampleImage() {
  const buffer = Buffer.from(pngBase64, 'base64');
  const form = new FormData();
  form.append('photo', new Blob([buffer], { type: 'image/png' }), 'sample.png');
  const response = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token'
    },
    body: form
  });
  const body = await response.json();
  return { response, body };
}

test('GET /api/photos returns an empty list initially', async () => {
  const res = await fetch(`${baseUrl}/api/photos`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data, []);
});

test('POST /api/upload rejects missing token', async () => {
  const buffer = Buffer.from(pngBase64, 'base64');
  const form = new FormData();
  form.append('photo', new Blob([buffer], { type: 'image/png' }), 'missing-auth.png');
  const res = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    body: form
  });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.ok(data.error.includes('Authorization'));
});

test('successful upload persists files and lists metadata', async () => {
  const { response, body } = await uploadSampleImage();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.items));
  assert.equal(body.items.length, 1);

  const savedName = body.items[0].filename;
  const savedPath = path.join(process.env.PHOTO_DIR, savedName);
  assert.ok(fs.existsSync(savedPath), 'original image should exist on disk');

  const listRes = await fetch(`${baseUrl}/api/photos?meta=1`);
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].original, savedName);

  const fileRes = await fetch(`${baseUrl}/files/${savedName}`);
  assert.equal(fileRes.status, 200);
  const blob = await fileRes.blob();
  assert.ok(blob.size > 0);

  if (body.items[0].thumb) {
    const thumbRes = await fetch(`${baseUrl}/files/thumbs/${body.items[0].thumb}`);
    assert.equal(thumbRes.status, 200);
  }
});
