import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';


test.use({ trace: 'off' });

test('批量文件独立导入、失败重试与分析结果刷新后保留', async ({ page }) => {
  expect((await page.request.post('/api/v1/workspace/session')).ok()).toBeTruthy();
  const suffix = Date.now();
  const filename = `销售指标-${suffix}.csv`;
  const retryName = `区域数据-${suffix}.tsv`;
  const badName = `损坏文件-${suffix}.json`;
  let rejected = false;
  await page.route('**/api/v1/imports', async route => {
    if (!rejected && route.request().postDataBuffer()?.includes(Buffer.from(retryName))) {
      rejected = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '临时不可用，请重试' } }) });
    } else await route.continue();
  });
  await page.goto('/onboarding');
  await expect(page.getByRole('heading', { name: '导入与分析', exact: true })).toBeVisible();
  await page.getByLabel('选择导入文件').setInputFiles([
    { name: filename, mimeType: 'text/csv', buffer: Buffer.from('地区,销售额,备注\n华东,100,首单\n华南,200,\n华东,100,首单', 'utf-8') },
    { name: retryName, mimeType: 'text/tab-separated-values', buffer: Buffer.from('区域\t数量\n西南\t3\n华北\t7', 'utf-8') },
    { name: badName, mimeType: 'application/json', buffer: Buffer.from('{broken') },
  ]);
  await page.getByRole('button', { name: '开始导入 (3)', exact: true }).click();
  const queue = page.locator('.import-queue');
  await expect(queue.getByRole('listitem').filter({ hasText: filename })).toContainText('导入完成');
  await expect(queue.getByRole('listitem').filter({ hasText: retryName })).toContainText('临时不可用');
  await expect(queue.getByRole('listitem').filter({ hasText: badName }).getByRole('button', { name: '重试' })).toBeEnabled();
  await queue.getByRole('listitem').filter({ hasText: retryName }).getByRole('button', { name: '重试' }).click();
  await expect(queue.getByRole('listitem').filter({ hasText: retryName })).toContainText('导入完成');
  const library = page.locator('.import-library').filter({ has: page.getByRole('heading', { name: '已导入文件', exact: true }) });
  const row = library.getByRole('row').filter({ hasText: filename });
  await row.getByRole('button', { name: '查看分析' }).click();
  const detail = page.getByRole('dialog', { name: '文件分析详情' });
  await expect(detail).toContainText('重复记录');
  await expect(detail.locator('.import-metrics > div').filter({ hasText: '重复记录' })).toContainText('1');
  await expect(detail.locator('.import-metrics > div').filter({ hasText: '缺失单元格' })).toContainText('1');
  const numericRow = detail.getByRole('row').filter({ has: page.getByRole('cell', { name: '销售额', exact: true }) });
  await expect(numericRow).toContainText('100 / 200');
  await expect(numericRow).toContainText('400');
  await expect(detail).toContainText('华东');
  await page.screenshot({ path: '../../docs/qa/import-analysis-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '关闭分析' }).click();
  await page.reload();
  await expect(library.getByRole('row').filter({ hasText: filename })).toHaveCount(1);
  await expect(library.getByRole('row').filter({ hasText: retryName })).toHaveCount(1);
  await expect(page.locator('.import-history-table').getByRole('row').filter({ hasText: badName })).toContainText('失败');
  await page.screenshot({ path: '../../docs/qa/import-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../../docs/qa/import-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '返回数据中心' }).click();
  await expect(page.getByRole('heading', { name: '数据中心', exact: true })).toBeVisible();
  await library.getByRole('row').filter({ hasText: filename }).getByRole('button', { name: '查看分析' }).click();
  await expect(page.getByRole('dialog', { name: '文件分析详情' })).toContainText(filename);
  await page.getByRole('button', { name: '关闭分析' }).click();
  await page.getByLabel('搜索数据源').fill(filename);
  await page.getByRole('row').filter({ hasText: filename }).getByRole('button', { name: '查看详情' }).click();
  await page.getByRole('button', { name: '查看文件分析' }).click();
  await expect(page.getByRole('dialog', { name: '文件分析详情' })).toContainText(filename);
});

test('MCP 只读调用引发 revision 更新时，设置页保留未保存的名称', async ({ page }) => {
  const login = await page.request.post('/api/v1/workspace/session');
  expect(login.ok()).toBeTruthy();
  await page.goto('/settings');
  const name = page.getByRole('textbox', { name: '工作区名称', exact: true });
  await expect(name).toBeVisible();
  const snapshot = await page.request.get('/api/v1/console');
  expect(snapshot.ok()).toBeTruthy();
  const before = (await snapshot.json()).data;
  const originalName = before.settings.workspace_name;
  const draftName = `${originalName} · 未保存编辑验证`;
  await name.fill(draftName);
  const token = (await readFile(resolve(__dirname, '../../../backend/data/mcp.token'), 'utf-8')).trim();
  const refreshed = page.waitForResponse(async response => {
    if (!response.url().endsWith('/api/v1/console') || !response.ok()) return false;
    return (await response.json()).data.revision > before.revision;
  });
  const mcp = await page.request.post('/api/v1/mcp/skills/skill-retention/run', {
    headers: { Authorization: `Bearer ${token}` }, data: { arguments: { customer_id: 'C001' } },
  });
  expect(mcp.ok()).toBeTruthy();
  expect((await mcp.json()).data.allowed_tools).toContain('get_incident');
  const refresh = await refreshed;
  expect((await refresh.json()).data.revision).toBeGreaterThan(before.revision);
  await expect(name).toHaveValue(draftName);
  const after = (await (await page.request.get('/api/v1/console')).json()).data;
  expect(after.settings.workspace_name).toBe(originalName);
});
