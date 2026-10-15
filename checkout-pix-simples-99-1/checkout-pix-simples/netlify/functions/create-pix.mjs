import { json, cpfOK, amountInCents, signature, providerHeaders } from '../../server/pagarme.mjs';
export default async function handler(request) {
  if (request.method !== 'POST') return json(405, { error: 'Método não permitido.' }, { Allow: 'POST' });
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json(403, { error: 'Origem não permitida.' });
  if (Number(request.headers.get('content-length')) > 8192) return json(413, { error: 'Dados muito extensos.' });
  let b;
  try { b = await request.json(); } catch { return json(400, { error: 'Dados inválidos.' }); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json(400, { error: 'Dados inválidos.' });
  const cents = amountInCents(b.value);
  const cpf = String(b.cpf || '').replace(/\D/g, '');
  const phone = String(b.phone || '').replace(/\D/g, '');
  if (!Number.isSafeInteger(cents) || cents < 100 || cents > 100000000) return json(400, { error: 'Informe um valor entre R$ 1,00 e R$ 1.000.000,00.' });
  if (typeof b.name !== 'string' || !/^\S+\s+\S/.test(b.name.trim()) || b.name.length > 150) return json(400, { error: 'Informe seu nome e sobrenome.' });
  if (typeof b.email !== 'string' || b.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) return json(400, { error: 'Informe um e-mail válido.' });
  if (!cpfOK(cpf)) return json(400, { error: 'Informe um CPF válido.' });
  if (!/^[1-9]{2}\d{8,9}$/.test(phone)) return json(400, { error: 'Informe um telefone brasileiro com DDD.' });
  if (b.visualName != null && (typeof b.visualName !== 'string' || b.visualName.length > 60)) return json(400, { error: 'O nome visual deve ter até 60 caracteres.' });
  const attempt = request.headers.get('Idempotency-Key');
  if (!/^[a-f0-9-]{36}$/i.test(attempt || '')) return json(400, { error: 'Atualize a página e tente novamente.' });
  const key = Netlify.env.get('PAGARME_SECRET_KEY');
  if (!key) return json(503, { error: 'O pagamento ainda não está disponível. A chave privada da Pagar.me precisa ser configurada pelo responsável pelo site.' });
  // The secondary recipient is fixed by the checkout's business rule.
  const r99 = 're_cmv8j7x5vtbmy0l9tgfjq8uzn';
  // Never infer the account's principal recipient or substitute an example ID.
  const r1 = (Netlify.env.get('PAGARME_RECIPIENT_1') || '').trim();
  if (r1 !== 're_cmv88m9b67jxf0l9tqzl5w9pp') return json(503, { error: 'O responsável precisa configurar o identificador real do recebedor principal da conta Pagar.me antes de aceitar pagamentos.' });
  // Active/accessibility checks do not prove which recipient is the account principal.
  // Activation requires the operator's explicit confirmation, as requested.
  if (Netlify.env.get('PAGARME_PRINCIPAL_CONFIRMED') !== 'true') return json(503, { error: 'Os pagamentos ainda não foram ativados. O responsável precisa confirmar o recebedor principal da conta Pagar.me.' });
  const body = {
    items: [{ amount: cents, description: 'Pagamento Pix', quantity: 1 }],
    customer: { name: b.name.trim(), email: b.email.trim(), type: 'individual', document: cpf, document_type: 'CPF', phones: { mobile_phone: { country_code: '55', area_code: phone.slice(0, 2), number: phone.slice(2) } } },
    payments: [{ payment_method: 'pix', pix: { expires_in: 1800 }, split: [
      { type: 'percentage', amount: 99, recipient_id: r99, options: { liable: true, charge_processing_fee: true, charge_remainder_fee: true } },
      { type: 'percentage', amount: 1, recipient_id: r1, options: { liable: false, charge_processing_fee: false, charge_remainder_fee: false } }
    ] }]
  };
  let creationStarted = false;
  try {
    // Validate both recipients using the same credentials used to create the order.
    // A prefix alone neither proves validity nor identifies the principal account.
    const recipients = await Promise.all([r99, r1].map(async id => {
      const result = await fetch('https://api.pagar.me/core/v5/recipients/' + encodeURIComponent(id), {
        headers: providerHeaders(key), signal: AbortSignal.timeout(8000)
      });
      if (!result.ok) return false;
      const recipient = await result.json();
      return recipient.id === id && recipient.status === 'active';
    }));
    if (!recipients.every(Boolean)) return json(503, { error: 'Os dois recebedores precisam ser reconhecidos e estar ativos na conta Pagar.me. Nenhuma cobrança foi criada. O responsável deve verificar os identificadores e a habilitação do split.' });
    creationStarted = true;
    const response = await fetch('https://api.pagar.me/core/v5/orders', { method: 'POST', headers: { ...providerHeaders(key), 'Idempotency-Key': attempt }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return json(response.status >= 500 ? 502 : 422, { error: 'A Pagar.me não aceitou a cobrança. O responsável deve verificar os recebedores, a habilitação do split e os dados exigidos pela conta no painel da Pagar.me.' });
    const tx = data.charges?.[0]?.last_transaction;
    if (!tx?.qr_code || !/^or_[A-Za-z0-9]+$/.test(data.id || '')) return json(502, { error: 'A cobrança não retornou um Pix válido. Consulte o painel da Pagar.me antes de tentar outra cobrança.' });
    const expiry = Date.now() + 24 * 60 * 60 * 1000;
    const cookie = `pix_order=${data.id}.${expiry}.${signature(data.id, expiry, key)}; HttpOnly; Secure; SameSite=Strict; Path=/.netlify/functions/check-pix; Max-Age=86400`;
    return json(200, { order_id: data.id, qr_code: tx.qr_code, amount: cents, expires_at: tx.expires_at || null, visualName: (b.visualName || '').trim() }, { 'Set-Cookie': cookie });
  } catch { return json(502, { error: creationStarted ? 'Não foi possível confirmar a criação. Tente novamente com os mesmos dados para reutilizar a solicitação.' : 'A verificação dos recebedores está indisponível. Nenhuma cobrança foi criada.' }); }
}
