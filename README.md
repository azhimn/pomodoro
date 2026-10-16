# Pomodoro

Offline pomodoro timer. Three static files, no build, no dependencies. Nothing leaves your browser; everything is saved in `localStorage`.

Source: https://github.com/azhimn/pomodoro

## Run / self-host

Serve this folder with any static web server:

```sh
python -m http.server 8080     # then open http://localhost:8080
```

For nginx/Caddy, point the web root at this folder. Opening `index.html` directly from disk also works.

## Use

- Space: pause/continue. Left/Right arrows: previous/next step.
- Gear icon: durations, auto-start, colors, timer text style, font, volumes, alarm and click pitches, export/import of tasks (.md) and settings (.json), and reset to defaults.
- Chart icon: your personal report (streak, focus and break time, pomodori, tasks, last 7 days). It can be exported, imported or turned off in Settings.
- Checklist icon: show/hide the to-do list. The ⋯ menu beside it deletes completed, incomplete or all tasks. Task export/import uses Markdown checklists (`- [x] task — 2026-10-16 14:32 · Focus 3/4 · Cycle 2`). Import appends and never overwrites.

Icons: [Phosphor](https://phosphoricons.com) (MIT).
