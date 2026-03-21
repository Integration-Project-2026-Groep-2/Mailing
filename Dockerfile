FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY contracts ./contracts

EXPOSE 3000

CMD ["npm", "start"]
