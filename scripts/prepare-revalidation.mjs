import {readFileSync, writeFileSync, mkdirSync, copyFileSync} from 'node:fs';
import * as pdf from 'pdfjs-dist/legacy/build/pdf.mjs';
import {layoutPage} from '../lib/pdf-layout.ts';
const dir='outputs/revalidation-public';
mkdirSync(dir+'/papers',{recursive:true});
const manifest=JSON.parse(readFileSync('outputs/competition-validation/papers/manifest.json','utf8'));
copyFileSync('outputs/competition-validation/papers/manifest.json',dir+'/papers/manifest.json');
const base='http://127.0.0.1:3000';
async function api(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;}
const title='修复复测 · 三篇全文 2026-09-22';
let project=(await api('/api/projects')).projects.find(p=>p.title===title);
if(!project)project=await api('/api/projects',{title,question:'比较 MPNN、GAT、DGN 的方法和实验条件，不将跨论文结果当作直接对照。'});
for(const paper of manifest){
  const current=(await api('/api/projects/'+project.id)).project;
  if(current.state.papers.some(p=>p.filename===paper.id+'.pdf'))continue;
  const bytes=readFileSync('outputs/competition-validation/papers/'+paper.id+'.pdf');
  const task=pdf.getDocument({data:new Uint8Array(bytes),useSystemFonts:true});const doc=await task.promise;
  const blocks=[],pages=[];
  for(let n=1;n<=doc.numPages;n++){
    const page=await doc.getPage(n), view=page.getViewport({scale:1}), content=await page.getTextContent();const items=[];let rotated=false;
    for(const item of content.items){if(!('str' in item)||!item.str.trim())continue;
      const t=pdf.Util.transform(view.transform,item.transform),h=Math.max(1,Math.hypot(t[2],t[3])),baseline=Math.max(.001,Math.hypot(t[0],t[1]));
      const ux=t[0]/baseline,uy=t[1]/baseline,vx=t[2]/h,vy=t[3]/h;
      if(Math.abs(uy)>.1||ux<0||item.dir==='ttb')rotated=true;
      const xs=[t[4],t[4]+ux*item.width,t[4]+vx*h,t[4]+ux*item.width+vx*h],ys=[t[5],t[5]+uy*item.width,t[5]+vy*h,t[5]+uy*item.width+vy*h];
      items.push({text:item.str,x:Math.min(...xs),y:Math.min(...ys),right:Math.max(...xs),bottom:Math.max(...ys)});
    }
    const result=layoutPage(items,n,view.width,view.height);blocks.push(...result.blocks);pages.push({page:n,layout:result.layout,rotated});page.cleanup();
  }
  const form=new FormData();form.set('file',new File([bytes],paper.id+'.pdf',{type:'application/pdf'}));form.set('revision',String(current.revision));form.set('blocks',JSON.stringify(blocks));form.set('pageCount',String(doc.numPages));form.set('parsing',JSON.stringify({engine:'pdfjs-layout-v2',pages}));
  await api('/api/projects/'+project.id+'/documents',form);await task.destroy();
  writeFileSync(dir+'/papers/'+paper.id+'-layout.json',JSON.stringify({pages,blocks},null,2));
  console.log(JSON.stringify({paper:paper.id,blocks:blocks.length,twoColumn:pages.filter(p=>p.layout==='two-column').length}));
}
console.log(JSON.stringify({projectId:project.id,title}));
