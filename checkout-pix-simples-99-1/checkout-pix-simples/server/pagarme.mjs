import { createHmac, timingSafeEqual } from 'node:crypto';
export function json(status, body, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
export function cpfOK(v) {
  if (!/^\d{11}$/.test(v) || /^(\d)\1{10}$/.test(v)) return false;
  for (let len = 9; len < 11; len++) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(v[i]) * (len + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(v[len])) return false;
  }
  return true;
}
export function amountInCents(value) {
  const raw = String(value ?? '').trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(raw) && !/^\d+\.\d{1,2}$/.test(raw)) return NaN;
  const normalized = raw.includes(',') ? raw.replaceAll('.', '').replace(',', '.') : /^\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replaceAll('.', '') : raw;
  return Math.round(Number(normalized) * 100);
}
export function signature(id, expiry, key) {
  return createHmac('sha256', key).update(`pix-status:${id}:${expiry}`).digest('hex');
}
export function authorized(cookie, id, key) {
  const [order, expiry, proof] = String(cookie || '').split('.');
  if (order !== id || !/^\d+$/.test(expiry || '') || Number(expiry) < Date.now() || !/^[a-f0-9]{64}$/.test(proof || '')) return false;
  return timingSafeEqual(Buffer.from(signature(id, expiry, key)), Buffer.from(proof));
}
export function providerHeaders(key) {
  return { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64'), 'Content-Type': 'application/json', Accept: 'application/json' };
}
