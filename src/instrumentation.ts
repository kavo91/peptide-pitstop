/**
 * Next.js instrumentation hook — runs once at server startup (Node runtime only).
 * Starts a daily PlannedDose generation tick AND a 15-minute HA reminder tick.
 *
 * Guard: NEXT_RUNTIME === "nodejs" ensures this never fires in the Edge runtime
 * or during the build/static-generation pass. We use a dependency-free
 * setInterval rather than node-cron: node-cron pulls node built-ins (`path`)
 * that break the Edge bundle even behind a dynamic import, and generation is
 * idempotent + horizon-based, so an exact wall-clock time isn't required —
 * "once now, then every 24 h" is sufficient and self-heals a missed tick.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_MS = 15 * 60 * 1000; // HA reminder tick — see REMINDER_GRACE_MINUTES

async function runForAllUsers() {
  const { prisma } = await import("@/lib/db");
  const { runPlannedDoseGeneration } = await import("@/lib/planned/run");
  console.log("[planned-doses] tick — starting generation");
  try {
    const users = await prisma.user.findMany({
      where: { protocols: { some: {} } },
      select: { id: true },
    });
    let totalUpserted = 0;
    let totalMissed = 0;
    for (const user of users) {
      const result = await runPlannedDoseGeneration(user.id);
      totalUpserted += result.upserted;
      totalMissed += result.markedMissed;
    }
    console.log(
      `[planned-doses] complete — upserted=${totalUpserted} markedMissed=${totalMissed} users=${users.length}`,
    );
  } catch (err) {
    console.error("[planned-doses] tick error", err);
  }
}

async function runRemindersTick() {
  const { runReminders } = await import("@/lib/reminders");
  try {
    const { sent } = await runReminders();
    if (sent > 0) console.log(`[reminders] tick — sent=${sent}`);
  } catch (err) {
    console.error("[reminders] tick error", err);
  }
}

/**
 * Startup safety check: if the owner is still unprovisioned (passwordHash === "")
 * and no SETUP_TOKEN gate is configured, /setup is open to whoever reaches it.
 */
async function warnIfSetupOpen() {
  try {
    // Inline env check (NOT an import of @/lib/auth/setupToken) — that module
    // pulls node:crypto, and instrumentation.ts is compiled for the Edge runtime
    // too, where node:crypto is an UnhandledScheme and breaks the build. Whether
    // a gate is configured is purely "is SETUP_TOKEN set", needing no crypto.
    if ((process.env.SETUP_TOKEN ?? "").trim() !== "") return; // gate active — nothing to warn about
    const { prisma } = await import("@/lib/db");
    const owner = await prisma.user.findFirst({
      where: { role: "owner" },
      select: { passwordHash: true },
    });
    if (owner && owner.passwordHash === "") {
      console.warn(
        "[startup] SECURITY: owner is unprovisioned and /setup is OPEN (no SETUP_TOKEN set). " +
          "Anyone who can reach this instance can claim it. Set SETUP_TOKEN before public exposure, " +
          "or complete setup immediately.",
      );
    }
  } catch (err) {
    console.error("[startup] setup-open check failed", err);
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Defence-in-depth for the WS6 today.ts TZ bug. Date logic derives the local
  // calendar day from the runtime TZ; PlannedDose.scheduledAt is an instant that
  // stands for a LOCAL midnight. If TZ is unset the container defaults to UTC and
  // a Monday-local-midnight row reads back as Sunday → a routine on-grid row is
  // misread as an off-grid rebase override → a dose shows "due" a day early.
  // Scream once at startup so a misconfigured deploy is obvious in the boot log.
  if (!process.env.TZ) {
    console.warn(
      "[startup] TZ not set — date logic assumes Australia/Brisbane; planned-dose days may be off by one. Set TZ=Australia/Brisbane in the container environment.",
    );
  }

  // Public /setup is only safe once the owner is provisioned (the atomic
  // passwordHash:"" claim makes a second run a no-op). If the owner row is still
  // unprovisioned AND no SETUP_TOKEN gate is configured, anyone who reaches the
  // page can claim the instance. Warn once at startup so an exposed-but-open
  // deploy is obvious in the boot log.
  await warnIfSetupOpen();

  // Catch-up run at startup (idempotent), then a daily tick.
  await runForAllUsers();
  setInterval(() => {
    void runForAllUsers();
  }, DAY_MS);

  console.log("[planned-doses] daily tick scheduled (every 24h)");

  // HA reminders: a separate, shorter cadence. Fire once now (catch-up) then
  // every 15 min. Idempotent stamping (reminderSentAt) makes overlap safe.
  void runRemindersTick();
  setInterval(() => {
    void runRemindersTick();
  }, REMINDER_MS);

  console.log("[reminders] tick scheduled (every 15m)");
}
