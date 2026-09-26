import test from 'node:test';
import assert from 'node:assert/strict';
import { graphExcerpts, anchoredGraphSchema } from '../lib/graph-excerpts.ts';
void test('anchored extraction retains exact original block text and rejects invented IDs downstream', () => {
  const blocks = [{id:'b',page:1,text:'Graph\n attention uses neighbors.'}];
  const excerpts = graphExcerpts(blocks);
  assert.ok(excerpts.every(e => blocks[0].text.includes(e.text)));
  const raw = anchoredGraphSchema(excerpts).parse({entities:[{key:'a',name:'GAT',type:'method',domain:'GNN',definition:'method',mentions:[{excerptId:'b:0',surface:'Graph attention'}]}],relations:[]});
  assert.equal(raw.entities[0].mentions[0].quote, blocks[0].text);
  assert.equal(raw.entities[0].mentions[0].surface, 'Graph\n attention');
});

void test('relocates a name only to one immediate same-page neighbour; relation evidence stays selected', () => {
 const excerpts=[{id:'a',blockId:'a',page:1,text:'The Pubmed dataset'}, {id:'b',blockId:'b',page:1,text:'contains 19717 nodes.'}];
 const raw={entities:[{key:'x',name:'Pubmed',type:'data',domain:'GNN',definition:'dataset',mentions:[{excerptId:'b',surface:'Pubmed'}]}],relations:[{source:'x',target:'y',type:'uses',condition:'unknown',evidence:[{excerptId:'b'}]}]};
 const got=anchoredGraphSchema(excerpts).parse(raw);
 assert.equal(got.entities[0].mentions[0].blockId,'a');
 assert.equal(got.relations[0].evidence[0].blockId,'b');
 const crossPage=anchoredGraphSchema([{...excerpts[0],page:2},excerpts[1]]).parse(raw);
 assert.equal(crossPage.entities[0].mentions[0].blockId,'b');
});
