import { admin, getSettings, login, acceptInvite } from '@netlify/identity';
import type { User } from '@netlify/identity';
import type { Context } from '@netlify/functions';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { eq, and, gt, sql } from 'drizzle-orm';
import { database } from '../db/index.js';
import { profiles, sessions, audit, rateLimits } from '../db/schema.js';
import { HttpError, passwordOK, text } from './http.js';
export function hash(value:string){return createHash('sha256').update(value).digest('hex');}
export async function record(actorId:string,action:string,targetId?:string){await database().insert(audit).values({id:randomUUID(),actorId,action,targetId});}
export async function limit(key:string,max:number,seconds:number){
 const now=new Date(),end=new Date(now.getTime()+seconds*1000);
 const [entry]=await database().insert(rateLimits).values({key,attempts:1,resetsAt:end}).onConflictDoUpdate({target:rateLimits.key,set:{
  attempts:sql`case when ${rateLimits.resetsAt} < ${now} then 1 else ${rateLimits.attempts} + 1 end`,
  resetsAt:sql`case when ${rateLimits.resetsAt} < ${now} then ${end} else ${rateLimits.resetsAt} end`
 }}).returning();
 if(entry.attempts>max)throw new HttpError(429,'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
}
export function clearIdentity(context:Context){context.cookies.delete('nf_jwt');context.cookies.delete('nf_refresh');}
export function isAdmin(user:User){return user.roles?.includes('admin')===true;}
async function profileFor(user:User){
 const db=database();
 let [profile]=await db.select().from(profiles).where(eq(profiles.id,user.id));
 if(!profile&&isAdmin(user)){
  await db.insert(profiles).values({id:user.id,email:user.email!,name:user.name||user.email!,mustChangePassword:false}).onConflictDoNothing();
  [profile]=await db.select().from(profiles).where(eq(profiles.id,user.id));
 }
 if(!profile||profile.blocked||profile.deleted)throw new HttpError(403,'Acesso indisponível. Entre em contato com o administrador.');
 return profile;
}
export async function startSession(data:Record<string,unknown>,context:Context,invite=false){
 const email=invite?'invite':text(data.email,254).toLowerCase();
 await limit('login-ip:'+hash(context.ip||'unknown'),20,900);
 await limit('login-email:'+hash(email),10,900);
 const settings=await getSettings();
 if(!settings.disableSignup)throw new HttpError(503,'O acesso privado ainda não está configurado. O administrador deve desativar o cadastro público.');
 let user:User;
 try{user=invite?await acceptInvite(text(data.token,4096),passwordOK(data.password)):await login(email,typeof data.password==='string'&&data.password.length<=128?data.password:'');}
 catch{throw new HttpError(401,'E-mail ou senha inválidos, ou convite expirado.');}
 finally{clearIdentity(context);}
 if(invite&&!isAdmin(user)){
  const [existing]=await database().select().from(profiles).where(eq(profiles.id,user.id));
  if(!existing)return {pendingApproval:true};
 }
 const profile=await profileFor(user);
 const raw=randomBytes(32).toString('base64url');
 await database().insert(sessions).values({hash:hash(raw),userId:user.id,expiresAt:new Date(Date.now()+8*60*60*1000)});
 context.cookies.set({name:'__Host-jvc_session',value:raw,httpOnly:true,secure:true,sameSite:'Strict',path:'/',maxAge:28800});
 await record(user.id,'session.login');
 return {id:user.id,email:profile.email,name:profile.name,admin:isAdmin(user),mustChangePassword:profile.mustChangePassword};
}
export async function requireUser(context:Context){
 const raw=context.cookies.get('__Host-jvc_session');
 if(!raw)throw new HttpError(401,'Faça login para continuar.');
 const [session]=await database().select().from(sessions).where(and(eq(sessions.hash,hash(raw)),gt(sessions.expiresAt,new Date())));
 if(!session)throw new HttpError(401,'Sua sessão expirou. Entre novamente.');
 let identity:User;
 try{identity=await admin.getUser(session.userId);}catch{throw new HttpError(401,'Não foi possível validar seu acesso. Entre novamente.');}
 const profile=await profileFor(identity);
 return {id:identity.id,email:profile.email,name:profile.name,admin:isAdmin(identity),mustChangePassword:profile.mustChangePassword};
}
export type Actor=Awaited<ReturnType<typeof requireUser>>;
export function requireAdmin(actor:Actor){if(!actor.admin)throw new HttpError(403,'Acesso exclusivo do administrador.');}
export function requireReady(actor:Actor){if(actor.mustChangePassword)throw new HttpError(403,'Defina sua senha pessoal antes de continuar.');}
export async function endSession(context:Context){const raw=context.cookies.get('__Host-jvc_session');if(raw)await database().delete(sessions).where(eq(sessions.hash,hash(raw)));context.cookies.delete('__Host-jvc_session');clearIdentity(context);}
