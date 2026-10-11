FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY web ./web
ENV HOST=0.0.0.0
ENV TRUST_PROXY=1
EXPOSE 8770
CMD ["node", "server/server.mjs"]
