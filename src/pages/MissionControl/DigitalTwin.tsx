import { Card } from '../../components/Card'

/* Patient Digital Twin — a purely DECORATIVE anatomical figure.
   -------------------------------------------------------------------
   VALIDATOR'S DECISION (safety): this card makes NO clinical claim and
   carries NO organ-level status colour. Earlier it coloured each organ
   from a SOFA sub-score (green/amber/red), which was dangerous: SOFA
   cardiovascular is MAP + vasopressors ONLY, so a clinically-bad heart
   with a normal MAP scored 0 and rendered a green "Stable" heart — a
   whole-organ wellness claim SOFA never makes. A status display that can
   show a wrong colour is worse than none. So the twin is now an
   attractive, neutral anatomical illustration ONLY. The HONEST clinical
   status lives on the score-backed surfaces that state their own
   definitions and contributors: the SOFA card, the NEWS2 card, the
   observation tiles, and the severity dot. This figure depends on no
   score and cannot mislead.

   Palette is a single aesthetic accent (the card's own cyan / steel
   tokens — NOT the green/amber/red clinical status family), so it reads
   as an illustration and adapts to light and dark themes. */

const ORGANS = ['Brain', 'Lungs', 'Heart', 'Liver', 'Kidneys'] as const

export function DigitalTwin() {
  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="3" /><path d="M12 8v5m0 0l-4 8m4-8l4 8M6 12h12" /></svg>}
      title="Patient Digital Twin" aside="anatomical illustration"
    >
      <div className="twin">
        <svg className="twinfig" viewBox="0 0 120 240" role="img"
          aria-label="Decorative anatomical illustration of the human body — an illustration only, not a clinical status display">
          <defs>
            <linearGradient id="twinBody" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(var(--steel2-rgb),.20)" />
              <stop offset="1" stopColor="rgba(var(--steel2-rgb),.05)" />
            </linearGradient>
            <radialGradient id="twinOrgan" cx="0.5" cy="0.4" r="0.7">
              <stop offset="0" stopColor="rgba(var(--cyan-rgb),.30)" />
              <stop offset="1" stopColor="rgba(var(--cyan-rgb),.12)" />
            </radialGradient>
          </defs>

          {/* body silhouette */}
          <g fill="url(#twinBody)" stroke="rgba(var(--steel3-rgb),.35)" strokeWidth="1.4" strokeLinejoin="round">
            <circle cx="60" cy="26" r="16" />
            <path d="M60 42c-14 0-22 8-24 20l-4 34c-1 8 2 12 6 12l2 44c0 6 3 10 8 10h24c5 0 8-4 8-10l2-44c4 0 7-4 6-12l-4-34c-2-12-10-20-24-20z" />
            <path d="M36 66l-10 40c-1 5 1 8 4 9l4 1 8-46" />
            <path d="M84 66l10 40c1 5-1 8-4 9l-4 1-8-46" />
            <path d="M50 162l-3 60c0 4 2 7 6 7h4l3-64" />
            <path d="M70 162l3 60c0 4-2 7-6 7h-4l-3-64" />
          </g>

          {/* decorative circulation ring — a gentle aesthetic accent */}
          <ellipse className="twinring" cx="60" cy="118" rx="30" ry="66" fill="none"
            stroke="rgba(var(--cyan-rgb),.35)" strokeWidth="1.6" strokeDasharray="3 8" strokeLinecap="round" />

          {/* organ glyphs — one cohesive illustrative treatment, no status colour */}
          <g className="twinorgans" fill="url(#twinOrgan)" stroke="rgba(var(--cyan-rgb),.45)" strokeWidth="1">
            <ellipse cx="60" cy="24" rx="10" ry="8" />
            <path d="M54 62c-8 0-12 8-12 18s3 16 9 16c4 0 6-4 6-10V68c0-4-1-6-3-6z" />
            <path d="M66 62c8 0 12 8 12 18s-3 16-9 16c-4 0-6-4-6-10V68c0-4 1-6 3-6z" />
            <path d="M60 74c3-4 9-4 11 0 2 3 1 7-3 11l-8 7-8-7c-4-4-5-8-3-11 2-4 8-4 11 0z" />
            <path d="M46 104c-5 1-8 5-7 10 1 4 5 6 11 5l16-4c4-1 5-5 3-8-3-4-14-5-23-3z" />
            <ellipse cx="48" cy="128" rx="5" ry="8" />
            <ellipse cx="72" cy="128" rx="5" ry="8" />
          </g>
        </svg>

        <div className="twinaside">
          <ul className="twinlabels">
            {ORGANS.map(o => (
              <li key={o}><span className="tldot" />{o}</li>
            ))}
          </ul>
          <p className="twinnote">
            Anatomical illustration — not a clinical status display. Read the
            patient's condition from the NEWS2 and SOFA cards, the observation
            tiles, and the labs.
          </p>
        </div>
      </div>
    </Card>
  )
}
