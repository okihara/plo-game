import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { findOrCreateUser, originFromRequest, setSessionCookie } from './helpers.js';

// Google OAuth 2.0 (Authorization Code Flow)
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が設定されているときだけルートを登録する。

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

// CSRF 対策の state を一時保存（10分で失効）
const pendingStates = new Map<string, number>();

function cleanupPendingStates() {
  const now = Date.now();
  for (const [state, expires] of pendingStates) {
    if (expires < now) pendingStates.delete(state);
  }
}

export function registerGoogleAuth(fastify: FastifyInstance): void {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return;
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;

  // Step 1: Start OAuth — redirect to Google consent screen
  fastify.get('/google', async (request, reply) => {
    const { serverBase } = originFromRequest(request);
    cleanupPendingStates();

    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, Date.now() + 10 * 60 * 1000);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${serverBase}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  // Step 2: Callback — exchange code for token, get user info
  fastify.get('/google/callback', async (request, reply) => {
    const { serverBase, clientBase } = originFromRequest(request);
    const failRedirect = `${clientBase}/login?error=oauth_failed`;
    try {
      const { code, state, error } = request.query as {
        code?: string;
        state?: string;
        error?: string;
      };

      if (error || !code || !state) {
        fastify.log.error({ error }, 'Google OAuth callback missing code/state');
        return reply.redirect(failRedirect);
      }
      if (!pendingStates.has(state)) {
        fastify.log.error('Google OAuth state not found or expired');
        return reply.redirect(failRedirect);
      }
      pendingStates.delete(state);

      // Exchange authorization code for access token
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: `${serverBase}/api/auth/google/callback`,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        fastify.log.error({ status: tokenRes.status, body }, 'Failed to exchange Google auth code');
        return reply.redirect(failRedirect);
      }

      const { access_token: accessToken } = await tokenRes.json() as { access_token: string };

      const profileRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!profileRes.ok) {
        const body = await profileRes.text();
        fastify.log.error({ status: profileRes.status, body }, 'Failed to fetch Google userinfo');
        return reply.redirect(failRedirect);
      }

      const profile = await profileRes.json() as {
        sub: string;
        email?: string;
        name?: string;
        picture?: string;
      };

      const username =
        profile.name?.trim() ||
        profile.email?.split('@')[0] ||
        `google_${profile.sub.slice(0, 8)}`;

      const user = await findOrCreateUser({
        provider: 'google',
        providerId: profile.sub,
        email: profile.email || `${profile.sub}@google.placeholder`,
        username,
        avatarUrl: profile.picture ?? null,
      });

      setSessionCookie(fastify, reply, user.id);
      reply.redirect(`${clientBase}/`);
    } catch (err) {
      fastify.log.error(err, 'Google OAuth callback error');
      reply.redirect(failRedirect);
    }
  });
}
