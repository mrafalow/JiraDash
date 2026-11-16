# Studioshare Launch — Node app (Jira proxy + static dashboard)
FROM node:22-alpine

WORKDIR /app

# Base Node images ship npm with tar < 7.5.19 (CVE-2024-59873) — Trivy CRITICAL on Launch.
RUN npm install -g npm@11.6.2 && npm cache clean --force

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
