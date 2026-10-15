#!/bin/sh
# Arranque del contenedor de la API: aplica las migraciones pendientes y levanta el servidor.
set -e
npx prisma migrate deploy
exec node dist/server.js
