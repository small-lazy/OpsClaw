import { test, expect } from '@playwright/test';

test('MCP 配置失败可重试，修改安装目录后配置同步更新', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/v1/mcp-config', route => route.fulfill({
    json: ++attempts === 1 ? { data: {} } : { data: {
      transport: 'stdio', command: 'C:/OpsClaw/python.exe',
      args: ['C:/OpsClaw/backend/opsweaver/mcp_server.py'], cwd: 'C:/OpsClaw/backend',
    } },
  }));
  await page.goto('/skills');
  await page.getByRole('button', { name: 'MCP 接入', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制配置' })).toBeDisabled();
  await page.getByRole('button', { name: '重新读取配置' }).click();
  await expect(page.getByRole('button', { name: '复制配置' })).toBeEnabled();
  await page.getByLabel('后端工作目录').fill('D:/My Agent/backend');
  const config = JSON.parse(await page.locator('.skill-code').innerText());
  expect(config.mcpServers.opsclaw.cwd).toBe('D:/My Agent/backend');
  expect(config.mcpServers.opsclaw.args).toEqual(['-m', 'opsweaver.mcp_server']);
  await page.getByLabel('Python 可执行文件').fill('   ');
  await expect(page.getByRole('button', { name: '复制配置' })).toBeDisabled();
  await page.getByRole('button', { name: '恢复安装路径' }).click();
  await expect(page.getByLabel('后端工作目录')).toHaveValue('C:/OpsClaw/backend');
  await expect(page.getByRole('button', { name: '复制配置' })).toBeEnabled();
});

test('Skill 参数修改后清除旧测试结果', async ({ page }) => {
  await page.route('**/api/v1/commands/skill-test', async route => {
    await new Promise(resolve => setTimeout(resolve, 600));
    await route.fulfill({ json: { data: { valid: true } } });
  });
  await page.goto('/skills');
  await page.locator('.skill-card-title').first().click();
  await page.getByRole('button', { name: '测试参数', exact: true }).click();
  await expect(page.getByLabel('Skill 测试参数')).toBeDisabled();
  await expect(page.getByLabel('关闭 Skill 详情')).toBeDisabled();
  await expect(page.getByLabel('服务端测试结果')).toContainText('true');
  await page.getByLabel('Skill 测试参数').fill('{invalid');
  await expect(page.getByLabel('服务端测试结果')).toHaveCount(0);
});
