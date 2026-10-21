/* Empty starting state. The application copies this into localStorage on first launch. */
window.STACKPOINT_SEED = {
  players: [],
  sessions: [],
  courts: [],
  queue: [],
  matches: [],
  history: [],
  nextPlayer: 1001,
  nextMatch: 1,
  settings: { targetScore: 11, winByTwo: true, xpPerMatch: 25, xpWinBonus: 15, stackingMode: "Equal Games Shuffle" }
};
