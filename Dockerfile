FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY web ./web
COPY server ./server
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=3000 DB_PATH=/data/attendance.sqlite
EXPOSE 3000
CMD ["node", "server/index.js"]
