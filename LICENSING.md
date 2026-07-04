# Peptide Pitstop — Licensing Model

*Finalised 2026-07-05. Sole copyright holder: Mitch Kavney ("the Owner").*

Peptide Pitstop is **open-core**: a freely self-hostable open-source core, plus a
proprietary paid layer the Owner licenses commercially. This document is the
authoritative map of what is licensed how.

## 1. The open core — AGPL-3.0-only

The free, self-hostable **web application** is licensed under **GNU AGPL-3.0-only**
(see `LICENSE`). This is the funnel; it is meant to be run, studied, modified, and
self-hosted freely.

**In the core (AGPL):** dose logging, protocols, titration, depletion forecast,
vial ledger + landed cost, bloodwork logging, Garmin sync, CSV/PDF export and
reports, the web UI, auth.

Why AGPL: its network-copyleft means anyone offering a modified hosted version
must publish their full source — a strong deterrent to closed-source SaaS
competition — while the Owner, holding all copyright, retains full freedom to
license the paid layer separately. The Owner's own hosted service satisfies AGPL
by publishing this core.

## 2. The proprietary layer — All Rights Reserved

The paid value is **not** in the core. It lives in separately-licensed,
**proprietary** modules kept in a private repository and delivered commercially:

**Proprietary (never AGPL):**
- the **server-side intelligence service** — biometric correlation, spend
  analytics, the PubMed literature engine + AI, and the personal API;
- the **license + billing** code;
- the **native iOS and Android apps**;
- the **managed Cloud** deployment;
- the **clinic / white-label** edition.

These are © the Owner, All Rights Reserved, and are provided to customers only
under the commercial end-user terms in `LICENSE-COMMERCIAL.md`.

### The open-core boundary (why the proprietary layer is a separate work)
The proprietary modules communicate with the AGPL core **only across a documented
API/IPC boundary** and do **not** import AGPL-licensed internals. They are an
independent work, not a derivative of the AGPL core, and are therefore not subject
to the AGPL. This boundary is a hard architectural rule (established in the P0
build): the intelligence layer runs *outside* the app, as a service the core
calls.

## 3. Sole ownership & dual-licensing

The Owner holds copyright to **all** first-party code. This is deliberate and
load-bearing: it preserves the right to (a) dual-license — ship the core under
AGPL while licensing the paid modules commercially — and (b) grant an exclusive
licence or sell the proprietary layer outright (the clinic-buyout path). To keep
that intact, **every outside contribution is CLA-gated** (§4).

## 4. Contributions — limited + CLA-gated

Outside contributions are **limited**. The public repository is not open to
unsolicited feature work; the maintainer may decline any contribution. See
`CONTRIBUTING.md`. Any contribution that *is* accepted requires a signed
Contributor License Agreement (`CLA.md`) assigning copyright to the Owner, so
sole ownership — and the dual-license / sale rights above — is never diluted.

## 5. Trademark

"Peptide Pitstop", its name and logo, are **reserved** (common-law; see
`TRADEMARK.md`). The code is open; the brand is not. Forks and redistributions
must use a different name and logo.

## 6. What this does — and does not — protect

- **Protects:** the paid modules (private + proprietary), the brand, and the
  Owner's freedom to dual-license or sell the proprietary layer exclusively.
- **Does not protect:** versions of the core already published under AGPL — those
  remain AGPL forever and cannot be made exclusive. The sellable exclusive value
  is the **proprietary layer + brand + expertise + clinic relationships**, not the
  already-open core.

## 7. Legal posture

These documents are practical, self-authored governance instruments, not
lawyer-reviewed contracts. The Owner has chosen not to commission paid legal at
this stage; an IP-counsel review is advisable before the first commercial sale or
any exclusive/buyout deal.

## Files
- `LICENSE` — AGPL-3.0-only (the core). *(already present)*
- `LICENSING.md` — this model.
- `CONTRIBUTING.md` — limited-contributions policy.
- `CLA.md` — Contributor License Agreement (copyright assignment).
- `TRADEMARK.md` — brand-use policy.
- `LICENSE-COMMERCIAL.md` — proprietary licence + end-user terms for the paid layer.
