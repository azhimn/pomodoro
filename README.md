# Pomodoro

Offline pomodoro timer. Three static files, no build, no dependencies. Nothing leaves your browser; everything is saved in `localStorage`.

## Run / self-host

Serve this folder with any static web server:

```sh
python -m http.server 8080     # then open http://localhost:8080
```

For nginx/Caddy, point the web root at this folder. Opening `index.html` directly from disk also works.

## Use

- Space: pause/continue. Left/Right arrows: previous/next step.
- Gear icon: durations, colors, alarm pitch per step, pairs per cycle, button sounds, font, and export/import of tasks (.md) and settings (.json).
- Checklist icon: show/hide the to-do list. Task export/import uses Markdown checklists (`- [x] task — 2026-10-16 14:32 · Work 3/4 · Cycle 2`). Import appends and never overwrites.

Icons: [Lucide](https://lucide.dev) (ISC).
