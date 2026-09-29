/**
 * CLUEDO — 1920s Noir Replica
 * Shared domain types (used by the authoritative host, the browser client and the AI).
 */

export type CardKind = 'suspect' | 'weapon' | 'room';

export interface Card {
  id: string;
  kind: CardKind;
  name: string;
  /** Short epithet used in flavour text and log lines. */
  epithet?: string;
}

/** Colors of the six suspect tokens. */
export interface SuspectMeta {
  id: string;
  name: string;
  short: string;
  color: string;
  glow: string;
  /** Authentic perimeter starting spawn (hallway tile). */
  spawn: { x: number; y: number };
  /** Flavour title shown in dossiers. */
  title: string;
}

export interface RoomMeta {
  id: string;
  name: string;
  short: string;
  /** Interior rectangle of the room (inclusive). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Secret passage destination room id, if any. */
  passageTo?: string;
  /** Decorative motif key used by the SVG renderer. */
  motif: string;
  accent: string;
}

export interface DoorMeta {
  id: string;
  roomId: string;
  /** Walkable *interior* doorway tile (belongs to the room). */
  tile: { x: number; y: number };
  /** Hallway tile directly outside the doorway. */
  out: { x: number; y: number };
  /** Cardinal direction the door faces (used for the artwork). */
  dir: 'n' | 's' | 'e' | 'w';
}

export type Position =
  | { kind: 'hall'; x: number; y: number }
  | { kind: 'room'; roomId: string; doorId?: string };

export type NodeKey = string;

export interface BoardNode {
  key: NodeKey;
  pos: Position;
  /** Cardinal neighbours reachable in one step. */
  edges: { key: NodeKey; cost: number; kind: 'hall' | 'door' | 'exit' }[];
}

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */

export type Phase =
  | 'LOBBY'
  | 'ROLL'
  | 'MOVE'
  | 'SUGGEST'
  | 'DISPROVE'
  | 'ACCUSE'
  | 'END_TURN'
  | 'GAME_OVER';

export type NotebookStamp = 'unknown' | 'cleared' | 'suspected' | 'ruled';

export interface PublicPlayer {
  id: string;
  name: string;
  suspectId: string;
  isBot: boolean;
  connected: boolean;
  isHost: boolean;
  eliminated: boolean;
  eliminatedOnTurn?: number;
  pos: Position;
  /** Card count is public — card identities never are. */
  cardCount: number;
  seat: number;
}

export interface PlayerState extends PublicPlayer {
  hand: string[];
  notebook: Record<string, NotebookStamp>;
  notes: string;
  /** Every card this player has been shown or has shown (for their private log). */
  seenCards: string[];
  /** Set when an unrefuted theory proved all three cards sit in the envelope. */
  accusationReady?: { suspectId: string; weaponId: string; roomId: string } | null;
}

/** A token travelling across the board (pawn move or a teleported clue). */
export interface AnimEvent {
  seq: number;
  type: 'pawn' | 'weapon' | 'suspect';
  id: string;
  path: Position[];
  at: number;
}

export interface DisprovePrompt {
  id: string;
  /** Player who must answer. */
  playerId: string;
  suggesterId: string;
  suspectId: string;
  weaponId: string;
  roomId: string;
  options: string[];
}

export interface SuggestionRecord {
  id: string;
  turn: number;
  suggesterId: string;
  suspectId: string;
  weaponId: string;
  roomId: string;
  /** null while players are still being queried. */
  disproverId: string | null;
  revealedCardId: string | null;
  unrefuted: boolean;
}

/** Structured, fully-public record of every suggestion and who answered it. */
export interface QueryRecord {
  id: string;
  turn: number;
  suggesterId: string;
  suspectId: string;
  weaponId: string;
  roomId: string;
  /** Detectives queried, in clockwise order. */
  queried: string[];
  /** Detectives who held none of the three cards and passed. */
  passed: string[];
  disproverId: string | null;
  unrefuted: boolean;
  /** Card ids under scrutiny — public knowledge. */
  cards: string[];
}

export interface LogEntry {
  id: string;
  turn: number;
  t: number;
  kind:
    | 'system'
    | 'roll'
    | 'move'
    | 'passage'
    | 'suggest'
    | 'disprove'
    | 'unrefuted'
    | 'accuse'
    | 'reveal'
    | 'eliminate'
    | 'deal'
    | 'win';
  text: string;
  /** null = public to everyone. */
  visibleTo: string | null;
  /** Purely decorative tag used for colouring in the ledger. */
  tone?: 'neutral' | 'gold' | 'blood' | 'green' | 'blue';
}

/** One-shot modal payloads, keyed by a unique id so re-broadcasts never reopen them. */
export interface ModalPayload {
  id: string;
  kind: 'unrefuted' | 'solved' | 'eliminated' | 'deal';
  forPlayerId: string | null;
  data: Record<string, unknown>;
}

export interface GameState {
  code: string;
  createdAt: number;
  phase: Phase;
  turn: number;
  /** Total wall-clock ms of play, used only for the HUD. */
  startedAt: number | null;
  players: PlayerState[];
  /** Seat order defines the clockwise turn rotation (Miss Scarlet first). */
  turnIndex: number;
  dice: [number, number] | null;
  diceRolledAt: number | null;
  /** Reason the move phase is open (dice or secret passage). */
  moveSource: 'dice' | 'passage' | null;
  /** Nodes the active player is allowed to move to (computed at roll time). */
  legalMoves: { key: NodeKey; pos: Position; dist: number; path: Position[]; stay?: boolean }[];
  weaponLocations: Record<string, string>; // weaponId -> roomId
  /** Suspect tokens parked in rooms (teleported by suggestions). */
  suspectRooms: Record<string, string>; // suspectId -> roomId (suggested suspects)
  envelope: string[];
  suggestion: SuggestionRecord | null;
  pendingPrompt: DisprovePrompt | null;
  queries: QueryRecord[];
  modals: ModalPayload[];
  /** Modal ids each player has already closed — never reopened on re-broadcast. */
  dismissed: Record<string, string[]>;
  log: LogEntry[];
  winnerId: string | null;
  solvable: boolean;
  rngSeed: number;
  version: number;
  /** Monotonic id counter for logs, modals, prompts and suggestions. */
  seq: number;
  animSeq: number;
  animations: AnimEvent[];
  /** Private card reveals. `mask()` only hands these to the two parties involved. */
  reveals: {
    cardId: string;
    byId: string;
    toId: string;
    suggestionId: string;
    turn: number;
  }[];
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export type Action =
  | { type: 'START_GAME'; playerId: string }
  | { type: 'ROLL'; playerId: string }
  | { type: 'SECRET_PASSAGE'; playerId: string }
  | { type: 'MOVE'; playerId: string; to: Position }
  | { type: 'SUGGEST'; playerId: string; suspectId: string; weaponId: string }
  | { type: 'SKIP_SUGGEST'; playerId: string }
  | { type: 'DISPROVE'; playerId: string; promptId: string; cardId: string | null }
  | { type: 'ACCUSE'; playerId: string; suspectId: string; weaponId: string; roomId: string }
  | { type: 'SKIP_ACCUSE'; playerId: string }
  | { type: 'END_TURN'; playerId: string }
  | { type: 'DISMISS_MODAL'; playerId: string; modalId: string }
  | { type: 'SET_NOTE'; playerId: string; item: string; stamp: NotebookStamp }
  | { type: 'SET_SCRATCH'; playerId: string; text: string }
  | { type: 'CLAIM_SEAT'; playerId: string; suspectId?: string; name?: string }
  | { type: 'ADD_BOT'; playerId: string; suspectId?: string; name?: string }
  | { type: 'REMOVE_PLAYER'; playerId: string; targetId: string }
  | { type: 'REMATCH'; playerId: string };

export interface ActionOk {
  ok: true;
  state: GameState;
  events: EngineEvent[];
}
export interface ActionErr {
  ok: false;
  error: string;
}
export type ActionResult = ActionOk | ActionErr;

/** Host-local effect requests (timers, targeted reveals) produced by a reducer step. */
export type EngineEvent =
  | { type: 'wait'; ms: number; forPlayerId: string; hint: string }
  | { type: 'sfx'; name: string }
  | { type: 'turnChanged'; playerId: string };

/* ------------------------------------------------------------------ */
/* Network protocol                                                    */
/* ------------------------------------------------------------------ */

export interface MaskedPlayer extends PublicPlayer {}

export interface MaskedState {
  code: string;
  phase: Phase;
  turn: number;
  turnIndex: number;
  players: MaskedPlayer[];
  you: string;
  isHost: boolean;
  dice: [number, number] | null;
  moveSource: 'dice' | 'passage' | null;
  legalMoves: { key: NodeKey; pos: Position; dist: number; path: Position[]; stay?: boolean }[];
  weaponLocations: Record<string, string>;
  suspectRooms: Record<string, string>;
  hand: string[];
  notebook: Record<string, NotebookStamp>;
  notes: string;
  cardCounts: Record<string, number>;
  suggestion: SuggestionRecord | null;
  queries: QueryRecord[];
  /** Only populated for the player who must answer. */
  prompt: DisprovePrompt | null;
  /** Cards revealed to *you* (you suggested or you revealed). */
  reveals: { cardId: string; byId: string; toId: string; suggestionId: string; turn: number }[];
  modals: ModalPayload[];
  log: LogEntry[];
  envelope: string[] | null;
  winnerId: string | null;
  startedAt: number | null;
  version: number;
  animations: AnimEvent[];
  turnPlayerId: string | null;
  passageRoomId: string | null;
  accusationReady: { suspectId: string; weaponId: string; roomId: string } | null;
}
