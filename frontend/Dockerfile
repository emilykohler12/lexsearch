# syntax=docker/dockerfile:1

# Imagen de la interfaz web de LexSearch: los archivos estáticos servidos por nginx, que
# además reenvía /api a la API (el servicio "api" de docker compose).
# Se construye desde la raíz del repositorio:
#   docker build -f frontend/Dockerfile -t lexsearch-web .
FROM node:24-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm ci --workspace frontend --ignore-scripts

COPY frontend frontend
RUN npm run build --workspace frontend

FROM nginx:1.31-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
