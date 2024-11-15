// setup code, you can skip this
import * as sss from 'sounds-some-sounds';
import 'pixi.js';
import 'pixi-filters';
import 'crisp-game-lib';
import {
  RawGolfRoom,
  hostMpRoom, joinMpRoom,
  NameAndPass, numColors, numShapes,
  PassLetter, BallStatePayload
} from "./multiplayer.ts";

(window as any).sss = sss;

type TitleState = {
  state: "title"
}
type PasswordEntryState = {
  state: "passwordEntry",
  currentSymbols: PassLetter[]
}
type ConnectingState = {
  state: "connecting",
  cachedOccupantCount: number | undefined,
  room: RawGolfRoom,
  hostId: string | undefined,
  connectionFailed: string | undefined,
  connectingStarted: number
}
type LobbyState = {
  state: "lobby",
  room: RawGolfRoom,
  isHost: boolean,
  readies: Record<string, boolean>,
  colors: Record<string, Color>,
  hostId: string,
}
type InGameState = {
  state: "inGame",
  room: RawGolfRoom,
  isHost: boolean,
  ballColor: Color,
  ourBall: Ball,
  ourLives: number,
  otherBalls: Record<string, BallStatePayload>,
  mapSeed: number,
  platforms: Platform[],
  ticksLeft: number,
  cachedColors: Record<string, Color>,
  hostId: string,
}
type LeaderboardState = {
  state: "leaderboard",
  room: RawGolfRoom,
  isHost: boolean,
  winnersLeastToGreatest: Record<string, number>,
  losersGreatestToLeast: Record<string, number>,
  colors: Record<string, Color>,
  hostId: string,
}

type State = TitleState | PasswordEntryState | ConnectingState | LobbyState | InGameState | LeaderboardState;

type Ground = { type: string; height?: number; };
type Platform = { pos: Vector; grounds: Ground[]; };
type Ball = {
  pos: Vector; prevPos: Vector; vel: Vector; angle: number; angleVel: number;
  power: number; basePower: number; prevBasePower: number; state: string;
};

// game starts here!

const title = "";

const description = `
`;

const characters = [
  `
 ll
llll
llll
 ll
 `,
  `
  ll  
 llll 
llllll
llllll
 llll
  ll
`,
  `
l    l
 l  l
  ll
  ll
 l  l
l    l
`,
  `
  ll
  ll
 llll
 llll
llllll
llllll
`,
  `
llllll
l    l
l ll l
l ll l
l    l
llllll
`,
  `
  ll  
  ll
llllll
 llll
ll  ll
l    l
`,
  `
  rrrr
 r  rr
r  rrr
r rr r
 rr  r
  rrrr
`,
  `
     G
  g GG
 ggGGG
gggGG
 ggG
  g
`
];

const replacements: Color[] = ["red", "yellow", "green", "cyan", "blue", "purple"]

function plToCharacter(pl: PassLetter): string {
  return String.fromCharCode("b".charCodeAt(0) + pl.shape)
}

const backspaceCharacter = "g"
const enterCharacter = "h"

function plToColor(pl: PassLetter): Color {
  return replacements[pl.color]
}

const options = {
  viewSize: { x: 150, y: 100 },
  isShowingScore: false,
  seed: 1,
};

let state: State;
let platforms: Platform[];
let ball: Ball;
let ballCount: number;
let holeCount: number;
let courseDifficulty: number;
let instructionTicks: number;
let holeStartingTicks: number;
let courseTime: number;

function update() {
  if (!ticks) {
    document.title = "SKY GOLF";
    instructionTicks = 200;
    initGame();
  }
  switch (state.state) {
    case "title":
      return updateTitle(state)
    case "passwordEntry":
      return updatePasswordEntry(state)
    case "connecting":
      return updateConnecting(state)
    case "lobby":
      return updateLobby(state)
    case "inGame":
      return updateInGame(state)
    case "leaderboard":
      return updateLeaderboard(state)
  }
}

let hostButton: Button;
let joinButton: Button;

let readyButton: Button;
let changeColorButton: Button;

function initGame() {
  state = { state: "title" };
  hostButton = getButton({
    text: "Host",
    pos: { x: 15, y: 45 },
    size: { x: 50, y: 7 },
    isToggle: false,
    onClick: setupRoomHost
  });
  joinButton = getButton({
    text: "Join",
    pos: { x: 15, y: 65 },
    size: { x: 50, y: 7 },
    isToggle: false,
    onClick: () => {
      state = {
        state: "passwordEntry",
        currentSymbols: []
      }
    }
  })
  readyButton = getButton({
    text: "Ready",
    pos: { x: 4, y: 65 },
    size: { x: 50, y: 7 },
    isToggle: true,
    onClick: toggleReady
  })
  changeColorButton = getButton({
    text: "Color",
    pos: { x: 4, y: 50 },
    size: { x: 50, y: 7 },
    isToggle: false,
    onClick: advanceColor
  })
  initBall();
  createHole(103);
}

function setupRoomHost() {
  const newRoom = hostMpRoom()
  const newState: LobbyState = {
    state: "lobby",
    room: newRoom,
    isHost: true,
    readies: { [newRoom.ownId]: false },
    colors: { [newRoom.ownId]: "red" },
    hostId: newRoom.ownId
  }

  newRoom.rawRoom.onPeerJoin(pid => newRoom.sendHostInfo(null, pid))

  newRoom.recvGameStateKeyRequest((_, pid) => {
    newRoom.sendGameStateKey(state.state, pid)
  })

  newRoom.recvLobbyInfoRequest((_, pid) => {
    switch(state.state) {
      case "lobby":
        newRoom.sendLobbyInfo({
          color: state.colors[state.room.ownId],
          ready: state.readies[state.room.ownId]
        }, pid)
        break;
    }
  })

  newRoom.recvLobbyInfo((li, pid) => {
    switch(state.state) {
      case "lobby":
        state.colors[pid] = li.color;
        state.readies[pid] = li.ready;
        break;
    }
  })

  state = newState
}

function toggleReady() {
  switch(state.state) {
    case "lobby":
      let oldReady = state.readies[state.room.ownId];
      let newReady = !oldReady;
      state.room.sendLobbyInfo({
        color: state.colors[state.room.ownId],
        ready: newReady
      })
      state.readies[state.room.ownId] = newReady;
      return;
    default: return;
  }
}

function advanceColor() {
  switch(state.state) {
    case "lobby":
      let oldColor = state.colors[state.room.ownId];
      let newColor: Color;
      switch(oldColor) {
        case "red":
          newColor = "yellow";
          break;
        case "yellow":
          newColor = "green";
          break;
        case "green":
          newColor = "cyan";
          break;
        case "cyan":
          newColor = "blue";
          break;
        case "blue":
          newColor = "purple";
          break;
        case "purple":
          newColor = "red";
          break;
      }

      state.room.sendLobbyInfo({
        color: newColor!,
        ready: state.readies[state.room.ownId]
      })
      state.colors[state.room.ownId] = newColor!;

      return;
    default: return;
  }
}

function updateTitle(_: TitleState) {
  drawHole();
  color("black");
  text("SKY GOLF", 9, 38);
  updateButton(hostButton);
  text("Host Game", 75, 48);
  updateButton(joinButton);
  text("Join Game", 75, 68);

  text("Click button to start", 20, 79);
}

function drawPassLetter(x: number, y: number, passLetter: PassLetter) {
  const charIdx = plToCharacter(passLetter)
  char(charIdx, x, y, { color: plToColor(passLetter) })
}

function drawPassLetters(x: number, y: number, passLetters: PassLetter[]) {
  let tx = x;
  passLetters.forEach(pl => {
    drawPassLetter(tx, y, pl)
    tx += 8
  })
}

function drawPassword(x: number, y: number, password: NameAndPass) {
  drawPassLetters(x, y, password.name)
  drawPassLetters(x, y + 8, password.pass)
}

function updateLobby(lobbyState: LobbyState) {
  drawPassword(8, 8, lobbyState.room.nameAndPass)

  if(lobbyState.isHost) {
    text("Hosting", 8, 28)
  }

  text("You:", 8, 40)
  char("a", 32, 40, { color: lobbyState.colors[lobbyState.room.ownId] })

  updateButton(changeColorButton)
  updateButton(readyButton)

  const playersToReadyCheck = [lobbyState.room.ownId, ...lobbyState.room.getPeerIds()]
  const readyPlayers = playersToReadyCheck.filter(pid => lobbyState.readies[pid])

  text("Ready: " + readyPlayers.length + "/" + playersToReadyCheck.length, 8, 80)

  const playerIds = lobbyState.room.getPeerIds();

  text("Opponents: " + playerIds.length, 75, 4)
  for(let i = 0; i < playerIds.length; i++) {
    const playerId = playerIds[i];
    const x = 78 + ((i % 6) * 10);
    const y = 16 + (((i / 6) | 0) * 10);

    const playerColor = lobbyState.colors[playerId] || "light_black";

    char("a", x, y, { color: playerColor });
  }
}

function joinRoom(pletters: PassLetter[]) {
  const name = pletters.slice(0, 6)
  const pass = pletters.slice(6, 12)

  // @ts-ignore
  const nap: NameAndPass = { name, pass }

  const newRoom = joinMpRoom(nap)
  const newState: ConnectingState = {
    state: "connecting",
    cachedOccupantCount: undefined,
    room: newRoom,
    hostId: undefined,
    connectionFailed: undefined,
    connectingStarted: ticks
  }

  newRoom.recvHostInfo((_, pid) => {
    switch(state.state) {
      case "connecting":
        state.hostId = pid
        state.room.getRoomSize().then(c => {
          if(state.state === "connecting") {
            state.cachedOccupantCount = c
          }
        })
        state.room.recvGameStateKey(gsk => {
          if(gsk !== "lobby" && state.state === "connecting") {
            state.connectionFailed = "Not in lobby"
          }
        })
        state.room.sendGameStateKeyRequest(null, pid)
        break;
      default: return;
    }
  })

  state = newState
}

function updatePasswordEntry(pentState: PasswordEntryState) {
  const gridWidth = (8 * (numColors - 1)) + 6;
  const startX = ((options.viewSize.x - gridWidth) / 2) | 0;
  const startY = 62;

  text("Password: ", 40, 10);

  for(let shape = 0; shape < numShapes; shape++) {
    for(let color = 0; color < numColors; color++) {
      const pl: PassLetter = { shape, color }

      const x = startX + (color * 8);
      const y = startY + (shape * 8);

      char(plToCharacter(pl), x, y, { color: plToColor(pl) })

      if(input.isJustPressed && input.pos.x >= (x - 3) && input.pos.y >= (y - 3) &&
          input.pos.x < (x + 3) && input.pos.y < (y + 3)) {
        if(pentState.currentSymbols.length < 12)
          pentState.currentSymbols.push(pl)
      }
    }
  }

  for(let i = 0; i < pentState.currentSymbols.length; i++) {
    const pl = pentState.currentSymbols[i]

    const row = (i / 6) | 0;
    const column = i % 6;

    const x = startX + (8 * column)
    const y = 20 + (8 * row)

    char(plToCharacter(pl), x, y, { color: plToColor(pl) })
  }

  if(pentState.currentSymbols.length > 0) {
    char(backspaceCharacter, 60, 48)
    if (input.isJustPressed && input.pos.x >= 57 && input.pos.y >= 45 &&
        input.pos.x < 63 && input.pos.y < 51) {
      pentState.currentSymbols.length--;
    }
  }

  if(pentState.currentSymbols.length == 12) {
    char(enterCharacter, 80, 48)
    if (input.isJustPressed && input.pos.x >= 77 && input.pos.y >= 45 &&
        input.pos.x < 83 && input.pos.y < 51) {
      joinRoom(pentState.currentSymbols)
    }
  }
}

function updateConnecting(connectingState: ConnectingState) {
  if(connectingState.connectionFailed) {
    text(connectingState.connectionFailed, 50, 50)
  } else if(connectingState.room.getPeerIds().length + 1 >= (connectingState.cachedOccupantCount || Infinity)) {
    transitionToLobbyAsNonHost(connectingState)
  } else {
    text("Connecting...", 50, 50)
    if((ticks - connectingState.connectingStarted) > 60) {
      text("You might need to disable", 8, 70)
      text("your VPN, if you have one", 8, 78)
    }
  }
}

function transitionToLobbyAsNonHost(connectingState: ConnectingState) {
  const newState: LobbyState = {
    state: "lobby",
    room: connectingState.room,
    isHost: false,
    readies: { [connectingState.room.ownId]: false },
    colors: { [connectingState.room.ownId]: "green" },
    hostId: connectingState.hostId!
  }

  newState.room.recvLobbyInfo((li, pid) => {
    newState.readies[pid] = li.ready
    newState.colors[pid] = li.color
  })

  newState.room.sendLobbyInfoRequest(null)

  newState.room.sendLobbyInfo({
    ready: newState.readies[newState.room.ownId],
    color: newState.colors[newState.room.ownId],
  })

  state = newState
}

const bgmSeeds = [1013, 1023, 1024];

function initInGame(_difficulty: number) {
  courseDifficulty = _difficulty;
  ballCount = 0;
  holeCount = 0;
  courseTime = 0;
  goToNextHole();
}

function updateInGame() {
  drawHole();
  color(ball.state === "shot" && ball.basePower < 1 ? "yellow" : "black");
  char("a", ball.pos);
  if (ball.state === "shot") {
    updateShotState();
  } else if (ball.state === "power") {
    sss.stopMml();
    updatePowerState();
  } else if (ball.state === "fly") {
    updateFlyState();
  }
  color("black");
  if (instructionTicks > 0) {
    instructionTicks--;
    text("[Hold] to adjust power", 20, 60);
    text("[Release] to shoot", 20, 68);
  }
  if (holeStartingTicks > 0) {
    holeStartingTicks--;
    text(`HOLE ${holeCount}`, 10, 95);
  }
  courseTime++;
  drawBallAndTime();
}

function drawBallAndTime() {
  color("black");
  char("a", 3, 4);
  text(`x${ballCount}`, 9, 3);
  drawTime(courseTime, 110, 3);
}

const holeSeeds = [
  [71, 45, 9],
  [49, 7, 98, 31, 54, 99],
  [15, 4, 67, 5, 90, 53, 79, 85, 78],
];

function goToNextHole() {
  state = "inGame";
  initBall();
  createHole(holeSeeds[courseDifficulty][holeCount]);
  ball.prevPos.set(ball.pos);
  holeStartingTicks = 120;
  holeCount++;
  ballCount += 5;
  initBallShotState();
}

function initBall() {
  ball = {
    pos: vec(5, 83),
    prevPos: vec(),
    vel: vec(),
    angle: 0,
    angleVel: -1,
    power: 0,
    basePower: 1,
    prevBasePower: 1,
    state: "shot",
  };
}

function updateShotState() {
  ball.angle += ball.angleVel * 0.05;
  if (
    (ball.angle < -PI && ball.angleVel < 0) ||
    (ball.angle > 0 && ball.angleVel > 0)
  ) {
    ball.angleVel = -ball.angleVel;
    ball.angle += ball.angleVel * 0.05 * 2;
  }
  color("light_black");
  line(ball.pos, vec(ball.pos).addWithAngle(ball.angle, 9), 2);
  if (input.isJustPressed) {
    sss.stopMml();
    play("select");
    ball.state = "power";
  }
}

function updatePowerState() {
  ball.power += 0.2;
  color("light_black");
  line(ball.pos, vec(ball.pos).addWithAngle(ball.angle, ball.power), 2);
  if (ball.power > 9 || input.isJustReleased) {
    play("laser");
    ball.vel.set().addWithAngle(ball.angle, ball.power * 0.5 * ball.basePower);
    ball.state = "fly";
    ballCount--;
  }
}

function updateFlyState() {
  const p = vec();
  color("transparent");
  p.set(ball.pos).add(ball.vel.x, 0);
  const ch = char("a", p).isColliding.rect!;
  if (
    ch.red ||
    ch.green ||
    ch.yellow ||
    ch.blue ||
    (ball.vel.x < 0 && ball.pos.x < 2) ||
    (ball.vel.x > 0 && ball.pos.x > 148)
  ) {
    ball.vel.x *= -0.8;
    ball.vel.y *= 0.8;
  }
  p.set(ball.pos).add(0, ball.vel.y);
  const cv = char("a", p).isColliding.rect!;
  if (cv.red || cv.green || cv.yellow || cv.blue) {
    let vr = 0.8;
    if (ball.vel.y > 0 && cv.blue) {
      play("click");
      vr = 0.4;
      color("blue");
      particle(ball.pos.x, ball.pos.y + 2, 3, 1, -PI / 2, PI / 4);
    } else if (ball.vel.y > 0 && cv.yellow) {
      play("click");
      vr = 0.5;
      color("yellow");
      particle(ball.pos.x, ball.pos.y + 2, 3, 1, -PI / 2, PI / 4);
    } else {
      play("hit");
    }
    ball.vel.y *= -vr;
    ball.vel.x *= vr;
    if (ball.vel.y < 0 && ball.vel.length < 0.5) {
      if (cv.white) {
        initGoToNextHole();
        return;
      } else if (ballCount <= 0) {
        initGiveUp();
        return;
      }
      initBallShotState();
      ball.basePower = cv.yellow ? 0.5 : 1;
      if (cv.blue) {
        color("blue");
        particle(ball.pos.x, ball.pos.y + 2, 9, 0.5, -PI / 2, PI / 2);
        backToPrevBallPos();
      }
      ball.prevPos.set(ball.pos);
      ball.prevBasePower = ball.basePower;
      return;
    }
  }
  ball.pos.add(ball.vel);
  ball.vel.mul(0.98);
  ball.vel.y += 0.1;
  if (ball.pos.y > 110) {
    if (ballCount <= 0) {
      initGiveUp();
      return;
    }
    backToPrevBallPos();
    initBallShotState();
  }
}

function backToPrevBallPos() {
  play("explosion");
  ball.pos.set(ball.prevPos);
  ball.basePower = ball.prevBasePower;
}

function initBallShotState() {
  ball.state = "shot";
  ball.power = 0.1;
  sss.playMml(sss.generateMml({ seed: bgmSeeds[courseDifficulty] }));
}

function drawHole() {
  platforms.forEach(p => {
    color("red");
    rect(p.pos.x, p.pos.y, p.grounds.length * 6, -2);
    let pgt = p.grounds[0].type;
    let x = p.pos.x;
    let bx = p.pos.x;
    p.grounds.forEach((g) => {
      if (g.type !== pgt) {
        drawGround(bx, p.pos.y - 2, x - bx, pgt);
        bx = x;
        pgt = g.type;
      }
      if (g.type === "tree") {
        drawTree(x, p.pos.y - 5, g.height!);
      } else if (g.type === "flag") {
        drawFlag(x, p.pos.y - 5);
      }
      x += 6;
    });
    drawGround(bx, p.pos.y - 2, x - bx, pgt);
  });
}

const groundColors: Record<string, Color> = {
  fairway: "green",
  sand: "yellow",
  water: "blue",
  tree: "green",
  flag: "white",
};

function drawGround(x: number, y: number, w: number, type: string) {
  color(groundColors[type]);
  rect(x, y, w, -3);
}

function drawTree(x: number, y: number, h: number) {
  const h2 = floor(h / 2);
  color("red");
  rect(x + 1, y, 3, -h2);
  color("green");
  rect(x, y - h2, 5, -h2);
}

function drawFlag(x: number, y: number) {
  color("light_yellow");
  rect(x + 1, y, 2, -10);
  color("light_red");
  rect(x + 3, y - 6, 5, -4);
}

let goToNextHoleTicks: number;

function initGoToNextHole() {
  if (holeCount === holeSeeds[courseDifficulty].length) {
    initHoleOut();
    return;
  }
  sss.playMml(
    sss.generateMml({
      seed: 1,
      noteLength: 16,
      partCount: 2,
      drumPartRatio: 0,
    }),
    { isLooping: false, speed: 2 }
  );
  state = "goToNextHole";
  goToNextHoleTicks = 0;
}

function updateGoToNextHole() {
  drawHole();
  color("black");
  text("GO TO NEXT HOLE", 30, 50);
  drawBallAndTime();
  goToNextHoleTicks++;
  if (goToNextHoleTicks > 150 || input.isJustPressed) {
    goToNextHole();
  }
}

let giveUpTicks: number;

function initGiveUp() {
  state = "giveUp";
  giveUpTicks = 0;
}

function updateGiveUp() {
  drawHole();
  color("black");
  text("GIVE UP", 20, 50);
  giveUpTicks++;
  if (giveUpTicks > 300 || input.isJustPressed) {
    initGame();
  }
}

let holeOutTicks: number;

function initHoleOut() {
  state = "holeOut";
  holeOutTicks = 0;
  sss.playMml(
    sss.generateMml({
      seed: 9,
      noteLength: 16,
      partCount: 2,
      drumPartRatio: 0,
    }),
    { isLooping: false, speed: 2 }
  );
}

function updateHoleOut() {
  drawHole();
  color("black");
  text("HOLE OUT!", 70, 50);
  drawBallAndTime();
  holeOutTicks++;
  if (holeOutTicks > 600 || input.isJustPressed) {
    initGame();
  }
}

class Random {
  w!: number;
  x!: number;
  y!: number;
  z!: number;

  constructor(seed = null) {
    this.setSeed(seed);
  }

  get(lowOrHigh = 1, high?: number) {
    if (high == null) {
      high = lowOrHigh;
      lowOrHigh = 0;
    }
    return (this.next() / 0xffffffff) * (high - lowOrHigh) + lowOrHigh;
  }

  getInt(lowOrHigh: number, high?: number) {
    if (high == null) {
      high = lowOrHigh;
      lowOrHigh = 0;
    }
    const lowOrHighInt = Math.floor(lowOrHigh);
    const highInt = Math.floor(high);
    if (highInt === lowOrHighInt) {
      return lowOrHighInt;
    }
    return (this.next() % (highInt - lowOrHighInt)) + lowOrHighInt;
  }

  setSeed(w: number | null, x = 123456789, y = 362436069, z = 521288629, loopCount = 32) {
    this.w = w != null ? w >>> 0 : Math.floor(Math.random() * 0xffffffff) >>> 0;
    this.x = x >>> 0;
    this.y = y >>> 0;
    this.z = z >>> 0;
    for (let i = 0; i < loopCount; i++) {
      this.next();
    }
    return this;
  }

  next() {
    const t = this.x ^ (this.x << 11);
    this.x = this.y;
    this.y = this.z;
    this.z = this.w;
    this.w = (this.w ^ (this.w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return this.w;
  }
}

const random = new Random();

function createHole(seed: number) {
  random.setSeed(seed);
  platforms = [];
  const pc = random.getInt(1, 3);
  let y = 90;
  let w = 25;
  if (random.get() < 0.5) {
    w = random.getInt(12, 20);
    if (random.get() < 0.5) {
      y = random.getInt(30, 70);
    }
  }
  ball.pos.y = y - 7;
  addPlatform(vec(0, y), w, false, true);
  times(pc, (i) => {
    const w = random.getInt(9, 20);
    addPlatform(
      vec(random.getInt(150 - w * 6), random.getInt(30, 70)),
      w,
      i === pc - 1,
      false
    );
  });
}

function addPlatform(pos: Vector, width: number, hasHole: boolean, hasTeeing: boolean) {
  const grounds = times(width, () => ({ type: "fairway" }));
  addGround(grounds, "tree");
  if (random.get() < 0.7) {
    addGround(grounds, "fairway");
  }
  if (random.get() < 0.8) {
    addGround(grounds, "sand");
  }
  if (random.get() < 0.5) {
    addGround(grounds, "water");
  }
  if (hasHole) {
    addGround(grounds, "hole");
  }
  if (hasTeeing) {
    times(5, (i) => {
      grounds[i] = { type: "fairway" };
    });
  }
  platforms.push({ pos, grounds });
}

function addGround(grounds: Ground[], type: string) {
  const w =
    type === "hole"
      ? random.getInt(3, 6)
      : random.getInt(3, grounds.length / 2);
  const x =
    type === "hole"
      ? grounds.length - w - random.getInt(3)
      : random.getInt(grounds.length - w);
  const bh = random.getInt(10, 20);
  times(w, (i) => {
    const height =
      type === "tree" ? floor(bh + random.getInt(-5, 6)) : undefined;
    if (type === "hole") {
      grounds[x + i] = {
        type: x + i === floor(x + w / 2) ? "flag" : "fairway",
      };
    } else {
      grounds[x + i] = { type, height };
    }
  });
}

function drawTime(time: number, x: number, y: number) {
  let t = Math.floor((time * 100) / 50);
  if (t >= 10 * 60 * 100) {
    t = 10 * 60 * 100 - 1;
  }
  const ts =
    getPaddedNumber(Math.floor(t / 6000), 1) +
    "'" +
    getPaddedNumber(Math.floor((t % 6000) / 100), 2) +
    '"' +
    getPaddedNumber(Math.floor(t % 100), 2);
  text(ts, x, y);
}

function getPaddedNumber(v: number, digit: number) {
  return ("0000" + v).slice(-digit);
}

// game ends here!
addEventListener("load", () => init({update, title, description, characters, options}));
