import { useSyncExternalStore } from 'react';
import { store, type StoreView } from '../store/gameStore';
import { SUSPECT_BY_ID, SUSPECTS } from '@shared/constants.js';
import type { MaskedState, PlayerState, Position } from '@shared/types.js';
import { knowledgeFromMask, type Knowledge } from '@shared/deduction.js';

export function useStoreView(): StoreView {
  return useSyncExternalStore(store.subscribe, store.getView, store.getView);
}

export function useGame(): StoreView['meta'] & { state: MaskedState | null } {
  const view = useStoreView();
  return { ...view.meta, state: view.state };
}

export function useMe(state: MaskedState | null) {
  if (!state) return null;
  return state.players.find((p) => p.id === state.you) ?? null;
}

export function useIsMyTurn(state: MaskedState | null): boolean {
  if (!state) return false;
  return state.turnPlayerId === state.you;
}

export function useKnowledge(state: MaskedState | null): Knowledge | null {
  if (!state) return null;
  return knowledgeFromMask(state);
}

export function suspectOf(player: { suspectId: string }) {
  return SUSPECT_BY_ID[player.suspectId] ?? SUSPECTS[0];
}

export function initialsOf(name: string): string {
  const parts = name.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/);
  if (!parts.length) return '?';
  if (/^(miss|mrs|mr|dr|col|colonel|prof|professor|inspector|constable|sergeant|lady|mademoiselle)$/i.test(parts[0])) {
    return (parts[1]?.[0] ?? parts[0][0]).toUpperCase();
  }
  return parts[0][0].toUpperCase();
}

export function describePosition(pos: Position, roomName: (id: string) => string): string {
  return pos.kind === 'room' ? roomName(pos.roomId) : `corridor ${String.fromCharCode(65 + (pos.x % 26))}${pos.y + 1}`;
}

export type { PlayerState };
