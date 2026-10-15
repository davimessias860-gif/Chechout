const json=(status,obj)=>({statusCode:status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(obj)});
const digits=x=>String(x||'').replace(/\D/g,'');
function cpfOK(v){if(!/^\d{11}$/.test(v)||/^(\d)\1{10}$/.test(v))return false;for(let len=9;len<11;len++){let s=0;for(let i=0;i<len;i++)s+=Number(v[i])*(len+1-i);if(((s*10)%11)%10!==Number(v[len]))return false}return true}
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return json(405,{error:'Método não permitido.'});
 let b;try{b=JSON.parse(event.body||'{}')}catch{return json(400,{error:'Dados inválidos.'})}
 const val=String(b.value||'').trim().replace(/\s/g,'').replace('R$','').replace(',', '.');
 const cents=Math.round(Number(val)*100);const cpf=digits(b.cpf),phone=digits(b.phone);
 if(!Number.isSafeInteger(cents)||cents<100||cents>100000000)return json(400,{error:'Informe um valor válido de pelo menos R$ 1,00.'});
 if(!b.name||String(b.name).trim().length<3||String(b.name).length>150)return json(400,{error:'Informe o nome completo.'});
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email||''))return json(400,{error:'Informe um e-mail válido.'});
 if(!cpfOK(cpf))return json(400,{error:'Informe um CPF válido.'});
 if(!/^\d{10,11}$/.test(phone))return json(400,{error:'Informe um telefone brasileiro com DDD.'});
 const key=process.env.PAGARME_SECRET_KEY;
 const r99=process.env.PAGARME_RECIPIENT_99||'re_cmv8j7x5vtbmy0l9tgfjq8uzn';
 const r1=process.env.PAGARME_RECIPIENT_1||'re_cmv88m9b67jxf0l9tqzl5w9pp';
 if(!key)return json(503,{error:'Configure PAGARME_SECRET_KEY nas variáveis de ambiente do Netlify.'});
 if(!/^rp_/.test(r99)||!/^rp_/.test(r1))return json(503,{error:'Os IDs informados começam com re_, mas a API V5 documenta IDs de split com prefixo rp_. Confirme com a Pagar.me os IDs V5 correspondentes e configure PAGARME_RECIPIENT_99 e PAGARME_RECIPIENT_1 nas variáveis do Netlify. Nenhuma cobrança foi criada.'});
 const body={items:[{amount:cents,description:'Pagamento Pix',quantity:1}],customer:{name:String(b.name).trim(),email:b.email.trim(),type:'individual',document:cpf,phones:{mobile_phone:{country_code:'55',area_code:phone.slice(0,2),number:phone.slice(2)}}},payments:[{payment_method:'pix',pix:{expires_in:1800},split:[{type:'percentage',amount:99,recipient_id:r99,options:{liable:true,charge_processing_fee:true,charge_remainder_fee:true}},{type:'percentage',amount:1,recipient_id:r1,options:{liable:false,charge_processing_fee:false,charge_remainder_fee:false}}]}]};
 try {const resp=await fetch('https://api.pagar.me/core/v5/orders',{method:'POST',headers:{'Authorization':'Basic '+Buffer.from(key+':').toString('base64'),'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)});const data=await resp.json().catch(()=>({}));if(!resp.ok){return json(resp.status>=500?502:422,{error:'A Pagar.me não aceitou criar a cobrança. Para contas PSP, o endereço do comprador pode ser obrigatório. Verifique também habilitação de Split e IDs dos recebedores. Detalhes: '+JSON.stringify(data.errors||data.message||data).slice(0,700)})}const tx=data.charges?.[0]?.last_transaction||{};if(!tx.qr_code)return json(502,{error:'Pedido criado, mas a Pagar.me não retornou o Pix Copia e Cola. Confira o pedido no painel pelo ID '+(data.id||'não informado')+'.'});return json(200,{order_id:data.id,qr_code:tx.qr_code,qr_code_url:tx.qr_code_url,visualName:String(b.visualName||'').slice(0,60)});}catch{return json(502,{error:'Não foi possível conectar à Pagar.me. Tente novamente.'})}
};
