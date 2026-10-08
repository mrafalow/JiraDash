# Studioshare Launch — Node app (Jira proxy + static dashboard)
FROM node:20-alpine

WORKDIR /app

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
