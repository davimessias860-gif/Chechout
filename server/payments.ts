import { randomUUID } from 'node:crypto';
import { and, eq, desc, sql, isNull, asc, inArray } from 'drizzle-orm';
import { database } from '../db/index.js';
import { charges, profiles } from '../db/schema.js';
import { hash, limit, record, type Actor } from './auth.js';
import { HttpError, text } from './http.js';
import { SECONDARY, PRINCIPAL, splitRules, cpfOK, amountInCents, publicStatus, mayReadCharge, paymentGate } from './payment-rules.mjs';
export function env(name:string){return Netlify.env.get(name);}
function key(){const value=env('PAGARME_SECRET_KEY');if(!value)throw new HttpError(503,'A chave da Pagar.me ainda não está configurada.');return value;}
function headers(secret:string){return {Authorization:'Basic '+Buffer.from(secret+':').toString('base64'),Accept:'application/json','Content-Type':'application/json'};}
export async function verifyRecipients(){
 const secret=key();
 return Promise.all([SECONDARY,PRINCIPAL].map(async id=>{
  try{
   const result=await fetch('https://api.pagar.me/core/v5/recipients/'+id,{headers:headers(secret),signal:AbortSignal.timeout(8000)});
   const data=await result.json().catch(()=>({}));
   return {id,http:result.status,accepted:result.ok&&data.id===id&&data.status==='active'};
  }catch{return {id,http:0,accepted:false};}
 }));
}
function customer(data:Record<string,unknown>){
 const name=text(data.name),email=text(data.email,254),cpf=text(data.cpf,20).replace(/\D/g,''),phone=text(data.phone,20).replace(/\D/g,'');
 if(!/^\S+\s+\S/.test(name)||!/^\S+@\S+\.\S+$/.test(email)||!cpfOK(cpf)||!/^[1-9]{2}\d{8,9}$/.test(phone))throw new HttpError(400,'Confira nome completo, e-mail, CPF e telefone do pagador.');
 const zip=text(data.zip,10).replace(/\D/g,''),street=text(data.street),number=text(data.number,15),district=text(data.district),city=text(data.city),state=text(data.state,2).toUpperCase(),complement=text(data.complement||'',100);
 if(!/^\d{8}$/.test(zip)||!street||!number||!district||!city||!['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].includes(state))throw new HttpError(400,'Informe o endereço real e completo do pagador.');
 return {name,email,type:'individual',document:cpf,document_type:'CPF',phones:{mobile_phone:{country_code:'55',area_code:phone.slice(0,2),number:phone.slice(2)}},address:{line_1:`${number}, ${street}, ${district}`,line_2:complement,zip_code:zip,city,state,country:'BR'}};
}
function present(row:typeof charges.$inferSelect){return {...row,status:publicStatus(row.status,row.expiresAt),fingerprint:undefined,requestKey:undefined};}
export async function createCharge(actor:Actor,data:Record<string,unknown>){
 const amount=amountInCents(data.value);
 if(!Number.isSafeInteger(amount)||amount<100||amount>100000000)throw new HttpError(400,'Informe um valor entre R$ 1,00 e R$ 1.000.000,00.');
 const gate=paymentGate(env,actor,amount,data.validation);
 if(gate)throw new HttpError(503,gate);
 const buyer=customer(data);
 const requestKey=text(data.requestKey,36);
 if(!/^[a-f0-9-]{36}$/i.test(requestKey))throw new HttpError(400,'Atualize a página e tente novamente.');
 await limit('charge:'+actor.id,12,60);
 const db=database(),fingerprint=hash(JSON.stringify({amount,buyer}));
 let [row]=await db.select().from(charges).where(and(eq(charges.creatorId,actor.id),eq(charges.requestKey,requestKey)));
 if(row&&row.fingerprint!==fingerprint)throw new HttpError(409,'Esta solicitação já foi usada com outros dados.');
 if(row?.qrCode)return present(row);
 const recipients=await verifyRecipients();
 if(!recipients.every(r=>r.accepted))throw new HttpError(503,recipients.some(r=>r.http===401)?'A Pagar.me recusou a autenticação (401). O administrador precisa corrigir a credencial de produção. Nenhuma cobrança foi criada.':'Os dois recebedores precisam ser aceitos e ativos na API V5. Nenhuma cobrança foi criada.');
 if(!row){
  await db.insert(charges).values({id:randomUUID(),creatorId:actor.id,requestKey,fingerprint,amount}).onConflictDoNothing();
  [row]=await db.select().from(charges).where(and(eq(charges.creatorId,actor.id),eq(charges.requestKey,requestKey)));
 }
 if(!row||row.fingerprint!==fingerprint)throw new HttpError(409,'Solicitação conflitante.');
 if(row.qrCode)return present(row);
 const body={closed:true,items:[{amount,description:'Cobrança JVC PAY',quantity:1,code:row.id}],customer:buyer,payments:[{payment_method:'pix',pix:{expires_in:1800},split:splitRules()}]};
 let result:Response;
 try{result=await fetch('https://api.pagar.me/core/v5/orders',{method:'POST',headers:{...headers(key()),'Idempotency-Key':hash(actor.id+':'+requestKey)},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});}
 catch{await db.update(charges).set({status:'uncertain'}).where(eq(charges.id,row.id));throw new HttpError(502,'Resultado da criação não confirmado. Reenvie os mesmos dados, sem recarregar a página, ou confira o painel Pagar.me.');}
 const order=await result.json().catch(()=>({}));
 if(!result.ok){await db.update(charges).set({status:'rejected'}).where(eq(charges.id,row.id));throw new HttpError(result.status===401?503:422,result.status===401?'A chave da Pagar.me foi recusada (401). Contate o administrador.':'A operadora recusou a cobrança. Confira os dados, a habilitação Pix com split e o painel Pagar.me.');}
 const transaction=order.charges?.[0]?.last_transaction;
 if(!/^or_[a-zA-Z0-9]+$/.test(order.id||''))throw new HttpError(502,'A operadora retornou um pedido inválido. Confira o painel antes de tentar novamente.');
 const date=transaction?.expires_at?new Date(transaction.expires_at):new Date(Date.now()+1800000);
 const [saved]=await db.update(charges).set({orderId:order.id,qrCode:transaction?.qr_code||null,status:order.charges?.[0]?.status||order.status||'pending',providerStatus:order.charges?.[0]?.status||order.status,expiresAt:Number.isNaN(date.getTime())?null:date,checkedAt:new Date()}).where(eq(charges.id,row.id)).returning();
 await record(actor.id,data.validation===true?'charge.validation_created':'charge.created',row.id);
 if(!saved.qrCode)throw new HttpError(502,'Pedido registrado sem código Pix disponível. Consulte esta cobrança no histórico antes de criar outra.');
 return present(saved);
}
export async function ownCharge(actor:Actor,id:string){const [row]=await database().select().from(charges).where(eq(charges.id,id));if(!row||!mayReadCharge(actor,row))throw new HttpError(404,'Cobrança não encontrada.');return row;}
export async function refreshCharge(actor:Actor,id:string){
 const row=await ownCharge(actor,id);
 if(!row.orderId)return present(row);
 if(row.checkedAt&&Date.now()-row.checkedAt.getTime()<8000)return present(row);
 await limit('status:'+actor.id,90,60);
 let result:Response;
 try{result=await fetch('https://api.pagar.me/core/v5/orders/'+encodeURIComponent(row.orderId),{headers:headers(key()),signal:AbortSignal.timeout(10000)});}catch{throw new HttpError(502,'Consulta temporariamente indisponível.');}
 if(!result.ok)throw new HttpError(502,'A operadora não confirmou o status. O último estado conhecido foi preservado.');
 const order=await result.json();
 if(order.id!==row.orderId)throw new HttpError(502,'Resposta de consulta inválida.');
 const charge=order.charges?.[0],providerStatus=charge?.status||order.status||'pending';
 const status=publicStatus(providerStatus,row.expiresAt);
 const [saved]=await database().update(charges).set({status,providerStatus,checkedAt:new Date(),paidAt:providerStatus==='paid'?(row.paidAt||new Date()):row.paidAt}).where(eq(charges.id,row.id)).returning();
 return present(saved);
}
export async function listCharges(actor:Actor,page=1,status='all',mine=false){
 const db=database(),scope=actor.admin&&!mine?undefined:eq(charges.creatorId,actor.id);
 const statusScope=status==='all'?undefined:status==='pending'?sql`(${charges.status} in ('pending','processing') and (${charges.expiresAt} is null or ${charges.expiresAt} > now()))`:status==='expired'?sql`(${charges.status} = 'expired' OR (${charges.status} IN ('pending','processing') AND ${charges.expiresAt} < now()))`:eq(charges.status,status);
 const rows=await db.select({charge:charges,creatorName:profiles.name,creatorEmail:profiles.email}).from(charges).innerJoin(profiles,eq(charges.creatorId,profiles.id)).where(and(scope,statusScope)).orderBy(desc(charges.createdAt)).limit(26).offset((page-1)*25);
 const [totals]=await db.select({paid:sql<number>`coalesce(sum(case when ${charges.status} = 'paid' then ${charges.amount} else 0 end),0)::bigint`,paidCount:sql<number>`count(*) filter (where ${charges.status} = 'paid')::int`,pendingCount:sql<number>`count(*) filter (where ${charges.status} in ('pending','processing') and (${charges.expiresAt} is null or ${charges.expiresAt} > now()))::int`,count:sql<number>`count(*)::int`}).from(charges).where(scope);
 return {hasMore:rows.length>25,items:rows.slice(0,25).map(r=>({...present(r.charge),creatorName:r.creatorName,creatorEmail:r.creatorEmail})),totals:{...totals,paid:Number(totals.paid)},page};
}
export async function syncCharges(actor:Actor,mine=false){
 const rows=await database().select().from(charges).where(and(actor.admin&&!mine?undefined:eq(charges.creatorId,actor.id),inArray(charges.status,['pending','processing','expired']))).orderBy(asc(charges.checkedAt)).limit(5);
 const result=await Promise.allSettled(rows.map(row=>refreshCharge(actor,row.id)));
 return {updated:result.filter(r=>r.status==='fulfilled').length,failed:result.filter(r=>r.status==='rejected').length};
}
