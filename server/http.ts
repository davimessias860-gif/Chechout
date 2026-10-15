import { verifyRequestOrigin } from '@netlify/identity';
export class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
export function json(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export async function readBody(req:Request){
 verifyRequestOrigin(req);
 if(!req.headers.get('content-type')?.includes('application/json'))throw new HttpError(415,'Envie os dados em JSON.');
 const raw=await req.text(); if(raw.length>16384)throw new HttpError(413,'Solicitação muito extensa.');
 try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw 0;return value;}catch{throw new HttpError(400,'Dados inválidos.');}
}
export function text(value:unknown,max=150){if(typeof value!=='string'||value.trim().length>max)throw new HttpError(400,'Dados inválidos.');return value.trim();}
export function passwordOK(value:unknown){if(typeof value!=='string'||value.length<12||value.length>128)throw new HttpError(400,'Use uma senha de 12 a 128 caracteres.');return value;}
