const $ = id => document.getElementById(id);
const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let activeOrder = null, timer = null, checking = false, attempt = null, fingerprint = null;
function mask(id, transform) { $(id).addEventListener('input', () => { $(id).value = transform($(id).value.replace(/\D/g, '')); }); }
mask('cpf', s => s.slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'));
mask('phone', s => { s = s.slice(0, 11); return s.length > 2 ? '(' + s.slice(0, 2) + ') ' + s.slice(2).replace(s.length > 10 ? /(\d{5})(\d)/ : /(\d{4})(\d)/, '$1-$2') : s; });
$('pixForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (activeOrder) { $('result').scrollIntoView({ behavior: 'smooth' }); return; }
  $('error').hidden = true;
  const button = $('submit'); button.disabled = true; button.firstElementChild.textContent = 'Gerando seu Pix…';
  const payload = Object.fromEntries(['visualName', 'value', 'name', 'email', 'cpf', 'phone'].map(id => [id, $(id).value.trim()]));
  const current = JSON.stringify(payload);
  if (current !== fingerprint) { attempt = crypto.randomUUID(); fingerprint = current; }
  try {
    const response = await fetch('/.netlify/functions/create-pix', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt }, body: current });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível gerar o Pix.');
    activeOrder = data.order_id;
    $('copy').value = data.qr_code;
    $('visual').textContent = data.visualName;
    $('paymentAmount').textContent = money(data.amount);
    $('qrGenerated').replaceChildren();
    try { new QRCode($('qrGenerated'), { text: data.qr_code, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M }); }
    catch { $('qrGenerated').hidden = true; $('qrError').hidden = false; }
    if (data.expires_at && !Number.isNaN(Date.parse(data.expires_at))) $('expiration').textContent = 'Válido até ' + new Date(data.expires_at).toLocaleString('pt-BR');
    $('result').hidden = false; $('step2').classList.add('active');
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Keep one charge per page; editing remains available when a request fails.
    $('pixForm').querySelectorAll('input').forEach(input => { input.readOnly = true; });
    timer = setInterval(() => checkStatus(false), 12000);
    setTimeout(() => { clearInterval(timer); }, 1800000);
  } catch (error) { $('error').textContent = error.message || 'Falha de conexão. Tente novamente.'; $('error').hidden = false; }
  finally { button.disabled = false; button.firstElementChild.textContent = activeOrder ? 'Ver meu Pix' : 'Gerar Pix e QR Code'; }
});
$('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('copy').value); $('copyBtn').textContent = 'Código copiado!'; }
  catch { $('copy').focus(); $('copy').select(); $('copyBtn').textContent = 'Selecione e copie o código acima'; }
  setTimeout(() => { $('copyBtn').textContent = 'Copiar código Pix'; }, 2500);
});
async function checkStatus(manual) {
  if (!activeOrder || checking || (!manual && document.hidden)) return;
  checking = true; $('checkBtn').disabled = true; $('statusError').textContent = '';
  try {
    const response = await fetch('/.netlify/functions/check-pix?order_id=' + encodeURIComponent(activeOrder), { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Consulta indisponível.');
    const labels = { paid: 'Pagamento confirmado!', pending: 'Aguardando pagamento', processing: 'Pagamento em processamento', failed: 'Pagamento não concluído', canceled: 'Cobrança cancelada', refunded: 'Pagamento estornado', chargedback: 'Pagamento contestado' };
    $('payStatus').textContent = labels[data.status] || 'Aguardando confirmação';
    if (['paid', 'failed', 'canceled', 'refunded', 'chargedback'].includes(data.status)) {
      clearInterval(timer);
      if (data.status === 'paid') $('step3').classList.add('active');
    } else if (data.expires_at && Date.parse(data.expires_at) < Date.now()) {
      $('payStatus').textContent = 'Prazo do Pix encerrado. Consulte o status para verificar se houve pagamento.';
      clearInterval(timer);
    }
  } catch (error) { $('statusError').textContent = error.message + ' Use “Consultar status agora” para tentar novamente.'; }
  finally { checking = false; $('checkBtn').disabled = false; }
}
$('checkBtn').addEventListener('click', () => checkStatus(true));
