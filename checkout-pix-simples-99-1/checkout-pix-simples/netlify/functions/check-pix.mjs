import { json, authorized, providerHeaders } from '../../server/pagarme.mjs';
export default async function handler(request) {
  if (request.method !== 'GET') return json(405, { error: 'Método não permitido.' }, { Allow: 'GET' });
  const id = new URL(request.url).searchParams.get('order_id') || '';
  if (!/^or_[A-Za-z0-9]+$/.test(id)) return json(400, { error: 'Cobrança inválida.' });
  const key = Netlify.env.get('PAGARME_SECRET_KEY');
  if (!key) return json(503, { error: 'Consulta temporariamente indisponível.' });
  const cookie = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith('pix_order='))?.slice(10);
  if (!authorized(cookie, id, key)) return json(403, { error: 'Esta cobrança não pertence à sessão atual.' });
  try {
    const response = await fetch('https://api.pagar.me/core/v5/orders/' + encodeURIComponent(id), { headers: providerHeaders(key), signal: AbortSignal.timeout(15000) });
    if (!response.ok) return json(502, { error: 'Não foi possível consultar o pagamento. Tente novamente.' });
    const data = await response.json();
    const charge = data.charges?.[0];
    return json(200, { status: charge?.status || data.status || 'pending', expires_at: charge?.last_transaction?.expires_at || null });
  } catch { return json(502, { error: 'A consulta está indisponível. Tente novamente em instantes.' }); }
}
