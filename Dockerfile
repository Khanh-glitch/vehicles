FROM node:22-bookworm-slim

WORKDIR /app

COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run build

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "npm run db:push && npm run start"]
