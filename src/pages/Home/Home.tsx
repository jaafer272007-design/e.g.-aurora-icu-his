import { useNavigate } from 'react-router-dom'
import './Home.css'
import { AppHeader } from '../../components/AppHeader'
import { Card } from '../../components/Card'
import { NavSidebar, icuOverviewTargetOf, visibleGroupsFor } from '../../components/NavSidebar'
import { IconHome } from '../../components/icons'
import { useHospitalIdentity } from '../../lib/hospitalIdentity'
import { getSession, initialsOf, landingRouteOf, profileOf } from '../../lib/session'

/* THE HOSPITAL HOME — the default landing for every profile (hospital-shell
   design A3, the owner's 2026-08-23 front-door amendment): Aurora HIS opens
   on the HOSPITAL, never on a module. This is deliberately the SMALLEST
   HONEST launch surface: the configured hospital identity, the signed-in
   role, and links to exactly the areas this session can actually reach —
   rendered from the SAME ownership model and the SAME permission filter as
   the sidebar (visibleGroupsFor), so the two can never disagree.

   WHAT IT REFUSES TO BE (the amendment's own list): no fabricated counts,
   no ICU-only KPI presented as a hospital KPI (no KPI of any kind — a
   number here would need a real hospital-wide source, and none exists),
   no "coming soon" module advertising, no card for a screen this profile
   cannot open. The per-role LANDING concept the old "Dashboard" row
   carried survives as the "your workspace" entry below — personalized,
   offered, never an automatic redirect into a module. */

/* the workspace targets' human names — the same screens' own titles */
const WORKSPACE_LABEL: Record<string, string> = {
  '/workspace': 'Doctor Workspace',
  '/nurse': 'Nurse Workspace',
  '/admin': 'Unit Administration',
  '/admin/users': 'User Accounts',
  '/beds': 'ICU Beds',
}

export function Home() {
  const navigate = useNavigate()
  const session = getSession()
  const identity = useHospitalIdentity()
  if (!session) return null // RequireSession already redirects; belt only

  const workspace = landingRouteOf(session.jobTitle)
  /* the sidebar's own visibility model — Home shows the same rows the rail
     does, grouped by the same ownership, minus the Home row itself */
  const groups = visibleGroupsFor(session.jobTitle).filter(g => g.label !== null)

  return (
    <div className="app-frame hm">
      <AppHeader
        subtitle="Home"
        kpis={[]}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="home" footerLines={['Hospital-wide launch surface', 'Links only — nothing is computed here']} />

        <main>
          <Card className="hmlead" icon={<IconHome size={15} stroke="var(--cyan)" />} title="Aurora HIS"
            aside={identity?.configured ? identity.name : undefined}>
            <p className="hmintro">
              {/* the configured identity, through the one resolver — while
                  unset the sentence simply names the product (never a demo
                  hospital name and never the configure-me placeholder as if
                  it were one) */}
              {identity?.configured ? <><b>{identity.name}</b> — hospital information system.</> : 'Hospital information system.'}
              {' '}You are signed in as <b>{session.name}</b> ({session.jobTitle} — {profileOf(session.jobTitle)} profile).
              Everything below is an area your role can open; nothing here is a metric.
            </p>
            <button className="hmws" onClick={() => navigate(workspace)}>
              Your workspace — {WORKSPACE_LABEL[workspace] ?? workspace} →
            </button>
          </Card>

          <div className="hmgroups">
            {groups.map(g => (
              <Card key={g.label} className="hmgroup" title={g.label!} aside={g.ownership}>
                <div className="hmlinks">
                  {g.rows.map(r => {
                    const to = r.icuWorkspace ? icuOverviewTargetOf(session.jobTitle) : r.to
                    if (!to) return null
                    return (
                      <button key={r.key} className="hmlink" onClick={() => navigate(to)}>
                        {r.icon}
                        <span>{r.label}</span>
                      </button>
                    )
                  })}
                </div>
              </Card>
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}
