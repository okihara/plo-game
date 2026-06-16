/**
 * /admin/tweets と関連 REST API。
 * 認証は他の admin ルートと同じく ?secret=<ADMIN_SECRET> 方式。
 */
import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { postDraft } from './poster.js';
import { TweetKind, TweetStatus } from './types.js';

const POSTABLE_STATUSES = new Set<TweetStatus>([TweetStatus.DRAFT, TweetStatus.FAILED]);

export async function tweetRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    const secret = env.ADMIN_SECRET;
    if (!secret) return;
    const querySecret = (request.query as Record<string, string>).secret;
    if (querySecret !== secret) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  });

  // 一覧 JSON
  fastify.get('/api/admin/tweets', async (request) => {
    const query = request.query as Record<string, string>;
    const status = (query.status || '').toUpperCase();
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '50', 10)));

    const where = status && status !== 'ALL'
      ? { status: status as TweetStatus }
      : {};

    const drafts = await prisma.tweetDraft.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      include: {
        tournament: {
          select: { id: true, name: true, scheduledStartTime: true, completedAt: true },
        },
      },
    });

    return {
      drafts: drafts.map((d) => ({
        id: d.id,
        kind: d.kind,
        status: d.status,
        scheduledFor: d.scheduledFor.toISOString(),
        generatedText: d.generatedText,
        editedText: d.editedText,
        text: d.editedText ?? d.generatedText ?? '',
        promptVersion: d.promptVersion,
        attachedImagePath: d.attachedImagePath,
        postedTweetId: d.postedTweetId,
        postedAt: d.postedAt?.toISOString() ?? null,
        errorMessage: d.errorMessage,
        retryCount: d.retryCount,
        updatedAt: d.updatedAt.toISOString(),
        tournament: d.tournament
          ? {
              id: d.tournament.id,
              name: d.tournament.name,
              scheduledStartTime: d.tournament.scheduledStartTime?.toISOString() ?? null,
              completedAt: d.tournament.completedAt?.toISOString() ?? null,
            }
          : null,
      })),
    };
  });

  // 詳細（プロンプト入力 JSON を含む）
  fastify.get('/api/admin/tweets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const draft = await prisma.tweetDraft.findUnique({
      where: { id },
      include: { tournament: { select: { id: true, name: true } } },
    });
    if (!draft) return reply.status(404).send({ error: 'not found' });
    return draft;
  });

  // editedText を保存
  fastify.patch('/api/admin/tweets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { editedText?: string | null };
    if (typeof body.editedText !== 'string' && body.editedText !== null) {
      return reply.status(400).send({ error: 'editedText required' });
    }
    await prisma.tweetDraft.update({
      where: { id },
      data: { editedText: body.editedText },
    });
    return { ok: true };
  });

  // 再生成: status を PENDING に戻すだけ。scheduler の次 tick で拾われる。
  fastify.post('/api/admin/tweets/:id/regenerate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const draft = await prisma.tweetDraft.findUnique({ where: { id } });
    if (!draft) return reply.status(404).send({ error: 'not found' });
    await prisma.tweetDraft.update({
      where: { id },
      data: { status: TweetStatus.PENDING, errorMessage: null },
    });
    return { ok: true };
  });

  // 投稿
  fastify.post('/api/admin/tweets/:id/post', async (request, reply) => {
    const { id } = request.params as { id: string };
    const draft = await prisma.tweetDraft.findUnique({ where: { id } });
    if (!draft) return reply.status(404).send({ error: 'not found' });
    if (!POSTABLE_STATUSES.has(draft.status)) {
      return reply.status(409).send({ error: `cannot post from status ${draft.status}` });
    }
    // FAILED の場合は DRAFT に戻してから poster に渡す
    if (draft.status === TweetStatus.FAILED) {
      await prisma.tweetDraft.update({
        where: { id },
        data: { status: TweetStatus.DRAFT, errorMessage: null },
      });
    }
    const result = await postDraft(id);
    return result;
  });

  // 破棄
  fastify.post('/api/admin/tweets/:id/discard', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.tweetDraft.update({
      where: { id },
      data: { status: TweetStatus.DISCARDED },
    });
    return { ok: true };
  });

  // 手動 enqueue（リカバリ用 / 動作確認用）
  fastify.post('/api/admin/tweets/manual', async (request, reply) => {
    const body = request.body as { kind?: string; tournamentId?: string };
    const kind = body.kind?.toUpperCase();
    if (!kind || !(kind in TweetKind)) {
      return reply.status(400).send({ error: 'kind required (ANNOUNCE|START|PROGRESS|RESULT|RANKING)' });
    }
    if (!body.tournamentId) {
      return reply.status(400).send({ error: 'tournamentId required' });
    }
    const draft = await prisma.tweetDraft.upsert({
      where: { kind_tournamentId: { kind: kind as TweetKind, tournamentId: body.tournamentId } },
      create: {
        kind: kind as TweetKind,
        tournamentId: body.tournamentId,
        scheduledFor: new Date(),
        status: TweetStatus.PENDING,
      },
      update: { status: TweetStatus.PENDING, errorMessage: null },
    });
    return { ok: true, id: draft.id };
  });

  // HTML 一覧ページ
  fastify.get('/admin/tweets', async (_request, reply) => {
    return reply.view('tweets.ejs', { title: 'Admin - ツイート', current: 'tweets' });
  });
}
