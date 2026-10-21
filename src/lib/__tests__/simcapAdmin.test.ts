import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { User } from '@supabase/supabase-js';
import { emailsFromAuthUser, isSimCapAdminFromUser } from '../simcapAdmin';

describe('simcapAdmin', () => {
  it('treats simcapadmin@gmail.com as admin', () => {
    const user = { email: 'SimCapAdmin@gmail.com' } as User;
    assert.equal(isSimCapAdminFromUser(user), true);
  });

  it('reads identity emails for OAuth users', () => {
    const user = {
      email: undefined,
      identities: [{ identity_data: { email: 'simcapadmin@gmail.com' } }],
    } as unknown as User;
    assert.deepEqual(emailsFromAuthUser(user), ['simcapadmin@gmail.com']);
    assert.equal(isSimCapAdminFromUser(user), true);
  });

  it('rejects unrelated logins', () => {
    const user = { email: 'player@example.com' } as User;
    assert.equal(isSimCapAdminFromUser(user), false);
  });
});
