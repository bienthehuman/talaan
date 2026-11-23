# Docs index

Docs are the source of truth. Accepted before code; updated when the design changes.

| Doc | Purpose | Status |
|---|---|---|
| [BUILD_PLAN.md](BUILD_PLAN.md) | Phases, slices, baseline checklist, backlog | accepted |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, write path, auth, environments, known risks | accepted |
| [DATA_MODEL.md](DATA_MODEL.md) | Tables, local stores, sync state machine, correction path per write action | accepted |
| [ROLES.md](ROLES.md) | Roles × flow steps × submission status table | accepted |
| [protocol.md](protocol.md) | Push/pull contract, statuses, error classes, versioning | accepted |
| [failure-scenarios.md](failure-scenarios.md) | The twelve scenarios, planned tests, guarantees map | accepted |
| [CONVENTIONS.md](CONVENTIONS.md) | Git/PR rules, code style, API contract, testing | accepted |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Tokens, light/dark, station line, components, a11y (v2, Wayfinding Line) | accepted |
| [FORM_BUILDER_PLAN.md](FORM_BUILDER_PLAN.md) | Form builder: how admins build forms without JSON, safely; slices 6.0 to 6.5 | accepted |
| [REDESIGN_PLAN.md](REDESIGN_PLAN.md) | Why the UI is being redesigned, the chosen direction, slices 5.0 to 5.6 | accepted |
| [adr/](adr/README.md) | ADRs 0001–0013 | accepted |
| [diagrams/](diagrams/push-pull-lost-response.md) | Push/pull sequence with a lost response. Architecture diagram is in ARCHITECTURE.md; sync state machine is in DATA_MODEL.md. | accepted |
| [loadtest/](loadtest/README.md) | How the load test works, and the measured results and their conditions | accepted |
| [writeups/pull-gap.md](writeups/pull-gap.md) | Why a pull cursor needs the advisory lock, with the failing run | accepted |
| [media/](media/) | Demo clips recorded by `scripts/demo.sh` | generated |
