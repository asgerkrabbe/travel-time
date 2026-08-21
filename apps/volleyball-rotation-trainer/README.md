# Volleyball Rotation Trainer

A small React app (originally a Claude-generated JSX artifact) for learning/quizzing 5-1
system volleyball rotations: which role is in which zone as the team rotates, including
libero substitution rules and the 2025 FIVB serving-position change.

Fully client-side — no backend, no persistence. Built with [Vite](https://vite.dev),
[React](https://react.dev), [Tailwind CSS v4](https://tailwindcss.com), and
[lucide-react](https://lucide.dev) icons.

## Develop

```bash
npm install
npm run dev       # local dev server with HMR
```

## Build

```bash
npm run build      # outputs static files to dist/
npm run preview    # serve the production build locally, to sanity-check it
```

## Deploy

`dist/` is a fully static site — no Node process needs to run for this app in production.
Serve it as its own site on the VPS, following the "adding a second app" pattern described in
the root repo's `README.md` / `deploy/nginx/newapp.conf.example`, but simplified: since there's
no backend, skip the `proxy_pass`/port/systemd-unit steps entirely and just point nginx's
`root` at this project's built `dist/` directory, e.g.:

```nginx
server {
    listen 443 ssl http2;
    server_name rotation.example.com;   # pick a subdomain

    ssl_certificate     /etc/letsencrypt/live/rotation.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rotation.example.com/privkey.pem;
    include snippets/ssl-params.conf;

    root /path/to/volleyball-rotation-trainer/dist;
    index index.html;
    location / {
        try_files $uri /index.html;   # SPA fallback
    }
}
```

Copy `dist/` to the server (e.g. `rsync -av dist/ user@host:/path/to/volleyball-rotation-trainer/dist/`
after each `npm run build`), then `nginx -t && systemctl reload nginx`.
