const {chromium}=require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const output=path.resolve('test-results/generation-v4'),base=process.env.STUDIO_TEST_URL||'http://127.0.0.1:5178';let browser;
(async()=>{
 browser=await chromium.launch({channel:'msedge',headless:true});const p=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),screens=[];
 await p.addInitScript(()=>localStorage.setItem('yingshen-preferences',JSON.stringify({theme:'light',quality:'balanced',motion:'reduced',backdrop:'pearl'})));
 await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__YINGSHEN__?.ready(),{},{timeout:90000});
 for(const [width,height,name] of [[390,844,'mobile'],[1440,900,'desktop']]){
  await p.setViewportSize({width,height});if(name==='mobile'){await p.locator('.stage-body').scrollIntoViewIfNeeded();await p.waitForTimeout(250);await p.evaluate(()=>scrollTo(0,0));}const state=await p.evaluate(()=>{const e=document.querySelector('#ai-tryon'),s=getComputedStyle(e),r=e.getBoundingClientRect();return{viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,color:s.color,background:s.backgroundColor,buttonWidth:r.width,buttonX:r.x,buttonRight:r.right,paused:window.__YINGSHEN__.getState().avatarPerformance.paused};});
  assert.equal(state.background,'rgb(0, 113, 227)');assert.equal(state.color,'rgb(255, 255, 255)');assert.equal(state.paused,true);assert.ok(state.scrollWidth<=width);assert.ok(state.buttonX>=0&&state.buttonRight<=width);
  await p.screenshot({path:path.join(output,`integrated-${name}-main.png`),fullPage:name==='mobile'});screens.push({...state,name});
 }
 const report={passed:true,checks:['AI入口在390px与1440px均为蓝底白字且完整可见','两种宽度均无横向溢出','复核时模型始终暂停，未进行性能基准'],screens,time:new Date().toISOString()};
 fs.writeFileSync(path.join(output,'entry-contrast-recheck.json'),JSON.stringify(report,null,2));
 const integrationPath=path.join(output,'integration.json'),integration=JSON.parse(fs.readFileSync(integrationPath,'utf8'));integration.resolvedIssues=integration.issues.length?integration.issues:integration.resolvedIssues;integration.issues=integration.issues.filter(issue=>issue.code!=='AI_ENTRY_INVISIBLE');integration.passed=integration.issues.length===0;integration.followUp={scope:'仅入口CSS修复后的390px/1440px局部复核；其他集成项沿用此前已通过结果',evidence:'entry-contrast-recheck.json',time:report.time};fs.writeFileSync(integrationPath,JSON.stringify(integration,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>browser?.close());
