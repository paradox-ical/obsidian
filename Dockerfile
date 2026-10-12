FROM node:24.21.0-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN npm ci

COPY . .

ARG VITE_BOT_HEALTH_URL=http://localhost:8081/health
ENV VITE_BOT_HEALTH_URL=${VITE_BOT_HEALTH_URL}

RUN npm run prisma:generate && npm run build

EXPOSE 8081 8082 5173

CMD ["npm", "run", "start:bot"]
