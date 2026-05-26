'use strict';

const crypto = require('crypto');
const { validateTelegramInitData } = require('./telegramAuth');

function buildInitData({ botToken, user, authDate, queryId = 'query-1' }) {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', queryId);
  params.set('user', JSON.stringify(user));

  const entries = [];
  for (const [key, value] of params.entries()) {
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const hash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  params.set('hash', hash);
  return params.toString();
}

describe('validateTelegramInitData', () => {
  const botToken = '123456:TEST_BOT_TOKEN';
  const baseUser = {
    id: 10001,
    username: 'tester',
    first_name: 'Test',
    last_name: 'User',
  };

  test('accepts valid signed initData', () => {
    const authDate = Math.floor(Date.now() / 1000);
    const initData = buildInitData({ botToken, user: baseUser, authDate });

    const result = validateTelegramInitData(initData, botToken);

    expect(result.valid).toBe(true);
    expect(result.userData.id).toBe(baseUser.id);
    expect(result.queryId).toBe('query-1');
  });

  test('rejects tampered payload with invalid signature', () => {
    const authDate = Math.floor(Date.now() / 1000);
    const initData = buildInitData({ botToken, user: baseUser, authDate });
    const tampered = `${initData}&foo=bar`;

    const result = validateTelegramInitData(tampered, botToken);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid signature');
  });

  test('rejects expired initData', () => {
    const oldAuthDate = Math.floor(Date.now() / 1000) - 7200;
    const initData = buildInitData({ botToken, user: baseUser, authDate: oldAuthDate });

    const result = validateTelegramInitData(initData, botToken);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('InitData expired');
  });
});
