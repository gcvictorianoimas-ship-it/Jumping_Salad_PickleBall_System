# Jumping Salad Pickleball System

A retro-styled pickleball club management prototype for running sessions, managing a live queue, assigning matches, and tracking player results locally in the browser.

This project is built with plain HTML, CSS, and JavaScript. There is no build step or framework required.

## Overview

The app includes:

- a club dashboard with quick actions and real-time summary cards
- session creation and management
- live queue controls for players waiting to play
- court availability and match assignment
- player registration, stats, and progression
- leaderboard and match history tracking
- local storage persistence for demo use
- a demo sign-in screen before entering the dashboard

## Run locally

From the project folder, start a local static server:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

You can also open `index.html` directly in a browser, but using a local web server is recommended because the app is designed to behave like a browser-based dashboard and some features are easier to test through a proper local origin.

## Tests

Install dependencies with `npm install`, then run `npm test`. The browser tests use Playwright with Chromium; if Chromium is not installed yet, run `npx playwright install chromium`.

## Project structure

- `index.html` – app shell and layout
- `style.css` – dashboard and responsive styling
- `script.js` – app logic, rendering, and interactions
- `data.js` – demo data and initial state

## Features

- Dashboard overview for active players, queue size, live matches, and open courts
- Quick actions for creating sessions, registering players, and managing courts
- Live stacking workflow for adding players, handling unavailable players, and monitoring queue order
- Choose any four eligible players and assign two per team in the next-match preview before creating a match; custom lineups can mix winners, losers, and first-game players
- Session game targets (3, 5, 7, 10, or a custom positive whole number), defaulting to 5 games per player, with an Unlimited Games option; targets can be changed during an open session without resetting completed-game counts
- Matchmaking offers Equal Games Shuffle, Partner Stacking, and Singles. All modes prioritize players with fewer completed games and queue wait; doubles prefer same-result groups and preserve linked partners, while Singles completes each game-count round before advancing, prefers winner-vs-winner then loser-vs-loser matchups using the latest completed results, avoids repeat opponents, and randomizes equally suitable pairings. Doubles uses dummy seats to finish odd or undersized rounds without leaving eligible players waiting; Singles uses a dummy only to finish an odd current round.
- Doubles lineups use clearly labeled dummy seats when needed to complete a current round, including Unlimited Games; dummy seats never enter the player roster, queue history, statistics, or leaderboard
- Manual court assignment preserves the staff-selected eligible players and ignores automatic result-group, queue-fairness, linked-partner, repeat-teammate, and skill-balancing preferences while enforcing player and team integrity
- Session status controls, including resume and completion flows
- Player profiles with skill level, avatar, stats, and match history
- Match results, win/loss tracking, and current-session leaderboards ranked by wins, fewest losses, current winning streak, score differential, then total points scored
- Recent results and courts-at-a-glance panels for quick club monitoring
- Mobile-responsive layout tuned for phone-sized screens
- Match assignment uses the browser Web Locks API to prevent concurrent tabs from assigning players to overlapping matches

## Notes

- All data is saved in the browser using `localStorage`.
- The app is intended as a prototype/demo system, not a production club-management backend.
- The demo sign-in checks credentials entirely in the browser and is not secure authentication; do not use real or sensitive credentials.
- There is no server-side authentication, permission enforcement, or multi-user sync.

## Demo usage

Use the app to simulate a club environment by:

1. creating a session
2. registering players
3. adding players to the queue
4. assigning matches to courts
5. entering results and reviewing leaderboard updates

## License

This project is for demo and prototype use.
