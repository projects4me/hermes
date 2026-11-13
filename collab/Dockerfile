FROM node:18-alpine

WORKDIR /app

ENV COLLAB_PORT=1234

COPY package.json ./

RUN npm install --omit=dev

COPY . .

USER node

EXPOSE 1234

CMD ["node", "server.js"]
