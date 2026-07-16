/* Conversation memory for the AI grounded query chat — the FLAGGED policy
   (design §8), stated: memory is (question, selected tool) pairs ONLY —
   never tool results, so patient data never re-enters the model path.
   It lives in this module (in-tab, survives in-app navigation), the last
   6 pairs ride to the translation endpoint, and it is CLEARED ON SIGN-OUT
   (src/lib/session.ts — the patient-context/preferences discipline) and
   on a hard refresh. Nothing is ever persisted. */

export interface ChatTurn {
  question: string
  /** the tool the model selected — null when unanswerable / failed */
  tool: string | null
}

let turns: ChatTurn[] = []

/** the last 6 turns — the exact window the wire contract allows */
export const chatHistory = (): ChatTurn[] => turns.slice(-6)

export function pushChatTurn(turn: ChatTurn): void {
  turns = [...turns, turn].slice(-24)
}

export function clearChatMemory(): void {
  turns = []
}
