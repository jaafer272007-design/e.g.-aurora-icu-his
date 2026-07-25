# AURORA ICU — Hospital Operations Runbook

**For the hospital IT person who looks after the Aurora server.**
You do not need to be a programmer to use this document. You do need to
follow it, because roughly half of what protects this hospital's patient
record cannot be automated — it depends on someone physically moving a disk
and physically guarding a key.

Print this. Keep a paper copy in the server room and a copy wherever your
on-call rota lives.

---

## 0. What Aurora protects, and what protects Aurora

Aurora stores the ICU's clinical record — patients, admissions, orders,
medications, lab and imaging results, nursing documentation. If that
database is lost and cannot be restored, the hospital has lost the record.

The software already does a lot on its own, every night:

- Takes a full backup of the database at **02:00**.
- Encrypts it, so a stolen disk is useless without the key.
- **Restores its own backup into a scratch database and compares every table**
  before it calls the backup good. A backup that cannot restore is reported
  as a failure, not filed as a success.
- Keeps **30 daily, 12 weekly, and 12 monthly** copies.
- Copies everything to the external disk, if one is configured.
- Shows all of this on the **Backup & Recovery** screen inside Aurora.

What the software **cannot** do:

- It cannot unplug a disk and carry it to another building.
- It cannot stop someone re-running the installer and destroying the key.
- It cannot remember a password that only lives in a person's head.
- It cannot phone you at 3 a.m.

Those four things are this runbook.

---

## 1. The five things that must always be true

If you read nothing else, read this. Everything in Part 3 exists to keep
these five true.

| # | Must be true | Why it matters |
|---|---|---|
| 1 | **Two external disks exist, and one of them is always unplugged and off the premises.** | The only real defence against ransomware, fire, and theft. |
| 2 | **The encryption key is written down in three separate places.** | Backups are useless without it. Nothing can recover a lost key. |
| 3 | **`AuroraSetup.exe` is NOT stored on the server.** | Re-running it generates a new key and orphans every existing backup. |
| 4 | **Someone knows a working Aurora username and password from the live system, recorded outside Aurora.** | After a restore onto a new machine, these are the only credentials that work. |
| 5 | **A named person is paged when the Backup screen stops saying HEALTHY.** | A backup that silently stops is the classic disaster. |

---

## 2. The Backup & Recovery screen

Log in to Aurora as a **System Administrator** and open **Backup &
Recovery**. This is the single place that tells you whether the hospital is
protected. Only the System Administrator role can see it — clinical staff
cannot, by design.

The screen shows one overall health state. Here is every state it can show,
what it means, and what you do:

| What it says | What it actually means | What you do |
|---|---|---|
| **HEALTHY** | Last night's backup succeeded, verified itself, and went off-site. | Nothing. Tick the daily checklist. |
| **NO BACKUP EXISTS YET** | This server has never produced a good backup. | **Stop and fix today.** The record is one disk failure from gone. Escalate immediately. |
| **NO SUCCESSFUL BACKUP IN _n_ HOURS** | The nightly job stopped running or keeps failing. Older backups are still fine. | Investigate today. See Part 6. |
| **The most recent backup attempt FAILED** | Last night broke. The previous good backup is intact. | Investigate today, before tonight. |
| **NO OFF-SITE COPY IS CONFIGURED** | Every backup is on this server only. One fire or one disk failure takes the database *and* every backup together. | Set up the external disk (Part 3). |
| **The most recent OFF-SITE COPY FAILED** | On-server backups are fine, but the disaster copy is not being made. | Check the disk is plugged in and healthy, today. |
| **NO OFF-SITE COPY IN _n_ DAYS** | Nobody plugged the rotated disk back in. This is the most common real-world failure. | Plug the next disk in today. |

**The off-site warning appears after 8 days without a successful copy.**
That is deliberately one week plus a day, so a weekly rotation does not
nag you but a forgotten disk is caught fast.

> **Read the words, not the colour.** "HEALTHY" is the only acceptable
> state. Anything else is a task with a date on it.

---

## 3. The external disk — the part only a human can do

### Why this is the important one

Encrypted backups on the server protect you against a disk dying. They do
**not** protect you against ransomware. Ransomware encrypts everything the
server can reach — including a backup folder on a second drive, including a
network share, including a USB stick that happens to be plugged in.

**A disk that is physically unplugged cannot be encrypted by anything.**

That is the whole defence. There is no software substitute for it in this
system, and there is no clever configuration that makes an always-connected
disk safe. If the off-site rotation stops happening, the hospital's
ransomware protection is gone, whatever the dashboard says about the
on-server copies.

Aurora helps in one specific way: the nightly copy to the external disk is
**add-only**. It writes new backup files and never overwrites or deletes a
file already on that disk. So if ransomware does encrypt the server's
backups in place, the nightly job will not faithfully push the ruined
versions over your last good off-site copies. That reduces the damage. It
does not replace unplugging the disk.

### What you need

- **Two external disks**, labelled clearly, e.g. `AURORA OFF-SITE A` and
  `AURORA OFF-SITE B`.
- A **location off the premises** — a different building, a bank box, a
  safe in a different wing. Not the room next to the server. Not a drawer
  in the server room.
- A **rotation log** — a sheet of paper or a spreadsheet. Sample in
  Appendix B.

### The weekly rotation, step by step

Do this on the same weekday every week. Pick one and stick to it.

1. Bring in the disk that has been off-site (say, **B**).
2. Open Aurora → **Backup & Recovery**. Confirm the screen says **HEALTHY**
   and that the newest backup in the list is from last night.
3. Unplug disk **A** from the server. Do this while nothing is copying —
   any time other than around 02:00 is fine.
4. Plug in disk **B**. Windows should give it the same drive letter. If it
   does not, the copy will silently stop — see Part 6.
5. Write both moves in the rotation log with the date and your name.
6. Take disk **A** off the premises to the agreed location.
7. **The next day**, check the Backup screen again. It should say HEALTHY
   with a fresh off-site copy. If it still says NO OFF-SITE COPY IN _n_
   DAYS, the new disk is not being written to — escalate.

Step 7 is the one people skip. Skipping it means you find out the rotation
has been broken for a month on the day you need the disk.

### Never do these

- Never leave both disks plugged in "so we don't forget".
- Never keep the off-site disk in the server room.
- Never use the same disk indefinitely without rotating.
- Never store `AuroraSetup.exe` on either the server or the backup disks
  (see Part 4).

---

## 4. The encryption key

### What it is

Every backup file is encrypted. The key is a long string of characters
stored in a file on the server. **Without it, every backup is permanently
unreadable — by you, by the vendor, by anyone.** There is no master key,
no recovery service, and no back door. This is deliberate: it is what makes
a stolen backup disk harmless.

### The key ID is not the key

Aurora displays a short **key ID** — eight characters, e.g. `a3f91c04`. That
is a fingerprint, not the key. It is safe to write in a ticket, read out on
the phone, or put in an email. It tells you *which* key a backup needs.

**The key itself must never be emailed, messaged, put in a ticket, or
photographed and left on a phone.**

### Three copies, three places

The key must exist in **three separate places**, and they must not all be
in the same building:

1. **On the server** — the file Aurora uses. This one is automatic.
2. **In the hospital's password manager or IT safe** — sealed envelope,
   signed and dated across the seal.
3. **Off-site, with the rotated disk or in a separate safe** — held by
   someone in management, not only by IT.

Copy 3 is the one that matters. Copies 1 and 2 are both inside a building
that could burn down.

### Rules

- **Aurora can never show you an existing key again.** It is displayed
  exactly once, when it is first created or rotated. If you did not write
  it down then, it is gone from everywhere except the key file itself.
- **Do not press "Rotate key" to find out what the key is.** Rotating
  *generates a new one* and every backup made with the old key becomes
  unreadable unless you still have the old key written down. Aurora will
  warn you how many existing backups would be orphaned — read that number
  before confirming.
- **When you do rotate**, update all three copies the same day, record the
  new key ID in the site record (Appendix A), and keep the old key —
  clearly marked as retired and with the date — for as long as any backup
  encrypted with it still exists.

---

## 5. Keep `AuroraSetup.exe` off the server

The installer is not a maintenance tool. Store it on the IT file share or
a locked-away USB, **not on the Aurora server and not on the backup
disks**.

The concrete reason: **a fresh install generates a brand-new encryption
key.** Someone re-running the installer to "repair" or "reinstall" Aurora
will produce a server that cannot read a single one of the hospital's
existing backups. The database might be fine and every backup still be
unreadable. This is a real way to lose the record without anything
appearing to break.

If Aurora needs repairing, the answer is almost never to re-run the
installer. Raise it with the vendor first.

---

## 6. Knowing a login before you need one

**This is the failure that catches people during a real disaster.**

Restoring a backup replaces the entire database — including the user
accounts. Every username and password in the restored system comes from
the backup, not from the machine you restored onto.

So if the server is destroyed and you install Aurora on a replacement
machine and restore last night's backup:

- The new install's own starting administrator account **is wiped by the
  restore**.
- The only logins that work are the ones that existed in the old system.
- If nobody remembers a working System Administrator username and
  password from the old server, you have a fully restored database that
  **nobody can log in to**.

### What to do about it, now, before you need it

Record one working System Administrator username and password in the same
sealed envelope as the encryption key. Treat it exactly like the key:
three places, off-site copy, never emailed.

Re-check it whenever that person's password changes, and whenever staff
leave. A credential recorded three years ago that no longer works is the
same as no credential at all.

### Also needed for a restore onto a new machine

Have these together, in one place, before you start:

- The backup file **and** its manifest file — both, with matching names.
  Aurora refuses to restore without the manifest, because the manifest is
  what it checks the restore against.
- The **encryption key** for that backup (match the key ID shown next to
  the file).
- A **working old username and password**, as above.
- The hospital's **time zone**, so the restored server shows the same clock.

---

## 7. Verify and Test Restore

A backup nobody has ever restored is a hope, not a backup. Aurora gives you
two checks, both safe to run at any time on a live system.

### Verify — quick, weekly

Decrypts the backup, checks it has not been corrupted, and confirms it
matches its manifest. Takes seconds. Does not touch the live database.

Use it as the weekly heartbeat.

### Test Restore — the real proof, monthly

Actually restores the backup into a **separate scratch database** and
compares every table's row count and content against what was recorded
when the backup was taken. It then throws the scratch copy away.

**Your live database is never touched.** This is the check that proves
the backup would actually work.

A good result shows every table as **MATCH / MATCH**. Anything else means
that backup is suspect — try another one, and escalate.

### Which file to test

Once a month, run Test Restore on a backup you have **taken from the
off-site disk**, not one sitting on the server. That tests the whole
chain: the disk, the copy, the file, and the key — which is what you will
actually be relying on.

### The full drill — once a year

Once a year, restore onto a **different machine** and log in. This is the
only exercise that proves the credential in your envelope still works and
that the key you wrote down is the right one. Schedule it. Write down what
happened.

---

## 8. Who gets paged

Fill this in. A runbook with blanks here does not work.

| Condition | Seen where | Who is contacted | How fast |
|---|---|---|---|
| Backup screen not HEALTHY | Aurora → Backup & Recovery | ____________________ | Same working day |
| NO BACKUP EXISTS / no successful backup in 24h | Aurora → Backup & Recovery | ____________________ | **Immediately** |
| Off-site copy failed or stale | Aurora → Backup & Recovery | ____________________ | Same working day |
| Off-site rotation missed 2 weeks running | Rotation log | ____________________ + management | Escalate |
| Test Restore shows any mismatch | Aurora → Backup & Recovery | ____________________ + vendor | **Immediately** |
| Server will not start / suspected ransomware | — | ____________________ + management | **Immediately — do not reboot repeatedly, do not reinstall** |

**If you suspect ransomware:** unplug the server from the network, do
**not** plug in any external disk, and do not re-run the installer. The
off-site disk is the recovery path and it must stay untouched until
someone competent has looked at the server.

The named person here should not be "IT". It should be a human being with
a phone number.

---

## 9. The checklist

### Every working day — 2 minutes

- [ ] Open Aurora → **Backup & Recovery**.
- [ ] Health says **HEALTHY**.
- [ ] The newest backup is from **last night**.
- [ ] If anything else — start Part 6 escalation the same day.

### Every week

- [ ] **Rotate the external disk** (Part 3). Log it.
- [ ] **The day after rotating**, confirm the off-site copy succeeded on
      the new disk.
- [ ] Run **Verify** on the newest backup.
- [ ] Check free disk space on the drives holding the database and the
      backups.

### Every month

- [ ] Run **Test Restore** on a backup taken **from the off-site disk**.
      Confirm every table reads MATCH / MATCH.
- [ ] Confirm the backup list still holds roughly 30 daily / 12 weekly /
      12 monthly copies.
- [ ] Confirm the recorded administrator username and password still work
      — actually log in with them.
- [ ] Confirm the sealed key envelopes are all still where they should be,
      all three, still sealed.

### Every quarter

- [ ] Walk to where the off-site disk is kept and confirm it is there.
- [ ] Confirm the key ID written in the site record matches the key ID
      shown on the Backup screen.
- [ ] Review the paged-person list in Part 8 — people change jobs.

### Every year

- [ ] Full restore drill onto a different machine, logging in with the
      recorded credential (Part 7).
- [ ] Update this document with anything that turned out to be wrong.

---

## 10. Honest limits

Things this system does **not** do. Do not assume otherwise.

- **It does not monitor itself when nobody looks.** Aurora shows the
  warning on the Backup screen. It does not send email, SMS, or pages.
  Someone opening that screen daily *is* the alerting system.
- **Off-site protection is entirely manual.** No software checks that the
  disk actually left the building. The dashboard only knows whether a copy
  happened, not where the disk is.
- **The key cannot be recovered.** Lost key, lost backups. There is no
  exception to this.
- **It does not warn you before the disk fills up.** Watch free space in
  the weekly check.
- **Backups retained for months are not continuously re-checked.** Only
  the newest one is proven each night. Slow, quiet corruption in an older
  backup is caught by your monthly Test Restore and not before — which is
  the reason the monthly check is on the list.
- **A backup taken after bad data was entered contains the bad data.**
  Backups protect against loss, not against mistakes. Noticing a data
  problem early is what lets you go back to a copy from before it.

---

## Appendix A — Site record

Fill in and keep with the sealed key envelope. Do **not** write the
encryption key itself on this sheet.

```
Hospital / unit        : ______________________________________
Aurora server name     : ______________________________________
Server location        : ______________________________________
Address staff use      : http://__________________ : __________
Database location      : ______________________________________
Backup location        : ______________________________________
Off-site disk labels   : ______________________  /  ____________
Off-site storage place : ______________________________________
Key ID (8 characters)  : ______________________________________
Key envelope 1 held by : ______________________________________
Key envelope 2 held by : ______________________________________
Key envelope 3 held by : ______________________________________
Admin username recorded: ______________________________________
Time zone              : ______________________________________
Rotation weekday       : ______________________________________
Installed version      : ______________________________________
Vendor contact         : ______________________________________
Last full restore drill: ______________________________________
```

## Appendix B — Disk rotation log

```
Date        Disk IN   Disk OUT   Off-site confirmed   Next-day check OK   Name
__________  ________  _________  __________________   _________________   ________
__________  ________  _________  __________________   _________________   ________
__________  ________  _________  __________________   _________________   ________
__________  ________  _________  __________________   _________________   ________
```

## Appendix C — What each backup file is

Every backup produces three files with the same name. **Keep them
together — a backup file without its manifest cannot be restored.**

| File | What it is |
|---|---|
| `aurora-<date>.aurbk` | The encrypted database. Useless without the key. |
| `aurora-<date>.manifest.json` | What the backup should contain. **Required for restore.** Contains no patient data. |
| `aurora-<date>.aurbk.sha256` | A fingerprint for spotting a damaged file. |
| `LAST_BACKUP_STATUS` | One line saying how the last run went. One per folder, overwritten nightly. |

---

*Numbers in this document (02:00 nightly, 24-hour backup warning, 8-day
off-site warning, 30/12/12 retention) are the values Aurora ships with. If
your site changed them, correct this document to match.*
