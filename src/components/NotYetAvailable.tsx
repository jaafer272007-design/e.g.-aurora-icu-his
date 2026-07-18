import './NotYetAvailable.css'

/** The honest not-yet state (Phase 3 PR 1, owner's decisions (a)+(b)):
 *  a domain that DOES NOT EXIST in this version says so explicitly. An
 *  empty consults/tasks/notes panel in a real hospital must never read
 *  as "nothing to do" — clinical absence — so this renders "Aurora does
 *  not record this yet", never a blank. Pass `what` as the domain noun
 *  phrase (e.g. "Consults", "The I&O worksheet").
 *
 *  Class prefix `nya-` is unique to this component — a component's
 *  classes must never share a prefix with a page's (the .al→.att and
 *  .uarow→.unrow collision lessons). */
export function NotYetAvailable({ what }: { what: string }) {
  return (
    <div className="nya-note" role="note">
      <span className="nya-badge">Not yet available</span>
      <p className="nya-text">
        {what} — not recorded in this version of Aurora. This panel is
        inactive until the domain is built; it is not an empty clinical
        record.
      </p>
    </div>
  )
}
