# Security Policy

Peptide Pitstop is a **self-hosted** application that stores sensitive personal
health data. Security reports are taken seriously — please follow responsible
disclosure so issues can be fixed before they're made public.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via **GitHub Security Advisories**:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability** to open a private advisory.

If you can't use GitHub Security Advisories, contact the maintainer privately at
`security@example.com` (replace with your real contact if you fork this project).

When reporting, please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (a proof of concept is ideal).
- Affected version / commit, and your environment if relevant.

## Response expectations

This project is maintained by a **single maintainer on a best-effort basis**.
There is no SLA, but the goal is to:

- Acknowledge a valid report within a reasonable timeframe.
- Investigate and confirm the issue.
- Ship a fix and publish an advisory once a fix is available.

Please allow reasonable time for a fix before any public disclosure.

## Supported versions

Only the **latest `main`** is supported. Fixes are applied to `main`; there are
no backported security releases for older revisions. Self-hosters should keep
their deployment up to date.

## Self-hosting responsibilities

This software is provided **with no warranty**. You run it on **your own
infrastructure**, and you are responsible for the security of your deployment,
your data, and your backups. See the AGPL-3.0 license for the full disclaimer of
warranty and limitation of liability.

To protect the health data this app stores, at a minimum:

- **Set strong, unique secrets.** Generate cryptographically random values for
  `PT_FIELD_KEY` and `AUTH_SECRET` (see the README for how to generate them).
  Never reuse the example values, and never commit your real secrets.
- **Keep your database on an encrypted volume.** Sensitive fields and backups
  should live on encrypted storage (full-disk encryption or an encrypted
  volume).
- **Serve over HTTPS** and keep your reverse proxy / TLS configuration current.
- **Restrict access** to the app and database to trusted networks/users.
- **Keep dependencies and the app updated**, and apply security fixes promptly.
- **Back up regularly** and verify your backups are encrypted and restorable.

Treating the data as sensitive — because it is — is the single most important
thing you can do as a self-hoster.
