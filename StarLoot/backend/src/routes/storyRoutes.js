'use strict';

const { telegramAuthMiddleware, validateNonce } = require('../middleware/telegramAuth');
const { z } = require('zod');

const UseStoryItemSchema = z.object({
  itemKey: z.string().min(1).max(100),
  selectedType: z.string().min(1).max(100).optional(),
  nonce: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});

async function storyRoutes(fastify, { storyService, storyDialogService }) {
  fastify.addHook('preHandler', telegramAuthMiddleware);

  // Get all story quests + obtained items
  fastify.get('/api/story', async (req, reply) => {
    const data = await storyService.getStoryQuests(req.user.id);
    return reply.send(data);
  });

  // Claim a story quest
  fastify.post('/api/story/claim', async (req, reply) => {
    const { questId, nonce } = req.body || {};
    if (!questId || !nonce) {
      return reply.code(400).send({ error: 'questId and nonce required' });
    }
    const nonceValid = await validateNonce(nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });

    const result = await storyService.claimStoryQuest(req.user.id, questId);
    return reply.send(result);
  });

  // Use a story item (currently resonator activation)
  fastify.post('/api/story/use', async (req, reply) => {
    const parsed = UseStoryItemSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }
    const nonceValid = await validateNonce(parsed.data.nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });

    const result = await storyService.useStoryItem(req.user.id, parsed.data.itemKey, {
      selectedType: parsed.data.selectedType,
    });
    return reply.send(result);
  });

  // Check if user has a specific story item (used by frontend to show/hide long expedition toggle)
  fastify.get('/api/story/has-item/:itemKey', async (req, reply) => {
    const hasItem = await storyService.hasStoryItem(req.user.id, req.params.itemKey);
    return reply.send({ hasItem });
  });

  // Mark a story dialog as seen (player accepted/completed the dialog)
  fastify.post('/api/story/dialogs/:id/seen', async (req, reply) => {
    if (!storyDialogService) return reply.code(503).send({ error: 'Not available' });
    await storyDialogService.markDialogSeen(req.user.id, req.params.id);
    return reply.send({ ok: true });
  });
}

module.exports = storyRoutes;
