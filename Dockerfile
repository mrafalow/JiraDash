# Studioshare Launch — Node app (Jira proxy + static dashboard)
FROM node:22-alpine

WORKDIR /app

# Trivy CRITICAL on tar < 7.5.19 (CVE-2026-59873). npm 11.x bundles tar 7.5.1; npm 12+ pulls ^7.5.22.
RUN npm install -g npm@12.2.2 && npm cache clean --force

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
ENV BIND_HOST=0.0.0.0

RUN chown -R node:node /app
USER node

EXPOSE 8080
CMD ["node", "server.js"]
