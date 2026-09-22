import { test, expect } from '@playwright/test';

test('增长工作台完成字段映射、同比分析、事件审批与方案登记，并明确外部服务待配置', async ({page}) => {
  test.setTimeout(90000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  expect((await page.request.post('/api/v1/workspace/session')).ok()).toBeTruthy();
  async function capture(filename:string){await page.evaluate(async()=>{window.scrollTo(0,0);await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});await page.screenshot({path:`../docs/qa/${filename}`,fullPage:true,animations:'disabled'});}
  const suffix=Date.now();const brand="生活方式品牌";const filename=`春季上新订单-${suffix}.csv`;
  const rows=['订单号,支付时间,实付金额,商品名称,品牌,品类,订单状态'];
  for(let i=0;i<12;i++)rows.push(`PREV-${suffix}-${i},2025-03-18 10:00:00,199,轻量徒步背包,${brand},户外用品,paid`);
  for(let i=0;i<24;i++)rows.push(`CURR-${suffix}-${i},2026-03-18 10:00:00,199,轻量徒步背包,${brand},户外用品,paid`);
  const imported=await page.request.post('/api/v1/imports',{multipart:{files:{name:filename,mimeType:'text/csv',buffer:Buffer.from(rows.join('\n'))}}});
  expect(imported.ok()).toBeTruthy();const datasetId=(await imported.json()).data.files[0].dataset_ids[0];
  await page.goto('/growth');await expect(page.getByRole('heading',{name:'增长工作台',exact:true})).toBeVisible();
  await page.getByLabel('订单数据集').selectOption(datasetId);
  await expect(page.getByRole('combobox',{name:'订单号',exact:true})).toHaveValue('订单号');
  await expect(page.getByRole('combobox',{name:'实付金额',exact:true})).toHaveValue('实付金额');
  await expect(page.getByRole('combobox',{name:'品牌/市场（可选）',exact:true})).toHaveValue('品牌');
  await expect(page.getByRole('combobox',{name:'品类/客群（可选）',exact:true})).toHaveValue('品类');
  await page.getByLabel('完整覆盖开始（可选）').fill('2025-03-18');await page.getByLabel('完整覆盖结束（可选）').fill('2026-03-18');
  const bind=page.waitForResponse(response=>response.url().endsWith('/growth/orders/bind'));
  await page.getByRole('button',{name:'确认映射并接入'}).click();expect((await bind).ok()).toBeTruthy();
  await page.getByLabel('开始日期',{exact:true}).fill('2026-03-18');await page.getByLabel('结束日期',{exact:true}).fill('2026-03-18');await page.getByLabel('最低订单样本').fill('1');
  const analysis=page.waitForResponse(response=>response.url().endsWith('/growth/reports'));
  await page.getByRole('button',{name:'运行分析'}).click();expect((await analysis).ok()).toBeTruthy();
  await expect(page.getByRole('heading',{name:'品牌/市场维度'})).toBeVisible();
  const group=page.getByRole('row').filter({has:page.getByRole('cell',{name:brand,exact:true})});await expect(group).toContainText('100.0%');
  await capture('growth-analysis-desktop.png');
  await page.getByRole('button',{name:'事件与因子',exact:true}).click();
  const eventPanel=page.locator('.growth-panel').filter({has:page.getByRole('heading',{name:'登记事件证据'})});
  await eventPanel.getByLabel('事件标题').fill('春季上新活动公告');await eventPanel.getByLabel('官方来源 URL').fill(`https://example.com/spring-launch-${suffix}`);await eventPanel.getByLabel('品牌/市场',{exact:true}).fill(brand);await eventPanel.getByLabel('品类/客群',{exact:true}).fill('户外用品');await eventPanel.getByLabel('发布时间').fill('2026-03-18');await eventPanel.getByLabel('潜在人群规模').fill('100');
  const registered=page.waitForResponse(response=>response.url().endsWith('/growth/events'));await page.getByRole('button',{name:'提交事件审核'}).click();expect((await registered).ok()).toBeTruthy();
  const eventCard=page.locator('.growth-record').filter({has:page.getByRole('heading',{name:'春季上新活动公告',exact:true})});await eventCard.getByRole('button',{name:'批准事件'}).click();await expect(eventCard).toContainText('已批准');
  const factorPanel=page.locator('.growth-panel').filter({has:page.getByRole('heading',{name:'添加监控因子',exact:true})});
  await factorPanel.getByLabel('因子名称').fill('春季上新与补货监控');await factorPanel.getByLabel('品牌/市场',{exact:true}).fill(brand);await factorPanel.getByLabel('品类/客群',{exact:true}).fill('户外用品');await factorPanel.getByLabel('搜索关键词').fill('生活方式品牌 户外用品 促销 新品 补货 节日');await factorPanel.getByLabel('官方域名（逗号分隔）').fill('example.com');await factorPanel.getByLabel('事件匹配词').fill('促销,新品,补货,节日');
  await factorPanel.getByRole('button',{name:'创建候选因子'}).click();const factorCard=page.locator('.growth-record').filter({has:page.getByRole('heading',{name:'春季上新与补货监控',exact:true})});await factorCard.getByRole('button',{name:'批准并启用监控'}).click();await expect(factorCard).toContainText('监控中');await capture('growth-factors-desktop.png');
  await page.getByRole('button',{name:'内容与机会',exact:true}).click();const assetPanel=page.locator('.growth-panel').filter({has:page.getByRole('heading',{name:'内容资产',exact:true})});
  await assetPanel.getByLabel('品牌/市场',{exact:true}).fill(brand);await assetPanel.getByLabel('品类/客群',{exact:true}).fill('户外用品');await assetPanel.getByLabel('商品',{exact:true}).fill('轻量徒步背包');await assetPanel.getByLabel('内容 ID').fill(`content-${suffix}`);await assetPanel.getByRole('button',{name:'注册资产'}).click();
  await expect(assetPanel).toContainText(`content-${suffix}`);await page.getByLabel('已审核事件').selectOption({label:'春季上新活动公告'});await page.getByRole('combobox',{name:'内容资产',exact:true}).selectOption({label:`${brand} / 户外用品 · 轻量徒步背包`});await page.getByLabel('潜在人群规模',{exact:true}).fill('100');await page.getByLabel('预计客单价（元）').fill('99');await page.getByLabel('预算上限（元）').fill('200');
  expect(await page.getByRole('button',{name:'生成并提交方案'}).evaluate(button=>Array.from(button.closest('form')!.querySelectorAll<HTMLInputElement>(':invalid')).map(input=>input.name))).toEqual([]);
  const proposal=page.waitForResponse(response=>response.url().endsWith('/growth/proposals'));await page.getByRole('button',{name:'生成并提交方案'}).click();const proposed=await proposal;expect(proposed.ok()).toBeTruthy();const actionId=(await proposed.json()).data.id;
  await page.getByRole('button',{name:'审批与投放',exact:true}).click();const action=page.locator('.growth-record').filter({hasText:actionId});await action.getByText('审阅参数、机会测算与操作记录').click();await expect(action).toContainText('20000');await action.getByRole('button',{name:'批准方案'}).click();await expect(action).toContainText('已批准');
  const snapshot=(await (await page.request.get('/api/v1/growth/overview')).json()).data;if(!snapshot.config.ads_configured){await expect(action.getByRole('button',{name:'执行已批准方案'})).toBeDisabled();await expect(page.getByText('广告服务待配置。',{exact:false})).toBeVisible();}
  await action.getByText('审阅参数、机会测算与操作记录').click();await capture('growth-actions-desktop.png');
  await page.getByRole('button',{name:'接入设置',exact:true}).click();await expect(page.getByRole('heading',{name:'外部连接'})).toBeVisible();await capture('growth-settings-desktop.png');
  await page.setViewportSize({width:390,height:844});await page.reload();await expect(page.getByRole('heading',{name:'增长工作台',exact:true})).toBeVisible();
  for(const tab of ['订单与诊断','事件与因子','内容与机会','审批与投放','接入设置']) {await page.getByRole('button',{name:tab,exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),tab).toBe(true);}
  await capture('growth-mobile.png');expect(errors).toEqual([]);
});
