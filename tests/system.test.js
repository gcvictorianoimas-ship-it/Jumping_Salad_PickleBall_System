const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
let server;
let browser;
let baseUrl;

before(async () => {
  server = http.createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }
    if (pathname === "/") pathname = "/index.html";
    const filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    fs.readFile(filename, (error, content) => {
      if (error) {
        response.writeHead(404).end("Not found");
        return;
      }
      const types = {
        ".css": "text/css",
        ".html": "text/html",
        ".js": "text/javascript",
        ".svg": "image/svg+xml"
      };
      response.writeHead(200, { "Content-Type": types[path.extname(filename)] || "application/octet-stream" });
      response.end(content);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

function makePlayer(id, sessionIds = ["S-QA"], name = `Player ${id}`, username = `player_${id}`) {
  return {
    id,
    name,
    username,
    email: "",
    avatar: "🎾",
    skill: "Beginner",
    rating: null,
    xp: 0,
    level: 1,
    wins: 0,
    losses: 0,
    streak: 0,
    matchIds: [],
    sessionIds,
    achievements: [],
    active: true
  };
}

function makeState({ players = [], sessions = [], courts = [], queue = [], matches = [], history = [] } = {}) {
  return {
    players,
    sessions,
    courts,
    queue,
    matches,
    history,
    nextPlayer: 1001,
    nextMatch: 1,
    settings: {
      targetScore: 11,
      winByTwo: true,
      xpPerMatch: 25,
      xpWinBonus: 15,
      stackingMode: "Equal Games Shuffle"
    }
  };
}

function makeSession(id, name, status, playerIds, gamesPerPlayer = 5, rotation = "Equal Games Shuffle") {
  return {
    id,
    name,
    date: "2026-10-19",
    time: "18:30",
    venue: "QA Courts",
    courts: 1,
    maxPlayers: 24,
    format: rotation === "Singles" ? "Singles" : "Doubles",
    rotation,
    gamesPerPlayer,
    status,
    playerIds,
    completedGameTargetPlayerIds: []
  };
}

async function openApp(state, hash = "dashboard") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(value => {
    if (!localStorage.getItem("stackpoint.arcade.v2")) {
      localStorage.setItem("stackpoint.arcade.v2", JSON.stringify(value));
    }
    sessionStorage.setItem("stackpoint.demo-authenticated", "true");
  }, state);
  await page.goto(`${baseUrl}/#${hash}`);
  await page.waitForSelector("#app-content");
  return { context, page };
}

async function createSession(page, name, gameTarget, mode = null) {
  await page.locator("#app-content [data-action='new-session']").click();
  const form = page.locator("#session-form");
  await form.locator("[name='name']").fill(name);
  await form.locator("[name='venue']").fill("QA Courts");
  if (mode) await form.locator("[name='rotation']").selectOption(mode);
  if (gameTarget === "custom") {
    await form.locator("[name='gamesPerPlayer']").selectOption("custom");
    assert.equal(await form.locator("[name='customGamesPerPlayer']").isVisible(), true);
    assert.equal(await form.locator("[name='customGamesPerPlayer']").evaluate(input => input.required), true);
    await form.locator("[name='customGamesPerPlayer']").fill("3");
  } else if (gameTarget === "unlimited") {
    await form.locator("[name='gamesPerPlayer']").selectOption("unlimited");
    assert.equal(await form.locator("[name='customGamesPerPlayer']").isVisible(), false);
    assert.equal(await form.locator("[name='customGamesPerPlayer']").evaluate(input => input.required), false);
  }
  await form.locator("button[type='submit']").click();
  await page.locator("#modal").waitFor({ state: "hidden" });
}

async function startNextMatch(page) {
  await page.locator("#create-match-form button[type='submit']").click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2"))
    .matches.some(match => match.status === "In Progress"));
  return page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")).matches.at(-1).id);
}

async function scoreMatch(page, matchId, scoreA = "11", scoreB = "8") {
  await page.evaluate(() => { location.hash = "#matches"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "MATCH MANAGEMENT");
  await page.locator(`#app-content [data-action='score-match'][data-id='${matchId}']`).click();
  await page.locator("#score-form [name='scoreA']").fill(scoreA);
  await page.locator("#score-form [name='scoreB']").fill(scoreB);
  await page.locator("#score-form button[type='submit']").click();
  await page.locator("#modal").waitFor({ state: "hidden" });
}

test("navigation renders across target viewport widths and mobile drawer closes after navigation", async t => {
  const { context, page } = await openApp(makeState());
  t.after(() => context.close());
  const routes = [
    "dashboard", "sessions", "queue", "matches", "courts", "register", "players",
    "leaderboard", "statistics", "achievements", "match-history", "history", "settings"
  ];
  const names = {
    dashboard: "DASHBOARD", sessions: "OPEN PLAY SESSIONS", queue: "LIVE STACKING",
    matches: "MATCH MANAGEMENT", courts: "COURT MANAGEMENT", register: "PLAYER REGISTRATION",
    players: "PLAYERS", leaderboard: "LEADERBOARDS", statistics: "PLAYER STATISTICS",
    achievements: "ACHIEVEMENTS", "match-history": "MATCH HISTORY",
    history: "QUEUE HISTORY", settings: "ADMIN SETTINGS"
  };
  const widths = [320, 375, 390, 480, 768, 1024, 1280, 1440, 1920];
  const links = page.locator("nav.main-nav a[data-view]");
  assert.equal(await links.count(), routes.length);
  assert.equal(await links.evaluateAll(items =>
    new Set(items.map(link => link.getAttribute("href"))).size), routes.length);

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.evaluate(value => { location.hash = `#${value}`; }, route);
      await page.waitForFunction(value => document.querySelector("#page-name")?.textContent === value, names[route]);
      const dimensions = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth
      }));
      assert.ok(dimensions.documentWidth <= width, `${route} overflows at ${width}px`);
      assert.ok(dimensions.bodyWidth <= width, `${route} body overflows at ${width}px`);
    }
  }

  await page.setViewportSize({ width: 320, height: 700 });
  await page.locator("#menu-toggle").click();
  assert.equal(await page.locator("#menu-toggle").getAttribute("aria-expanded"), "true");
  await page.locator("nav.main-nav a[data-view='sessions']").click();
  await page.waitForFunction(() => document.querySelector("#menu-toggle")?.getAttribute("aria-expanded") === "false");
  assert.equal(await page.locator("#sidebar").evaluate(node => node.classList.contains("open")), false);
  assert.equal(await page.locator("#menu-toggle").getAttribute("aria-expanded"), "false");
});

test("session creation defaults to five, supports custom limits, and allows explicit unlimited games", async t => {
  const { context, page } = await openApp(makeState(), "sessions");
  t.after(() => context.close());
  await page.setViewportSize({ width: 320, height: 700 });

  await page.locator("#app-content [data-action='new-session']").click();
  const form = page.locator("#session-form");
  const dialogBounds = await page.locator("#modal").evaluate(dialog => {
    const rect = dialog.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: innerWidth };
  });
  assert.ok(dialogBounds.left >= 0 && dialogBounds.right <= dialogBounds.width);
  assert.equal(await form.locator("[name='gamesPerPlayer']").inputValue(), "5");
  assert.equal(await form.locator("[name='customGamesPerPlayer']").isVisible(), false);
  await form.locator("[name='name']").fill("Default target");
  await form.locator("[name='venue']").fill("QA Courts");
  await form.locator("button[type='submit']").click();
  await page.locator("#modal").waitFor({ state: "hidden" });

  await createSession(page, "Custom target", "custom");
  await createSession(page, "Unlimited target", "unlimited");
  const targets = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("stackpoint.arcade.v2")).sessions.map(item => item.gamesPerPlayer)
  );
  assert.deepEqual(targets, [5, 3, "unlimited"]);
});

test("player registration, session lifecycle, court availability, and match workflow work end to end", async t => {
  const { context, page } = await openApp(makeState(), "sessions");
  t.after(() => context.close());
  await createSession(page, "Lifecycle QA", "default");

  for (let index = 1; index <= 4; index++) {
    await page.evaluate(() => { location.hash = "#players"; });
    await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "PLAYERS");
    await page.locator("#app-content [data-action='new-player']").click();
    const form = page.locator("#player-form");
    await form.locator("[name='name']").fill(`Lifecycle Player ${index}`);
    await form.locator("[name='username']").fill(`lifecycle_${index}`);
    assert.equal(await form.locator("[name='joinQueue']").isChecked(), true);
    await form.locator("button[type='submit']").click();
    await page.locator("#modal").waitFor({ state: "hidden" });
  }

  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.sessions[0].status, "Registration Open");
  assert.equal(saved.sessions[0].playerIds.length, 4);
  assert.equal(saved.queue.length, 4);
  const firstPlayerId = saved.players[0].id;

  await page.locator(`[data-action='edit-player'][data-id='${firstPlayerId}']`).click();
  await page.locator("#player-form [name='name']").fill("Lifecycle Player Edited");
  await page.locator("#player-form [name='rating']").fill("4.2");
  await page.locator("#player-form button[type='submit']").click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.players.find(person => person.id === firstPlayerId).name, "Lifecycle Player Edited");
  assert.equal(saved.players.find(person => person.id === firstPlayerId).rating, 4.2);

  await page.evaluate(() => { location.hash = "#sessions"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "OPEN PLAY SESSIONS");
  await page.locator("#app-content [data-action='session-status'][data-status='In Progress']").click();
  await page.waitForFunction(() => location.hash === "#queue");
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.sessions[0].status, "In Progress");

  await page.evaluate(() => { location.hash = "#sessions"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "OPEN PLAY SESSIONS");
  await page.locator("#app-content [data-action='session-status'][data-status='Paused']").click();
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.sessions[0].status, "Paused");
  await page.evaluate(() => { location.hash = "#queue"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "LIVE STACKING");
  assert.match(await page.locator("#app-content").innerText(), /session is paused/i);

  await page.evaluate(() => { location.hash = "#sessions"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "OPEN PLAY SESSIONS");
  await page.locator("#app-content [data-action='session-status'][data-status='In Progress']").click();
  await page.waitForFunction(() => location.hash === "#queue");

  await page.evaluate(() => { location.hash = "#courts"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "COURT MANAGEMENT");
  await page.locator("#app-content [data-action='new-court']").click();
  await page.locator("#court-form button[type='submit']").click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  const addedCourt = saved.courts.find(court => court.name === "Court 02");
  assert.ok(addedCourt);
  await page.locator(`[data-action='toggle-court'][data-id='${addedCourt.id}']`).click();
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.courts.find(court => court.id === addedCourt.id).available, false);
  await page.locator(`[data-action='toggle-court'][data-id='${addedCourt.id}']`).click();

  await page.evaluate(() => { location.hash = "#queue"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "LIVE STACKING");
  await page.locator("#create-match-form button[type='submit']").click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2"))
    .matches.some(match => match.status === "In Progress"));
  await page.evaluate(() => { location.hash = "#sessions"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "OPEN PLAY SESSIONS");
  await page.locator("#app-content [data-action='session-status'][data-status='Completed']").click();
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.sessions[0].status, "In Progress");
  assert.equal(saved.matches.filter(match => match.status === "In Progress").length, 1);
  assert.match(await page.locator("#toast-region").innerText(), /Complete or cancel all live matches/i);

  await page.evaluate(() => { location.hash = "#matches"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "MATCH MANAGEMENT");
  await page.locator("#app-content [data-action='score-match']").click();
  await page.locator("#score-form [name='scoreA']").fill("11");
  await page.locator("#score-form [name='scoreB']").fill("8");
  await page.locator("#score-form button[type='submit']").click();
  await page.locator("#modal").waitFor({ state: "hidden" });

  await page.evaluate(() => { location.hash = "#sessions"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "OPEN PLAY SESSIONS");
  await page.locator("#app-content [data-action='session-status'][data-status='Completed']").click();
  await page.waitForFunction(() => location.hash === "#leaderboard");
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.sessions[0].status, "Completed");
  assert.equal(saved.queue.filter(entry => entry.sessionId === saved.sessions[0].id).length, 0);
  assert.equal(saved.matches.filter(match => match.status === "Completed").length, 1);

  await page.evaluate(() => { location.hash = "#players"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "PLAYERS");
  await page.locator(`[data-action='deactivate-player'][data-id='${firstPlayerId}']`).click();
  assert.equal((await page.evaluate(id =>
    JSON.parse(localStorage.getItem("stackpoint.arcade.v2")).players.find(person => person.id === id).active,
  firstPlayerId)), false);
  await page.locator(`[data-action='deactivate-player'][data-id='${firstPlayerId}']`).click();
  assert.equal((await page.evaluate(id =>
    JSON.parse(localStorage.getItem("stackpoint.arcade.v2")).players.find(person => person.id === id).active,
  firstPlayerId)), true);
});

test("cancelled sessions can be safely removed when they have no match history", async t => {
  const { context, page } = await openApp(makeState(), "sessions");
  t.after(() => context.close());
  await createSession(page, "Cancelled QA", "unlimited");
  const created = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")).sessions[0]);
  assert.equal(created.gamesPerPlayer, "unlimited");

  await page.locator("#app-content [data-action='session-status'][data-status='Cancelled']").click();
  await page.locator(`[data-action='delete-session'][data-id='${created.id}']`).click();
  await page.locator(`[data-action='confirm-delete-session'][data-id='${created.id}']`).click();
  const sessions = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")).sessions);
  assert.equal(sessions.length, 0);
});

test("doubles current-round fallback prioritizes fewer games and lets all eligible players reach target", async t => {
  const players = Array.from({ length: 6 }, (_, index) =>
    makePlayer(`P-${index + 1}`, ["S-TARGET"], `Target ${index + 1}`, `target_${index + 1}`)
  );
  const queue = players.map((person, index) => ({
    playerId: person.id,
    sessionId: "S-TARGET",
    joinedAt: new Date(Date.UTC(2026, 9, 19, 10, 0, index)).toISOString(),
    unavailable: false,
    partnerId: null
  }));
  const completed = {
    id: "M-COMPLETED",
    sessionId: "S-TARGET",
    courtId: "C1",
    playerIds: ["P-1", "P-2", "P-3", "P-4"],
    teamA: ["P-1", "P-2"],
    teamB: ["P-3", "P-4"],
    scoreA: 11,
    scoreB: 8,
    winner: "A",
    status: "Completed",
    awarded: true,
    createdAt: "2026-10-19T09:00:00.000Z",
    completedAt: "2026-10-19T09:30:00.000Z"
  };
  const cancelled = {
    ...completed,
    id: "M-CANCELLED",
    playerIds: ["P-3", "P-4", "P-5", "P-6"],
    teamA: ["P-3", "P-4"],
    teamB: ["P-5", "P-6"],
    status: "Cancelled",
    completedAt: undefined
  };
  const state = makeState({
    players,
    sessions: [makeSession("S-TARGET", "Target QA", "In Progress", players.map(person => person.id), 2)],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    queue,
    matches: [completed, cancelled]
  });
  const { context, page } = await openApp(state, "queue");
  t.after(() => context.close());

  const preview = page.locator(".board-layout > div.grid > section").first();
  assert.match(await preview.innerText(), /STACKING RELAXED/);
  const selectedNames = await preview.locator(".preview-match-grid .queue-row .player-info strong").allTextContents();
  assert.equal(selectedNames.length, 4);
  assert.ok(selectedNames.every(name => name.startsWith("target_")));
  const playedCounts = selectedNames.map(name => Number(name.slice("target_".length)) > 4 ? 0 : 1).sort();
  assert.deepEqual(playedCounts, [0, 0, 1, 1]);

  for (let round = 0; round < 4 && await page.locator("#create-match-form").count(); round++) {
    await page.locator("#create-match-form button[type='submit']").click();
    await page.locator("#app-content [data-action='score-match']").first().click();
    await page.locator("#score-form [name='scoreA']").fill("11");
    await page.locator("#score-form [name='scoreB']").fill("8");
    await page.locator("#score-form button[type='submit']").click();
    await page.locator("#modal").waitFor({ state: "hidden" });
  }

  const result = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("stackpoint.arcade.v2"));
    const session = saved.sessions.find(item => item.id === "S-TARGET");
    return {
      completedMatches: saved.matches.filter(match => match.sessionId === session.id && match.status === "Completed").length,
      counts: session.playerIds.map(id => saved.matches.filter(match =>
        match.sessionId === session.id && match.status === "Completed" && match.playerIds.includes(id)
      ).length),
      targetedPlayers: session.completedGameTargetPlayerIds
    };
  });
  assert.equal(result.completedMatches, 3);
  assert.deepEqual(result.counts, [2, 2, 2, 2, 2, 2]);
  assert.deepEqual(result.targetedPlayers, players.map(person => person.id));
  assert.equal(await page.locator("#create-match-form").count(), 0);
});

test("doubles queue completes first and second rounds with every 1-3 player remainder", async t => {
  for (const realPlayerCount of [1, 2, 3, 5, 6, 7, 9, 10, 11]) {
    await t.test(`${realPlayerCount} real players`, async t => {
      const sessionId = `S-DOUBLES-REMAINDER-${realPlayerCount}`;
      const players = Array.from({ length: realPlayerCount }, (_, index) => {
        const person = makePlayer(`P-${index + 1}`, [sessionId]);
        person.skill = ["Novice", "Beginner", "Intermediate", "Advanced"][index % 4];
        return person;
      });
      const state = makeState({
        players,
        sessions: [makeSession(sessionId, `Doubles remainder ${realPlayerCount}`, "In Progress", players.map(item => item.id), 2)],
        courts: [{ id: "C1", name: "Court 01", available: true }],
        queue: players.map(item => ({ playerId: item.id, sessionId, joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false }))
      });
      const { context, page } = await openApp(state, "queue");
      t.after(() => context.close());

      while (true) {
        const before = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
        const gameCounts = new Map(players.map(person => [
          person.id,
          before.matches.filter(match => match.sessionId === sessionId &&
            match.status === "Completed" && match.playerIds.includes(person.id)).length
        ]));
        if ([...gameCounts.values()].every(count => count >= 2)) break;
        const minGames = Math.min(...gameCounts.values());
        const currentRound = players.filter(person => gameCounts.get(person.id) === minGames);
        const eligiblePriorCount = players.filter(person => gameCounts.get(person.id) === minGames + 1).length;

        const matchId = await startNextMatch(page);
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
        const match = saved.matches.find(item => item.id === matchId);
        const realIds = match.playerIds.filter(id => players.some(person => person.id === id));
        assert.equal(match.playerIds.length, 4);
        assert.equal(new Set(match.playerIds).size, 4);
        assert.equal(match.teamA.length, 2);
        assert.equal(match.teamB.length, 2);
        assert.equal(new Set([...match.teamA, ...match.teamB]).size, 4);
        assert.equal(realIds.filter(id => gameCounts.get(id) === minGames).length, Math.min(currentRound.length, 4));
        assert.equal(match.dummyPlayerIds.length, 4 - realIds.length);
        const activeMatches = saved.matches.filter(item => item.status === "In Progress");
        const activeRealIds = activeMatches.flatMap(item => item.playerIds.filter(id =>
          players.some(person => person.id === id)));
        assert.equal(new Set(activeRealIds).size, activeRealIds.length, "A real player was assigned to overlapping active matches.");

        if (currentRound.length === 2) {
          if (eligiblePriorCount >= 2 && realIds.length === 4) {
            assert.ok([match.teamA, match.teamB].every(side =>
              side.filter(id => currentRound.some(person => person.id === id)).length === 1),
            "The remaining players should face each other when completed players are reused.");
          } else {
            for (const playerId of currentRound.map(person => person.id)) {
              const team = [match.teamA, match.teamB].find(side => side.includes(playerId));
              assert.ok(team.some(id => match.dummyPlayerIds.includes(id)), "Each remaining player needs a dummy partner.");
            }
          }
        }
        if (currentRound.length === 1 && eligiblePriorCount >= 2) {
          const remainingId = currentRound[0].id;
          const team = [match.teamA, match.teamB].find(side => side.includes(remainingId));
          assert.ok(team.some(id => match.dummyPlayerIds.includes(id)), "The lone current-round player needs a dummy partner.");
          assert.equal(realIds.filter(id => gameCounts.get(id) > minGames).length, 2);
        }

        await scoreMatch(page, matchId);
        await page.evaluate(() => { location.hash = "#queue"; });
        await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "LIVE STACKING");
        const after = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
        const countsAfter = players.map(person => after.matches.filter(item =>
          item.sessionId === sessionId && item.status === "Completed" && item.playerIds.includes(person.id)).length);
        assert.ok(Math.max(...countsAfter) - Math.min(...countsAfter) <= 1,
          `Unfair game distribution: ${countsAfter.join(", ")}`);
      }

      const completed = await page.evaluate(id => {
        const saved = JSON.parse(localStorage.getItem("stackpoint.arcade.v2"));
        return saved.matches.filter(match => match.sessionId === id && match.status === "Completed");
      }, sessionId);
      assert.ok(completed.length > 0);
      assert.equal(new Set(completed.map(match => match.id)).size, completed.length);
      const finalState = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
      assert.ok(finalState.players.every(person => person.matchIds.length === 2));
      assert.ok(finalState.matches.every(match => match.dummyPlayerIds.every(id =>
        !finalState.players.some(person => person.id === id))));
      assert.deepEqual(finalState.sessions[0].completedGameTargetPlayerIds.sort(), players.map(person => person.id).sort());
    });
  }
});

test("a lone first-game player is paired with a dummy against same-result previous players", async t => {
  const players = Array.from({ length: 5 }, (_, index) => makePlayer(`P-${index + 1}`, ["S-ONE-LEFT"]));
  players[0].skill = "Novice";
  players[1].skill = "Advanced";
  players[2].skill = "Advanced";
  players[3].skill = "Advanced";
  players[4].skill = "Intermediate";
  const previousMatch = {
    id: "M-PREVIOUS-ROUND",
    sessionId: "S-ONE-LEFT",
    courtId: "C1",
    playerIds: ["P-1", "P-2", "P-3", "P-4"],
    teamA: ["P-1", "P-2"],
    teamB: ["P-3", "P-4"],
    scoreA: 11,
    scoreB: 8,
    winner: "A",
    status: "Completed",
    createdAt: "2026-10-19T10:00:00.000Z",
    completedAt: "2026-10-19T10:30:00.000Z"
  };
  const state = makeState({
    players,
    sessions: [makeSession("S-ONE-LEFT", "One left QA", "In Progress", players.map(item => item.id), 5)],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    queue: players.map(item => ({ playerId: item.id, sessionId: "S-ONE-LEFT", joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false })),
    matches: [previousMatch]
  });
  const { context, page } = await openApp(state, "queue");
  t.after(() => context.close());

  const matchId = await startNextMatch(page);
  const match = await page.evaluate(id =>
    JSON.parse(localStorage.getItem("stackpoint.arcade.v2")).matches.find(item => item.id === id),
  matchId);
  assert.equal(match.dummyPlayerIds.length, 1);
  assert.equal(match.playerIds.includes("P-5"), true);
  const remainingPlayerTeam = [match.teamA, match.teamB].find(team => team.includes("P-5"));
  assert.ok(remainingPlayerTeam.some(id => match.dummyPlayerIds.includes(id)));
  const opposingTeam = [match.teamA, match.teamB].find(team => !team.includes("P-5"));
  assert.deepEqual(new Set(opposingTeam), new Set(["P-1", "P-2"]));
});

test("score validation and result correction recalculate player records exactly once", async t => {
  const players = Array.from({ length: 4 }, (_, index) => makePlayer(`P-${index + 1}`, ["S-SCORE"]));
  const match = {
    id: "M-SCORE",
    sessionId: "S-SCORE",
    courtId: "C1",
    playerIds: players.map(person => person.id),
    teamA: ["P-1", "P-2"],
    teamB: ["P-3", "P-4"],
    scoreA: null,
    scoreB: null,
    winner: null,
    status: "In Progress",
    awarded: false,
    createdAt: "2026-10-19T10:00:00.000Z"
  };
  const state = makeState({
    players,
    sessions: [makeSession("S-SCORE", "Score QA", "In Progress", players.map(person => person.id))],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    matches: [match]
  });
  const { context, page } = await openApp(state, "matches");
  t.after(() => context.close());

  await page.locator("#app-content [data-action='score-match']").click();
  await page.locator("#score-form [name='scoreA']").fill("10");
  await page.locator("#score-form [name='scoreB']").fill("8");
  await page.locator("#score-form button[type='submit']").click();
  assert.match(await page.locator("#score-form .form-error").innerText(), /reach at least 11/);
  await page.locator("#score-form [name='scoreA']").fill("11");
  await page.locator("#score-form [name='scoreB']").fill("11");
  await page.locator("#score-form button[type='submit']").click();
  assert.match(await page.locator("#score-form .form-error").innerText(), /no tie/);
  await page.locator("#score-form [name='scoreA']").fill("11");
  await page.locator("#score-form [name='scoreB']").fill("8");
  await page.locator("#score-form button[type='submit']").click();
  await page.locator("#modal").waitFor({ state: "hidden" });

  await page.evaluate(() => { location.hash = "#matches"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "MATCH MANAGEMENT");
  await page.locator("#app-content [data-action='correct-match']").click();
  await page.locator("#score-form [name='scoreA']").fill("11");
  await page.locator("#score-form [name='scoreB']").fill("13");
  await page.locator("#score-form button[type='submit']").click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  const result = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("stackpoint.arcade.v2"));
    return {
      match: saved.matches[0],
      players: saved.players.map(person => ({
        id: person.id, wins: person.wins, losses: person.losses, xp: person.xp, matchIds: person.matchIds
      }))
    };
  });
  assert.equal(result.match.status, "Completed");
  assert.equal(result.match.winner, "B");
  assert.equal(result.match.corrections.length, 1);
  assert.deepEqual(result.players.map(person => [person.wins, person.losses, person.xp]), [
    [0, 1, 25], [0, 1, 25], [1, 0, 40], [1, 0, 40]
  ]);
  assert.ok(result.players.every(person => person.matchIds.length === 1));
});

test("rankings apply wins, losses, streak, differential, then total points", async t => {
  const targets = [
    "rank_A", "rank_B", "rank_C", "rank_D", "rank_E",
    "rank_F", "rank_G", "rank_H", "rank_I"
  ];
  const players = [...targets, "extra_1", "extra_2", "extra_3"].map(username =>
    makePlayer(username, ["S-RANK"], username, username)
  );
  const matches = [];
  let serial = 0;
  function addResult(id, won, scoreA, scoreB) {
    const targetTeam = won ? [id, "extra_1"] : ["extra_1", id];
    const otherTeam = ["extra_2", "extra_3"];
    const teamA = won ? targetTeam : otherTeam;
    const teamB = won ? otherTeam : targetTeam;
    matches.push({
      id: `R-${++serial}`,
      sessionId: "S-RANK",
      courtId: "C1",
      playerIds: [...teamA, ...teamB],
      teamA,
      teamB,
      scoreA,
      scoreB,
      winner: scoreA > scoreB ? "A" : "B",
      status: "Completed",
      awarded: true,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, serial)).toISOString(),
      completedAt: new Date(Date.UTC(2026, 0, 1, 0, serial)).toISOString()
    });
  }
  function addRecord(id, outcomes) {
    outcomes.forEach(([won, scoreA, scoreB]) => addResult(id, won, scoreA, scoreB));
  }
  addRecord("rank_A", Array.from({ length: 8 }, () => [true, 11, 9]));
  addRecord("rank_B", [[false, 11, 0], ...Array.from({ length: 8 }, () => [true, 21, 0])]);
  addRecord("rank_C", Array.from({ length: 7 }, () => [true, 11, 0]));
  addRecord("rank_D", [[false, 11, 0], [true, 11, 0], [true, 11, 0]]);
  addRecord("rank_E", [[true, 21, 0], [false, 11, 0], [true, 21, 0]]);
  addRecord("rank_F", [[false, 11, 0], [true, 11, 0], [true, 11, 0]]);
  addRecord("rank_G", [[false, 11, 0], [true, 11, 9], [true, 11, 9]]);
  addRecord("rank_H", [[false, 11, 4], [true, 21, 19], [true, 21, 19]]);
  addRecord("rank_I", [[false, 11, 4], [true, 11, 9], [true, 11, 9]]);
  const state = makeState({
    players,
    sessions: [makeSession("S-RANK", "Ranking QA", "In Progress", players.map(person => person.id))],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    matches
  });
  const { context, page } = await openApp(state, "leaderboard");
  t.after(() => context.close());

  const rows = await page.locator("#app-content table tbody tr").evaluateAll(items =>
    items.map(row => ({
      name: row.querySelector("td:nth-child(2) strong").textContent,
      record: row.cells[2].textContent,
      streak: Number(row.cells[5].textContent),
      total: Number(row.cells[6].textContent),
      differential: Number(row.cells[7].textContent)
    }))
  );
  const names = rows.map(row => row.name);
  const position = name => names.indexOf(name);
  assert.equal(rows.find(row => row.name === "rank_A").record, "8–0");
  assert.equal(rows.find(row => row.name === "rank_B").record, "8–1");
  assert.equal(rows.find(row => row.name === "rank_C").record, "7–0");
  assert.ok(rows.find(row => row.name === "rank_B").differential >
    rows.find(row => row.name === "rank_A").differential);
  assert.ok(position("rank_A") < position("rank_B"));
  assert.ok(position("rank_B") < position("rank_C"));
  assert.ok(rows.find(row => row.name === "rank_D").streak >
    rows.find(row => row.name === "rank_E").streak);
  assert.ok(rows.find(row => row.name === "rank_E").differential >
    rows.find(row => row.name === "rank_D").differential);
  assert.ok(position("rank_D") < position("rank_E"));
  assert.equal(rows.find(row => row.name === "rank_F").record, rows.find(row => row.name === "rank_G").record);
  assert.equal(rows.find(row => row.name === "rank_F").streak, rows.find(row => row.name === "rank_G").streak);
  assert.ok(rows.find(row => row.name === "rank_F").differential >
    rows.find(row => row.name === "rank_G").differential);
  assert.ok(position("rank_F") < position("rank_G"));
  assert.equal(rows.find(row => row.name === "rank_H").record, rows.find(row => row.name === "rank_I").record);
  assert.equal(rows.find(row => row.name === "rank_H").streak, rows.find(row => row.name === "rank_I").streak);
  assert.ok(position("rank_H") < position("rank_I"));
  assert.equal(rows.find(row => row.name === "rank_H").differential,
    rows.find(row => row.name === "rank_I").differential);
  assert.ok(rows.find(row => row.name === "rank_H").total >
    rows.find(row => row.name === "rank_I").total);
});

test("completed-session leaderboard stays selectable while another session is active", async t => {
  const players = Array.from({ length: 4 }, (_, index) =>
    makePlayer(`P-${index + 1}`, ["S-OLD", "S-ACTIVE"])
  );
  const oldSession = makeSession("S-OLD", "Finished QA Session", "Completed", players.map(person => person.id));
  const activeSession = makeSession("S-ACTIVE", "Current QA Session", "In Progress", players.map(person => person.id));
  const match = {
    id: "M-OLD",
    sessionId: "S-OLD",
    courtId: "C1",
    playerIds: players.map(person => person.id),
    teamA: ["P-1", "P-2"],
    teamB: ["P-3", "P-4"],
    scoreA: 11,
    scoreB: 8,
    winner: "A",
    status: "Completed",
    awarded: true,
    createdAt: "2026-10-01T10:00:00.000Z",
    completedAt: "2026-10-01T10:30:00.000Z"
  };
  const state = makeState({
    players,
    sessions: [oldSession, activeSession],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    matches: [match]
  });
  state.leaderboardSession = activeSession.id;
  const { context, page } = await openApp(state, "sessions");
  t.after(() => context.close());

  await page.locator("#app-content [data-action='view-session-results'][data-id='S-OLD']").click();
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "LEADERBOARDS");
  assert.match(await page.locator("#app-content h1").innerText(), /Finished QA Session standings/);
  assert.equal(await page.locator("#app-content table tbody tr").count(), 4);
  assert.equal(await page.locator(".leaderboard-primary strong").innerText(), "player_P-1");
});

test("player names are escaped before rendering", async t => {
  const player = makePlayer("P-XSS", ["S-XSS"], `<img src=x onerror="alert(1)">`, "safe_username");
  const state = makeState({ players: [player] });
  const { context, page } = await openApp(state, "players");
  t.after(() => context.close());
  assert.equal(await page.locator("#player-grid img").count(), 0);
  assert.equal(await page.locator("#player-grid h3").innerText(), `<img src=x onerror="alert(1)">`);
});

test("finite-target sessions use dummy fill-ins only for remaining real players and exclude them from statistics", async t => {
  for (const realPlayerCount of [1, 2, 3, 4, 5, 6, 7]) {
    await t.test(`${realPlayerCount} real player${realPlayerCount === 1 ? "" : "s"}`, async t => {
      const players = Array.from({ length: realPlayerCount }, (_, index) =>
        makePlayer(`P-${index + 1}`, ["S-DUMMY"])
      );
      const state = makeState({
        players,
        sessions: [makeSession("S-DUMMY", "Dummy QA", "In Progress", players.map(item => item.id), 1)],
        courts: [{ id: "C1", name: "Court 01", available: true }],
        queue: players.map(item => ({ playerId: item.id, sessionId: "S-DUMMY", joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false }))
      });
      const { context, page } = await openApp(state, "queue");
      t.after(() => context.close());

      assert.match(await page.locator("#app-content").innerText(), realPlayerCount < 4
        ? /Dummy seats complete an odd or undersized doubles round/
        : /Fewest completed games come first/);
      const firstMatchId = await startNextMatch(page);
      let saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
      const firstMatch = saved.matches.find(match => match.id === firstMatchId);
      const expectedFirstDummies = Math.max(0, 4 - realPlayerCount);
      assert.equal(firstMatch.dummyPlayerIds.length, expectedFirstDummies);
      assert.equal(firstMatch.playerIds.length, 4);
      assert.equal(firstMatch.playerIds.filter(id => !saved.players.some(person => person.id === id)).length, expectedFirstDummies);
      await scoreMatch(page, firstMatchId);

      if (realPlayerCount > 4) {
        await page.evaluate(() => { location.hash = "#queue"; });
        await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "LIVE STACKING");
        assert.match(await page.locator("#app-content").innerText(), /Dummy seats complete an odd or undersized doubles round/);
        const secondMatchId = await startNextMatch(page);
        saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
        const secondMatch = saved.matches.find(match => match.id === secondMatchId);
        assert.equal(secondMatch.dummyPlayerIds.length, 8 - realPlayerCount);
        await scoreMatch(page, secondMatchId);
      }

      saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
      assert.deepEqual(saved.sessions[0].completedGameTargetPlayerIds.sort(), players.map(item => item.id).sort());
      assert.equal(saved.players.length, realPlayerCount);
      assert.ok(saved.players.every(person => person.wins + person.losses === 1));
      assert.ok(saved.players.every(person => person.matchIds.length === 1));
      assert.ok(saved.matches.every(match => Object.keys(match.preAwardPlayers).every(id =>
        saved.players.some(person => person.id === id))));
      assert.ok(saved.queue.every(entry => saved.players.some(person => person.id === entry.playerId)));
      assert.ok(saved.history.every(entry => saved.players.some(person => person.id === entry.playerId)));

      await page.evaluate(() => { location.hash = "#match-history"; });
      await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "MATCH HISTORY");
      assert.equal(await page.locator("#app-content table tbody tr").count(), saved.matches.filter(match => match.status === "Completed").length);
      if (saved.matches.some(match => match.dummyPlayerIds.length)) {
        assert.match(await page.locator("#app-content").innerText(), /Dummy Player/);
      }

      await page.evaluate(() => { location.hash = "#leaderboard"; });
      await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "LEADERBOARDS");
      assert.equal(await page.locator("#app-content table tbody tr").count(), realPlayerCount);
    });
  }
});

test("unlimited small doubles sessions use dummy seats to complete the current round", async t => {
  const players = Array.from({ length: 3 }, (_, index) => makePlayer(`P-${index + 1}`, ["S-UNLIMITED"]));
  const state = makeState({
    players,
    sessions: [makeSession("S-UNLIMITED", "Unlimited QA", "In Progress", players.map(item => item.id), "unlimited")],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    queue: players.map(item => ({ playerId: item.id, sessionId: "S-UNLIMITED", joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false }))
  });
  const { context, page } = await openApp(state, "queue");
  t.after(() => context.close());
  const matchId = await startNextMatch(page);
  await scoreMatch(page, matchId);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  const completed = saved.matches.find(match => match.id === matchId);
  assert.equal(completed.playerIds.length, 4);
  assert.equal(completed.dummyPlayerIds.length, 1);
  assert.equal(saved.players.length, 3);
  assert.ok(saved.players.every(person => person.matchIds.includes(matchId)));
  assert.ok(completed.dummyPlayerIds.every(id => !saved.players.some(person => person.id === id)));
});

test("dummy matches cancel and correct without creating dummy queue or player statistics", async t => {
  const players = Array.from({ length: 2 }, (_, index) => makePlayer(`P-${index + 1}`, ["S-DUMMY-FIX"]));
  const state = makeState({
    players,
    sessions: [makeSession("S-DUMMY-FIX", "Dummy correction QA", "In Progress", players.map(item => item.id), 1)],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    queue: players.map(item => ({ playerId: item.id, sessionId: "S-DUMMY-FIX", joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false }))
  });
  const { context, page } = await openApp(state, "queue");
  t.after(() => context.close());

  const cancelledId = await startNextMatch(page);
  await page.locator("#app-content [data-action='cancel-match']").click();
  await page.locator("#cancel-match-form button[type='submit']").click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.matches.find(match => match.id === cancelledId).status, "Cancelled");
  assert.ok(saved.queue.every(entry => players.some(person => person.id === entry.playerId)));
  assert.ok(saved.history.every(entry => players.some(person => person.id === entry.playerId)));

  const matchId = await startNextMatch(page);
  await scoreMatch(page, matchId);
  await page.evaluate(() => { location.hash = "#matches"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "MATCH MANAGEMENT");
  await page.locator(`#app-content [data-action='correct-match'][data-id='${matchId}']`).click();
  await page.locator("#score-form [name='scoreA']").fill("11");
  await page.locator("#score-form [name='scoreB']").fill("13");
  await page.locator("#score-form button[type='submit']").click();
  await page.locator("#modal").waitFor({ state: "hidden" });

  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  const corrected = saved.matches.find(match => match.id === matchId);
  assert.equal(corrected.status, "Completed");
  assert.equal(corrected.corrections.length, 1);
  assert.equal(Object.keys(corrected.preAwardPlayers).length, 2);
  assert.ok(saved.players.every(person => person.wins + person.losses === 1));
  assert.ok(saved.queue.every(entry => players.some(person => person.id === entry.playerId)));
  assert.ok(saved.history.every(entry => players.some(person => person.id === entry.playerId)));
});

test("matchmaking selectors contain only supported modes and legacy values migrate safely", async t => {
  const state = makeState({
    sessions: [makeSession("S-LEGACY", "Legacy mode QA", "In Progress", [], 5, "Paddle Stacking")]
  });
  state.settings.stackingMode = "Standard Queue";
  const { context, page } = await openApp(state, "settings");
  t.after(() => context.close());
  const modes = ["Equal Games Shuffle", "Partner Stacking", "Singles"];
  assert.deepEqual(await page.locator("#setting-mode option").evaluateAll(items => items.map(item => item.value)), modes);
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.settings.stackingMode, "Equal Games Shuffle");
  assert.equal(saved.sessions[0].rotation, "Partner Stacking");

  await page.locator("#setting-mode").selectOption("Partner Stacking");
  await page.locator("[data-action='save-settings']").click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")).settings.stackingMode), "Partner Stacking");
  await page.reload();
  await page.waitForSelector("#app-content");
  assert.equal(await page.locator("#setting-mode").inputValue(), "Partner Stacking");
  await page.evaluate(() => { location.hash = "#sessions"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "OPEN PLAY SESSIONS");
  await createSession(page, "Partner mode", "default");
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.sessions.at(-1).rotation, "Partner Stacking");
  await page.locator("#app-content [data-action='new-session']").click();
  assert.deepEqual(await page.locator("select[name='rotation'] option").evaluateAll(items => items.map(item => item.value)), modes);
  await page.locator("#modal [data-action='close-modal']").click();
  await createSession(page, "Singles mode", "default", "Singles");
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.sessions.at(-1).rotation, "Singles");
  assert.equal(saved.sessions.at(-1).format, "Singles");
  await page.reload();
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.sessions.at(-1).rotation, "Singles");
});

test("Singles prioritizes equal low game counts, same recent results, and skill balance", async t => {
  const players = ["P-1", "P-2", "P-3", "P-4", "P-5", "P-6"].map((id, index) => {
    const person = makePlayer(id, ["S-SINGLES"]);
    person.skill = ["Novice", "Advanced", "Beginner", "Beginner", "Novice", "Advanced"][index];
    return person;
  });
  const previousResults = [
    ["P-1", "P-5", "A"],
    ["P-2", "P-6", "A"],
    ["P-5", "P-3", "A"],
    ["P-6", "P-4", "A"]
  ].map(([winner, loser, winningTeam]) => {
    const teamA = winningTeam === "A" ? [winner] : [loser];
    const teamB = winningTeam === "A" ? [loser] : [winner];
    return {
      id: `H-${winner}-${loser}`,
      sessionId: "S-SINGLES",
      courtId: "C1",
      playerIds: [winner, loser],
      teamA,
      teamB,
      scoreA: 11,
      scoreB: 8,
      winner: "A",
      status: "Completed",
      awarded: true,
      createdAt: "2026-10-19T10:00:00.000Z",
      completedAt: "2026-10-19T10:30:00.000Z"
    };
  });
  const state = makeState({
    players,
    sessions: [makeSession("S-SINGLES", "Singles QA", "In Progress", players.map(item => item.id), 5, "Singles")],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    queue: players.slice(0, 4).map(item => ({ playerId: item.id, sessionId: "S-SINGLES", joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false })),
    matches: previousResults
  });
  const { context, page } = await openApp(state, "queue");
  t.after(() => context.close());
  const matchupNames = await page.locator(".preview-match-grid .preview-team-column").evaluateAll(columns =>
    columns.map(column => column.querySelector(".player-info strong")?.textContent)
  );
  assert.equal(matchupNames.length, 2);
  const selected = matchupNames.map(name => players.find(item => name?.startsWith(item.username))?.id);
  assert.equal(selected.length, 2);
  assert.ok(selected.every(id => ["P-1", "P-2"].includes(id)) ||
    selected.every(id => ["P-3", "P-4"].includes(id)), JSON.stringify({ matchupNames, selected }));
  assert.equal(await page.locator("#app-content").getByText("PLAYER A", { exact: true }).count(), 1);
});

test("Singles selects players with the fewest current-session games first", async t => {
  const players = Array.from({ length: 4 }, (_, index) => makePlayer(`P-${index + 1}`, ["S-SINGLES-FAIR"]));
  const previousMatch = {
    id: "M-PREVIOUS",
    sessionId: "S-SINGLES-FAIR",
    courtId: "C1",
    playerIds: ["P-3", "P-4"],
    teamA: ["P-3"],
    teamB: ["P-4"],
    scoreA: 11,
    scoreB: 8,
    winner: "A",
    status: "Completed",
    awarded: true,
    createdAt: "2026-10-19T10:00:00.000Z",
    completedAt: "2026-10-19T10:30:00.000Z"
  };
  const state = makeState({
    players,
    sessions: [makeSession("S-SINGLES-FAIR", "Singles fairness QA", "In Progress", players.map(item => item.id), 5, "Singles")],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    queue: players.slice(0, 3).map(item => ({ playerId: item.id, sessionId: "S-SINGLES-FAIR", joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false })),
    matches: [previousMatch]
  });
  const { context, page } = await openApp(state, "queue");
  t.after(() => context.close());
  const names = await page.locator(".preview-match-grid .preview-team-column .player-info strong")
    .evaluateAll(items => items.map(item => item.textContent));
  assert.deepEqual(names.map(name => name.replace(/[WL]$/, "")), ["player_P-1", "player_P-2"]);
});

test("Singles prioritizes the latest completed winner classification over queue order", async t => {
  const players = Array.from({ length: 4 }, (_, index) => makePlayer(`P-${index + 1}`, ["S-SINGLES-RESULTS"]));
  const previousMatches = [
    { playerId: "P-1", opponentId: "O-1", winner: "B" },
    { playerId: "P-2", opponentId: "O-2", winner: "B" },
    { playerId: "P-3", opponentId: "O-3", winner: "A" },
    { playerId: "P-4", opponentId: "O-4", winner: "A" }
  ].map(({ playerId, opponentId, winner }, index) => ({
    id: `H-${index}`,
    sessionId: "S-SINGLES-RESULTS",
    courtId: "C1",
    playerIds: [playerId, opponentId],
    teamA: [playerId],
    teamB: [opponentId],
    scoreA: winner === "A" ? 11 : 8,
    scoreB: winner === "A" ? 8 : 11,
    winner,
    status: "Completed",
    completedAt: "2026-10-19T10:30:00.000Z",
    createdAt: "2026-10-19T10:00:00.000Z"
  }));
  previousMatches.push({
    ...previousMatches[2],
    id: "H-INCOMPLETE",
    playerIds: ["P-3", "O-3"],
    winner: "B",
    status: "Incomplete",
    completedAt: null,
    createdAt: "2026-10-21T10:30:00.000Z"
  }, {
    ...previousMatches[3],
    id: "H-CANCELLED",
    playerIds: ["P-4", "O-4"],
    winner: "B",
    status: "Cancelled",
    completedAt: null,
    createdAt: "2026-10-21T10:30:00.000Z"
  });
  const state = makeState({
    players,
    sessions: [makeSession("S-SINGLES-RESULTS", "Singles result QA", "In Progress", players.map(item => item.id), 5, "Singles")],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    queue: players.map(item => ({ playerId: item.id, sessionId: "S-SINGLES-RESULTS", joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false })),
    matches: previousMatches
  });
  const { context, page } = await openApp(state, "queue");
  t.after(() => context.close());

  const matchId = await startNextMatch(page);
  const selectedIds = await page.evaluate(id =>
    JSON.parse(localStorage.getItem("stackpoint.arcade.v2")).matches.find(match => match.id === id).playerIds,
  matchId);
  assert.deepEqual(new Set(selectedIds), new Set(["P-3", "P-4"]));
});

test("Singles completes each round before advancing for 5, 6, 7, 9, and 10 players", async t => {
  for (const realPlayerCount of [5, 6, 7, 9, 10]) {
    await t.test(`${realPlayerCount} real players`, async t => {
      const sessionId = `S-SINGLES-ROUNDS-${realPlayerCount}`;
      const players = Array.from({ length: realPlayerCount }, (_, index) =>
        makePlayer(`P-${index + 1}`, [sessionId])
      );
      const state = makeState({
        players,
        sessions: [makeSession(sessionId, `Singles rounds ${realPlayerCount}`, "In Progress", players.map(item => item.id), 3, "Singles")],
        courts: [{ id: "C1", name: "Court 01", available: true }],
        queue: players.map(item => ({ playerId: item.id, sessionId, joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false }))
      });
      const { context, page } = await openApp(state, "queue");
      t.after(() => context.close());

      while (true) {
        const savedBeforeMatch = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
        const gamesByPlayer = new Map(players.map(person => [
          person.id,
          savedBeforeMatch.matches.filter(match => match.sessionId === sessionId &&
            match.status === "Completed" && match.playerIds.includes(person.id)).length
        ]));
        if ([...gamesByPlayer.values()].every(games => games >= 3)) break;

        const matchId = await startNextMatch(page);
        const match = await page.evaluate(id =>
          JSON.parse(localStorage.getItem("stackpoint.arcade.v2")).matches.find(item => item.id === id),
        matchId);
        assert.equal(match.playerIds.length, 2);
        const currentRoundSize = [...gamesByPlayer.values()].filter(games =>
          games === Math.min(...gamesByPlayer.values())).length;
        assert.equal(match.dummyPlayerIds.length, currentRoundSize === 1 ? 1 : 0);
        const realIds = match.playerIds.filter(id => players.some(person => person.id === id));
        assert.equal(realIds.length, 2 - match.dummyPlayerIds.length);
        for (const playerId of realIds) {
          const gamesBefore = gamesByPlayer.get(playerId);
          if (gamesBefore >= 1) {
            assert.ok([...gamesByPlayer.values()].every(games => games >= 1),
              `${playerId} started Round 2 before all players completed Round 1`);
          }
          if (gamesBefore >= 2) {
            assert.ok([...gamesByPlayer.values()].every(games => games >= 2),
              `${playerId} started Round 3 before all players completed Round 2`);
          }
        }

        await scoreMatch(page, matchId);
        await page.evaluate(() => { location.hash = "#queue"; });
        await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "LIVE STACKING");
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
        const completedGames = players.map(person => saved.matches.filter(item =>
          item.sessionId === sessionId && item.status === "Completed" && item.playerIds.includes(person.id)).length);
        assert.ok(Math.max(...completedGames) - Math.min(...completedGames) <= 1,
          `Game distribution diverged: ${completedGames.join(", ")}`);
      }
    });
  }
});

test("Singles avoids a repeat opponent when another same-result option is available", async t => {
  const players = Array.from({ length: 4 }, (_, index) => makePlayer(`P-${index + 1}`, ["S-SINGLES-ROTATION"]));
  const history = [];
  function addCompletedMatch(id, firstId, secondId, winnerId, completedAt) {
    const loserId = winnerId === firstId ? secondId : firstId;
    history.push({
      id,
      sessionId: "S-SINGLES-ROTATION",
      courtId: "C1",
      playerIds: [firstId, secondId],
      teamA: [winnerId],
      teamB: [loserId],
      scoreA: 11,
      scoreB: 8,
      winner: "A",
      status: "Completed",
      createdAt: completedAt,
      completedAt
    });
  }
  addCompletedMatch("H-REPEAT", "P-1", "P-2", "P-1", "2026-10-19T10:00:00.000Z");
  addCompletedMatch("H-P1", "P-1", "X-1", "P-1", "2026-10-19T10:10:00.000Z");
  addCompletedMatch("H-P2", "P-2", "X-2", "P-2", "2026-10-19T10:10:00.000Z");
  addCompletedMatch("H-P3-A", "P-3", "X-3", "P-3", "2026-10-19T10:00:00.000Z");
  addCompletedMatch("H-P3-B", "P-3", "Y-3", "P-3", "2026-10-19T10:10:00.000Z");
  addCompletedMatch("H-P4-A", "P-4", "X-4", "P-4", "2026-10-19T10:00:00.000Z");
  addCompletedMatch("H-P4-B", "P-4", "Y-4", "P-4", "2026-10-19T10:10:00.000Z");
  const state = makeState({
    players,
    sessions: [makeSession("S-SINGLES-ROTATION", "Singles rotation QA", "In Progress", players.map(item => item.id), 5, "Singles")],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    queue: players.map(item => ({ playerId: item.id, sessionId: "S-SINGLES-ROTATION", joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false })),
    matches: history
  });
  const { context, page } = await openApp(state, "queue");
  t.after(() => context.close());

  const matchId = await startNextMatch(page);
  const selectedIds = await page.evaluate(id =>
    JSON.parse(localStorage.getItem("stackpoint.arcade.v2")).matches.find(match => match.id === id).playerIds,
  matchId);
  assert.notDeepEqual(new Set(selectedIds), new Set(["P-1", "P-2"]));
});

test("Partner Stacking keeps a linked real pair together and records a normal doubles result", async t => {
  const players = Array.from({ length: 4 }, (_, index) => makePlayer(`P-${index + 1}`, ["S-PARTNER"]));
  const state = makeState({
    players,
    sessions: [{
      ...makeSession("S-PARTNER", "Partner stacking QA", "In Progress", players.map(item => item.id), 1, "Partner Stacking"),
      partnerLinks: [["P-1", "P-2"]]
    }],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    queue: players.map(item => ({ playerId: item.id, sessionId: "S-PARTNER", joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false }))
  });
  const { context, page } = await openApp(state, "queue");
  t.after(() => context.close());
  const matchId = await startNextMatch(page);
  const assigned = await page.evaluate(id => {
    const match = JSON.parse(localStorage.getItem("stackpoint.arcade.v2")).matches.find(item => item.id === id);
    return match;
  }, matchId);
  assert.ok(assigned.teamA.includes("P-1") && assigned.teamA.includes("P-2") ||
    assigned.teamB.includes("P-1") && assigned.teamB.includes("P-2"));
  await scoreMatch(page, matchId, "11", "8");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.ok(saved.players.every(person => person.matchIds.includes(matchId)));
  assert.ok(saved.sessions[0].completedGameTargetPlayerIds.length === 4);
});

test("Singles supports odd player counts, dummy target completion, scoring, and leaderboard statistics", async t => {
  const players = Array.from({ length: 3 }, (_, index) => makePlayer(`P-${index + 1}`, ["S-SINGLES-TARGET"]));
  const state = makeState({
    players,
    sessions: [makeSession("S-SINGLES-TARGET", "Singles target QA", "In Progress", players.map(item => item.id), 1, "Singles")],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    queue: players.map(item => ({ playerId: item.id, sessionId: "S-SINGLES-TARGET", joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false }))
  });
  const { context, page } = await openApp(state, "queue");
  t.after(() => context.close());

  const firstMatchId = await startNextMatch(page);
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  const firstMatch = saved.matches.find(match => match.id === firstMatchId);
  assert.equal(firstMatch.playerIds.length, 2);
  assert.equal(firstMatch.dummyPlayerIds.length, 0);

  await page.locator(`#app-content [data-action='edit-live-match'][data-id='${firstMatchId}']`).click();
  assert.equal(await page.locator("#match-lineup-form select").count(), 2);
  await page.locator("#match-lineup-form button[type='submit']").click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  await scoreMatch(page, firstMatchId, "11", "8");
  await page.evaluate(() => { location.hash = "#matches"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "MATCH MANAGEMENT");
  await page.locator(`#app-content [data-action='correct-match'][data-id='${firstMatchId}']`).click();
  await page.locator("#score-form [name='scoreA']").fill("8");
  await page.locator("#score-form [name='scoreB']").fill("11");
  await page.locator("#score-form button[type='submit']").click();
  await page.locator("#modal").waitFor({ state: "hidden" });

  await page.evaluate(() => { location.hash = "#queue"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "LIVE STACKING");
  const secondMatchId = await startNextMatch(page);
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  const secondMatch = saved.matches.find(match => match.id === secondMatchId);
  assert.equal(secondMatch.playerIds.length, 2);
  assert.equal(secondMatch.dummyPlayerIds.length, 1);
  assert.equal(secondMatch.playerIds.filter(id => players.some(person => person.id === id)).length, 1);
  await scoreMatch(page, secondMatchId, "8", "11");

  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.players.length, 3);
  assert.ok(saved.players.every(person => person.matchIds.length === 1));
  assert.ok(saved.players.every(person => person.wins + person.losses === 1));
  assert.deepEqual(saved.sessions[0].completedGameTargetPlayerIds.sort(), players.map(item => item.id).sort());
  assert.ok(saved.matches.every(match => match.dummyPlayerIds.every(id => !saved.players.some(person => person.id === id))));
  assert.equal(saved.matches.find(match => match.id === firstMatchId).corrections.length, 1);
  for (const match of saved.matches.filter(item => item.status === "Completed")) {
    const winnerIds = match.scoreA > match.scoreB ? match.teamA : match.teamB;
    for (const id of match.playerIds.filter(playerId => players.some(person => person.id === playerId))) {
      const person = saved.players.find(item => item.id === id);
      assert.equal(person.wins, Number(winnerIds.includes(id)));
      assert.equal(person.losses, Number(!winnerIds.includes(id)));
      assert.equal(person.matchIds.filter(matchId => matchId === match.id).length, 1);
    }
  }
  await page.evaluate(() => { location.hash = "#leaderboard"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "LEADERBOARDS");
  assert.equal(await page.locator("#app-content table tbody tr").count(), 3);
  const records = await page.locator("#app-content table tbody tr").evaluateAll(rows =>
    rows.map(row => [row.querySelector("td:nth-child(2) strong").textContent, row.cells[2].textContent, row.cells[6].textContent, row.cells[7].textContent])
  );
  assert.equal(records.length, 3);
  for (const person of saved.players) {
    const totals = saved.matches.filter(match => match.status === "Completed" && match.playerIds.includes(person.id))
      .reduce((result, match) => {
        const onTeamA = match.teamA.includes(person.id);
        result.scored += onTeamA ? match.scoreA : match.scoreB;
        result.conceded += onTeamA ? match.scoreB : match.scoreA;
        return result;
      }, { scored: 0, conceded: 0 });
    const row = records.find(item => item[0] === person.username);
    assert.ok(row, JSON.stringify({ username: person.username, records }));
    assert.equal(row[1], `${person.wins}–${person.losses}`);
    assert.equal(Number(row[2]), totals.scored);
    assert.equal(Number(row[3]), totals.scored - totals.conceded);
  }
});

test("Singles Unlimited Games uses a dummy only to finish an odd current round", async t => {
  const players = Array.from({ length: 3 }, (_, index) => makePlayer(`P-${index + 1}`, ["S-SINGLES-UNLIMITED-ODD"]));
  const state = makeState({
    players,
    sessions: [makeSession("S-SINGLES-UNLIMITED-ODD", "Singles unlimited odd QA", "In Progress", players.map(item => item.id), "unlimited", "Singles")],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    queue: players.map(item => ({ playerId: item.id, sessionId: "S-SINGLES-UNLIMITED-ODD", joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false }))
  });
  const { context, page } = await openApp(state, "queue");
  t.after(() => context.close());

  const firstMatchId = await startNextMatch(page);
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.deepEqual(saved.matches.find(match => match.id === firstMatchId).dummyPlayerIds, []);
  await scoreMatch(page, firstMatchId);
  await page.evaluate(() => { location.hash = "#queue"; });
  await page.waitForFunction(() => document.querySelector("#page-name")?.textContent === "LIVE STACKING");

  const secondMatchId = await startNextMatch(page);
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  const secondMatch = saved.matches.find(match => match.id === secondMatchId);
  assert.equal(secondMatch.dummyPlayerIds.length, 1);
  assert.equal(secondMatch.playerIds.filter(id => players.some(person => person.id === id)).length, 1);
  await scoreMatch(page, secondMatchId);
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.players.length, 3);
  assert.ok(saved.players.every(person => person.matchIds.length === 1));
  assert.ok(secondMatch.dummyPlayerIds.every(id => !saved.players.some(person => person.id === id)));
});

test("Singles unlimited mode requires two real players and persists without dummy fallback", async t => {
  const players = Array.from({ length: 2 }, (_, index) => makePlayer(`P-${index + 1}`, ["S-SINGLES-UNLIMITED"]));
  const state = makeState({
    players,
    sessions: [makeSession("S-SINGLES-UNLIMITED", "Singles unlimited QA", "In Progress", players.map(item => item.id), "unlimited", "Singles")],
    courts: [{ id: "C1", name: "Court 01", available: true }],
    queue: players.map(item => ({ playerId: item.id, sessionId: "S-SINGLES-UNLIMITED", joinedAt: "2026-10-19T10:00:00.000Z", unavailable: false }))
  });
  const { context, page } = await openApp(state, "queue");
  t.after(() => context.close());
  const matchId = await startNextMatch(page);
  await scoreMatch(page, matchId);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("stackpoint.arcade.v2")));
  assert.equal(saved.matches[0].playerIds.length, 2);
  assert.deepEqual(saved.matches[0].dummyPlayerIds, []);
  assert.ok(saved.players.every(person => person.wins + person.losses === 1));
});
