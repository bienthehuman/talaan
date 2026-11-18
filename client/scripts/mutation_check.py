"""Plants deliberate bugs in the local layer and sync engine and requires a test to fail for each.

    cd client && python3 scripts/mutation_check.py        (about 1 minute)

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
("pull drops unsent edits","src/db/apply.ts","      const view = overlay(shadow, queued);\n      await db.submissions.put({\n        ...row,\n        ...view,\n        // Deleted","      const view = overlay(shadow, []);\n      await db.submissions.put({\n        ...row,\n        ...view,\n        // Deleted"),
("failed attempt not counted","src/db/apply.ts","attempts: current.attempts + 1","attempts: current.attempts"),
("push before nothing: pull skipped on cursor","src/sync/engine.ts","if (!page.has_more) return;","return;"),
("cursor not saved","src/db/apply.ts",'await db.meta.put({ key: "syncCursor", value: nextCursor });',''),
("retry resends with new ids (stamp resets)","src/db/apply.ts","      if (entry.sentAt === null) {\n        entry.sentAt = now;\n        await db.outbox.update(entry.seq!, { sentAt: now });\n      }","      entry.mutationId = crypto.randomUUID();\n      await db.outbox.update(entry.seq!, { sentAt: now, mutationId: entry.mutationId });"),
]
bad=0
for d,f,old,new in M:
    s=open(f).read()
    if old not in s: print("STALE",d); bad+=2; continue
    open(f,'w').write(s.replace(old,new,1))
    try:
        out=subprocess.run(["npx","vitest","run","src/db","src/sync"],capture_output=True,text=True).stdout
    finally:
        open(f,'w').write(s)
    ok="failed" in out
    print(("caught   " if ok else "SURVIVED ")+d)
    bad+= 0 if ok else 1
sys.exit(1 if bad else 0)
