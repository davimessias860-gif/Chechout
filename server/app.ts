import type { Context } from '@netlify/functions';
import { admin, AuthError } from '@netlify/identity';
import { eq, desc } from 'drizzle-orm';
import { database } from '../db/index.js';
import { profiles, sessions } from '../db/schema.js';
import { startSession, endSession, requireUser, requireAdmin, requireReady, limit, record } from './auth.js';
import { json, readBody, HttpError, text, passwordOK } from './http.js';
import { createCharge, listCharges, refreshCharge, syncCharges, env, verifyRecipients } from './payments.js';
export async function application(request:Request,context:Context){
 try{
  const url=new URL(request.url),path=url.pathname.replace(/^\/api/,'').replace(/\/$/,'')||'/',method=request.method;
  if(path==='/login'&&method==='POST')return json({user:await startSession(await readBody(request),context)});
  if(path==='/accept-invite'&&method==='POST')return json({user:await startSession(await readBody(request),context,true)});
  if(path==='/logout'&&method==='POST'){await readBody(request);await endSession(context);return json({ok:true});}
  const actor=await requireUser(context);
  if(path==='/session'&&method==='GET')return json({user:actor,paymentsEnabled:env('PAGARME_PRINCIPAL_CONFIRMED')==='true'&&env('PAGARME_RECEIVABLES_CONFIRMED')==='true'});
  if(path==='/password'&&method==='POST'){
   const body=await readBody(request);await limit('password:'+actor.id,5,900);
   await admin.updateUser(actor.id,{password:passwordOK(body.password)});
   await database().update(profiles).set({mustChangePassword:false}).where(eq(profiles.id,actor.id));
   await database().delete(sessions).where(eq(sessions.userId,actor.id));await endSession(context);await record(actor.id,'user.password_changed',actor.id);return json({ok:true});
  }
  requireReady(actor);
  if(path==='/charges'&&method==='POST')return json({charge:await createCharge(actor,await readBody(request))},201);
  if(path==='/charges'&&method==='GET'){
   const page=Math.max(1,Math.min(10000,Number(url.searchParams.get('page'))||1)),filter=url.searchParams.get('status')||'all';
   if(!['all','pending','paid','expired','failed','rejected','uncertain'].includes(filter))throw new HttpError(400,'Filtro inválido.');
   return json(await listCharges(actor,Math.floor(page),filter,url.searchParams.get('scope')==='mine'));
  }
  if(path==='/sync'&&method==='POST'){const body=await readBody(request);return json(await syncCharges(actor,body.scope==='mine'));}
  const chargeMatch=path.match(/^\/charges\/([a-f0-9-]{36})\/refresh$/);
  if(chargeMatch&&method==='POST'){await readBody(request);return json({charge:await refreshCharge(actor,chargeMatch[1])});}
  requireAdmin(actor);
  if(path==='/integration'&&method==='GET')return json({keyConfigured:Boolean(env('PAGARME_SECRET_KEY')),principalConfirmed:env('PAGARME_PRINCIPAL_CONFIRMED')==='true',receivablesConfirmed:env('PAGARME_RECEIVABLES_CONFIRMED')==='true'});
  if(path==='/integration/verify'&&method==='POST'){await readBody(request);await limit('verify:'+actor.id,5,300);return json({recipients:await verifyRecipients(),principalProven:false});}
  if(path==='/users'&&method==='GET')return json({users:await database().select().from(profiles).orderBy(desc(profiles.createdAt)).limit(500)});
  if(path==='/users'&&method==='POST'){
   const body=await readBody(request),email=text(body.email,254).toLowerCase(),name=text(body.name),password=passwordOK(body.password);
   if(!/^\S+@\S+\.\S+$/.test(email)||name.length<2)throw new HttpError(400,'Informe nome e e-mail válidos.');
   await limit('new-user:'+actor.id,15,3600);
   const user=await admin.createUser({email,password,data:{app_metadata:{roles:['member'],jvc_managed:true},user_metadata:{full_name:name}}});
   try{await database().insert(profiles).values({id:user.id,email,name,mustChangePassword:true});}
   catch{try{await admin.deleteUser(user.id);}catch{}throw new HttpError(503,'Não foi possível concluir o cadastro. Confira a lista antes de repetir.');}
   await record(actor.id,'user.created',user.id);return json({ok:true},201);
  }
  const userMatch=path.match(/^\/users\/([a-zA-Z0-9-]+)$/);
  if(userMatch&&['PATCH','DELETE'].includes(method)){
   const body=await readBody(request),id=userMatch[1];
   if(id===actor.id)throw new HttpError(400,'Você não pode bloquear ou excluir seu próprio acesso.');
   const [profile]=await database().select().from(profiles).where(eq(profiles.id,id));
   if(!profile)throw new HttpError(404,'Usuário não encontrado.');
   let target;
   try{target=await admin.getUser(id);}catch(error){if(!(error instanceof AuthError)||error.status!==404)throw error;}
   if(target?.roles?.includes('admin'))throw new HttpError(403,'Administre outros administradores pelo painel seguro da Netlify.');
   if(method==='PATCH'){
    if(typeof body.blocked!=='boolean'||profile.deleted)throw new HttpError(400,'Alteração inválida.');
    await database().update(profiles).set({blocked:body.blocked}).where(eq(profiles.id,id));
    await database().delete(sessions).where(eq(sessions.userId,id));
    await record(actor.id,body.blocked?'user.blocked':'user.unblocked',id);
   }else{
    await database().update(profiles).set({blocked:true,deleted:true}).where(eq(profiles.id,id));
    await database().delete(sessions).where(eq(sessions.userId,id));
    if(target)await admin.deleteUser(id);
    await record(actor.id,'user.deleted',id);
   }
   return json({ok:true});
  }
  throw new HttpError(404,'Recurso não encontrado.');
 }catch(error){
  if(error instanceof HttpError)return json({error:error.message},error.status);
  if(error instanceof AuthError)return json({error:'O serviço de autenticação não concluiu a operação. Confira a configuração do Identity e os dados informados.'},error.status===422?422:503);
  return json({error:'O serviço está temporariamente indisponível. Tente novamente ou contate o administrador.'},503);
 }
}
