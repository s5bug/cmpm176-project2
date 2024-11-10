import {FirebaseOptions, initializeApp } from 'firebase/app';
import {joinRoom, selfId} from 'trystero/firebase';

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

export interface GolfRoom {
    nameAndPass: NameAndPass;

    getPlayerIds(): string[];
    // the Owner is the main source of trust, even though this is fully p2p
    // we want to minimize the amount of talking ideally
    getOwnerId(): string;

    getColor(): Color;
    setColor(color: Color): Promise<void>;
    getPlayerColors(): Record<string, Color>;

    getReady(): boolean;
    setReady(ready: boolean): Promise<void>;
    getPlayerReadys(): string[];

    // setStartGame(): Promise<void>;
    //
    // setTurnBegin(pos: Vector): Promise<void>;
    // setTurnLaunched(pos: Vector, vel: Vector): Promise<void>;
    // setTurnEnd(pos: Vector): Promise<void>;
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

type HostInfoPayload = {
    existingColors: Record<string, Color>,
    existingReadies: Record<string, boolean>
}

export const hostMpRoom = (ownColor: Color): GolfRoom => {
    const nameAndPass = generateNameAndPass()

    const room = joinRoom({
        appId: "https://cmpm176-project2-multiplayer-default-rtdb.firebaseio.com/",
        firebaseApp: app,
        password: passToString(nameAndPass.pass)
    }, passToString(nameAndPass.name))

    const [setColorAct, getColorAct] = room.makeAction<Color>("playerColor")
    const playerColors: Record<string, Color> = {
        [selfId]: ownColor
    }
    getColorAct((name, peer) => playerColors[peer] = name)

    const [setReadyAct, getReadyAct] = room.makeAction<boolean>("ready")
    const readies: Record<string, boolean> = {
        [selfId]: false
    }
    getReadyAct((ready, peer) => readies[peer] = ready)

    const [setHostInfo] = room.makeAction<HostInfoPayload>("hostInfo")

    const [setReqCurState, getRequestCurrentStateAct] = room.makeAction<null>("reqCurrState")
    getRequestCurrentStateAct((_, peerId) => {
        setHostInfo({
            existingColors: playerColors,
            existingReadies: readies,
        }, [peerId])
    })

    room.onPeerJoin(pid => setReqCurState(null, pid))

    return {
        nameAndPass: nameAndPass,

        getPlayerIds(): string[] {
            return [selfId, ...Object.keys(room.getPeers())]
        },

        getOwnerId(): string {
            return selfId
        },

        getColor(): Color {
            return playerColors[selfId]
        },

        async setColor(name: Color) {
            playerColors[selfId] = name
            await setColorAct(name)
        },

        getPlayerColors(): Record<string, Color> {
            return playerColors
        },

        getReady(): boolean {
            return readies[selfId]
        },

        async setReady(ready: boolean): Promise<void> {
            readies[selfId] = ready
            await setReadyAct(ready)
        },

        getPlayerReadys(): string[] {
            return Object.entries(readies).flatMap(([peerId, ready]) => ready ? [peerId] : [])
        }
    }
}

export const joinMpRoom = async (nap: NameAndPass, ownColor: Color): Promise<GolfRoom> => {
    // TODO failure behavior
    const room = joinRoom({
        appId: "https://cmpm176-project2-multiplayer-default-rtdb.firebaseio.com/",
        firebaseApp: app,
        password: passToString(nap.pass)
    }, passToString(nap.name))

    let hostId: string = null!;

    const [setColorAct, getColorAct] = room.makeAction<Color>("playerColor")
    const playerColors: Record<string, Color> = {
        [selfId]: ownColor
    }
    getColorAct((name, peer) => playerColors[peer] = name)

    const [setReadyAct, getReadyAct] = room.makeAction<boolean>("ready")
    const readies: Record<string, boolean> = {
        [selfId]: false
    }
    getReadyAct((ready, peer) => readies[peer] = ready)

    const [_, getHostInfo] = room.makeAction<HostInfoPayload>("hostInfo")
    getHostInfo((info, host) => {
        hostId = host
        for(let id in room.getPeers()) {
            if(id in info.existingColors) {
                playerColors[id] = info.existingColors[id]
            }
            if(id in info.existingReadies) {
                readies[id] = info.existingReadies[id]
            }
        }
    })

    const [setReqCurState, getReqCurState] = room.makeAction<null>("reqCurrState")
    getReqCurState((_, peerId) => {
        setColorAct(playerColors[selfId], [peerId])
        setReadyAct(readies[selfId], [peerId])
    })

    room.onPeerJoin(pid => setReqCurState(null, pid))

    await setReqCurState(null)

    return {
        nameAndPass: nap,

        getPlayerIds(): string[] {
            return [selfId, ...Object.keys(room.getPeers())]
        },

        getOwnerId(): string {
            return hostId
        },

        getColor(): Color {
            return playerColors[selfId]
        },

        async setColor(c: Color) {
            playerColors[selfId] = c
            await setColorAct(c)
        },

        getPlayerColors(): Record<string, Color> {
            return playerColors
        },

        getReady(): boolean {
            return readies[selfId]
        },

        async setReady(ready: boolean): Promise<void> {
            readies[selfId] = ready
            await setReadyAct(ready)
        },

        getPlayerReadys(): string[] {
            return Object.entries(readies).flatMap(([peerId, ready]) => ready ? [peerId] : [])
        }
    }
}
