const $ = id => document.getElementById(id);
const digits = v => v.replace(/\D/g,'');
$('pixForm').addEventListener('submit', async event => {
  event.preventDefault(); $('error').hidden = true; $('result').hidden = true;
  const button = $('submit'); button.disabled=true;button.textContent='Gerando...';
  try {
    const response=await fetch('/.netlify/functions/create-pix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visualName:$('visualName').value.trim(),value:$('value').value,name:$('name').value.trim(),email:$('email').value.trim(),cpf:digits($('cpf').value),phone:digits($('phone').value)})});
    const data=await response.json(); if(!response.ok) throw new Error(data.error||'Não foi possível gerar o Pix.');
    $('copy').value=data.qr_code;$('visual').textContent=data.visualName?`Referência visual: ${data.visualName}`:'';
    $('qrGenerated').replaceChildren();$('qrImg').hidden=true;$('qrImg').removeAttribute('src');
    if(typeof QRCode!=='undefined') {new QRCode($('qrGenerated'),{text:data.qr_code,width:200,height:200,correctLevel:QRCode.CorrectLevel.M});}
    else if(data.qr_code_url){$('qrImg').src=data.qr_code_url;$('qrImg').hidden=false;}
    else {throw new Error('Pix criado, mas a biblioteca de QR Code não carregou. Copie o código e tente novamente.');}
    $('payStatus').textContent='Cobrança criada — aguardando pagamento';$('result').hidden=false;$('result').scrollIntoView({behavior:'smooth'});
    if(data.order_id) pollStatus(data.order_id);
  } catch(e){$('error').textContent=e.message;$('error').hidden=false;}finally{button.disabled=false;button.textContent='Gerar Pix e QR Code';}
});
$('copyBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('copy').value);$('copyBtn').textContent='Copiado!';setTimeout(()=>$('copyBtn').textContent='Copiar código Pix',2200)}catch{$('copy').select();document.execCommand('copy')}});
async function pollStatus(id){for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,10000));if($('result').hidden)return;try{const r=await fetch('/.netlify/functions/check-pix?order_id='+encodeURIComponent(id));if(!r.ok)continue;const d=await r.json();if(d.status==='paid'){$('payStatus').textContent='Pagamento confirmado!';return}if(['canceled','failed'].includes(d.status)){$('payStatus').textContent='Pagamento não concluído ('+d.status+')';return}}catch{}}}
