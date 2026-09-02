FROM node:18-alpine

WORKDIR /app

ENV PORT=9000

COPY package.json ./

RUN npm install

COPY . .

EXPOSE 9000

CMD ["node", "server.js"]
