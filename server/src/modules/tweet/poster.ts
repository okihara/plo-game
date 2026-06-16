/**
 * TweetDraft → X 投稿。
 * DRAFT 行を POSTING に楽観ロックで遷移させた上で twitterClient.postTweet() を呼ぶ。
 */
import fs from 'fs';
import { prisma } from '../../config/database.js';
import { Sentry, sentryEnabled } from '../../config/sentry.js';
import { getCredentialsFromEnv, postTweet } from './twitterClient.js';
import { TweetStatus } from './types.js';

export interface PostResult {
  ok: boolean;
  tweetId?: string;
  errorMessage?: string;
}

/**
 * 指定 draft を投稿する。承認ボタンから直接呼ばれる想定。
 * - DRAFT → POSTING への遷移失敗（既に他で取られている／状態が違う）は ok=false で返す
 * - 投稿成功時は POSTED + postedTweetId/postedAt を保存
 * - 失敗時は FAILED + errorMessage を保存し Sentry へ
 */
export async function postDraft(draftId: string): Promise<PostResult> {
  const claim = await prisma.tweetDraft.updateMany({
    where: { id: draftId, status: TweetStatus.DRAFT },
    data: { status: TweetStatus.POSTING },
  });
  if (claim.count === 0) {
    return { ok: false, errorMessage: 'draft is not in DRAFT status' };
  }

  const draft = await prisma.tweetDraft.findUniqueOrThrow({ where: { id: draftId } });
  const text = (draft.editedText ?? draft.generatedText ?? '').trim();
  if (!text) {
    await prisma.tweetDraft.update({
      where: { id: draftId },
      data: { status: TweetStatus.FAILED, errorMessage: 'tweet text is empty' },
    });
    return { ok: false, errorMessage: 'tweet text is empty' };
  }

  let image: Buffer | undefined;
  if (draft.attachedImagePath) {
    try {
      image = fs.readFileSync(draft.attachedImagePath);
    } catch (err) {
      const msg = `failed to read image at ${draft.attachedImagePath}: ${String(err)}`;
      await prisma.tweetDraft.update({
        where: { id: draftId },
        data: { status: TweetStatus.FAILED, errorMessage: msg },
      });
      return { ok: false, errorMessage: msg };
    }
  }

  try {
    const creds = getCredentialsFromEnv();
    const result = await postTweet(creds, {
      text,
      image,
      replyToTweetId: draft.inReplyToTweetId ?? undefined,
    });
    await prisma.tweetDraft.update({
      where: { id: draftId },
      data: {
        status: TweetStatus.POSTED,
        postedTweetId: result.tweetId,
        postedAt: new Date(),
        errorMessage: null,
      },
    });
    console.log(`[TweetPoster] Posted ${draft.kind} draft=${draftId} tweetId=${result.tweetId}`);
    return { ok: true, tweetId: result.tweetId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.tweetDraft.update({
      where: { id: draftId },
      data: {
        status: TweetStatus.FAILED,
        errorMessage: msg,
        retryCount: { increment: 1 },
      },
    });
    if (sentryEnabled) {
      Sentry.withScope((scope) => {
        scope.setTag('source', 'tweetPoster');
        scope.setContext('draft', { id: draftId, kind: draft.kind });
        Sentry.captureException(err);
      });
    }
    return { ok: false, errorMessage: msg };
  }
}
