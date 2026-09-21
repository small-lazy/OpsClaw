import { test, expect } from '@playwright/test';

test('增长工作台完成字段映射、同比分析、事件审批与方案登记，并明确外部服务待配置', async ({page}) => {
  test.setTimeout(90000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  expect((await page.request.post('/api/v1/workspace/session')).ok()).toBeTruthy();
  const suffix=Date.now();const school=`验收学校${suffix}`;const filename=`增长订单${suffix}.csv`;
  const rows=['订单号,支付时间,实付金额,商品名称,学校,学院,订单状态'];
  for(let i=0;i<2;i++)rows.push(`PREV-${suffix}-${i},2025-09-18 10:00:00,100,面试资料,${school},管理学院,paid`);
  for(let i=0;i<4;i++)rows.push(`CURR-${suffix}-${i},2026-09-18 10:00:00,100,面试资料,${school},管理学院,paid`);
  const imported=await page.request.post('/api/v1/imports',{multipart:{files:{name:filename,mimeType:'text/csv',buffer:Buffer.from(rows.join('\n'))}}});
  expect(imported.ok()).toBeTruthy();const datasetId=(await imported.json()).data.files[0].dataset_ids[0];
  await page.goto('/growth');await expect(page.getByRole('heading',{name:'增长工作台',exact:true})).toBeVisible();
  await page.getByLabel('订单数据集').selectOption(datasetId);
  await expect(page.getByRole('combobox',{name:'订单号',exact:true})).toHaveValue('订单号');
  await expect(page.getByRole('combobox',{name:'实付金额',exact:true})).toHaveValue('实付金额');
  await page.getByLabel('完整覆盖开始（可选）').fill('2025-09-18');await page.getByLabel('完整覆盖结束（可选）').fill('2026-09-18');
  const bind=page.waitForResponse(response=>response.url().endsWith('/growth/orders/bind'));
  await page.getByRole('button',{name:'确认映射并接入'}).click();expect((await bind).ok()).toBeTruthy();
  await page.getByLabel('开始日期',{exact:true}).fill('2026-09-18');await page.getByLabel('结束日期',{exact:true}).fill('2026-09-18');await page.getByLabel('最低订单样本').fill('1');
  const analysis=page.waitForResponse(response=>response.url().endsWith('/growth/reports'));
  await page.getByRole('button',{name:'运行分析'}).click();expect((await analysis).ok()).toBeTruthy();
  await expect(page.getByRole('heading',{name:'学校维度'})).toBeVisible();
  const group=page.getByRole('row').filter({has:page.getByRole('cell',{name:school,exact:true})});await expect(group).toContainText('100.0%');
  await page.screenshot({path:'../../docs/qa/growth-analysis-desktop.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'事件与因子',exact:true}).click();
  const eventPanel=page.locator('.growth-panel').filter({has:page.getByRole('heading',{name:'登记事件证据'})});
  await eventPanel.getByLabel('事件标题').fill(`招生公告${suffix}`);await eventPanel.getByLabel('官方来源 URL').fill(`https://example.com/admissions-${suffix}`);await eventPanel.getByLabel('学校',{exact:true}).fill(school);await eventPanel.getByLabel('学院',{exact:true}).fill('管理学院');await eventPanel.getByLabel('发布时间').fill('2026-09-18');await eventPanel.getByLabel('招生人数').fill('100');
  const registered=page.waitForResponse(response=>response.url().endsWith('/growth/events'));await page.getByRole('button',{name:'提交事件审核'}).click();expect((await registered).ok()).toBeTruthy();
  const eventCard=page.locator('.growth-record').filter({has:page.getByRole('heading',{name:`招生公告${suffix}`,exact:true})});await eventCard.getByRole('button',{name:'批准事件'}).click();await expect(eventCard).toContainText('已批准');
  await page.getByRole('button',{name:'内容与机会',exact:true}).click();const assetPanel=page.locator('.growth-panel').filter({has:page.getByRole('heading',{name:'内容资产',exact:true})});
  await assetPanel.getByLabel('学校',{exact:true}).fill(school);await assetPanel.getByLabel('学院',{exact:true}).fill('管理学院');await assetPanel.getByLabel('商品',{exact:true}).fill('面试资料');await assetPanel.getByLabel('内容 ID').fill(`content-${suffix}`);await assetPanel.getByRole('button',{name:'注册资产'}).click();
  await expect(assetPanel).toContainText(`content-${suffix}`);await page.getByLabel('已审核事件').selectOption({label:`招生公告${suffix}`});await page.getByRole('combobox',{name:'内容资产',exact:true}).selectOption({label:`${school} / 管理学院 · 面试资料`});await page.getByLabel('招生人数',{exact:true}).fill('100');await page.getByLabel('预计客单价（元）').fill('99');await page.getByLabel('预算上限（元）').fill('200');
  expect(await page.getByRole('button',{name:'生成并提交方案'}).evaluate(button=>Array.from(button.closest('form')!.querySelectorAll<HTMLInputElement>(':invalid')).map(input=>input.name))).toEqual([]);
  const proposal=page.waitForResponse(response=>response.url().endsWith('/growth/proposals'));await page.getByRole('button',{name:'生成并提交方案'}).click();const proposed=await proposal;expect(proposed.ok()).toBeTruthy();const actionId=(await proposed.json()).data.id;
  await page.getByRole('button',{name:'审批与投放',exact:true}).click();const action=page.locator('.growth-record').filter({hasText:actionId});await action.getByText('审阅参数、机会测算与操作记录').click();await expect(action).toContainText('20000');await action.getByRole('button',{name:'批准方案'}).click();await expect(action).toContainText('已批准');
  const snapshot=(await (await page.request.get('/api/v1/growth/overview')).json()).data;if(!snapshot.config.ads_configured){await expect(action.getByRole('button',{name:'执行已批准方案'})).toBeDisabled();await expect(page.getByText('广告服务待配置。',{exact:false})).toBeVisible();}
  await page.screenshot({path:'../../docs/qa/growth-actions-desktop.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'接入设置',exact:true}).click();await expect(page.getByRole('heading',{name:'外部连接'})).toBeVisible();await page.screenshot({path:'../../docs/qa/growth-settings-desktop.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await page.reload();await expect(page.getByRole('heading',{name:'增长工作台',exact:true})).toBeVisible();
  for(const tab of ['订单与诊断','事件与因子','内容与机会','审批与投放','接入设置']) {await page.getByRole('button',{name:tab,exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),tab).toBe(true);}
  await page.screenshot({path:'../../docs/qa/growth-mobile.png',fullPage:true,animations:'disabled'});expect(errors).toEqual([]);
});
