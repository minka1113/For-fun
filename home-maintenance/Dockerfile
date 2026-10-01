FROM node:22-slim

WORKDIR /app

# Dev dependencies are kept on purpose: the server runs as TypeScript with tsx.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && mkdir -p data && chown node:node data

ENV NODE_ENV=production \
    PORT=8788
USER node
EXPOSE 8788

# data/ (home.json) is a volume mounted from the host's EBS disk.
CMD ["node_modules/.bin/tsx", "server/index.ts"]
