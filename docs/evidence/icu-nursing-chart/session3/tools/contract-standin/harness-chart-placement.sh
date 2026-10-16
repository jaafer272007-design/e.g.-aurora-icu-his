#!/bin/bash
# HARNESS-ONLY stand-in for Session 2's placement commit: mount PatientNurseCarePanel in the
# nurse's chart of a SCRATCH copy so both routes can be driven. Session 2 owns the real placement.
set -e
F=$DST/src/pages/MissionControl/MissionControl.tsx
python3 - "$F" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("import { useNavigate, useParams } from 'react-router-dom'",
 "import { useNavigate, useParams } from 'react-router-dom'\nimport { PatientNurseCarePanel } from '../../features/nurse-care/PatientNurseCarePanel'\nimport { profileOf as harnessProfileOf } from '../../lib/session'",1)
a="          {missing && <NotFoundCard />}\n"
assert a in s
s=s.replace(a, a+"          {session && (harnessProfileOf(session.jobTitle) === 'Nurse' || window.location.search.includes('s3panel=1')) && <div className=\"s3-harness-slot\" style={{ gridColumn: '1/-1' }}><PatientNurseCarePanel patientId={patientId} /></div>}\n",1)
open(p,'w').write(s)
PY
