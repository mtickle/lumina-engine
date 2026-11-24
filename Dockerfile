FROM node:22-alpine

RUN apk update && apk upgrade --no-cache && npm install -g npm@latest

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["node", "content.js"]
