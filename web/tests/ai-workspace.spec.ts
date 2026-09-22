import { test, expect } from '@playwright/test';

test('本地接口夹具：连接验证、模型发现、生成草稿、保存与异步工具运行', async ({ page }) => {
  const providers:any[]=[];
  const agents:any[]=Array.from({length:6},(_,index)=>({id:`template-${index}`,name:['订单分析','数据质量','增长观察','商品洞察','运营周报','策略复核'][index],description:'基于工作区数据完成有依据的业务分析。',instructions:'读取授权数据并引用证据。',provider_id:null,tools:['dataset_summary'],status:'paused',template:true}));
  const runs:any[]=[];let testAttempts=0;let runReads=0;let providerSecret='';let lastRun:any;
  const tools=[{name:'dataset_summary',description:'读取数据集统计与质量信息'},{name:'dataset_rows',description:'读取授权数据记录'}];
  await page.route('**/api/v1/datasets',route=>route.fulfill({json:{data:[{id:'dataset-test',name:'订单测试表.csv',row_count:24}]}}));
  await page.route('**/api/v1/ai/**',async route=>{
    const req=route.request();const path=new URL(req.url()).pathname.replace('/api/v1/ai','');const body=req.method()==='POST'?req.postDataJSON():{};
    const send=(data:any)=>route.fulfill({json:{data}});
    if(path==='/workspace')return send({providers,agents,runs,tools,presets:{providers:[{id:'deepseek',name:'DeepSeek',protocol:'openai',base_url:'https://api.deepseek.com/v1',model:'deepseek-chat',env_key:'DEEPSEEK_API_KEY'}],agents:[]}});
    if(path==='/providers'){
      if(body.api_key)providerSecret=body.api_key;
      expect(body.env_key||'').toBe('');
      const saved={id:'provider-test',name:body.name,protocol:body.protocol,base_url:body.base_url,model:body.model,env_key:body.env_key||'',api_key_configured:Boolean(providerSecret),key_source:'stored'};
      providers.splice(0,providers.length,saved);return send(saved);
    }
    if(path==='/providers/provider-test/models')return send([{id:'local-test-model',name:'本地协议测试模型'}]);
    if(path==='/providers/provider-test/test'){
      testAttempts++;if(testAttempts===1)return route.fulfill({status:401,json:{error:{message:'连接验证失败：测试凭据无效'}}});
      return send({status:'ok',message:'本地接口夹具校验通过'});
    }
    if(path==='/generate')return send({name:'周度订单复核',description:'检查每周订单变化并给出数据依据。',instructions:'使用 dataset_summary 获取授权数据质量与规模，输出简明结论。',provider_id:'provider-test',tools:['dataset_summary'],status:'paused'});
    if(path==='/agents'){const saved={...body,id:body.id||'agent-generated'};const index=agents.findIndex(item=>item.id===saved.id);if(index>=0)agents[index]=saved;else agents.push(saved);return send(saved);}
    if(path==='/runs'){lastRun=body;const run={id:'run-test',agent_id:body.agent_id,task:body.task,status:'queued',trace:[],created_at:'2026-09-22T08:00:00Z'};runs.push(run);return send(run);}
    if(path==='/runs/run-test'){runReads++;const run=runs[0];if(runReads>1)Object.assign(run,{status:'completed',result:'本地协议测试结果：授权数据包含 24 条记录。',trace:[{type:'tool',tool:'dataset_summary',output:{row_count:24}},{type:'model',content:'完成基于工具结果的汇总。'}]});return send(run);}
    return route.fulfill({status:404,json:{error:{message:'未定义的本地测试接口'}}});
  });
  await page.goto('/agents');await expect(page.getByRole('heading',{name:'Agent 工作台',exact:true})).toBeVisible();await expect(page.locator('.ai-agent-card')).toHaveCount(6);
  await page.getByRole('button',{name:'模型连接',exact:true}).click();await page.getByRole('button',{name:'新增模型连接',exact:true}).click();
  const provider=page.getByRole('dialog',{name:'模型连接配置'});await provider.locator('[aria-label="服务预设"]').selectOption('deepseek');await expect(provider.locator('[aria-label="API Base URL"]')).toHaveValue('https://api.deepseek.com/v1');await expect(provider.locator('[aria-label="环境变量名（可选）"]')).toHaveValue('');
  await provider.locator('[aria-label="连接名称"]').fill('本地协议夹具');await provider.locator('[aria-label="API Base URL"]').fill('http://localhost:9901/v1');await provider.locator('[aria-label="API Key"]').fill('local-test-key-not-a-secret');await expect(provider.locator('[aria-label="API Key"]')).toHaveAttribute('type','password');
  await provider.getByRole('button',{name:'获取模型列表'}).click();await expect(provider).toContainText('模型服务返回 1 个模型');await expect(provider.locator('[aria-label="API Key"]')).toHaveValue('');await provider.locator('[aria-label="模型名称"]').fill('local-test-model');
  await provider.getByRole('button',{name:'测试连接',exact:true}).click();await expect(provider.getByRole('alert')).toHaveText('连接验证失败：测试凭据无效');await provider.getByRole('button',{name:'测试连接',exact:true}).click();await expect(provider).toContainText('本地接口夹具校验通过');await provider.getByRole('button',{name:'保存连接',exact:true}).click();await expect(provider).not.toBeVisible();
  await page.getByRole('button',{name:'我的 Agent',exact:true}).click();await page.getByRole('button',{name:'从需求生成',exact:true}).click();const generate=page.getByRole('dialog',{name:'根据需求生成 Agent'});await generate.locator('[aria-label="描述工作需求"]').fill('检查每周订单变化，并引用统计结果。');await generate.getByRole('button',{name:'生成 Agent 草稿'}).click();const editor=page.getByRole('dialog',{name:'创建 Agent'});await expect(editor.locator('[aria-label="Agent 名称"]')).toHaveValue('周度订单复核');await editor.getByRole('checkbox',{name:'启用此 Agent'}).check();await editor.getByRole('button',{name:'保存 Agent',exact:true}).click();await expect(editor).not.toBeVisible();
  const card=page.locator('.ai-agent-card').filter({has:page.getByRole('heading',{name:'周度订单复核',exact:true})});await card.getByRole('button',{name:'运行',exact:true}).click();await page.locator('[aria-label="本次任务"]').fill('统计所选数据集的记录规模。');await page.getByRole('checkbox',{name:/订单测试表.csv/}).check();await page.getByRole('button',{name:'开始运行'}).click();await expect(page.getByText('本地协议测试结果：授权数据包含 24 条记录。',{exact:true})).toBeVisible();expect(lastRun.dataset_ids).toEqual(['dataset-test']);expect(runReads).toBeGreaterThan(1);await expect(page.locator('.ai-trace')).toContainText('dataset_summary');
  await page.getByRole('button',{name:'运行历史',exact:true}).click();await expect(page.locator('.ai-history')).toContainText('统计所选数据集的记录规模。');await page.reload();await expect(page.getByRole('heading',{name:'周度订单复核',exact:true})).toBeVisible();await page.setViewportSize({width:390,height:844});await page.reload();await expect(page.getByRole('heading',{name:'Agent 工作台',exact:true})).toBeVisible();for(const tab of ['我的 Agent','模型连接','运行任务','运行历史']){await page.getByRole('button',{name:tab,exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),tab).toBe(true);}
});
