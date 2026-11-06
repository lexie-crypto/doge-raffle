# DogeOS VRF oracle — runs `vrf-oracle.mjs --watch` as an always-on worker.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY ecvrf.mjs vrf-oracle.mjs ./
USER node
CMD ["node", "vrf-oracle.mjs", "--watch"]
