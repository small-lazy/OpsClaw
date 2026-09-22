import { test, expect } from '@playwright/test';

test('直接进入工作区，无账户入口，内置记录支持分页', async ({ page }) => {
  await page.goto('/overview');
  await expect(page.getByText('服务运行正常', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '运营总览', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/演示|模拟环境|演示账户|合成快照/);
  const completed = page.waitForResponse(r => r.url().endsWith('/api/v1/commands/scan') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '运行检测', exact: true }).click();
  expect((await completed).ok()).toBeTruthy();
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('.toast')).not.toContainText(/会话已过期|登录|失败/);
  await page.goto('/data');
  await page.getByLabel('搜索数据源').fill('支付订单');
  await page.getByRole('row').filter({ hasText: '支付订单' }).getByRole('button', { name: '查看详情' }).first().click();
  const records = page.locator('.source-records');
  await expect(records.locator('tbody tr')).toHaveCount(25);
  const first = await records.locator('tbody tr').first().innerText();
  await records.getByRole('button', { name: '下一页' }).click();
  await expect(records.locator('tbody tr').first()).not.toHaveText(first);
  await expect(records).toContainText('26–50');
  await page.screenshot({ path: '../docs/qa/data-records-desktop.png', fullPage: true });
});
