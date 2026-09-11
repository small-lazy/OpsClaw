import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "../../docs/qa/browser-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    channel: "chrome",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  outputDir: "../../docs/qa/browser-results",
});
