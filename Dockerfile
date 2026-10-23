# Imagen única para la API y el worker (ARM64 en la NAS). Se construye en el Mac (también ARM64).
FROM node:26-trixie-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:26-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg util-linux && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json /app/prisma.config.ts ./
ENV NODE_ENV=production NODE_NO_WARNINGS=1 DATA_DIR=/data DATABASE_URL=file:/data/db/boveda.db
USER node
EXPOSE 3102
CMD ["sh", "-c", "npx prisma migrate deploy && node server/index.ts"]
