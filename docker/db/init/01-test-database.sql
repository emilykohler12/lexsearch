-- Se ejecuta solo la primera vez que se crea el volumen de datos.
-- Base separada para los tests de integración (se vacía en cada corrida).
-- Las extensiones (vector, unaccent) las crean las migraciones de Prisma.
CREATE DATABASE lexsearch_test;
