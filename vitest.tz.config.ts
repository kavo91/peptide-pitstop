import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Time-zone matrix for date-only protocol fields (`npm run test:tz`). Same
// aliases as the main config, but WITHOUT its Australia/Brisbane pin: the
// caller sets TZ (America/New_York, America/Santiago) so the date-only tests
// run in zones west of UTC, which the pinned suite can never see.
export default defineConfig({
  resolve: base.resolve,
  test: {
    environment: "node",
    include: ["src/**/*.tz.test.ts"],
    env: { TZ_MATRIX: "1" },
  },
});
