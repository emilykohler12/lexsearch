# syntax=docker/dockerfile:1

# Imagen de la API de LexSearch. Se construye desde la raíz del repositorio:
#   docker build -f backend/Dockerfile -t lexsearch-api .
#
# Al arrancar aplica las migraciones pendientes de la base (DATABASE_URL) y levanta el servidor.
# Los modelos de búsqueda y de OCR se descargan la primera vez (hace falta internet) en
# /app/backend/.cache y los documentos subidos se guardan en /app/backend/storage: conviene
# montar esas dos carpetas como volúmenes para no perderlos al actualizar la imagen
# (docker-compose.prod.yml ya lo hace).
FROM node:24-slim

# Prisma necesita OpenSSL para conectarse a la base y aplicar las migraciones.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Primero solo lo que hace falta para instalar las dependencias: mientras no cambien los
# package.json ni el esquema de datos, Docker reutiliza esta capa y las reconstrucciones son rápidas.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# El postinstall del backend (prisma generate) necesita el esquema y la configuración de Prisma.
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/
# onnxruntime-node (el motor de los embeddings) trae los binarios de todas las plataformas y el
# soporte para placas de video NVIDIA: casi 500 MB que acá no se usan, porque corre en la CPU. Se
# borran en este mismo paso, si no la imagen los seguiría cargando en la capa anterior. La caché de
# npm (otros ~500 MB de paquetes descargados) queda fuera de la imagen con un montaje de caché.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace backend \
    && for dir in node_modules/onnxruntime-node/bin/napi-v*; do \
        rm -rf "$dir/darwin" "$dir/win32"; \
        rm -f "$dir"/linux/*/libonnxruntime_providers_cuda.so "$dir"/linux/*/libonnxruntime_providers_tensorrt.so; \
        case "$(uname -m)" in x86_64) rm -rf "$dir/linux/arm64" ;; aarch64) rm -rf "$dir/linux/x64" ;; esac; \
    done

COPY backend backend
# Por si el script se editó en Windows (saltos de línea CRLF): sh no los entiende.
RUN sed -i 's/\r$//' backend/docker-entrypoint.sh && npm run build --workspace backend

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
EXPOSE 4000

# Sin privilegios de administrador.
RUN mkdir -p /app/backend/storage /app/backend/.cache \
    && chown -R node:node /app/backend/storage /app/backend/.cache
USER node
WORKDIR /app/backend

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["sh", "docker-entrypoint.sh"]
