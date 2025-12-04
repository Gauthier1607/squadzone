# SquadZone - Node + SQLite prototype Dockerfile
FROM node:18-alpine

# install build deps for bcrypt and sqlite (alpine)
RUN apk add --no-cache python3 make g++ sqlite sqlite-dev

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# copy app
COPY . .

# create uploads dir and ensure permissions
RUN mkdir -p uploads && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node","server.js"]
