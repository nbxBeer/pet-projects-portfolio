'use strict';

jest.mock('../db/pool', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({ debug: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { query } = require('../db/pool');
const { resolveRegistrationContext, upsertUser } = require('./telegramAuth');

describe('resolveRegistrationContext', () => {
  beforeEach(() => {
    query.mockReset();
  });

  test('resolves chat deep link from pg rows', async () => {
    query.mockResolvedValueOnce({
      rows: [{ chat_id: -100123, chat_title: 'Raid Chat' }],
    });

    await expect(resolveRegistrationContext('chat_abc123')).resolves.toEqual({
      chatId: -100123,
      chatTitle: 'Raid Chat',
      sourceType: 'chat_link',
    });

    expect(query).toHaveBeenCalledWith(
      'SELECT chat_id, chat_title FROM chat_sources WHERE link_code = $1 LIMIT 1',
      ['abc123']
    );
  });
});

describe('upsertUser registration attribution', () => {
  beforeEach(() => {
    query.mockReset();
  });

  test('does not rewrite registration source for existing users on conflict', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ chat_id: -100123, chat_title: 'Raid Chat' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 501, registration_source_type: 'organic' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await upsertUser(
      { id: 501, username: 'pilot', first_name: 'Alex', language_code: 'ru' },
      'chat_abc123'
    );

    const upsertSql = query.mock.calls[1][0];
    const conflictClause = upsertSql.split('ON CONFLICT (id) DO UPDATE SET')[1];

    expect(conflictClause).not.toContain('registration_chat_id');
    expect(conflictClause).not.toContain('registration_chat_title');
    expect(conflictClause).not.toContain('registration_source_type');
  });
});
