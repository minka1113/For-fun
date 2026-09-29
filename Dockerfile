FROM node:22-slim

WORKDIR /app

# Dev dependencies are kept on purpose: `npm start` runs the TypeScript server with tsx.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && mkdir -p data && chown node:node data

ENV NODE_ENV=production \
    PORT=8787
USER node
EXPOSE 8787

# data/ (uploaded knowledge packs) is a volume mounted from the host's EBS disk.
CMD ["node_modules/.bin/tsx", "server/index.ts"]
