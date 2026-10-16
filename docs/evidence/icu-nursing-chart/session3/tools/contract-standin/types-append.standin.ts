
/* [SESSION-3 CONTRACT STAND-IN — appended to a SCRATCH copy of src/lib/api/types.ts only;
   contract §3.2 + Amendment 1 §9.1. Session 1 owns the real declarations.] */
export interface NursingOrderDraft {
  intervalMinutes?: number
}
export interface NursingRound {
  roundId: string
  number: number
  dueTime: string
}
export interface NursingCompletion {
  round: number
  roundId: string
  dueTime: string
  completedTime: string
  completedBy: string
  attemptId?: string
}
export interface NursingOrderDetails {
  intervalMinutes?: number
  completions: NursingCompletion[]
  currentRound?: NursingRound
}
export interface NursingImplementRequest {
  roundId: string
  attemptId: string
}
/* declaration merging (same module): Order / NewOrderDraft gain the optional field */
export interface Order {
  nursing?: NursingOrderDetails
}
export interface NewOrderDraft {
  nursing?: NursingOrderDraft
}
