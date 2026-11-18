// Simulated devices syncing against the real API (docs/loadtest/README.md).
//
// One virtual user is one device: its own login (loadtest001, ...), its own device id, its own
// records. Each iteration is one sync cycle, as the real client does it: push a small batch of
// mutations, then pull until caught up, then wait `THINK` seconds.
//
//   k6 run -e BASE=http://127.0.0.1:8080 -e VUS=50 -e DURATION=60s -e THINK=1 devices.js
//
// Devices only touch their own records, so there are no conflicts: this measures the write path
// (one advisory lock, ADR 0005) and the pull path, not conflict handling.
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE || "http://127.0.0.1:8080";
const THINK = Number(__ENV.THINK ?? 1);
const PASSWORD = __ENV.PASSWORD || "loadtest-password-1";
const MAX_RECORDS = 15; // per device, so a long run does not grow one device without limit

export const options = {
  scenarios: {
    devices: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 50),
      duration: __ENV.DURATION || "60s",
      gracefulStop: "10s",
    },
  },
  thresholds: {
    // Not a pass mark for the project, only a sanity floor: errors would mean the run measured nothing.
    http_req_failed: ["rate<0.01"],
    // These never fail; declaring them makes k6 report the push and pull timings separately.
    "http_req_duration{name:push}": ["max>=0"],
    "http_req_duration{name:pull}": ["max>=0"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const mutations = new Counter("mutations_sent");
const applied = new Counter("mutations_applied");
const conflicts = new Counter("mutations_conflict");
const rejected = new Counter("mutations_rejected");
const cycle = new Trend("sync_cycle_ms", true);

// Per-device state lives in module scope: k6 gives every VU its own copy.
let device = null;

function uuid() {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[8 + Math.floor(Math.random() * 4)];
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

function json(token, extra = {}) {
  return {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Client-Schema": "1",
      "X-Device-Id": device ? device.id : "",
      ...extra,
    },
  };
}

function start() {
  const username = `loadtest${String(__VU).padStart(3, "0")}`;
  const login = http.post(
    `${BASE}/api/auth/token/`,
    JSON.stringify({ username, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" }, tags: { name: "login" } },
  );
  if (!check(login, { "login works": (r) => r.status === 200 })) return null;
  const token = login.json("access");
  const assignments = http.get(`${BASE}/api/assignments/`, {
    headers: { Authorization: `Bearer ${token}`, "X-Client-Schema": "1" },
    tags: { name: "assignments" },
  });
  const assignment = assignments.json("results.0.id");
  return { id: uuid(), token, assignment, records: [], cursor: 0 };
}

function nextMutation() {
  const canCreate = device.records.length < MAX_RECORDS;
  if (canCreate && (device.records.length === 0 || Math.random() < 0.25)) {
    const id = uuid();
    device.records.push({ id, version: 0, pending: true });
    return {
      mutation_id: uuid(),
      record_id: id,
      op: "create",
      base_version: 0,
      assignment_id: device.assignment,
      fields: { oil_level: "ok", hours_run: Math.floor(Math.random() * 500) },
    };
  }
  // Only records whose create has been answered can be updated (version known).
  const ready = device.records.filter((r) => !r.pending && r.version > 0);
  if (ready.length === 0) return null;
  const record = ready[Math.floor(Math.random() * ready.length)];
  const fields =
    Math.random() < 0.5
      ? { notes: `note ${Math.floor(Math.random() * 1e6)}` }
      : { hours_run: Math.floor(Math.random() * 500), oil_pressure_psi: 20 + Math.random() * 60 };
  return {
    mutation_id: uuid(),
    record_id: record.id,
    op: "update",
    base_version: record.version,
    fields,
  };
}

export default function () {
  if (device === null) {
    device = start();
    if (device === null) {
      sleep(5);
      return;
    }
    // Phones do not all start at the same instant: spread the first sync cycles over two think
    // times, so a run is not dominated by 50 devices arriving together.
    if (THINK > 0) sleep(Math.random() * THINK * 2);
  }
  const began = Date.now();

  // Push a batch of 1 to 4 mutations. A record appears at most once per batch, as the real client sends it.
  const batch = [];
  const touched = new Set();
  const size = 1 + Math.floor(Math.random() * 4);
  for (let i = 0; i < size; i++) {
    const m = nextMutation();
    if (m && !touched.has(m.record_id)) {
      touched.add(m.record_id);
      batch.push(m);
    }
  }
  if (batch.length > 0) {
    const res = http.post(
      `${BASE}/api/sync/push/`,
      JSON.stringify({ device_id: device.id, client_schema: 1, app_version: "k6", mutations: batch }),
      { ...json(device.token), tags: { name: "push" } },
    );
    mutations.add(batch.length);
    if (check(res, { "push 200": (r) => r.status === 200 })) {
      for (const result of res.json("results")) {
        const mine = device.records.find((r) => r.id === (result.record && result.record.id));
        if (result.status === "applied") {
          applied.add(1);
          if (mine) {
            mine.version = result.record.version;
            mine.pending = false;
          }
        } else if (result.status === "conflict") {
          conflicts.add(1);
          if (mine) mine.version = result.record.version;
        } else {
          rejected.add(1);
        }
      }
    }
  }

  // Pull until caught up.
  for (let page = 0; page < 20; page++) {
    const res = http.get(`${BASE}/api/sync/pull/?cursor=${device.cursor}&limit=200`, {
      ...json(device.token),
      tags: { name: "pull" },
    });
    if (!check(res, { "pull 200": (r) => r.status === 200 })) break;
    device.cursor = res.json("next_cursor");
    if (!res.json("has_more")) break;
  }

  cycle.add(Date.now() - began);
  if (THINK > 0) sleep(THINK * (0.5 + Math.random()));
}
