# Self-hosting Peptide Pitstop on a Synology NAS

[Peptide Pitstop](https://peptidepitstop.com) is a free, open-source, self-hosted
peptide & GLP-1 tracker. This guide installs it on a Synology NAS using the public,
multi-arch image `ghcr.io/kavo91/peptide-pitstop:latest` (works on both Intel/AMD
and ARM Synology models).

There is **no Synology third-party app store** for arbitrary Docker images, so the
supported path is **Container Manager** (DSM 7.2+) or the older **Docker** package.

- [What you'll end up with](#what-youll-end-up-with)
- [Before you start: generate two secrets](#before-you-start-generate-two-secrets)
- [Option A — DSM 7.2+ (Container Manager, recommended)](#option-a--dsm-72-container-manager-recommended)
- [Option B — Older DSM (Docker package)](#option-b--older-dsm-docker-package)
- [First run — the setup wizard](#first-run--the-setup-wizard)
- [Updating](#updating)
- [Backups](#backups)
- [Optional: publish over the internet (Cloudflare Tunnel)](#optional-publish-over-the-internet-cloudflare-tunnel)
- [Troubleshooting](#troubleshooting)

---

## What you'll end up with

- One container, `peptide-pitstop`, listening on **port 3000**.
- All data (the SQLite database) lives in the Synology shared folder
  `docker/peptide-pitstop` → mounted into the container at `/data`. Back this up.
- Reachable at **`http://<your-NAS-IP>:3000`** on your LAN.

---

## Before you start: generate two secrets

The app needs two secrets. Generate them once and keep them safe.

If you have SSH/Terminal access to the NAS (Control Panel → Terminal & SNMP →
enable SSH), or on any Mac/Linux machine:

```bash
openssl rand -base64 32     # → PT_FIELD_KEY  (AES-256-GCM field encryption key)
openssl rand -base64 48     # → AUTH_SECRET   (session cookie signing secret)
```

On Windows (PowerShell):

```powershell
[Convert]::ToBase64String((1..32 | % {Get-Random -Max 256}))   # PT_FIELD_KEY
[Convert]::ToBase64String((1..48 | % {Get-Random -Max 256}))   # AUTH_SECRET
```

> **Save `PT_FIELD_KEY` in a password manager.** If you ever lose or change it,
> every encrypted field already in your database becomes permanently unreadable.

---

## Option A — DSM 7.2+ (Container Manager, recommended)

Container Manager is Synology's renamed Docker package and is the only path that
gives you a managed **Project** built from a `docker-compose.yml`.

### 1. Create the data folder

1. Open **File Station**.
2. If you don't already have a shared folder named **`docker`**, create one
   (Control Panel → Shared Folder → Create → name it `docker`).
3. Inside `docker`, create a folder named **`peptide-pitstop`**.
   (You can skip this — Container Manager will create the path on first build —
   but creating it yourself lets you set permissions up front.)

### 2. Create the Project

1. Open **Container Manager** → left sidebar → **Project** → **Create**.
2. **Project name:** `peptide-pitstop`
3. **Path:** click *Set Path* / *Browse* and choose **`/docker/peptide-pitstop`**
   (DSM shows it as `/volume1/docker/peptide-pitstop`). This is where the
   compose file is stored.
4. **Source:** choose **Create `compose.yml`**.
5. Open [`docker-compose.yml`](./docker-compose.yml) from this folder, copy its
   entire contents, and **paste** it into the editor.
6. **Edit the two REQUIRED values** in the pasted text:
   - replace `REPLACE_WITH_openssl_rand_base64_32` with your `PT_FIELD_KEY`
   - replace `REPLACE_WITH_openssl_rand_base64_48` with your `AUTH_SECRET`
   - (optional) set `TZ` to your timezone, e.g. `Europe/London`.
   - leave `COOKIE_SECURE=false` — you're using plain `http://...:3000`.
7. Click **Next**. Container Manager may offer to enable a **web portal / reverse
   proxy** — you can skip this; just click **Next**.
8. Click **Done**. Container Manager pulls `ghcr.io/kavo91/peptide-pitstop:latest`
   and starts the container. First pull takes a minute or two.

### 3. Confirm it's running

- **Project** tab → `peptide-pitstop` should show **Running**.
- **Container** tab → `peptide-pitstop` container is green.
- Browse to **`http://<your-NAS-IP>:3000`** → continue to
  [First run](#first-run--the-setup-wizard).

> The compose file deliberately has **no `version:` key** — it's obsolete in
> Compose v2 (what Container Manager runs) and only prints a warning.

---

## Option B — Older DSM (Docker package)

Older DSM (6.x / 7.0 / 7.1) ships the legacy **Docker** package, which has **no
Project/compose UI**. Use one of these two routes.

### B1. Run the image from the Docker GUI (no compose)

1. **Docker** → **Registry** → the GUI Registry can only browse Docker Hub, so it
   can't reach GHCR. Pull the GHCR image once over SSH (see B2 step 1) first.
2. After the image is pulled, **Docker → Image → Launch**, then:
   - **Volume:** add a folder mount — File path `docker/peptide-pitstop`,
     Mount path `/data`.
   - **Port Settings:** Local port `3000` → Container port `3000` (TCP).
   - **Environment:** add `PT_FIELD_KEY`, `AUTH_SECRET`,
     `DATABASE_URL=file:/data/peptides.db`, and `COOKIE_SECURE=false`
     (plus optional `TZ`).
   - Enable **auto-restart**. Apply → Next → Done.

### B2. Run via SSH + Docker CLI (most reliable on old DSM)

1. Enable SSH (Control Panel → Terminal & SNMP → **Enable SSH service**), then
   SSH in and pull the public image:

   ```bash
   sudo docker pull ghcr.io/kavo91/peptide-pitstop:latest
   ```

2. Create the data folder and start the container:

   ```bash
   sudo mkdir -p /volume1/docker/peptide-pitstop

   sudo docker run -d \
     --name peptide-pitstop \
     --restart unless-stopped \
     -p 3000:3000 \
     -v /volume1/docker/peptide-pitstop:/data \
     -e PT_FIELD_KEY='PASTE_YOUR_base64_32_KEY' \
     -e AUTH_SECRET='PASTE_YOUR_base64_48_SECRET' \
     -e DATABASE_URL='file:/data/peptides.db' \
     -e COOKIE_SECURE=false \
     -e TZ='America/New_York' \
     ghcr.io/kavo91/peptide-pitstop:latest
   ```

3. Browse to `http://<your-NAS-IP>:3000`.

> If your DSM also has **docker-compose** available over SSH, you can instead
> drop [`docker-compose.yml`](./docker-compose.yml) into
> `/volume1/docker/peptide-pitstop/` (edit the secrets first) and run
> `sudo docker-compose up -d` from that directory.

---

## First run — the setup wizard

1. Open **`http://<your-NAS-IP>:3000`** in a browser.
2. You'll land on the **`/setup`** wizard. Create your owner account:
   - set a password (default minimum length 12),
   - scan the TOTP QR code with an authenticator app and confirm the code.
3. That's it — Peptide Pitstop is **single-user**; the wizard only runs once.

---

## Updating

**Container Manager (Option A):** Project → `peptide-pitstop` →
**Action ▸ Stop**, then **Action ▸ Build** (it re-pulls `:latest`). Or pull a
specific version by editing the `image:` tag (e.g. `:1.0.1`) and rebuilding.

**SSH / CLI (Option B2):**

```bash
sudo docker pull ghcr.io/kavo91/peptide-pitstop:latest
sudo docker stop peptide-pitstop && sudo docker rm peptide-pitstop
# re-run the same `docker run …` command from B2
```

Your data survives because it lives in `/volume1/docker/peptide-pitstop`, not in
the container.

---

## Backups

The single thing to back up is the data folder:
**`/volume1/docker/peptide-pitstop`** (contains `peptides.db`).

Use **Hyper Backup** to schedule copies of that folder, or just snapshot/copy it.
Stop the container first for a perfectly clean copy, or rely on SQLite's WAL —
file-level copies of a running DB are usually fine for a single-user app.

---

## Optional: publish over the internet (Cloudflare Tunnel)

To reach the app from outside your LAN **without opening any ports** on your
router or DSM firewall:

1. Create a tunnel in the Cloudflare Zero Trust dashboard and copy its **token**.
2. In the compose file, uncomment `CLOUDFLARE_TUNNEL_TOKEN` and paste the token.
3. Because the tunnel terminates HTTPS, set **`COOKIE_SECURE=true`** and you can
   remove the `ports:` block (no LAN port needed).
4. Point the tunnel's public hostname at `http://app:3000` (or the container's
   service) per Cloudflare's docs.

(There is also an all-in-one "bundled" image that runs the tunnel inside the
container — see the repo's `deploy/bundled/` for that variant.)

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| **Login won't stick / bounced back to login** over `http://…:3000` | `COOKIE_SECURE` must be `false` for plain-HTTP LAN access. It's the default in this compose. |
| **Permission denied / DB won't open** | The data folder needs to be writable by the container. In **File Station** set the `docker/peptide-pitstop` folder permissions so it's writable, or via SSH: `sudo chown -R 1000:1000 /volume1/docker/peptide-pitstop` (DSM's first user is usually UID 1000/GID 100 — adjust if needed). |
| **`version is obsolete` warning** | Harmless — the compose file intentionally omits `version:`. If you see this, you pasted an old file; ignore it. |
| **Image won't pull on old DSM GUI** | The GUI Registry only browses Docker Hub. Pull the GHCR image once over SSH (`sudo docker pull ghcr.io/kavo91/peptide-pitstop:latest`), then launch from **Docker → Image**. |
| **Port 3000 already in use** | Change the left side of the port mapping, e.g. `-p 3010:3000`, and browse to `…:3010`. |
| **Forgot/lost `PT_FIELD_KEY`** | Encrypted fields can't be recovered. You'd have to start a fresh database. Always store this key in a password manager. |

---

Questions or bugs: <https://github.com/kavo91/peptide-pitstop/issues>.
Licensed AGPL-3.0.

