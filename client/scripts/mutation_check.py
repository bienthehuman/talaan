"""Plants deliberate bugs in the local layer and sync engine and requires a test to fail for each.

    cd client && python3 scripts/mutation_check.py        (a few minutes)

Exit 1 if a bug survives, 2 if a pattern went stale after a refactor (update the entry). Run it after
changing src/db/apply.ts or src/sync/. Restores every file, including on failure.
"""
import subprocess, sys
M=[
("takeBatch never stamps sentAt","src/db/apply.ts","if (entry.sentAt === null) {","if (false) {"),
("rebase even when someone else wrote","src/db/apply.ts","if (next.baseVersion + 1 === result.record.version) {","if (true) {"),
("pull ignores version guard","src/db/apply.ts","if (record.version <= row.serverVersion) continue;",""),
("batch cap 100","src/db/apply.ts","const MAX_BATCH = 50;","const MAX_BATCH = 100;"),
("several entries per record in one batch","src/db/apply.ts","if (seen.has(entry.recordId)) continue;",""),
("blocked records still sent","src/db/apply.ts","if (blocked.has(entry.recordId)) continue;",""),
("conflict drops the entry","src/db/apply.ts","    await db.outbox.update(entry.seq!, {\n      lastError:","    await db.outbox.delete(entry.seq!);\n    await db.outbox.update(entry.seq!, {\n      lastError:"),
("second engine runs anyway","src/sync/lock.ts","if (held.has(name)) return BUSY;",""),
("401 treated as transient","src/sync/classify.ts",'if (response.status === 401) return { kind: "auth", reason };','if (response.status === 401) return { kind: "transient", reason, retryAfterMs: 0 };'),
("Retry-After ignored","src/sync/classify.ts","retryAfterMs: Math.max(0, seconds) * 1000","retryAfterMs: 0"),
("backoff uncapped","src/sync/backoff.ts","Math.min(CAP_MS, BASE_MS * 2 ** Math.max(0, attempt - 1))","BASE_MS * 2 ** Math.max(0, attempt - 1)"),
("pull drops unsent edits","src/db/apply.ts","      const view = overlay(shadow, queued);\n      await db.submissions.put({\n        ...row,\n        ...view,\n        ...(restored","      const view = overlay(shadow, []);\n      await db.submissions.put({\n        ...row,\n        ...view,\n        ...(restored"),
("failed attempt not counted","src/db/apply.ts","attempts: current.attempts + 1","attempts: current.attempts"),
("push before nothing: pull skipped on cursor","src/sync/engine.ts","if (!page.has_more) return;","return;"),
("cursor not saved","src/db/apply.ts",'await db.meta.put({ key: "syncCursor", value: nextCursor });',''),
("retry resends with new ids (stamp resets)","src/db/apply.ts","      if (entry.sentAt === null) {\n        entry.sentAt = now;\n        await db.outbox.update(entry.seq!, { sentAt: now });\n      }","      entry.mutationId = crypto.randomUUID();\n      await db.outbox.update(entry.seq!, { sentAt: now, mutationId: entry.mutationId });"),
("unreachable refresh treated as logged out","src/sync/engine.ts",'if (outcome === "unreachable") {','if (false) {'),
("a 503 on refresh treated as logged out","src/auth/refresh.ts",'if (!response.ok || !access) return "unreachable";','if (!response.ok || !access) return "login-required";'),
("refresh requests not shared","src/auth/refresh.ts","inFlight ??= run().finally","inFlight = run().finally"),
("refresh forgets the refresh token","src/auth/refresh.ts","saveSession({ ...session, access });",'saveSession({ ...session, access, refresh: "" });'),
("re-login accepts a different person","src/auth/AuthContext.tsx","if (me.id !== current.id) throw new WrongUserError();",""),
("sign-out keeps the data","src/auth/AuthContext.tsx","void wipeUser(leaving);","void 0;"),
("401 after refresh does not pause","src/sync/engine.ts",'return this.fail({ kind: "auth", reason: "session_expired" });','return this.fail({ kind: "transient", reason: "x", retryAfterMs: 0 });'),
("form saves values the server would refuse","src/pages/SubmissionPage.tsx","if (!check[field.name]) void save(field, converted.value);","void save(field, converted.value);"),
("submit skips the required-field check","src/pages/SubmissionPage.tsx","validateRecord(definition, row!.data, { complete: true })","validateRecord(definition, row!.data, { complete: false })"),
("a refused value vanishes from the screen","src/pages/SubmissionPage.tsx","text !== undefined && sameValue(f, text, row.data[f.name])","text !== undefined"),
("submitted form stays editable","src/pages/SubmissionPage.tsx","disabled={locked !== null}","disabled={false}"),
("cancelled assignment can start inspections","src/pages/AssignmentsPage.tsx","{!assignment.cancelled && (","{true && ("),
("list shows deleted inspections","src/pages/AssignmentsPage.tsx",".filter((s) => !s.deleted)",""),
("required fields not enforced by the validator","src/forms/validate.ts","complete && field.required ? base : base.optional()","base.optional()"),
("integer accepts fractions",'src/forms/validate.ts','z.number().int({ error: "Enter a whole number." })','z.number()'),
("local changes wait for the next tick","src/sync/engine.ts","if (grew && navigator.onLine) {","if (false) {"),
("changes trigger sync while offline","src/sync/engine.ts","if (grew && navigator.onLine) {","if (grew) {"),
("resolution keeps the old base version","src/db/resolve.ts","const rebase = { fields, baseVersion: shadow.version };","const rebase = { fields, baseVersion: entry.baseVersion };"),
("resolution reuses the conflicted mutation id","src/db/resolve.ts","if (entry.seq === blocked.seq) await reissue(db, entry, rebase);","if (entry.seq === blocked.seq) await db.outbox.update(entry.seq!, rebase);"),
("a field given up is still sent","src/db/resolve.ts",".filter(([name]) => !giveUp.has(name)),",""),
("given-up fields only dropped from the first entry","src/db/resolve.ts","const emptied = entry.op === \"update\" && Object.keys(fields).length === 0;","const emptied = false;"),
("incomplete decisions accepted","src/db/resolve.ts","if (clashing.some((name) => choices[name] !== \"mine\" && choices[name] !== \"theirs\")) {","if (false) {"),
("restore does not re-queue the edits","src/db/apply.ts","        await reissue(db, queued[0]!);\n",""),
("restore re-queues under the old id","src/db/apply.ts","await reissue(db, queued[0]!);","await db.outbox.update(queued[0]!.seq!, { sentAt: null });"),
("keep-the-record leaves the delete queued","src/db/resolve.ts","      await db.outbox.delete(blocked.seq!);","      await db.outbox.update(blocked.seq!, { sentAt: null });"),
("delete anyway keeps the old base","src/db/resolve.ts","await reissue(db, blocked, { baseVersion: shadow.version });","await reissue(db, blocked);"),
("starting value forgotten after the first edit","src/db/submissions.ts","before: { ...prior, ...last.before }","before: { ...last.before, ...prior }"),
("a re-issued entry is not treated as new work","src/sync/engine.ts","`${e.seq}:${e.mutationId}`","`${e.seq}`"),
("work during a cycle waits for the next tick","src/sync/engine.ts","if (this.running) this.again = true;","if (this.running) return;"),
("own delete stays hidden while it is in conflict","src/db/apply.ts","          ? false\n          : row.deleted,","          ? row.deleted\n          : row.deleted,"),
("form stays editable during a conflict","src/pages/SubmissionPage.tsx",'if (row.syncState === "conflict") {\n    return "Your changes','if (false) {\n    return "Your changes'),
("choices can be applied half made","src/components/ConflictPanel.tsx","disabled={undecided.length > 0}","disabled={false}"),
("mine and theirs swapped on screen","src/components/ConflictPanel.tsx","Use theirs: {formatValue(field(f.field), f.theirs)}","Use theirs: {formatValue(field(f.field), f.mine)}"),
("header never counts decisions","src/sync/status.ts","conflicts: sync ? conflicts : 0,","conflicts: 0,"),
("delete anyway asks for nothing and keeps instead","src/components/ConflictPanel.tsx",'resolveEditedSinceBase(db, row.id, "delete")','resolveEditedSinceBase(db, row.id, "keep")'),
]
bad=0
for d,f,old,new in M:
    s=open(f).read()
    if old not in s: print("STALE",d); bad+=2; continue
    open(f,'w').write(s.replace(old,new,1))
    try:
        out=subprocess.run(["npx","vitest","run","--bail=1"],capture_output=True,text=True).stdout
    finally:
        open(f,'w').write(s)
    ok="failed" in out
    print(("caught   " if ok else "SURVIVED ")+d)
    bad+= 0 if ok else 1
sys.exit(1 if bad else 0)
