import { test, expect } from "@playwright/test";

test("all workspaces render without JavaScript errors and stay within desktop viewport", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const route of [
    "/overview",
    "/incidents",
    "/incidents/inc-C001",
    "/agents",
    "/runs/run-C001",
    "/approvals",
    "/actions",
    "/data",
    "/onboarding",
    "/experiments",
    "/memories",
    "/settings",
    "/skills",
    "/login",
  ]) {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    if (route !== "/login")
      await expect(
        page.getByText("服务运行正常", { exact: true }),
      ).toBeVisible();
    await page.waitForTimeout(200);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      route,
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("approval, independent CRM execution and persistent readback", async ({
  page,
}) => {
  await page.request.post("/api/v1/workspace/session");
  const initial = (await (await page.request.get("/api/v1/console")).json())
    .data;
  const plan = initial.plans.find((p: { id: string }) => p.id === "plan-C001");
  if (plan.status === "pending") {
    await page.goto("/approvals?plan=plan-C001");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "批准方案", exact: true }).click();
    await dialog.getByRole("button", { name: "确认批准", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  await page.goto("/actions");
  const execute = page.getByRole("button", { name: "执行到 客户管理" });
  if (!initial.actions.some((a: { customer: string }) => a.customer === "C001"))
    await execute.first().click();
  await expect(page.getByText("已回读验证").first()).toBeVisible();
  await page.getByRole("button", { name: "查看 客户管理" }).click();
  await expect(
    page.getByRole("dialog").getByText("C001 · 售后协调任务"),
  ).toBeVisible();
  await page.getByRole("dialog").getByLabel("关闭弹窗").click();
  await page.reload();
  await expect(page.getByText("已回读验证").first()).toBeVisible();
  const after = (await (await page.request.get("/api/v1/console")).json()).data;
  expect(
    after.actions.filter((a: { customer: string }) => a.customer === "C001"),
  ).toHaveLength(1);
  expect(
    after.runs.find((r: { customer: string }) => r.customer === "C001").state,
  ).toBe("waiting_observation");
});

test("incident search is reflected in URL, no match is explicit", async ({
  page,
}) => {
  await page.goto("/incidents");
  const search = page.getByRole("textbox", { name: "搜索缺口" });
  await search.fill("C018");
  await expect(page).toHaveURL(/q=C018/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await search.fill("NOT_A_CUSTOMER");
  await expect(page.getByText("没有符合条件的缺口")).toBeVisible();
});

test("mobile navigation and all principal surfaces have no page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "/overview",
    "/incidents",
    "/runs/run-C001",
    "/approvals",
    "/actions",
    "/data",
    "/onboarding",
    "/skills",
    "/settings",
  ]) {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    if (route !== "/login")
      await expect(
        page.getByText("服务运行正常", { exact: true }),
      ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      route,
    ).toBe(true);
  }
  await page.goto("/overview");
  await page.getByLabel("打开导航").click();
  await expect(page.getByRole("navigation")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Skill 工坊" })
    .click();
  await expect(page).toHaveURL(/skills/);
});

test("export reviewed desktop and mobile screenshots", async ({ page }) => {
  for (const [route, name] of [
    ["/overview", "overview"],
    ["/approvals", "approvals"],
    ["/runs/run-C001", "run"],
    ["/skills", "skills"],
    ["/data", "data"],
  ]) {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    if (route !== "/login")
      await expect(
        page.getByText("服务运行正常", { exact: true }),
      ).toBeVisible();
    await page.waitForTimeout(700);
    await page.screenshot({
      path: `../../docs/qa/${name}-desktop.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/overview");
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "../../docs/qa/overview-mobile.png",
    fullPage: true,
  });
});

test("custom Skill editor validates JSON, saves and persists over reload", async ({
  page,
}) => {
  await page.request.post("/api/v1/workspace/session");
  await page.goto("/skills");
  await expect(page.getByText("服务运行正常", { exact: true })).toBeVisible();
  const state = (await (await page.request.get("/api/v1/console")).json()).data;
  const name = "售后证据复核";
  if (!state.skills.some((s: { name: string }) => s.name === name)) {
    await page.getByRole("button", { name: "创建 Skill", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "创建 Skill",
      exact: true,
    });
    await dialog.getByLabel("Skill 名称").fill(name);
    await dialog
      .getByLabel("用途简介")
      .fill("只读核查客户售后证据，向外部 Agent 返回事实与限制。");
    await dialog
      .getByLabel("Markdown 工作指令")
      .fill(
        "# 售后证据复核\n1. 读取指定客户案件。\n2. 核查工单与来源覆盖。\n3. 引用证据并返回限制，不批准或执行任何任务。",
      );
    await dialog.getByRole("button", { name: "输入参数" }).click();
    await dialog.getByLabel("输入 JSON Schema").fill("{not valid json");
    await dialog.getByRole("button", { name: "保存 Skill" }).click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("输入 JSON Schema")
      .fill(
        JSON.stringify(
          {
            type: "object",
            properties: { customer_id: { type: "string" } },
            required: ["customer_id"],
            additionalProperties: false,
          },
          null,
          2,
        ),
      );
    await dialog.getByRole("button", { name: "检验 JSON" }).click();
    await expect(
      dialog.getByText(
        "JSON 语法与基本 Schema 结构有效；完整校验由服务端完成。",
      ),
    ).toBeVisible();
    await dialog.getByLabel("保存后启用").check();
    await page.screenshot({
      path: "../../docs/qa/skill-editor-desktop.png",
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "保存 Skill" }).click();
    await expect(dialog).not.toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "MCP 接入", exact: true }).click();
  await expect(page.locator(".skill-code")).toContainText("mcp_server.py");
  await expect(page.locator(".skill-code")).not.toContainText(
    "<Python executable>",
  );
  await page.screenshot({
    path: "../../docs/qa/mcp-desktop.png",
    fullPage: true,
  });
});
