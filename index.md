---
layout: default
title: Peptide Pitstop
---

Track your peptide therapy with precision — dosing, protocols, bloodwork, and analytics — all running on hardware you control.

![Peptide Pitstop — Today dashboard](docs/screenshots/today.png)

## Your data never leaves your server

Peptide Pitstop is self-hosted by design. There is no cloud account, no third-party analytics, and no telemetry. Your regimen, lab results, and history live in a database on your own machine. You decide who can reach it and how it's backed up. Open-source and auditable, top to bottom.

## Feature highlights

- **Dosing engine** — Calculate reconstitution, draw volumes, and per-dose units from concentration and target dose. No more manual math at the bench.
- **Protocols & titration** — Build multi-week protocols with ramp-up, hold, and taper phases. Track cycles for peptides like BPC-157, TB-500, and Ipamorelin.
- **Bloodwork** — Log lab panels over time, flag out-of-range markers, and see how results track against your protocol timeline.
- **Analytics & plasma curves** — Visualise estimated plasma concentration, adherence, and trends across your dosing history.
- **Integrations** — Optional wearable sync brings activity and recovery context alongside your regimen.
- **PWA** — Installs to your phone or desktop and works offline, so logging a dose takes seconds wherever you are.

![Analytics — adherence, heatmap, and plasma-level estimates](docs/screenshots/analytics.png)

## Self-host it

Deployment is a single container. Bring your own database file, point a reverse proxy at it, and you're running. Full setup steps — Docker, environment variables, and demo seed data — are in the repository README.

➡️ [Read the setup guide in the README](https://github.com/kavo91/peptide-pitstop#readme)

The bundled demo seed ships with example peptides (BPC-157, TB-500, Ipamorelin) so you can explore the interface before entering any of your own data.

## Get started

- [View on GitHub](https://github.com/kavo91/peptide-pitstop)
- [Setup & documentation](https://github.com/kavo91/peptide-pitstop#readme)

---

If Peptide Pitstop is useful to you, you can support development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-FFDD00?logo=buymeacoffee&logoColor=000)](https://buymeacoffee.com/peptidepitstop)

> Peptide Pitstop is a tracking tool, not medical advice. Consult a qualified clinician before starting or changing any therapy.
