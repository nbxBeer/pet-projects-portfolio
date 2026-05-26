'use strict';

const { telegramAuthMiddleware } = require('../middleware/telegramAuth');

async function referralRoutes(fastify, { referralService }) {
  fastify.addHook('preHandler', telegramAuthMiddleware);

  // Get referral stats (for UI)
  fastify.get('/api/referral/stats', async (req) => {
    return referralService.getStats(req.user.id);
  });

  // Set referrer (first time only)
  fastify.post('/api/referral/set-referrer', async (req, reply) => {
    const { referrerId } = req.body || {};
    if (!referrerId) {
      return reply.code(400).send({ error: 'Missing referrerId' });
    }
    const parsedId = parseInt(referrerId, 10);
    if (!parsedId || parsedId === req.user.id) {
      return reply.code(400).send({ error: 'Invalid referrer' });
    }

    const success = await referralService.setReferrer(req.user.id, parsedId);
    if (!success) {
      return reply.code(400).send({ error: 'Cannot set referrer (already set or invalid)' });
    }
    return { success: true };
  });

  // Skip referral (user chose "no referral code")
  fastify.post('/api/referral/skip', async (req) => {
    // Mark user as having seen the referral prompt (we use referral_reward_claimed as marker)
    // We need a separate flag — let's use a lightweight approach:
    // If user has no referrer and hasn't seen prompt, we set referred_by to their own ID? No.
    // Better: store in user metadata or just return from stats that prompt was shown.
    // Actually: the frontend can store this in sessionStorage. No backend needed.
    return { success: true };
  });

  // Claim activation rewards
  fastify.post('/api/referral/claim-activation', async (req) => {
    const result = await referralService.claimActivationRewards(req.user.id);
    if (!result) {
      return { error: 'Nothing to claim' };
    }
    return result;
  });

  // Claim milestone
  fastify.post('/api/referral/claim-milestone', async (req, reply) => {
    const { milestoneCount } = req.body || {};
    if (!milestoneCount) {
      return reply.code(400).send({ error: 'Missing milestoneCount' });
    }
    const result = await referralService.claimMilestone(req.user.id, milestoneCount);
    if (result.error) {
      return reply.code(400).send(result);
    }
    return result;
  });
}

module.exports = referralRoutes;
