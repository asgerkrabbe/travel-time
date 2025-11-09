# Photo Gallery Web App

This repository contains a minimal, production‑ready photo gallery built with
Node.js and Express. It serves images from a mounted directory and provides
an authenticated upload endpoint. The frontend is a single static page that
displays images in a responsive grid and offers a modal dialog for uploading
new photos.

## Features

* **Lightweight runtime** – built on Express 4.x with only a few
  dependencies. No database required; images are read directly from the file
  system.
* **Secure uploads** – a single shared secret (Bearer token) protects the
  upload endpoint. Files are validated by extension and simple magic‑number
  checks before being saved. Uploads are rate‑limited and capped in size.
* **Responsive gallery** – photos are lazy‑loaded and displayed in a CSS grid.
* **Configurable** – key options such as the photo directory, upload token,
  listening port and maximum upload size are exposed via environment
  variables.
* **Deployment ready** – includes instructions and sample files for both
  native (systemd + Nginx) and Docker deployments on a Hetzner CX22 or
  similar VPS.

## Quick Start (Development)

1. Install [Node.js](https://nodejs.org/) ≥ 18.
2. Clone this repository and install dependencies:

   ```bash
   git clone https://github.com/asgerkrabbe/travel-time.git
   cd travel-time
   npm install
   ```

3. Copy `.env.example` to `.env` and adjust the variables to suit your
   environment. At minimum, set a strong `UPLOAD_TOKEN` and ensure
   `PHOTO_DIR` points to a directory that exists and is writable.

4. Start the server:

   ```bash
   npm start
   ```

5. Visit `http://localhost:3000` in your browser. The front page will list
   images found in `PHOTO_DIR`. To upload, click **Upload Photo** and enter
   your token.

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `PHOTO_DIR` | Absolute path to the directory where images are stored. This path must be writable. | `./photos` |
| `UPLOAD_TOKEN` | Long random secret required to POST to `/api/upload`. Sent as `Authorization: Bearer …`. | `changeme` |
| `PORT` | Port the Express server listens on. | `3000` |
| `MAX_FILE_BYTES` | Maximum allowed size in bytes for an uploaded file. Tune based on server resources. | `10485760` (10 MB) |
| `MAX_FILES_PER_UPLOAD` | Maximum number of files accepted per upload request. | `10` |
| `ENABLE_TEST_FIXTURES` | When set to `true`, enables the `/api/test/fixtures` endpoint for seeding demo images. | `false` |
| `TEST_FIXTURE_TOKEN` | Optional token used for `/api/test/fixtures`; falls back to `UPLOAD_TOKEN` when unset. | `UPLOAD_TOKEN` |

Create a `.env` file (or pass variables via your process manager) with values
appropriate for your environment. **Never commit your real `UPLOAD_TOKEN`
to version control.**

## API

### `GET /api/photos`

Returns a JSON array of filenames for images found in `PHOTO_DIR`. Only files
with extensions `.jpg`, `.jpeg`, `.png`, `.gif` and `.webp` are listed.

### `GET /files/:name`

Serves the requested image from `PHOTO_DIR` if it exists and has a whitelisted
extension. Responses include `Cache‑Control: public, max‑age=31536000, immutable` to
enable long‑term client caching.

### `POST /api/upload`

Uploads a new image. Accepts multipart/form‑data with a single field named
`photo`. Requires an `Authorization` header containing a valid Bearer token
(your `UPLOAD_TOKEN`). The server validates:

* File size does not exceed `MAX_FILE_BYTES`.
* File extension is one of the allowed types.
* Magic number matches a supported image format.

If validation passes, the file is saved to `PHOTO_DIR` using a safe, unique
filename (timestamp + random hex). The response contains the new filename.

Rate limiting is applied per IP (10 uploads per 15 minutes by default) to
mitigate abuse.

### `POST /api/test/fixtures`

Seeds the gallery with a handful of sample images so you can exercise the UI
and API without manually uploading photos. This endpoint is **disabled by
default**. To enable it, set `ENABLE_TEST_FIXTURES=true` in your environment
and restart the server. Authentication uses the same Bearer token format as the
upload endpoint; by default it reuses `UPLOAD_TOKEN`, but you may override it
with `TEST_FIXTURE_TOKEN`.

When invoked, the endpoint copies three small PNG fixtures into `PHOTO_DIR`
without overwriting existing files. Re-running the endpoint is idempotent – it
skips any fixture that is already present and only regenerates missing
thumbnails.

## Frontend

The application includes a static frontend under `/public`:

* `index.html` – the gallery page and upload modal.
* `styles.css` – minimal styles to lay out the page and modal.
* `script.js` – fetches the image list, renders the gallery and performs
  client‑side uploads via `fetch()`.

Images are lazy‑loaded using the `loading="lazy"` attribute to reduce
bandwidth usage.

## Deployment

The app is designed to run on a small VPS such as the Hetzner CX22 (2 vCPU,
4 GB RAM). Two deployment strategies are described below.

### 1. Native Deployment (systemd + Nginx)

This approach runs Node.js directly on the host and is recommended for the
lowest overhead.

1. **Create a system user:**

   ```bash
   sudo useradd --system --shell /usr/sbin/nologin --home /opt/photoapp photoapp
   ```

2. **Install Node.js 18:** Use your distribution’s packages or
   [NodeSource](https://github.com/nodesource/distributions). Verify with `node -v`.

3. **Clone the repository:**

   ```bash
   sudo mkdir -p /opt/photoapp
   sudo chown photoapp:photoapp /opt/photoapp
   sudo -u photoapp git clone https://github.com/asgerkrabbe/travel-time.git /opt/photoapp
   cd /opt/photoapp
   sudo -u photoapp npm install --production
   ```

4. **Set up the photo directory:**

   Mount your storage at `/srv/photos` (or another location) and ensure the
   `photoapp` user has read/write access:

   ```bash
   sudo mkdir -p /srv/photos
   sudo chown photoapp:photoapp /srv/photos
   ```

5. **Create an environment file:** at `/opt/photoapp/.env`:

   ```ini
   PHOTO_DIR=/srv/photos
   UPLOAD_TOKEN=<your_long_random_secret>
   PORT=3000
   MAX_FILE_BYTES=10485760
   ```

   Set permissions to restrict access:

   ```bash
   sudo chmod 600 /opt/photoapp/.env
   sudo chown photoapp:photoapp /opt/photoapp/.env
   ```

6. **Install the systemd service:**

   Copy `deploy/systemd/photoapp.service` to `/etc/systemd/system/photoapp.service`:

   ```bash
   sudo cp deploy/systemd/photoapp.service /etc/systemd/system/photoapp.service
   ```

   Adjust paths in the service file if your installation directory differs.

7. **Start and enable the service:**

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now photoapp.service
   sudo systemctl status photoapp.service
   ```

   The application will now be listening on `127.0.0.1:3000`.

8. **Configure Nginx:** Place a reverse proxy in front of the Node.js server
   for SSL termination, compression and client buffering. Below is a sample
   Nginx server block (replace `example.com` with your domain):

   ```nginx
   server {
       listen 80;
       server_name example.com;

       # Redirect HTTP to HTTPS (Let’s Encrypt handled separately)
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl;
       server_name example.com;

       # SSL configuration via certbot or your certificate provider
       ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

       # Limit upload body size to match MAX_FILE_BYTES
       client_max_body_size 10m;

       location /api/upload {
           # Optional: require HTTP Basic auth in addition to Bearer token
           # auth_basic "Restricted";
           # auth_basic_user_file /etc/nginx/.htpasswd;

           proxy_pass         http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header   Host $host;
           proxy_set_header   X-Real-IP $remote_addr;
           proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header   X-Forwarded-Proto $scheme;
       }

       location /files/ {
           proxy_pass         http://127.0.0.1:3000;
           proxy_cache_valid  200 30d;
           add_header         Cache-Control "public, max-age=2592000, immutable";
       }

       location / {
           proxy_pass         http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header   Host $host;
           proxy_set_header   X-Real-IP $remote_addr;
           proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header   X-Forwarded-Proto $scheme;
       }
   }
   ```

   After configuring Nginx, obtain an SSL certificate via certbot:

   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d example.com
   ```

### 2. Docker Deployment (optional)

Running the app in Docker allows for easy portability at the cost of a small
overhead. A `Dockerfile` and a `docker-compose.yml` are provided.

1. Install [Docker](https://docs.docker.com/engine/install/) and
   [docker-compose](https://docs.docker.com/compose/install/) on your host.

2. Ensure the host photo directory exists and is writable (e.g. `/srv/photos`).

3. Build and start the container:

   ```bash
   cd travel-time
   docker compose up -d
   ```

   The service will be available on port 3000 of the host. Edit
   `docker-compose.yml` to set your `UPLOAD_TOKEN` and adjust other
   environment variables. Use `docker compose down` to stop the service.

4. **Rotating the upload token:** To change the token:

   ```bash
   # Stop the container
   docker compose down
   # Edit docker-compose.yml and set a new UPLOAD_TOKEN
   # or create a .env file and refer to it in the compose file
   docker compose up -d
   ```

   Note that existing sessions using the old token will no longer work.

#### CI/CD (optional)

A simple GitHub Actions workflow could build and push a Docker image on each
commit to the `main` branch and tag. To enable this, create a file in
`.github/workflows/ci.yml` with a Node build step and add secrets for
`GHCR_USERNAME` and `GHCR_TOKEN`. This repository does not include the
workflow by default.

## Tuning for Hetzner CX22

The Hetzner CX22 provides 2 vCPU and 4 GB RAM. Keep the following in mind:

* Limit Node’s memory usage via `--max-old-space-size` (128 MB is used in the
  provided service file). This prevents the process from consuming all
  available memory during large uploads.
* Keep `MAX_FILE_BYTES` modest (5–10 MB). Large uploads consume memory since
  files are buffered in RAM before being written.
* Use Nginx to handle compression (gzip) instead of enabling any server‑side
  compression in the app.
* Mount the photo directory on fast storage. On networked mounts, high
  latency can delay responses; enable caching headers to mitigate repeated
  reads.

### Troubleshooting

| Issue                              | Remedy                                                                                         |
|-----------------------------------|-------------------------------------------------------------------------------------------------|
| "Invalid token" on upload        | Verify that the `Authorization` header is set to `Bearer <UPLOAD_TOKEN>` and that the token
                                     matches the one in your `.env` file.                                                           |
| Upload rejected as non‑image       | Ensure the file has one of the allowed extensions and that it is a real image. The server
                                     performs a simple magic‑number check.                                                           |
| Upload exceeds max size            | Lower `MAX_FILE_BYTES` or increase the client’s `client_max_body_size` in Nginx.              |
| Rate limit triggered               | Wait for the window to reset (default 15 minutes) or adjust `max`/`windowMs` in `server.js`.   |
| Service fails to start via systemd | Run `sudo journalctl -u photoapp.service` to inspect logs; check file paths and permissions.   |

## Verification Checklist

Before going live, verify the following:

* The `PHOTO_DIR` exists, is writable by the service and contains a few
  images. Visiting `/api/photos` returns their filenames.
* The gallery page loads and displays the images; new images appear after
  uploading without reloading the page.
* Uploading without any `Authorization` header or with the wrong token
  results in `401` and an appropriate JSON error.
* Uploading a valid image with the correct token returns `200` and the file
  appears on disk.
* Uploading a non‑image file (e.g. `.txt`) returns `400` with a clear error
  message.
* Exceeding the upload rate limit returns the configured error message.
* Requests to `/files/<name>` include `Cache‑Control` headers indicating
  long‑term caching and return the file content.
* When deployed via systemd, the service starts automatically on reboot and
  logs remain clean. When deployed via Docker, `docker compose ps` shows
  the container running.

## Changelog

### v1.0.0 – Initial release

* Implemented an Express server with routes to list, serve and upload images.
* Added rate limiting, magic‑number sniffing and safe filename generation.
* Created a simple HTML/CSS/JS frontend with a responsive gallery and upload
  modal.
* Added sample systemd service file and Docker configuration.
* Documented native and Docker deployment procedures, including Nginx
  configuration and TLS setup.