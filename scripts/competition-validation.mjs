// Real full-text validation. Reuses only the named browser-created fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const base = 'http://127.0.0.1:3000';
const dir = process.env.VALIDATION_DIR || 'outputs/competition-validation';
const reportPath = `${dir}/report.json`;
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : {
  startedAt: new Date().toISOString(), checks: [], papers: [], answers: [],
  limitations: ['Three papers, no independent researcher gold standard or held-out benchmark.', 'No scientific experiment reproduced; functional and source-location checks only.'],
};
function save() { writeFileSync(reportPath, JSON.stringify(report, null, 2)); }
async function api(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(base + path, {
    method, headers: body instanceof FormData ? {} : {'Content-Type':'application/json'},
    ...(body ? {body: body instanceof FormData ? body : JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(240000),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(d)}`);
  return d;
}
const norm = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
function check(name, condition, detail) {
  report.checks=report.checks.filter(item=>item.name!==name);
  report.checks.push({name, passed:Boolean(condition), detail, at:new Date().toISOString()});
  save(); console.log(JSON.stringify({name, passed:Boolean(condition)}));
}
async function waitJobs(path, batchId) {
  for(let i=0;i<180;i++) {
    const state=await api(path+'/graph');
    const jobs=state.jobs.filter(j=>j.batchId===batchId);
    if(jobs.length && jobs.every(j=>['succeeded','partial','failed','cancelled'].includes(j.status))) return state;
    if(i%6===0) console.log(JSON.stringify({waiting:jobs.map(j=>({status:j.status,stage:j.stage}))}));
    await delay(5000);
  }
  throw new Error('Graph task deadline exceeded.');
}
try {
  const initial=await api('/api/projects');
  const fixture=initial.projects.find(p=>p.title===(process.env.VALIDATION_TITLE || '真实全文验证 · 图神经网络与分子预测'));
  assert.ok(fixture,'Create the fixture and upload three real PDFs through the browser first.');
  report.projectId=fixture.id; report.model=initial.ai.model; report.usageBefore??=initial.usage;
  const path='/api/projects/'+fixture.id;
  let p=(await api(path)).project;
  assert.equal(p.state.papers.length,3);
  const manifest=JSON.parse(readFileSync(`${dir}/papers/manifest.json`,'utf8'));
  const blocksByPaper=new Map();
  for(const paper of p.state.papers) {
    const metadata=manifest.find(m=>paper.filename===m.id+'.pdf'); assert.ok(metadata);
    const material=await api(path+'/papers/'+paper.id);
    blocksByPaper.set(paper.id,material.blocks);
    const raw=await fetch(base+path+'/papers/'+paper.id+'?raw=1');
    const hash=createHash('sha256').update(Buffer.from(await raw.arrayBuffer())).digest('hex');
    const item={...metadata,paperId:paper.id,pages:paper.pages,blocks:material.blocks.length,
      characters:material.blocks.reduce((n,b)=>n+b.text.length,0),coverage:paper.coverage,
      parsing:paper.parsing,downloadHashMatches:hash===metadata.sha256,rawStatus:raw.status};
    report.papers=report.papers.filter(x=>x.paperId!==paper.id).concat(item);
    check('PDF original and browser parser '+metadata.id,raw.ok && hash===metadata.sha256 && paper.parsing.engine==='pdfjs-layout-v2' && material.blocks.length>0 && new Set(material.blocks.map(b=>b.page)).size===paper.pages,{pages:paper.pages,blocks:material.blocks.length});
    writeFileSync(`${dir}/papers/${metadata.id}-blocks.json`,JSON.stringify(material.blocks,null,2));
  }
  const crossSite=await fetch(base+'/api/projects',{headers:{'Sec-Fetch-Site':'cross-site'}});
  check('Local mode blocks cross-site requests',crossSite.status===403);
  const crossOrigin=await fetch(base+path,{method:'PATCH',headers:{'Content-Type':'application/json',Origin:'https://example.org'},body:JSON.stringify({revision:p.revision,action:'profile.update'})});
  check('Mutation rejects foreign Origin',crossOrigin.status===403);
  if(!report.extractionBatch) {
    const submitted=await api(path+'/graph',{task:'extract',paperIds:p.state.papers.map(x=>x.id)});
    report.extractionBatch=submitted.batchId;save();
  }
  let state=await waitJobs(path,report.extractionBatch);
  report.extractionJobs=state.jobs.filter(j=>j.batchId===report.extractionBatch);
  report.graphCounts={entities:state.graph.entities.length,relations:state.graph.relations.length,evidence:state.graph.evidence.length};
  writeFileSync(`${dir}/graph.json`,JSON.stringify(state,null,2));save();
  check('All full-text graph jobs succeeded with zero rejected candidates',report.extractionJobs.length===3 && report.extractionJobs.every(j=>j.status==='succeeded'),report.extractionJobs.map(j=>({status:j.status,result:j.result})));
  let quotePass=0;
  for(const evidence of state.graph.evidence) {
    const block=blocksByPaper.get(evidence.paperId)?.find(b=>b.id===evidence.blockId);
    if(block && block.page===evidence.page && norm(block.text).includes(norm(evidence.quote))) quotePass++;
  }
  check('Graph evidence text and page match original blocks',quotePass===state.graph.evidence.length && quotePass>0,{passed:quotePass,total:state.graph.evidence.length});
  const questions=[
    {id:'methods',question:'用中文逐篇说明三篇论文提出的核心方法以及各自实际评估的数据集。请区分 MPNN、GAT、DGN，不要把引用的他人工作当作本篇自己的实验。',paperIds:p.state.papers.map(x=>x.id)},
    {id:'comparison',question:'仅根据这三篇论文，能否声称 GAT 在 QM9 分子预测上显著优于 MPNN 和 DGN？请判断原文是否提供同数据集、同指标、同条件的直接对照及统计显著性证据；没有则明确说明不能判断。',paperIds:p.state.papers.map(x=>x.id)},
    {id:'missing',question:'这篇论文招募了多少名临床试验患者？请只提供原文明确报告的临床患者人数；若没有临床试验，明确回答未报告，不要把图节点数、分子数或数据集样本数当成患者人数。',paperIds:[report.papers.find(x=>x.id==='gilmer17a').paperId]},
  ];
  for(const q of questions) {
    if(report.answers.some(a=>a.id===q.id)) continue;
    const start=Date.now();
    try {
      const answer=await api(path+'/ai',{task:'ask',mode:'analysis',question:q.question,paperIds:q.paperIds});
      report.answers.push({...q,elapsedMs:Date.now()-start,...answer});save();
      const sources=answer.sources??[];
      const located=sources.filter(s=>{const b=blocksByPaper.get(s.paperId)?.find(b=>b.id===s.blockId);return b && b.page===s.page && norm(b.text).includes(norm(s.quote));}).length;
      const whitespaceTolerant=sources.filter(s=>{const b=blocksByPaper.get(s.paperId)?.find(b=>b.id===s.blockId);return b && b.page===s.page && norm(b.text).replace(/\s/g,'').includes(norm(s.quote).replace(/\s/g,''));}).length;
      check('Answer references '+q.id,located===sources.length && (answer.id==='missing' || sources.length>0) && (answer.statements??[]).every(s=>s.sourceIndices.every(i=>sources[i])),{located,total:sources.length,whitespaceTolerant});
      check('Answer persisted '+q.id,Boolean(answer.savedAnswerId) && !answer.persistenceError);
    } catch(error) { report.answers.push({...q,error:error.message}); check('Answer request '+q.id,false,error.message); }
  }
  // Recheck saved answers on resumed runs as well; do not drop earlier failures.
  for(const answer of report.answers) {
    const sources=answer.sources??[];
    const located=sources.filter(s=>{const b=blocksByPaper.get(s.paperId)?.find(b=>b.id===s.blockId);return b && b.page===s.page && norm(b.text).includes(norm(s.quote));}).length;
    const whitespaceTolerant=sources.filter(s=>{const b=blocksByPaper.get(s.paperId)?.find(b=>b.id===s.blockId);return b && b.page===s.page && norm(b.text).replace(/\s/g,'').includes(norm(s.quote).replace(/\s/g,''));}).length;
    check('Answer references '+answer.id,!answer.error && located===sources.length && (answer.id==='missing' || sources.length>0) && (answer.statements??[]).every(s=>s.sourceIndices.every(i=>sources[i])),{located,total:sources.length,whitespaceTolerant});
    check('Answer persisted '+answer.id,Boolean(answer.savedAnswerId) && !answer.persistenceError);
  }
  if(!report.bridgeBatch) {
    const a=state.graph.entities.find(e=>e.type==='method'&&e.paperIds.includes(report.papers.find(x=>x.id==='gat').paperId)&&!e.mergedInto);
    const b=state.graph.entities.find(e=>e.type==='method'&&e.paperIds.includes(report.papers.find(x=>x.id==='beaini21a').paperId)&&!e.mergedInto);
    if(a && b) { report.bridgeBatch=(await api(path+'/graph',{task:'bridge',source:a.id,target:b.id})).batchId;save(); }
  }
  if(report.bridgeBatch) {
    state=await waitJobs(path,report.bridgeBatch);
    report.bridgeJobs=state.jobs.filter(j=>j.batchId===report.bridgeBatch);
    report.bridges=state.graph.bridges.filter(b=>report.bridgeJobs.some(j=>j.id===b.runId));save();
    check('Bridge has two-paper evidence and limitations',report.bridges.length>0 && report.bridges.every(b=>new Set(b.evidenceIds.map(id=>state.graph.evidence.find(e=>e.id===id)?.paperId).filter(Boolean)).size>=2 && b.risks && b.differences && b.experiment),{hypotheses:report.bridges.length});
  }
  if(!report.matrixJobs) {
    p=(await api(path)).project;
    report.matrixJobs=(await api(path+'/extract',{paperIds:p.state.papers.map(x=>x.id),fieldIds:p.state.fields.slice(0,2).map(f=>f.id)})).jobs;save();
  }
  for(let i=0;i<120;i++) {
    const d=await api(path); const jobs=d.jobs.filter(j=>report.matrixJobs.includes(j.id));
    if(jobs.length && jobs.every(j=>['succeeded','failed','cancelled'].includes(j.status))) {
      report.matrixResults=jobs;report.cells=d.project.state.cells;save();
      check('Matrix extraction succeeds for three full texts',jobs.length===3 && jobs.every(j=>j.status==='succeeded'));break;
    }
    await delay(5000);
  }
  if(!report.matrixResults) check('Matrix deadline',false);
  report.usageAfter=(await api('/api/projects')).usage;
  report.completedAt=new Date().toISOString();
  report.status=report.checks.every(c=>c.passed)?'functional_checks_passed_not_academic_acceptance':'checks_have_failures';
  save();console.log(JSON.stringify({status:report.status,counts:report.graphCounts,reportPath}));
} catch(error) {report.error=error.message;report.status='incomplete';save();console.error(error);process.exitCode=1;}
