# Railway 本番ビルド用。nixpacks は Node のメジャー版しか指定できず、
# パッチ版がビルド時の nixpkgs スナップショット次第になるため、公式イメージでパッチ版まで固定する。
FROM node:22.23.4-slim

# Prisma のエンジンが libssl を必要とする
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Railway はサービス変数を ARG で宣言したものだけビルドに渡す（Vite が埋め込む値）
ARG RAILWAY_GIT_COMMIT_SHA
ARG VITE_SERVER_URL
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ENVIRONMENT
ARG VITE_SENTRY_RELEASE

COPY . .

# pnpm 11 以降は package.json の pnpm.onlyBuiltDependencies を読まずビルドが失敗するため固定する
RUN npm i -g pnpm@10.18.3 && pnpm install --frozen-lockfile && pnpm run build:all

ENV NODE_ENV=production

# 起動コマンドは railway.toml の startCommand が優先される
CMD ["sh", "-c", "cd server && npx prisma db push --schema=./prisma/schema.prisma && node --import tsx src/index.ts"]
