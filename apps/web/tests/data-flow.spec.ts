import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';


test.use({ trace: 'off' });

test('CSV 接入完成字段确认，并在刷新后保留来源与映射', async ({ page }) => {
  const login = await page.request.post('/api/v1/workspace/session');
  expect(login.ok()).toBeTruthy();
  const filename = `订单接入验证-${Date.now()}.csv`;
  const csv = [
    'order_id,customer_id,paid_at,paid_amount_minor,refunded_amount_minor',
    'IMPORT-DEMO-001,C001,2026-09-09T08:00:00Z,12800,0',
    'IMPORT-DEMO-002,C002,2026-09-09T09:00:00Z,25600,1200',
  ].join('\n');

  await page.goto('/onboarding');
  await expect(page.getByRole('heading', { name: '选择需要接入的数据' })).toBeVisible();
  await expect(page.getByLabel('标准业务表')).toHaveValue('orders');
  await page.locator('input[type="file"]').setInputFiles({
    name: filename, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8'),
  });
  await expect(page.getByRole('button', { name: new RegExp(filename.replace('.', '\\.')) })).toBeVisible();
  const uploadResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/commands/upload') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '保存并继续', exact: true }).click();
  const uploaded = await uploadResponse;
  expect(uploaded.ok()).toBeTruthy();
  const sourceId = (await uploaded.json()).data.source_id;
  expect(sourceId).toBeTruthy();
  await expect(page.getByRole('heading', { name: '让字段与业务含义对齐' })).toBeVisible();
  for (const field of ['order_id', 'customer_id', 'paid_at', 'paid_amount_minor', 'refunded_amount_minor']) {
    const mappingRow = page.locator('label').filter({ has: page.locator('code').filter({ hasText: new RegExp(`^${field}$`) }) });
    await expect(mappingRow.getByRole('combobox')).toHaveValue(field);
  }
  await page.getByLabel('金额单位').selectOption('minor');
  await page.getByLabel('来源时区').selectOption('Asia/Shanghai');
  await page.getByRole('checkbox', { name: /我确认该来源/ }).check();
  const mappingResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/commands/mapping') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '保存并继续', exact: true }).click();
  expect((await mappingResponse).ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: '你希望 Agent 关注什么？' })).toBeVisible();
  await page.getByLabel('运营目标', { exact: true }).fill('核验订单接入与映射预览，减少高价值用户跟进遗漏');
  await page.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(page.getByRole('heading', { name: '检查并启用工作流' })).toBeVisible();
  await page.getByRole('checkbox', { name: /确认以上目标与工具权限/ }).check();
  const activateResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/commands/activate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '编译并激活', exact: true }).click();
  expect((await activateResponse).ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: '数据接入配置已保存' })).toBeVisible();
  await expect(page.getByText(/当前分析使用内置业务数据集/)).toBeVisible();

  await page.goto('/data');
  await page.getByRole('textbox', { name: '搜索数据源' }).fill(filename);
  const row = page.getByRole('row').filter({ hasText: filename });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: '查看详情' }).click();
  await expect(page.getByRole('dialog', { name: '数据源详情' })).toContainText('来源声明覆盖完整');
  await expect(page.getByRole('dialog', { name: '数据源详情' })).toContainText('IMPORT-DEMO-001');
  await page.reload();
  await page.getByRole('textbox', { name: '搜索数据源' }).fill(filename);
  await expect(page.getByRole('row').filter({ hasText: filename })).toHaveCount(1);
  const snapshot = await page.request.get('/api/v1/console');
  expect(snapshot.ok()).toBeTruthy();
  const source = (await snapshot.json()).data.sources.find((item: { id: string }) => item.id === sourceId);
  expect(source).toMatchObject({ name: filename, rows: 2, status: 'ready', coverage: true, role: 'orders' });
  expect(source.mapping).toMatchObject({ order_id: 'order_id', paid_amount_minor: 'paid_amount_minor' });
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
