import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../checkout-pix-simples-99-1/checkout-pix-simples/netlify/functions/create-pix.mjs';
import check from '../checkout-pix-simples-99-1/checkout-pix-simples/netlify/functions/check-pix.mjs';
import { amountInCents, cpfOK } from '../checkout-pix-simples-99-1/checkout-pix-simples/server/pagarme.mjs';
test('Valores em reais são convertidos em centavos sem aceitar formatos inválidos', () => {
  for (const [input, expected] of [['25,90',2590],['1.234,56',123456],['1.000',100000],['25.90',2590],['10',1000]]) assert.equal(amountInCents(input),expected);
  for (const input of ['1e3','-10','1,234','abc','10abc']) assert.ok(Number.isNaN(amountInCents(input)));
  assert.equal(cpfOK('11111111111'),false); assert.equal(cpfOK('52998224725'),true);
});
test('Criação, split, idempotência e consulta restrita à sessão', async () => {
  const oldFetch = globalThis.fetch;
  const env = { PAGARME_SECRET_KEY: 'mock-only', PAGARME_RECIPIENT_1: 're_cmv88m9b67jxf0l9tqzl5w9pp', PAGARME_PRINCIPAL_CONFIRMED: 'true' };
  globalThis.Netlify = { env: { get: name => env[name] } };
  const body = { value:'25,90', name:'Pessoa de Teste', email:'teste@example.com', cpf:'52998224725', phone:'11999998888', visualName:'Instituição' };
  const request = data => new Request('https://checkout.example/.netlify/functions/create-pix', { method:'POST', headers:{ 'Content-Type':'application/json', 'Idempotency-Key':'12345678-1234-1234-1234-123456789012' }, body:JSON.stringify(data) });
  try {
    assert.equal((await create(request(null))).status,400);
    assert.equal((await create(request({...body,cpf:'123'}))).status,400);
    delete env.PAGARME_PRINCIPAL_CONFIRMED;
    assert.equal((await create(request(body))).status,503);
    env.PAGARME_PRINCIPAL_CONFIRMED = 'true';
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      if (url.includes('/recipients/')) return Response.json({id: url.split('/').at(-1), status:'active'});
      if (options.method === 'POST') {
        const sent = JSON.parse(options.body);
        assert.equal(sent.items[0].amount,2590);
        assert.deepEqual(sent.payments[0].split.map(x => [x.amount,x.recipient_id]),[[99,'re_cmv8j7x5vtbmy0l9tgfjq8uzn'],[1,'re_cmv88m9b67jxf0l9tqzl5w9pp']]);
        assert.equal(options.headers['Idempotency-Key'],'12345678-1234-1234-1234-123456789012');
        return Response.json({id:'or_test123',charges:[{last_transaction:{qr_code:'000201mock'}}]});
      }
      return Response.json({status:'paid'});
    };
    const created = await create(request(body)); assert.equal(created.status,200);
    const data = await created.json(); assert.equal(data.qr_code,'000201mock');
    const cookie = created.headers.get('set-cookie').split(';')[0];
    const statusURL = 'https://checkout.example/.netlify/functions/check-pix?order_id=or_test123';
    assert.equal((await check(new Request(statusURL))).status,403);
    assert.equal(calls,3);
    const status = await check(new Request(statusURL,{headers:{cookie}}));
    assert.equal((await status.json()).status,'paid');
    assert.equal((await check(new Request(statusURL.replace('test123','other'),{headers:{cookie}}))).status,403);
    delete env.PAGARME_RECIPIENT_1;
    const beforeMissing = calls;
    assert.equal((await create(request(body))).status,503);
    assert.equal(calls,beforeMissing);
    env.PAGARME_RECIPIENT_1 = 're_cmv8j7x5vtbmy0l9tgfjq8uzn';
    assert.equal((await create(request(body))).status,503);
    env.PAGARME_RECIPIENT_1 = 're_cmv88m9b67jxf0l9tqzl5w9pp';
    let orderCreated = false;
    globalThis.fetch = async (url, options) => {
      if (options.method === 'POST') { orderCreated = true; throw new Error('Must not create'); }
      return Response.json({id: url.split('/').at(-1), status:'inactive'});
    };
    assert.equal((await create(request(body))).status,503);
    assert.equal(orderCreated,false);
    for (const response of [
      () => Response.json({message:'not-authorized'}, {status:401}),
      () => Response.json({id:'re_wrongRecipient',status:'active'})
    ]) {
      orderCreated = false;
      globalThis.fetch = async (url, options) => {
        if (options.method === 'POST') orderCreated = true;
        return response();
      };
      assert.equal((await create(request(body))).status,503);
      assert.equal(orderCreated,false);
    }
    globalThis.fetch = async (url) => url.includes('/recipients/')
      ? Response.json({id: url.split('/').at(-1), status:'active'})
      : Response.json({error:'provider-private-data'},{status:422});
    const failure = await create(request(body));
    assert.equal(failure.status,422); assert.ok(!(await failure.text()).includes('provider-private-data'));
  } finally { globalThis.fetch = oldFetch; delete globalThis.Netlify; }
});
