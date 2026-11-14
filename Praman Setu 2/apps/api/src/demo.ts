import { z } from 'zod';
import { ApiError } from './errors';
import { config } from './config';
import type { Store, UserDoc } from './store';

export const demoLoginSchema = z.object({
  role: z.enum(['user', 'admin']).default('user'),
});

export async function demoLogin(store: Store, role: 'user' | 'admin'): Promise<UserDoc> {
  const phone = role === 'admin' ? config.seedAdminPhone : config.seedDemoPhone;
  const user = await store.users.findOne((doc) => doc.phone === phone);
  if (!user) {
    throw new ApiError(
      404,
      'Demo user is not seeded. Run npm run seed, or use the OTP flow.',
      'demo_not_seeded',
    );
  }
  if (user.status !== 'active') {
    throw new ApiError(403, 'This account is not active.', 'account_inactive');
  }
  return user;
}
