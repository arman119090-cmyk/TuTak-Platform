// Юнит-тесты логики заявки. Запуск: npm test (Node ≥ 22.18 — снимает типы с .ts сам).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeArmenianPhone,
  validateLead,
  RateLimiter,
  formatLeadMessage,
  sendToTelegram,
  clientIp,
} from '../src/lib/lead.ts';

const good = { name: 'Арам', phone: '+374 43 357 007', type: 'residential', consent: 'on', locale: 'ru' };

test('телефон: принимаем армянские форматы', () => {
  for (const raw of ['+374 43 357 007', '+37443357007', '374 43 357007', '043 357 007', '(043) 35-70-07', '00374 43 357 007', '+374 10 123456']) {
    assert.equal(normalizeArmenianPhone(raw)?.slice(0, 4), '+374', raw);
  }
  assert.equal(normalizeArmenianPhone('043 357 007'), '+37443357007');
});

test('телефон: отклоняем чужие и битые номера', () => {
  for (const raw of ['', '+7 999 123 45 67', '+374 43 357 00', '+374 43 357 0077', '43357007', '+374 03 357 007', '+0043357007', 'abc043357007', '+374-43-357-007; DROP']) {
    assert.equal(normalizeArmenianPhone(raw), null, raw);
  }
});

test('валидация: корректная заявка', () => {
  const r = validateLead(good);
  assert.equal(r.ok, true);
  assert.equal(r.spam, false);
  assert.deepEqual(r.lead, { name: 'Арам', phone: '+37443357007', type: 'residential', locale: 'ru' });
});

test('валидация: имя 2–80 символов, считаем символы, а не байты', () => {
  assert.deepEqual(validateLead({ ...good, name: 'А' }), { ok: false, error: 'invalid_name' });
  assert.equal(validateLead({ ...good, name: 'Ար' }).ok, true);
  assert.equal(validateLead({ ...good, name: 'Ա'.repeat(80) }).ok, true);
  assert.deepEqual(validateLead({ ...good, name: 'Ա'.repeat(81) }), { ok: false, error: 'invalid_name' });
  assert.deepEqual(validateLead({ ...good, name: '   ' }), { ok: false, error: 'invalid_name' });
  assert.deepEqual(validateLead({ ...good, name: '12345' }), { ok: false, error: 'invalid_name' });
  assert.deepEqual(validateLead({ ...good, name: 42 }), { ok: false, error: 'invalid_name' });
});

test('валидация: тип объекта только из списка', () => {
  assert.deepEqual(validateLead({ ...good, type: 'villa' }), { ok: false, error: 'invalid_type' });
  assert.deepEqual(validateLead({ ...good, type: '' }), { ok: false, error: 'invalid_type' });
  for (const type of ['residential', 'commercial', 'renovation', 'infrastructure']) {
    assert.equal(validateLead({ ...good, type }).ok, true, type);
  }
});

test('валидация: без согласия — отказ', () => {
  const { consent, ...noConsent } = good;
  assert.deepEqual(validateLead(noConsent), { ok: false, error: 'no_consent' });
  assert.deepEqual(validateLead({ ...good, consent: 'off' }), { ok: false, error: 'no_consent' });
  assert.equal(validateLead({ ...good, consent: true }).ok, true);
});

test('валидация: заполненная ловушка = спам, даже при кривых остальных полях', () => {
  assert.deepEqual(validateLead({ ...good, website: 'x' }), { ok: true, spam: true });
  assert.deepEqual(validateLead({ website: 'http://spam' }), { ok: true, spam: true });
});

test('валидация: неизвестный язык → hy', () => {
  assert.equal(validateLead({ ...good, locale: 'de' }).lead.locale, 'hy');
});

test('лимит: 5 за 10 минут на ключ, потом отказ, после окна снова можно', () => {
  const rl = new RateLimiter(5, 10 * 60 * 1000);
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(rl.take('1.1.1.1', t0 + i), true);
  assert.equal(rl.take('1.1.1.1', t0 + 10), false);
  assert.equal(rl.take('2.2.2.2', t0 + 10), true, 'другой IP не затронут');
  assert.equal(rl.take('1.1.1.1', t0 + 10 * 60 * 1000 + 1), true, 'окно прошло');
});

test('лимит: отказанные попытки не продлевают блокировку', () => {
  const rl = new RateLimiter(1, 1000);
  assert.equal(rl.take('a', 0), true);
  for (let t = 100; t < 1000; t += 100) assert.equal(rl.take('a', t), false);
  assert.equal(rl.take('a', 1001), true);
});

test('IP: последний адрес X-Forwarded-For, доверенный заголовок, сокет', () => {
  const h = new Headers({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4', 'x-real-ip': '9.9.9.9' });
  assert.equal(clientIp(h, '127.0.0.1'), '1.2.3.4', 'первый адрес XFF — от клиента, ему не верим');
  assert.equal(clientIp(h, '127.0.0.1', 'x-real-ip'), '9.9.9.9');
  assert.equal(clientIp(new Headers(), '127.0.0.1'), '127.0.0.1');
  assert.equal(clientIp(new Headers(), undefined), 'unknown');
});

test('сообщение в Telegram: все поля, по-русски', () => {
  const text = formatLeadMessage({ name: 'Арам', phone: '+37443357007', type: 'infrastructure', locale: 'hy' }, new Date('2026-09-24T08:00:00Z'));
  assert.match(text, /Имя: Арам/);
  assert.match(text, /Телефон: \+37443357007/);
  assert.match(text, /Тип объекта: Дороги и инфраструктура/);
  assert.match(text, /Язык сайта: армянский/);
  assert.match(text, /12:00/, 'время по Еревану (UTC+4)');
});

test('отправка: правильный запрос в Bot API, ошибка API → исключение', async () => {
  const calls = [];
  const okFetch = async (url, init) => {
    calls.push({ url, init });
    return new Response('{"ok":true}', { status: 200 });
  };
  await sendToTelegram({ token: 'T0KEN', chatId: '-100500' }, 'привет', okFetch);
  assert.equal(calls[0].url, 'https://api.telegram.org/botT0KEN/sendMessage');
  assert.deepEqual(JSON.parse(calls[0].init.body), { chat_id: '-100500', text: 'привет', disable_web_page_preview: true });

  const badFetch = async () => new Response('{"ok":false,"description":"chat not found"}', { status: 400 });
  await assert.rejects(sendToTelegram({ token: 'T', chatId: 'x' }, 'x', badFetch), /Telegram API 400: .*chat not found/);
});
