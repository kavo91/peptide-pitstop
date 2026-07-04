# Contributing to Peptide Pitstop

Thanks for your interest. Peptide Pitstop is **open-core** software maintained by a
single owner, so the contribution policy here is intentionally **limited** — please
read the policy section before opening a pull request.

## Local setup

Prerequisites: a recent Node.js LTS and npm. The core uses SQLite by default (see
`.env.example`).

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file
cp .env.example .env

# 3. Generate the two required secrets and add them to .env
#    (PT_FIELD_KEY and AUTH_SECRET — see .env.example for the generate commands)

# 4. Apply the database schema
npx prisma migrate dev

# 5. Seed demo data (BPC-157, TB-500, Ipamorelin, etc.)
npm run db:seed

# 6. Start the dev server
npm run dev
```

The seed data is fictional and exists only to give you something to look at —
**never commit real health data.**

## Running checks

Before proposing any change, make sure the suite and type checker pass:

```bash
npm test          # run the test suite
npm run typecheck # TypeScript type checking
```

If your change touches the schema, run `npx prisma migrate dev` and commit the
generated migration.

## Code style

- **TypeScript** — keep new code typed; avoid `any` where practical.
- Match the existing patterns in the surrounding files (naming, structure, layout).
- Keep changes small and focused — much easier on a solo maintainer.

## Contribution policy (please read)

Peptide Pitstop is maintained by a single owner under an open-core model. To keep
copyright clean and the roadmap coherent, **the project does not accept unsolicited
feature pull requests.** The maintainer may close any PR without merging, at their
sole discretion.

What is welcome:
- **Bug reports** and **security reports** — open an issue (for security, contact
  the maintainer privately; do not file a public issue).
- **Small, clearly-scoped fixes** — but only after raising them in an issue first
  and getting a maintainer's go-ahead. Please do not open a PR before that.

Large features, refactors, and new subsystems are handled by the maintainer.

## The CLA is mandatory

Any contribution the maintainer agrees to accept **must** be covered by a signed
**Contributor License Agreement** ([`CLA.md`](CLA.md)) *before* it is merged. The
CLA assigns copyright in your contribution to the project owner — this keeps the
project under single ownership, which its open-core / dual-license model requires.
**No CLA, no merge.** The CLA Assistant will prompt you on your PR. If you are not
comfortable assigning copyright, please don't submit code — a bug report is still
very welcome.

## Scope

This repository is the **open-source core** (AGPL-3.0-only). The paid, proprietary
modules (intelligence service, native apps, billing, Cloud, clinic edition) are not
part of this repository and are not open for contribution. See
[`LICENSING.md`](LICENSING.md) for the full model.
