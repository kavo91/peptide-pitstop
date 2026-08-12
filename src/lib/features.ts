const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function envFlag(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env[name] ?? "").trim().toLowerCase();
  return TRUE_VALUES.has(raw);
}

export function prescriptionWizardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlag("ENABLE_PRESCRIPTION_WIZARD", env) || envFlag("PT_PRIVATE_RX_WIZARD", env);
}
