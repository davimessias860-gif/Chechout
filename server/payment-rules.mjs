export const SECONDARY='re_cmv8j7x5vtbmy0l9tgfjq8uzn';
export const PRINCIPAL='re_cmv88m9b67jxf0l9tqzl5w9pp';
export function splitRules(){return [
 {type:'percentage',amount:99,recipient_id:SECONDARY,options:{liable:true,charge_processing_fee:true,charge_remainder_fee:true}},
 {type:'percentage',amount:1,recipient_id:PRINCIPAL,options:{liable:false,charge_processing_fee:false,charge_remainder_fee:false}}
];}
export function cpfOK(v){if(!/^\d{11}$/.test(v)||/^(\d)\1{10}$/.test(v))return false;for(let len=9;len<11;len++){let sum=0;for(let i=0;i<len;i++)sum+=Number(v[i])*(len+1-i);if(((sum*10)%11)%10!==Number(v[len]))return false;}return true;}
export function amountInCents(value){const raw=String(value??'').trim();if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(raw)&&!/^\d+\.\d{1,2}$/.test(raw))return NaN;return Math.round(Number(raw.includes(',')?raw.replaceAll('.','').replace(',','.'):/^\d{1,3}(?:\.\d{3})+$/.test(raw)?raw.replaceAll('.',''):raw)*100);}
export function publicStatus(status,expiresAt,now=Date.now()){
 if(status==='paid')return 'paid';
 if(['refunded','chargedback','failed','canceled','expired','rejected'].includes(status))return status;
 return expiresAt&&new Date(expiresAt).getTime()<now?'expired':status;
}
export function mayReadCharge(actor,charge){return actor.admin||actor.id===charge.creatorId;}
export function paymentGate(env,actor,amount,validation){
 if(env('PAGARME_RECIPIENT_1')!==PRINCIPAL)return 'O recebedor de 1% precisa ser configurado corretamente.';
 if(env('PAGARME_PRINCIPAL_CONFIRMED')!=='true')return 'A confirmação do recebedor principal está pendente.';
 if(env('PAGARME_RECEIVABLES_CONFIRMED')!=='true'&&!(actor.admin&&validation===true&&amount===1000))return 'Pagamentos bloqueados até a conferência dos recebíveis. Apenas o administrador pode gerar a cobrança de validação de R$ 10,00.';
 return null;
}
