'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = { user: null, enabled: false, charge: null, timer: null, invite: null, ownPage: 1, adminPage: 1, view: 'generator', tab: 'users', rows: new Map(), refreshing: false, historyBusy: false, epoch: 0 };
  const labels = { pending:'Pendente', processing:'Pendente', paid:'Pago', expired:'Expirado', creating:'Criando', uncertain:'Criação não confirmada', rejected:'Recusado', failed:'Falhou', canceled:'Cancelado', refunded:'Estornado', chargedback:'Contestado' };
  const money = value => (Number(value || 0) / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  const date = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : '—';
  const initial = name => String(name || '?').split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
  function message(id, value) { $(id).textContent = value || ''; $(id).hidden = !value; }
  function toast(text) { message('toast', text); clearTimeout(toast.timer); toast.timer = setTimeout(()=>{ $('toast').hidden=true; },4000); }
  function node(tag, text, className) { const el=document.createElement(tag); if(text!==undefined)el.textContent=text;if(className)el.className=className;return el; }
  function badge(status) { return node('span',labels[status] || 'Aguardando confirmação','status '+(Object.hasOwn(labels,status)?status:'neutral')); }
  function sessionEnded(text) {
    state.epoch++; state.user=null; state.charge=null; state.rows.clear(); clearInterval(state.timer);
    $('appView').hidden=true; $('loginView').hidden=false; $('pixResult').hidden=true; $('pixEmpty').hidden=false; $('adminView').hidden=true;
    $('chargeForm').reset(); $('newUserForm').reset(); $('passwordForm').reset(); $('loginForm').reset();
    $('qrCode').replaceChildren(); $('qrCode').dataset.content=''; $('pixCode').value=''; ['ownHistory','userList','adminPayments'].forEach(id=>$(id).replaceChildren());
    if(text)message('loginError',text);
  }
  async function api(path, options = {}) {
    let response;
    try { response=await fetch('/api'+path,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},body:options.body?JSON.stringify(options.body):undefined}); }
    catch { throw new Error('Não foi possível conectar. Verifique sua conexão e tente novamente.'); }
    const data=await response.json().catch(()=>({}));
    if(!response.ok) { if(response.status===401&&state.user)sessionEnded('Sua sessão expirou. Entre novamente.'); const error=new Error(data.error||'O serviço não concluiu a operação. Tente novamente.');error.status=response.status;throw error; }
    return data;
  }
  async function action(button, job, errorId='globalError') {
    if(button.disabled)return; const prior=button.disabled; button.disabled=true; button.setAttribute('aria-busy','true'); message(errorId,'');
    try{return await job();}catch(error){message(errorId,error.message);}finally{button.disabled=prior;button.removeAttribute('aria-busy');}
  }
  function updateGenerationLock() { $('generateBtn').disabled=!state.user||(!state.enabled&&!(state.user.admin&&$('chargeForm').elements.validation.checked)); }
  async function enter() {
    const result=await api('/session'); state.user=result.user;state.enabled=result.paymentsEnabled;
    $('loginView').hidden=true; $('appView').hidden=false; $('accountName').textContent=state.user.name;
    $('accountRole').textContent=state.user.admin?'Administrador':'Usuário'; $('avatar').textContent=initial(state.user.name);
    $('adminNav').hidden=!state.user.admin; $('validationLabel').hidden=!state.user.admin; $('paymentNotice').hidden=state.enabled;
    $('passwordView').hidden=!state.user.mustChangePassword; $('generatorNav').disabled=state.user.mustChangePassword;
    $('adminNav').disabled=state.user.mustChangePassword; $('generatorView').hidden=state.user.mustChangePassword; $('adminView').hidden=true;
    updateGenerationLock(); if(!state.user.mustChangePassword)await navigate('generator');
    clearInterval(state.timer); state.timer=setInterval(poll,15000);
  }
  async function navigate(view) {
    if(!state.user||state.user.mustChangePassword)return;
    if(view==='admin'&&!state.user.admin)return;
    state.view=view; $('generatorView').hidden=view!=='generator'; $('adminView').hidden=view!=='admin';
    $('generatorNav').classList.toggle('active',view==='generator');$('adminNav').classList.toggle('active',view==='admin');
    $('breadcrumb').textContent=view==='admin'?'Administração':'Gerador de Pix';message('globalError','');
    try { if(view==='generator')await loadHistory(false);else await showTab(state.tab); }catch(error){message('globalError',error.message);}
  }
  async function showTab(tab) {
    if(!state.user?.admin)return;state.tab=tab;
    document.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('active',button.dataset.tab===tab));
    ['users','payments','integration'].forEach(name=>$(name+'Tab').hidden=name!==tab);
    if(tab==='users')await loadUsers();else if(tab==='payments')await loadHistory(true);else await loadIntegration();
  }
  $('loginForm').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;action(form.querySelector('[type=submit]'),async()=>{await api('/login',{method:'POST',body:Object.fromEntries(new FormData(form))});form.reset();await enter();},'loginError');});
  $('showPassword').addEventListener('click',()=>{const visible=$('loginPassword').type==='password';$('loginPassword').type=visible?'text':'password';$('showPassword').textContent=visible?'Ocultar':'Mostrar';$('showPassword').setAttribute('aria-label',visible?'Ocultar senha':'Mostrar senha');});
  $('inviteForm').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;action(form.querySelector('[type=submit]'),async()=>{const body=Object.fromEntries(new FormData(form));if(body.password!==body.confirmation)throw new Error('As senhas precisam ser iguais.');const result=await api('/accept-invite',{method:'POST',body:{token:state.invite,password:body.password}});form.reset();state.invite=null;$('inviteForm').hidden=true;$('loginForm').hidden=false;$('loginTitle').textContent='Bem-vindo de volta';$('loginDescription').textContent='Informe o e-mail e a senha do seu acesso.';if(result.user?.pendingApproval){toast('Senha definida. O administrador precisa atribuir a função admin na Netlify antes do primeiro login.');return;}await enter();},'inviteError');});
  $('passwordForm').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;action(form.querySelector('[type=submit]'),async()=>{const body=Object.fromEntries(new FormData(form));if(body.password!==body.confirmation)throw new Error('As senhas precisam ser iguais.');await api('/password',{method:'POST',body:{password:body.password}});sessionEnded();toast('Senha alterada. Entre novamente com a nova senha.');},'passwordError');});
  $('logoutBtn').addEventListener('click',()=>action($('logoutBtn'),async()=>{await api('/logout',{method:'POST',body:{}});sessionEnded();}));
  $('generatorNav').addEventListener('click',()=>navigate('generator'));$('adminNav').addEventListener('click',()=>navigate('admin'));
  document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>showTab(button.dataset.tab).catch(error=>message('globalError',error.message))));
  $('chargeForm').elements.validation.addEventListener('change',()=>{if($('chargeForm').elements.validation.checked)$('chargeForm').elements.value.value='10,00';updateGenerationLock();});
  async function attemptKey(payload) {
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
    const fingerprint=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
    const storage='jvc_attempt_'+state.user.id;let old;
    try{old=JSON.parse(sessionStorage.getItem(storage)||'null');}catch{}
    if(old?.fingerprint===fingerprint&&Date.now()-old.createdAt<23*3600000)return old.key;
    const key=crypto.randomUUID();try{sessionStorage.setItem(storage,JSON.stringify({fingerprint,key,createdAt:Date.now()}));}catch{}
    return key;
  }
  $('chargeForm').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;action($('generateBtn'),async()=>{
    const payload=Object.fromEntries(new FormData(form));payload.validation=form.elements.validation.checked;payload.requestKey=await attemptKey(payload);
    const epoch=state.epoch;const result=await api('/charges',{method:'POST',body:payload});if(epoch!==state.epoch)return;
    state.charge=result.charge;renderCharge(result.charge);toast('Cobrança criada. Confira os dados antes de pagar.');await loadHistory(false);
  },'chargeError');});
  function renderCharge(charge) {
    state.charge=charge;$('pixEmpty').hidden=false;$('pixResult').hidden=true;
    const status=charge.status;$('resultBadge').className='status '+(Object.hasOwn(labels,status)?status:'neutral');$('resultBadge').textContent=labels[status]||'Aguardando confirmação';
    if(!charge.qrCode){toast('Esta cobrança não possui código Pix. Consulte o status e o painel da operadora.');return;}
    $('pixEmpty').hidden=true;$('pixResult').hidden=false;$('resultAmount').textContent=money(charge.amount);$('pixCode').value=charge.qrCode;
    $('expiresAt').textContent=(status==='expired'?'Prazo encerrado: ':'Válido até: ')+date(charge.expiresAt);
    $('orderReference').textContent='Pedido: '+(charge.orderId||'Aguardando confirmação');message('pixStatusError','');
    if($('qrCode').dataset.content!==charge.qrCode){
      $('qrCode').replaceChildren();$('qrError').hidden=true;
      try{new QRCode($('qrCode'),{text:charge.qrCode,width:190,height:190,correctLevel:QRCode.CorrectLevel.M});$('qrCode').dataset.content=charge.qrCode;$('qrCode').setAttribute('role','img');$('qrCode').setAttribute('aria-label','QR Code Pix da cobrança');}
      catch{$('qrError').hidden=false;$('qrCode').dataset.content='';}
    }
    $('copyBtn').disabled=['expired','canceled','failed','refunded','chargedback'].includes(status);
  }
  async function refreshCurrent(){if(!state.charge||state.refreshing)return;state.refreshing=true;const id=state.charge.id,epoch=state.epoch;try{const result=await api('/charges/'+id+'/refresh',{method:'POST',body:{}});if(epoch===state.epoch&&state.charge?.id===id)renderCharge(result.charge);}finally{state.refreshing=false;}}
  $('refreshPix').addEventListener('click',()=>action($('refreshPix'),async()=>{await refreshCurrent();await loadHistory(false);},'pixStatusError'));
  $('copyBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('pixCode').value);toast('Código Pix copiado.');}catch{$('pixCode').focus();$('pixCode').select();toast('Selecione e copie o código acima.');}});
  async function poll(){
    if(!state.user||state.user.mustChangePassword||document.hidden||state.refreshing)return;
    try{if(state.charge&&['pending','processing','expired','uncertain','creating'].includes(state.charge.status))await refreshCurrent();if(state.user)await loadHistory(state.view==='admin'&&state.tab==='payments');}
    catch(error){if(state.user)message('pixStatusError',error.message);}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
  function renderTable(items,adminView,container) {
    container.replaceChildren();if(!items.length){container.append(node('div','Nenhuma cobrança encontrada.','empty-state'));return;}
    const table=node('table'),thead=node('thead'),tr=node('tr');
    const headings=['Data','Valor','Status',...(adminView?['Criado por']:[]),'Ação'];headings.forEach(t=>tr.append(node('th',t)));thead.append(tr);table.append(thead);
    const tbody=node('tbody');items.forEach(row=>{
      state.rows.set(row.id,row);const line=node('tr');const dateCell=node('td',date(row.createdAt));dateCell.append(node('small',row.orderId||'Pedido não confirmado'));line.append(dateCell);
      const amount=node('td');amount.append(node('strong',money(row.amount)));line.append(amount);const status=node('td');status.append(badge(row.status));line.append(status);
      if(adminView){const owner=node('td',row.creatorName);owner.append(node('small',row.creatorEmail));line.append(owner);}
      const actions=node('td'),button=node('button',row.qrCode?'Abrir Pix':'Consultar','text-button');button.type='button';button.addEventListener('click',()=>action(button,async()=>{const result=await api('/charges/'+row.id+'/refresh',{method:'POST',body:{}});await navigate('generator');renderCharge(result.charge);$('resultHeading').scrollIntoView?.({behavior:'smooth',block:'center'});}));actions.append(button);line.append(actions);tbody.append(line);
    });table.append(tbody);container.append(table);
  }
  async function loadHistory(adminView) {
    if(!state.user||state.historyBusy)return;state.historyBusy=true;const epoch=state.epoch;
    try{
      const page=adminView?state.adminPage:state.ownPage;const filter=adminView?$('paymentFilter').value:'all';
      const result=await api('/charges?page='+page+'&status='+encodeURIComponent(filter)+(adminView?'':'&scope=mine'));if(epoch!==state.epoch)return;
      renderTable(result.items,adminView,$(adminView?'adminPayments':'ownHistory'));$(adminView?'adminPage':'ownPage').textContent='Página '+page;
      $(adminView?'adminPrev':'ownPrev').disabled=page<=1;$(adminView?'adminNext':'ownNext').disabled=!result.hasMore;
      if(adminView){$('paidTotal').textContent=money(result.totals.paid);$('paidCount').textContent=result.totals.paidCount;$('pendingCount').textContent=result.totals.pendingCount;}
      else{$('ownSummary').replaceChildren();const total=node('span','Total pago bruto: ');total.append(node('strong',money(result.totals.paid)));$('ownSummary').append(total,node('span',result.totals.pendingCount+' pendentes'));}
    }finally{state.historyBusy=false;}
  }
  $('refreshHistory').addEventListener('click',()=>action($('refreshHistory'),async()=>{const result=await api('/sync',{method:'POST',body:{scope:'mine'}});await loadHistory(false);if(result.failed)toast('Algumas consultas falharam; o último status foi preservado.');}));
  for(const [id,adminView,delta] of [['ownPrev',false,-1],['ownNext',false,1],['adminPrev',true,-1],['adminNext',true,1]])$(id).addEventListener('click',()=>{if(adminView)state.adminPage=Math.max(1,state.adminPage+delta);else state.ownPage=Math.max(1,state.ownPage+delta);loadHistory(adminView).catch(error=>message('globalError',error.message));});
  $('paymentFilter').addEventListener('change',()=>{state.adminPage=1;loadHistory(true).catch(error=>message('globalError',error.message));});
  $('syncPayments').addEventListener('click',()=>action($('syncPayments'),async()=>{const result=await api('/sync',{method:'POST',body:{}});$('syncMessage').textContent=result.updated+' consultas concluídas'+(result.failed?'; '+result.failed+' falharam. O último status foi preservado.':'. Totais brutos, antes do split e das taxas.');await loadHistory(true);}));
  async function confirmAction(title,description){const dialog=$('confirmDialog');$('confirmTitle').textContent=title;$('confirmDescription').textContent=description;dialog.returnValue='cancel';dialog.showModal();return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));}
  async function loadUsers(){
    const epoch=state.epoch;const result=await api('/users');if(epoch!==state.epoch)return;$('userList').replaceChildren();
    result.users.forEach(user=>{
      const row=node('div',undefined,'user-row'),avatar=node('span',initial(user.name),'avatar'),info=node('div',undefined,'user-info');info.append(node('strong',user.name),node('small',user.email));row.append(avatar,info);
      const controls=node('div',undefined,'user-controls');controls.append(node('span',user.deleted?'Excluído':user.blocked?'Bloqueado':'Ativo','status '+(user.deleted||user.blocked?'expired':'paid')));
      if(!user.deleted&&user.id!==state.user.id){
        const block=node('button',user.blocked?'Desbloquear':'Bloquear','text-button');block.type='button';block.addEventListener('click',()=>action(block,async()=>{if(!await confirmAction(user.blocked?'Desbloquear acesso?':'Bloquear acesso?',user.name+' — as sessões existentes serão encerradas.'))return;await api('/users/'+user.id,{method:'PATCH',body:{blocked:!user.blocked}});await loadUsers();toast('Acesso atualizado.');}));
        const remove=node('button','Excluir','text-button danger-text');remove.type='button';remove.addEventListener('click',()=>action(remove,async()=>{if(!await confirmAction('Excluir usuário?',user.name+' perderá o acesso. O histórico das cobranças permanece registrado.'))return;await api('/users/'+user.id,{method:'DELETE',body:{}});await loadUsers();toast('Acesso excluído.');}));controls.append(block,remove);
      }else if(user.id===state.user.id)controls.append(node('small','Seu acesso'));
      row.append(controls);$('userList').append(row);
    });if(!result.users.length)$('userList').append(node('div','Nenhum usuário cadastrado.','empty-state'));
  }
  $('refreshUsers').addEventListener('click',()=>action($('refreshUsers'),loadUsers));
  $('newUserForm').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;message('userSuccess','');action(form.querySelector('[type=submit]'),async()=>{await api('/users',{method:'POST',body:Object.fromEntries(new FormData(form))});form.reset();message('userSuccess','Usuário criado. Compartilhe a senha inicial por um canal privado.');await loadUsers();},'userError');});
  async function loadIntegration(){const result=await api('/integration');$('integrationChecks').replaceChildren();for(const [title,ok] of [['Chave configurada no servidor',result.keyConfigured],['Principal confirmado pelo responsável',result.principalConfirmed],['Dois recebíveis conferidos na Pagar.me',result.receivablesConfirmed]]){const line=node('div',undefined,'integration-check');line.append(node('span',title),node('b',ok?'Configurado':'Pendente'));$('integrationChecks').append(line);}}
  $('verifyIntegration').addEventListener('click',()=>action($('verifyIntegration'),async()=>{const result=await api('/integration/verify',{method:'POST',body:{}});$('integrationResult').textContent=result.recipients.map((r,i)=>(i===0?'Thiago Farias (99%)':'João Victor (1%)')+': '+(r.accepted?'ID aceito e ativo na V5.':r.http===401?'HTTP 401. Corrija a chave secreta e confirme a conta/ambiente na Pagar.me.':r.http?'HTTP '+r.http+'. ID não confirmado pela V5.':'Consulta indisponível.')).join('\n')+'\nA consulta não comprova quem é o principal nem valida os recebíveis.';await loadIntegration();}));
  async function init(){
    // Handlers are installed before enabling forms; no credentials fall back to a native GET.
    document.querySelectorAll('fieldset.pending-form').forEach(fieldset=>fieldset.disabled=false);
    $('loginTitle').textContent='Bem-vindo de volta';$('loginDescription').textContent='Informe o e-mail e a senha do seu acesso.';
    const params=new URLSearchParams(location.hash.slice(1));state.invite=params.get('invite_token');
    if(state.invite){history.replaceState(null,'',location.pathname+location.search);$('loginForm').hidden=true;$('inviteForm').hidden=false;$('loginTitle').textContent='Ative seu acesso';$('loginDescription').textContent='Defina uma senha pessoal para aceitar o convite.';return;}
    try{await enter();}catch(error){if(error.status!==401)message('loginError',error.message);}
  }
  init();
})();
