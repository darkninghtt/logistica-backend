# Imagen única (un solo origen): el backend sirve el build del frontend desde /app/public.

# 1) Compila el frontend clonando su repo público. FRONTEND_REF permite fijar rama o etiqueta.
FROM node:24-slim AS frontend
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ARG FRONTEND_REPO=https://github.com/darkninghtt/logistica-frontend.git
ARG FRONTEND_REF=main
WORKDIR /frontend
RUN git clone --depth 1 --branch "$FRONTEND_REF" "$FRONTEND_REPO" . \
  && npm ci \
  && npm run build

# 2) Compila el backend
FROM node:24-slim AS backend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# 3) Imagen final: solo dependencias de producción, lo compilado y las migraciones
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=backend /app/dist ./dist
COPY migrations ./migrations
COPY --from=frontend /frontend/dist ./public
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
