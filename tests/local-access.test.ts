import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { localAccess } from '../scripts/local-access.ts';

function run(enabled: boolean, headers: Record<string, string>, remoteAddress='127.0.0.1') {
  let middleware: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) | undefined;
  const plugin=localAccess(enabled);
  const configureServer = plugin.configureServer;
  if (typeof configureServer !== 'function') throw new Error('Server hook missing');
  void configureServer.call({} as ThisParameterType<typeof configureServer>, {middlewares:{use(fn: NonNullable<typeof middleware>) {middleware=fn;}}} as unknown as ViteDevServer);
  const req={headers,socket:{remoteAddress}};
  let status=200,continued=false;
  const res={writeHead(code: number){status=code;return this;},end(){}};
  middleware?.(req as unknown as IncomingMessage,res as unknown as ServerResponse,()=>{continued=true;});
  return {middleware,headers:req.headers,status,continued};
}
void test('local access is opt-in and serve-only',()=>{
  assert.equal(localAccess(true).apply,'serve');
  assert.equal(run(false,{host:'localhost:3000'}).middleware,undefined);
});
void test('loopback access preserves app cookies and replaces duplicate local auth',()=>{
  const result=run(true,{host:'127.0.0.1:3000',cookie:'theme=dark; __sites_local_auth=0; __sites_local_auth=1'});
  assert.equal(result.continued,true);
  assert.equal(result.headers.cookie,'theme=dark; __sites_local_auth=1');
});
void test('non-loopback peers, foreign hosts and cross-site browser requests are denied',()=>{
  for(const [headers,peer] of [
    [{host:'127.0.0.1:3000'},'192.168.1.2'],
    [{host:'evil.example:3000'},'127.0.0.1'],
    [{host:'127.0.0.1:3000','sec-fetch-site':'cross-site'},'127.0.0.1'],
  ] as [Record<string,string>,string][]) {
    const r=run(true,headers,peer); assert.equal(r.status,403);assert.equal(r.continued,false);
  }
});
