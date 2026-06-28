# Contributing to Peptide Pitstop

Thanks for your interest in contributing! Peptide Pitstop is a self-hosted health
tracking app maintained by a single person, so a little coordination goes a long
way. This guide covers local setup, testing, and the contribution policy.

## Local setup

Prerequisites: a recent Node.js LTS, npm, and a Postgres database (or whatever
the README specifies for your environment).

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file
cp .env.example .env

# 3. Generate the two required secrets and add them to .env
#    (see the README for the exact commands — you'll need values for
#    PT_FIELD_KEY and AUTH_SECRET)

# 4. Apply the database schema
npx prisma migrate dev

# 5. Seed demo data (BPC-157, TB-500, Ipamorelin, etc.)
npm run db:seed

# 6. Start the dev server
npm run dev
```

The app should now be available locally. The seed data is fictional and exists
only to give you something to look at — never commit real health data.

## Running checks

Before opening a PR, make sure the test suite and type checker pass:

```bash
npm test          # run the test suite
npm run typecheck # TypeScript type checking
```

If your change touches the database schema, run `npx prisma migrate dev` and
commit the generated migration.

## Code style

- Written in **TypeScript** — keep new code typed; avoid `any` where practical.
- Follow the existing patterns in the surrounding files (naming, structure,
  component layout). When in doubt, match what's already there.
- Keep changes focused. Small, reviewable PRs are much easier on a solo
  maintainer than large mixed ones.

## Contribution policy

- **Open an issue first for anything large.** For small fixes (typos, obvious
  bugs, doc tweaks) a direct PR is fine. For new features, refactors, or
  anything that changes behaviour, please open an issue to discuss the approach
  before writing the code — it saves everyone time.
- **License.** This project is licensed under **AGPL-3.0**. By contributing, you
  agree that your contributions are licensed under AGPL-3.0 as well.
- **Contributor agreement.** A lightweight CLA or contributor agreement may be
  requested before larger contributions are merged. If so, it'll be raised on
  the relevant issue or PR.

## A note on scope

This is a hobby project run by one maintainer in spare time. Reviews may take a
while, and not every feature request will be a fit for the project's direction.
That's not a reflection on your idea — just the realities of a single-maintainer
codebase. Thanks for understanding, and thanks again for contributing!
