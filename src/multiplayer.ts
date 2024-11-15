import {FirebaseOptions, initializeApp } from 'firebase/app';
import {ActionReceiver, ActionSender, getOccupants, joinRoom, Room, selfId} from 'trystero/firebase';

export enum Shape {
    CIRCLE,
    CROSS,
    TRIANGLE,
    SQUARE,
    STAR
}

export const numShapes = Object.keys(Shape).length >> 1;

export enum ShapeColor {
    RED,
    YELLOW,
    GREEN,
    BLUE,
    CYAN,
    PURPLE
}

export const numColors = Object.keys(ShapeColor).length >> 1;

export type PassLetter = { shape: Shape; color: ShapeColor };

export type NameAndPass = {
    name: [PassLetter, PassLetter, PassLetter, PassLetter, PassLetter, PassLetter],
    pass: [PassLetter, PassLetter, PassLetter, PassLetter, PassLetter, PassLetter]
}

const charBuf =
    "upyk3jm4vl0csrd26ftqgoah7izb5x"

const passLetterToString = (l: PassLetter) => {
    const indexOfShape: number = l.shape
    const indexOfColor: number = l.color

    const indexIntoBuf = (indexOfShape * numShapes) + indexOfColor;

    return charBuf.charAt(indexIntoBuf);
}

const passToString = (l: PassLetter[]) => {
    return l.map(passLetterToString).join("")
}

export const base30DigitToPassLetter = (digit: number): PassLetter => {
    const indexOfShape = digit % numShapes;
    const indexOfColor = (digit / numShapes) | 0;

    return {
        shape: indexOfShape,
        color: indexOfColor
    }
}

export const passLetterToBase30Digit = (pl: PassLetter): number => {
    const indexOfShape: number = pl.shape
    const indexOfColor: number = pl.color

    const indexIntoBuf = (indexOfShape * numShapes) + indexOfColor;

    return indexIntoBuf;
}

const generateNameAndPass = (): NameAndPass => {
    // (shape = 5 * shapecolor = 6) ^ (name = 6 + pass = 6)
    // = 531441000000000000
    // = 2^(58.8...)
    // = 64 bits is fine

    const sixFourBits = new BigUint64Array(1);
    crypto.getRandomValues(sixFourBits)

    const bigNum = sixFourBits[0]
    // not exactly uniform but this is fine
    const combo = bigNum % (30n ** 12n)

    const digits = []
    for(let i = 11; i >= 0; i--) {
        const powerOf30 = 30n ** BigInt(i)
        const bigDigit = (combo / powerOf30) % 30n

        digits.push(Number(bigDigit))
    }

    return {
        // @ts-ignore
        name: digits.slice(0, 6).map(base30DigitToPassLetter),
        // @ts-ignore
        pass: digits.slice(6, 12).map(base30DigitToPassLetter)
    }
}

export type LobbyInfoPayload = {
    color: Color,
    ready: boolean
}

export type BallStatePayload = {
    x: number,
    y: number,
    vx: number,
    vy: number,
    color: Color,
    lives: number,
    spectating: boolean
}

export type HoleLostPayload = {
    totalTicksLived: number
}

export type HoleFinishedPayload = {
    holeTicksLived: number,
    totalTicksLived: number
}

export type GameOverPayload = {
    // map of Id to totalTicksLived
    winners: Record<string, number>,
    losers: Record<string, number>,
}

export type CollisionPayload = {
    initiatorVx: number,
    initiatorVy: number
}

export interface RawGolfRoom {
    nameAndPass: NameAndPass,
    rawRoom: Room,
    getRoomSize(): Promise<number>,
    getPeerIds(): string[],
    ownId: string,

    // the Host sends to all new peers unconditionally
    sendHostInfo: ActionSender<null>,
    recvHostInfo: ActionReceiver<null>,

    // after a new peer receives Host info, it asks back for current state key
    // if this is not a lobby (i.e. the game is in progress) the new peer will disconnect
    sendGameStateKeyRequest: ActionSender<null>,
    recvGameStateKeyRequest: ActionReceiver<null>,

    // the host will send the current state key
    sendGameStateKey: ActionSender<string>,
    recvGameStateKey: ActionReceiver<string>,

    // if in a multiplayer lobby, the new peer will
    // - wait until the number of connected peers matches the room size, then transition to the lobby screen
    // - request ready state and color from all peers
    // - broadcast its ready state and color
    // LobbyInfoPayload will be sent whenever ready state or color changes
    sendLobbyInfoRequest: ActionSender<null>,
    recvLobbyInfoRequest: ActionReceiver<null>,
    sendLobbyInfo: ActionSender<LobbyInfoPayload>,
    recvLobbyInfo: ActionReceiver<LobbyInfoPayload>,

    // once all players are ready, the host will start the game
    // this will be done with a `sendGameStateKey`
    // then the first hole will be loaded with a simple broadcast of the hole seed from the host
    sendStartHole: ActionSender<number>,
    recvStartHole: ActionReceiver<number>,

    // every player can send their own ball state
    sendBallState: ActionSender<BallStatePayload>,
    recvBallState: ActionReceiver<BallStatePayload>,
    // if they run out of lives, they announce that they are entering spectator mode
    sendHoleLost: ActionSender<HoleLostPayload>,
    recvHoleLost: ActionReceiver<HoleLostPayload>,
    // or if they complete the hole, they announce how many lives they completed it with and how many ticks it took
    sendHoleFinished: ActionSender<HoleFinishedPayload>,
    recvHoleFinished: ActionReceiver<HoleFinishedPayload>,

    // when at least one person has finished the hole, host runs a `sendStartHole`
    // when all holes are done, or everyone has died, host broadcasts that it's game over
    sendGameOver: ActionSender<GameOverPayload>,
    recvGameOver: ActionReceiver<GameOverPayload>,

    // when clients are done viewing this screen, they return to the lobby screen
    // all peers assume that all peers are not ready, and will send LobbyInfoRequests
    // these may go unanswered when other peers are still on the game over screen
    // clients will broadcast their LobbyInfo as soon as they return to the lobby screen

    // the fun and jank
    sendCollision: ActionSender<CollisionPayload>,
    recvCollision: ActionReceiver<CollisionPayload>
}

const createActions = (nameAndPass: NameAndPass, rawRoom: Room): RawGolfRoom => {
    const getRoomSize = async () => {
        const occupants = await getOccupants({
            appId: "https://cmpm176-project2-multiplayer-default-rtdb.firebaseio.com/",
            firebaseApp: app,
            password: passToString(nameAndPass.pass)
        }, passToString(nameAndPass.name))
        return occupants.length
    }
    const getPeerIds = () => {
        return Object.keys(rawRoom.getPeers())
    }
    const [sendHostInfo, recvHostInfo] = rawRoom.makeAction<null>("hostInfo")
    const [sendGameStateKeyRequest, recvGameStateKeyRequest] = rawRoom.makeAction<null>("gsKeyReq")
    const [sendGameStateKey, recvGameStateKey] = rawRoom.makeAction<string>("gsKey")
    const [sendLobbyInfoRequest, recvLobbyInfoRequest] = rawRoom.makeAction<null>("lobInfReq")
    const [sendLobbyInfo, recvLobbyInfo] = rawRoom.makeAction<LobbyInfoPayload>("lobInfo")
    const [sendStartHole, recvStartHole] = rawRoom.makeAction<number>("startHole")
    const [sendBallState, recvBallState] = rawRoom.makeAction<BallStatePayload>("ballState")
    const [sendHoleLost, recvHoleLost] = rawRoom.makeAction<HoleLostPayload>("holeLose")
    const [sendHoleFinished, recvHoleFinished] = rawRoom.makeAction<HoleFinishedPayload>("holeFin")
    const [sendGameOver, recvGameOver] = rawRoom.makeAction<GameOverPayload>("gameOver")
    const [sendCollision, recvCollision] = rawRoom.makeAction<CollisionPayload>("collision")

    return {
        nameAndPass,
        rawRoom,
        getRoomSize,
        getPeerIds,
        ownId: selfId,
        sendHostInfo,
        recvHostInfo,
        sendGameStateKeyRequest,
        recvGameStateKeyRequest,
        sendGameStateKey,
        recvGameStateKey,
        sendLobbyInfoRequest,
        recvLobbyInfoRequest,
        sendLobbyInfo,
        recvLobbyInfo,
        sendStartHole,
        recvStartHole,
        sendBallState,
        recvBallState,
        sendHoleLost,
        recvHoleLost,
        sendHoleFinished,
        recvHoleFinished,
        sendGameOver,
        recvGameOver,
        sendCollision,
        recvCollision
    }
}

const firebaseConfig: FirebaseOptions = {
    apiKey: "AIzaSyBLbgQQGlxZ49kQUthK9dvmAd44VhFFQoA",
    authDomain: "cmpm176-project2-multiplayer.firebaseapp.com",
    projectId: "cmpm176-project2-multiplayer",
    storageBucket: "cmpm176-project2-multiplayer.firebasestorage.app",
    messagingSenderId: "742533561040",
    appId: "1:742533561040:web:64476833c7a802b6217cd5",
    measurementId: "G-BBRW5G0PY1",
    databaseURL: "https://cmpm176-project2-multiplayer-default-rtdb.firebaseio.com/",
};
const app = initializeApp(firebaseConfig);

export const hostMpRoom = (): RawGolfRoom => {
    const nameAndPass = generateNameAndPass()

    const room = joinRoom({
        appId: "https://cmpm176-project2-multiplayer-default-rtdb.firebaseio.com/",
        firebaseApp: app,
        password: passToString(nameAndPass.pass)
    }, passToString(nameAndPass.name))

    return createActions(nameAndPass, room)
}

export const joinMpRoom = (nap: NameAndPass): RawGolfRoom => {
    // TODO failure behavior
    const room = joinRoom({
        appId: "https://cmpm176-project2-multiplayer-default-rtdb.firebaseio.com/",
        firebaseApp: app,
        password: passToString(nap.pass)
    }, passToString(nap.name))

    return createActions(nap, room)
}
