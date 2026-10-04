import { z } from 'zod';
import { updateDocumentSchema, uploadFieldsSchema } from '../modules/documents/documents.schemas.js';
import { askBodySchema, searchBodySchema } from '../modules/rag/rag.schemas.js';

/** Request schemas come from the same zod validators the API uses, so the docs can't drift. */
const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });

const errorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
          },
        },
      },
    },
  },
};

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const json = (schema: object) => ({ content: { 'application/json': { schema } } });

export function buildOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'LexSearch API',
      version: '0.1.0',
      description:
        'API del sistema LexSearch. Uso personal y local. Todo contenido generado por IA es una propuesta que el abogado debe revisar.',
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'Sistema' },
      { name: 'Biblioteca', description: 'Documentos propios: legislación, jurisprudencia, doctrina y modelos' },
      { name: 'Consultas', description: 'Búsqueda en la biblioteca y respuestas con citas (RAG)' },
      { name: 'Historial', description: 'Interacciones registradas con los módulos de IA' },
    ],
    paths: {
      '/api/health': {
        get: { tags: ['Sistema'], summary: 'Estado de la base de datos, embeddings y LLM', responses: { 200: { description: 'OK' } } },
      },
      '/api/documents': {
        get: {
          tags: ['Biblioteca'],
          summary: 'Listar documentos',
          parameters: [
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Lista de documentos' } },
        },
        post: {
          tags: ['Biblioteca'],
          summary: 'Subir uno o más documentos (PDF, DOCX, TXT, MD)',
          description: 'Responde enseguida; la indexación sigue en segundo plano (status PENDING → PROCESSING → READY/FAILED).',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['files'],
                  properties: {
                    files: { type: 'array', items: { type: 'string', format: 'binary' } },
                    ...(jsonSchema(uploadFieldsSchema) as { properties?: object }).properties,
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Ningún documento nuevo (duplicados o rechazados)' },
            202: { description: 'Resultado por archivo: created | duplicate | rejected' },
            400: errorResponse,
            413: errorResponse,
          },
        },
      },
      '/api/documents/{id}': {
        parameters: [idParam],
        get: { tags: ['Biblioteca'], summary: 'Detalle de un documento', responses: { 200: { description: 'OK' }, 404: errorResponse } },
        patch: {
          tags: ['Biblioteca'],
          summary: 'Cambiar título o categoría',
          requestBody: { required: true, ...json(jsonSchema(updateDocumentSchema)) },
          responses: { 200: { description: 'OK' }, 400: errorResponse, 404: errorResponse },
        },
        delete: { tags: ['Biblioteca'], summary: 'Eliminar documento y sus fragmentos', responses: { 204: { description: 'Eliminado' }, 404: errorResponse } },
      },
      '/api/documents/{id}/file': {
        parameters: [idParam],
        get: { tags: ['Biblioteca'], summary: 'Ver el archivo original', responses: { 200: { description: 'Archivo' }, 404: errorResponse } },
      },
      '/api/documents/{id}/reprocess': {
        parameters: [idParam],
        post: { tags: ['Biblioteca'], summary: 'Volver a indexar', responses: { 202: { description: 'En cola' }, 409: errorResponse } },
      },
      '/api/rag/search': {
        post: {
          tags: ['Consultas'],
          summary: 'Búsqueda híbrida (por significado + por palabras) sin IA generativa',
          requestBody: { required: true, ...json(jsonSchema(searchBodySchema)) },
          responses: { 200: { description: 'Fragmentos ordenados por relevancia' }, 400: errorResponse },
        },
      },
      '/api/rag/ask': {
        post: {
          tags: ['Consultas'],
          summary: 'Respuesta redactada por la IA (Gemini) con citas verificadas de la biblioteca',
          requestBody: { required: true, ...json(jsonSchema(askBodySchema)) },
          responses: {
            200: { description: 'Respuesta en bloques con citas y las fuentes usadas' },
            400: errorResponse,
            409: errorResponse,
            429: errorResponse,
            502: errorResponse,
            503: errorResponse,
          },
        },
      },
      '/api/interactions': {
        get: {
          tags: ['Historial'],
          summary: 'Últimas interacciones',
          parameters: [
            { name: 'module', in: 'query', schema: { type: 'string', example: 'rag-qa' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 30 } },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/interactions/{id}': {
        parameters: [idParam],
        get: { tags: ['Historial'], summary: 'Detalle completo de una interacción', responses: { 200: { description: 'OK' }, 404: errorResponse } },
      },
    },
  };
}
