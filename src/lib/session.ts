/* Session stub — replaced by the Login / Role-Switch screen at Stage 9.
   Screens read the role from here so real auth is a single-point swap.
   RBAC (locked decision): doctors acknowledge results; nurses view only. */

export type SessionRole = 'physician' | 'nurse'

export interface Session {
  role: SessionRole
  actor: string
}

export const CURRENT_SESSION: Session = { role: 'physician', actor: 'Dr. S. Rahman' }

export const canAcknowledgeResults = (role: SessionRole): boolean => role === 'physician'
