import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@app/db";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";
import { presignGet } from "../lib/r2";
import { isFreshReauthenticationSession } from "../lib/account-lifecycle";

export const accountLifecycle = new Hono<AppEnv>();
function key(c:{req:{header(name:string):string|undefined}}){const value=c.req.header("idempotency-key")?.trim();return value&&value.length<=128?value:null;}

accountLifecycle.get("/export-requests",async(c)=>{const requests=await getDb(c.env.DB).select().from(schema.dataExportRequests)
	.where(eq(schema.dataExportRequests.userId,c.get("userId"))).orderBy(desc(schema.dataExportRequests.requestedAt)).limit(20);return okJson(c,await Promise.all(requests.map(async request=>({...request,downloadUrl:request.status==='ready'&&request.objectKey&&request.expiresAt&&Number(request.expiresAt)>Date.now()?await presignGet(c.env,"exports",request.objectKey,600):null}))));});

accountLifecycle.get("/export-requests/:id/chunk-url",async(c)=>{const keyValue=c.req.query("key");if(!keyValue)return Errors.validation(c,"key query parameter is required");let key:string;try{key=decodeURIComponent(keyValue);}catch{return Errors.validation(c,"Invalid export chunk key");}const request=await c.env.DB.prepare("SELECT id,status,expires_at FROM data_export_requests WHERE id=? AND user_id=?").bind(c.req.param("id"),c.get("userId")).first<{id:string;status:string;expires_at:number|null}>();if(!request||request.status!=="ready"||!request.expires_at||request.expires_at<=Date.now())return Errors.notFound(c,"Ready export not found");const prefix=`users/${c.get("userId")}/exports/${request.id}/chunks/`;if(!key.startsWith(prefix)||key.includes(".."))return Errors.validation(c,"Chunk does not belong to this export");if(!(await c.env.EXPORTS_BUCKET.head(key)))return Errors.notFound(c,"Export chunk not found");return okJson(c,{url:await presignGet(c.env,"exports",key,600),expiresInSeconds:600});});

async function workflowExists(binding:Workflow,id:string):Promise<boolean>{try{return (await (await binding.get(id)).status()).status!=="unknown";}catch{return false;}}
async function startExport(c:any,request:{id:string;userId:string;status:string;workflowInstanceId?:string|null}){if(request.status!=="queued")return request;const workflowId=request.workflowInstanceId??`data-export-${request.id}`;if(!request.workflowInstanceId){const persisted=await c.env.DB.prepare("UPDATE data_export_requests SET workflow_instance_id=? WHERE id=? AND user_id=? AND status='queued' AND workflow_instance_id IS NULL").bind(workflowId,request.id,request.userId).run();if((persisted.meta.changes??0)!==1){const raced=await c.env.DB.prepare("SELECT workflow_instance_id FROM data_export_requests WHERE id=? AND user_id=?").bind(request.id,request.userId).first() as {workflow_instance_id:string|null}|null;if(raced?.workflow_instance_id)return{...request,workflowInstanceId:raced.workflow_instance_id};}}
	if(await workflowExists(c.env.DATA_EXPORT_WORKFLOW,workflowId))return{...request,workflowInstanceId:workflowId};
	try{await c.env.DATA_EXPORT_WORKFLOW.create({id:workflowId,params:{requestId:request.id,userId:request.userId}});return{...request,workflowInstanceId:workflowId};}catch(error){if(await workflowExists(c.env.DATA_EXPORT_WORKFLOW,workflowId))return{...request,workflowInstanceId:workflowId};await c.env.DB.prepare("UPDATE data_export_requests SET status='failed',error_code='workflow_start_failed' WHERE id=? AND user_id=? AND status='queued' AND workflow_instance_id=?").bind(request.id,request.userId,workflowId).run();throw error;}}

accountLifecycle.post("/export-requests",async(c)=>{
	const idempotencyKey=key(c); if(!idempotencyKey)return Errors.validation(c,"Idempotency-Key header is required");
	const db=getDb(c.env.DB); const existing=await db.select().from(schema.dataExportRequests).where(and(eq(schema.dataExportRequests.userId,c.get("userId")),eq(schema.dataExportRequests.idempotencyKey,idempotencyKey))).get();
	if(existing)return okJson(c,{request:await startExport(c,existing),replayed:true});
	const request={id:nanoid(),userId:c.get("userId"),status:"queued",idempotencyKey,requestedAt:Date.now()};
	try{await db.insert(schema.dataExportRequests).values(request);}catch(error){const raced=await db.select().from(schema.dataExportRequests).where(and(eq(schema.dataExportRequests.userId,c.get("userId")),eq(schema.dataExportRequests.idempotencyKey,idempotencyKey))).get();if(raced)return okJson(c,{request:raced,replayed:true});throw error;}
	return okJson(c,{request:await startExport(c,request),replayed:false,note:"Export preparation is queued. A signed download will appear after processing."},202);
});

accountLifecycle.get("/deletion-requests",async(c)=>okJson(c,await getDb(c.env.DB).select().from(schema.accountDeletionRequests)
	.where(eq(schema.accountDeletionRequests.userId,c.get("userId"))).orderBy(desc(schema.accountDeletionRequests.requestedAt)).limit(20)));

accountLifecycle.post("/deletion-requests",async(c)=>{
	const idempotencyKey=key(c);if(!idempotencyKey)return Errors.validation(c,"Idempotency-Key header is required");
	const db=getDb(c.env.DB);const existing=await db.select().from(schema.accountDeletionRequests).where(and(eq(schema.accountDeletionRequests.userId,c.get("userId")),eq(schema.accountDeletionRequests.idempotencyKey,idempotencyKey))).get();
	if(existing)return okJson(c,{request:existing,replayed:true,nextAction:"reauthenticate"});
	const request={id:nanoid(),userId:c.get("userId"),status:"awaiting_reauthentication",idempotencyKey,requestedAt:Date.now()};
	try{await db.insert(schema.accountDeletionRequests).values(request);}catch(error){const raced=await db.select().from(schema.accountDeletionRequests).where(and(eq(schema.accountDeletionRequests.userId,c.get("userId")),eq(schema.accountDeletionRequests.idempotencyKey,idempotencyKey))).get();if(raced)return okJson(c,{request:raced,replayed:true,nextAction:"reauthenticate"});throw error;}
	return okJson(c,{request,replayed:false,nextAction:"reauthenticate",note:"No data has been deleted. Re-authentication and a cooling-off period are required."},202);
});

accountLifecycle.post("/deletion-requests/:id/cancel",async(c)=>{
	const now=Date.now();const result=await c.env.DB.prepare("UPDATE account_deletion_requests SET status='cancelled',cancelled_at=? WHERE id=? AND user_id=? AND status IN ('awaiting_reauthentication','scheduled')")
		.bind(now,c.req.param("id"),c.get("userId")).run();
	return (result.meta.changes??0)>0?okJson(c,{id:c.req.param("id"),status:"cancelled",cancelledAt:now}):Errors.notFound(c,"Cancellable deletion request not found");
});

accountLifecycle.post("/deletion-requests/:id/confirm",async(c)=>{
	const userId=c.get("userId"),requestId=c.req.param("id"),session=c.get("session"),now=Date.now();
	const request=await c.env.DB.prepare("SELECT id,user_id,status,requested_at,workflow_instance_id FROM account_deletion_requests WHERE id=? AND user_id=?").bind(requestId,userId).first<{id:string;user_id:string;status:string;requested_at:number;workflow_instance_id:string|null}>();
	if(!request)return Errors.notFound(c,"Deletion request not found");
	if(request.status==='scheduled')return okJson(c,{requestId,status:"scheduled",workflowInstanceId:request.workflow_instance_id,replayed:true});
	if(request.status!=='awaiting_reauthentication')return Errors.conflict(c,"Deletion request cannot be confirmed in its current state");
	if(!isFreshReauthenticationSession(session.createdAt,request.requested_at,now))return Errors.unauthorized(c,"Create a fresh sign-in session after requesting deletion, then confirm within 15 minutes");
	const scheduledFor=now+7*24*60*60_000,workflowId=`account-deletion-${requestId}`;
	const claimed=await c.env.DB.prepare("UPDATE account_deletion_requests SET status='scheduled',reauthenticated_at=?,scheduled_for=?,confirmed_session_id=?,workflow_instance_id=? WHERE id=? AND user_id=? AND status='awaiting_reauthentication'").bind(now,scheduledFor,session.id,workflowId,requestId,userId).run();
	if((claimed.meta.changes??0)!==1)return Errors.conflict(c,"Deletion request changed; refresh and retry");
	try{await c.env.ACCOUNT_DELETION_WORKFLOW.create({id:workflowId,params:{requestId,userId,scheduledFor}});}catch(error){if(!(await workflowExists(c.env.ACCOUNT_DELETION_WORKFLOW,workflowId))){await c.env.DB.prepare("UPDATE account_deletion_requests SET status='awaiting_reauthentication',reauthenticated_at=NULL,scheduled_for=NULL,confirmed_session_id=NULL,workflow_instance_id=NULL,error_code='workflow_start_failed' WHERE id=? AND user_id=? AND status='scheduled' AND workflow_instance_id=?").bind(requestId,userId,workflowId).run();throw error;}}
	return okJson(c,{requestId,status:"scheduled",scheduledFor,workflowInstanceId:workflowId,cancellableUntil:scheduledFor},202);
});
