import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

const script=`export default {async fetch(request,env){const u=request.headers.get('x-user');const url=new URL(request.url);if(url.pathname==='/brand'){const b=await request.json();const old=await env.DB.prepare('SELECT fingerprint,snapshot FROM mutations WHERE user_id=? AND idem=?').bind(u,b.key).first();if(old)return old.fingerprint===b.fingerprint?Response.json(JSON.parse(old.snapshot)):new Response('mismatch',{status:409});await env.DB.prepare('INSERT INTO mutations VALUES(?,?,?,?)').bind(u,b.key,b.fingerprint,JSON.stringify(b.snapshot)).run();return Response.json(b.snapshot,{status:201});}if(url.pathname==='/chunk'){const key=url.searchParams.get('key')||'';return key.startsWith('users/'+u+'/exports/'+url.searchParams.get('request')+'/chunks/')?Response.json({ok:true}):new Response('denied',{status:403});}if(url.pathname==='/sweep'){const row=await env.DB.prepare("SELECT id FROM outbox WHERE status='retry' ORDER BY id LIMIT 1").first();if(!row)return Response.json({claimed:0});const claim=await env.DB.prepare("UPDATE outbox SET status='processing',attempts=attempts+1 WHERE id=? AND status='retry'").bind(row.id).run();return Response.json({claimed:claim.meta.changes});}return new Response('not found',{status:404});}}`;

test("Miniflare isolates two tenants, replays exact snapshots, rejects key mismatch, and claims outbox once",async()=>{
  const mf=new Miniflare({modules:true,script,d1Databases:{DB:"brand-account-test"}});const db=await mf.getD1Database("DB");await db.exec("CREATE TABLE mutations(user_id TEXT,idem TEXT,fingerprint TEXT,snapshot TEXT,PRIMARY KEY(user_id,idem));CREATE TABLE outbox(id TEXT PRIMARY KEY,status TEXT,attempts INTEGER);");
  const call=(user,path,body)=>mf.dispatchFetch(`http://local${path}`,{method:body?'POST':'GET',headers:{'x-user':user,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const original={id:"brand-a",version:1};assert.equal((await call("tenant-a","/brand",{key:"k",fingerprint:"f1",snapshot:original})).status,201);
  assert.deepEqual(await (await call("tenant-a","/brand",{key:"k",fingerprint:"f1",snapshot:{id:"changed",version:99}})).json(),original);
  assert.equal((await call("tenant-a","/brand",{key:"k",fingerprint:"different",snapshot:original})).status,409);
  assert.equal((await call("tenant-b","/brand",{key:"k",fingerprint:"f2",snapshot:{id:"brand-b",version:1}})).status,201);
  assert.equal((await call("tenant-b","/chunk?request=req-a&key=users%2Ftenant-a%2Fexports%2Freq-a%2Fchunks%2F0.json")).status,403);
  await db.prepare("INSERT INTO outbox VALUES('cleanup-1','retry',0)").run();assert.deepEqual(await (await call("tenant-a","/sweep")).json(),{claimed:1});assert.deepEqual(await (await call("tenant-a","/sweep")).json(),{claimed:0});await mf.dispose();
});
