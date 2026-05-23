// Single source of truth for every data-testid used in tests. Components
// emit these attributes; tests import this object to construct locators.
// Modify in lockstep with the corresponding component change.

export const TID = {
  // Landing
  home: { root: "home", roomCodeInput: "home-room-code-input", findRoomBtn: "home-find-room-btn", hostSignInLink: "home-host-signin" },

  // Player phone — pre-join
  playerJoinCodeEntry: { root: "player-code-entry", input: "player-code-input", submit: "player-code-submit" },
  playerJoin: { root: "player-join", input: "player-name-input", submit: "player-join-submit" },

  // Player phone — in-room
  playerLobby: { root: "player-lobby" },
  playerQuestion: { root: "player-question", answer: (slot: 1 | 2 | 3 | 4) => `player-answer-${slot}` },
  playerLocked: { root: "player-locked" },
  playerRevealCorrect: { root: "player-reveal-correct", points: "player-reveal-points" },
  playerRevealWrong: { root: "player-reveal-wrong" },
  playerJoinGame2: { root: "player-join-game2", submit: "player-join-game2-submit" },
  playerWinnerCard: { root: "player-winner-card", download: "player-winner-download" },
  playerRecap: { root: "player-recap" },

  // TV
  tvLobby: { root: "tv-lobby", qr: "tv-lobby-qr", roomCode: "tv-lobby-room-code", roster: "tv-lobby-roster" },
  tvGrid: { root: "tv-grid", cell: (cat: number, pts: number) => `tv-grid-cell-${cat}-${pts}` },
  tvQuestion: { root: "tv-question", prompt: "tv-question-prompt", pile: "tv-question-pile" },
  tvReveal: { root: "tv-reveal", correctAnswer: "tv-reveal-correct" },
  tvLeaderboard: { root: "tv-leaderboard", row: (rank: number) => `tv-leaderboard-row-${rank}` },
  tvIntermission: { root: "tv-intermission" },
  tvFinaleWinner: { root: "tv-finale-winner", name: "tv-finale-winner-name" },

  // Host
  hostDashboard: { root: "host-dashboard", newNightBtn: "host-new-night-btn", openRoomBtn: (nightId: string) => `host-open-room-${nightId}` },
  hostLiveConsole: { root: "host-live-console", revealBtn: "host-reveal-btn", undoBtn: "host-undo-btn", endEarlyBtn: "host-end-early-btn", question: (qid: string) => `host-question-${qid}` },
} as const;
