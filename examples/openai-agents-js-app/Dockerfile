FROM node:22-slim

WORKDIR /app

COPY package*.json .
RUN npm ci --omit=dev --no-audit --no-fund

COPY app.mjs .

CMD ["npm", "start"]
