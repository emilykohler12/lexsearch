import { z } from 'zod';
import { nonWorkingDayInputSchema } from '../modules/calendar/calendar.schemas.js';
import {
  analyzeTextSchema,
  createCaseSchema,
  createProceedingSchema,
  createProceedingsBatchSchema,
  updateCaseSchema,
  updateProceedingSchema,
} from '../modules/cases/cases.schemas.js';
import { analyzeNotesSchema, createClientSchema, updateClientSchema } from '../modules/clients/clients.schemas.js';
import {
  calculateSchema,
  createDeadlineSchema,
  createDeadlinesBatchSchema,
  updateDeadlineSchema,
} from '../modules/deadlines/deadlines.schemas.js';
import { updateDocumentSchema, uploadFieldsSchema } from '../modules/documents/documents.schemas.js';
import { createDraftSchema, updateDraftSchema } from '../modules/drafts/drafts.schemas.js';
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
const proceedingIdParam = { name: 'proceedingId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
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
      { name: 'Clientes', description: 'Fichas de cliente: datos, contraparte, caso y documentación que falta reunir' },
      { name: 'Expedientes', description: 'Expedientes, sus actuaciones y la línea de tiempo (actuaciones y vencimientos ordenados por fecha)' },
      { name: 'Plazos', description: 'Plazos procesales y contractuales: vencimientos calculados con el calendario, y lectura de cédulas y resoluciones' },
      { name: 'Calendario', description: 'Feriados nacionales (calculados) y días inhábiles propios (feria judicial, asuetos)' },
      { name: 'Avisos', description: 'Avisos generados por el sistema (plazos por vencer)' },
      { name: 'Borradores', description: 'Escritos y contratos redactados por el agente con la biblioteca como referencia' },
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
          summary: 'Subir uno o más documentos (PDF, DOCX, TXT, MD, o imágenes JPG/PNG/WEBP/TIFF leídas con OCR)',
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
      '/api/clients': {
        get: {
          tags: ['Clientes'],
          summary: 'Listar clientes (resumen, sin notas ni textos largos)',
          responses: { 200: { description: 'Clientes con la cantidad de documentos pendientes' } },
        },
        post: {
          tags: ['Clientes'],
          summary: 'Crear la ficha de un cliente',
          description: 'Solo el nombre es obligatorio.',
          requestBody: { required: true, ...json(jsonSchema(createClientSchema)) },
          responses: { 201: { description: 'Ficha creada' }, 400: errorResponse },
        },
      },
      '/api/clients/analyze-notes': {
        post: {
          tags: ['Clientes'],
          summary: 'Proponer una ficha a partir de las notas o la transcripción de la primera reunión',
          description:
            'La IA (Gemini) lee las notas y devuelve una propuesta para que el abogado la revise: no guarda nada. Los datos que no figuran en las notas quedan vacíos.',
          requestBody: { required: true, ...json(jsonSchema(analyzeNotesSchema)) },
          responses: {
            200: { description: 'Propuesta de ficha y lista de documentación que falta reunir' },
            400: errorResponse,
            429: errorResponse,
            502: errorResponse,
            503: errorResponse,
          },
        },
      },
      '/api/clients/{id}': {
        parameters: [idParam],
        get: { tags: ['Clientes'], summary: 'Ficha completa de un cliente', responses: { 200: { description: 'OK' }, 404: errorResponse } },
        patch: {
          tags: ['Clientes'],
          summary: 'Guardar cambios (solo los campos enviados)',
          requestBody: { required: true, ...json(jsonSchema(updateClientSchema)) },
          responses: { 200: { description: 'OK' }, 400: errorResponse, 404: errorResponse },
        },
        delete: {
          tags: ['Clientes'],
          summary: 'Eliminar un cliente',
          description: 'Sus borradores se conservan, sin el vínculo con el cliente.',
          responses: { 204: { description: 'Eliminado' }, 404: errorResponse },
        },
      },
      '/api/cases': {
        get: {
          tags: ['Expedientes'],
          summary: 'Listar expedientes (el último con movimiento, primero)',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'CLOSED'] } },
            { name: 'clientId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Expedientes con sus clientes, la fecha de la última actuación y el próximo vencimiento' },
            400: errorResponse,
          },
        },
        post: {
          tags: ['Expedientes'],
          summary: 'Crear un expediente',
          description: 'Solo la carátula es obligatoria. Puede tener uno o más clientes.',
          requestBody: { required: true, ...json(jsonSchema(createCaseSchema)) },
          responses: { 201: { description: 'Expediente creado' }, 400: errorResponse },
        },
      },
      '/api/cases/{id}': {
        parameters: [idParam],
        get: { tags: ['Expedientes'], summary: 'Detalle de un expediente', responses: { 200: { description: 'OK' }, 404: errorResponse } },
        patch: {
          tags: ['Expedientes'],
          summary: 'Guardar cambios (solo los campos enviados; clientIds reemplaza la lista de clientes)',
          requestBody: { required: true, ...json(jsonSchema(updateCaseSchema)) },
          responses: { 200: { description: 'OK' }, 400: errorResponse, 404: errorResponse },
        },
        delete: {
          tags: ['Expedientes'],
          summary: 'Eliminar un expediente',
          description: 'Se borran sus actuaciones. Sus plazos se conservan, sin el vínculo con el expediente.',
          responses: { 204: { description: 'Eliminado' }, 404: errorResponse },
        },
      },
      '/api/cases/{id}/timeline': {
        parameters: [idParam],
        get: {
          tags: ['Expedientes'],
          summary: 'Línea de tiempo: actuaciones y vencimientos de plazos del expediente, de la más antigua a la más reciente',
          description: 'El día del vencimiento de un plazo ocupa su lugar en la línea, junto a las actuaciones de esa fecha.',
          responses: { 200: { description: 'El expediente y sus entradas (type PROCEEDING o DEADLINE)' }, 404: errorResponse },
        },
      },
      '/api/cases/{id}/proceedings': {
        parameters: [idParam],
        post: {
          tags: ['Expedientes'],
          summary: 'Agregar una actuación',
          requestBody: { required: true, ...json(jsonSchema(createProceedingSchema)) },
          responses: { 201: { description: 'Actuación creada' }, 400: errorResponse, 404: errorResponse },
        },
      },
      '/api/cases/{id}/proceedings/batch': {
        parameters: [idParam],
        post: {
          tags: ['Expedientes'],
          summary: 'Agregar varias actuaciones juntas (las de una misma lectura): todas o ninguna',
          requestBody: { required: true, ...json(jsonSchema(createProceedingsBatchSchema)) },
          responses: { 201: { description: 'Actuaciones creadas' }, 400: errorResponse, 404: errorResponse },
        },
      },
      '/api/cases/{id}/proceedings/analyze': {
        parameters: [idParam],
        post: {
          tags: ['Expedientes'],
          summary: 'Leer un texto con los movimientos del expediente y proponer sus actuaciones',
          description:
            'La IA (Gemini) extrae las actuaciones que el texto presenta con fecha; cada cita se verifica contra el texto y las que el expediente ya tiene se marcan como repetidas. El texto se envía pegado (JSON) o como archivo (PDF, imagen, Word o texto). No se guarda nada: el abogado confirma cada actuación.',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: jsonSchema(analyzeTextSchema) },
              'multipart/form-data': {
                schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
              },
            },
          },
          responses: {
            200: { description: 'Propuesta: datos del expediente que figuran en el texto y actuaciones ordenadas por fecha' },
            400: errorResponse,
            404: errorResponse,
            413: errorResponse,
            429: errorResponse,
            502: errorResponse,
            503: errorResponse,
          },
        },
      },
      '/api/cases/{id}/proceedings/{proceedingId}': {
        parameters: [idParam, proceedingIdParam],
        patch: {
          tags: ['Expedientes'],
          summary: 'Guardar cambios de una actuación (solo los campos enviados)',
          requestBody: { required: true, ...json(jsonSchema(updateProceedingSchema)) },
          responses: { 200: { description: 'OK' }, 400: errorResponse, 404: errorResponse },
        },
        delete: { tags: ['Expedientes'], summary: 'Eliminar una actuación', responses: { 204: { description: 'Eliminada' }, 404: errorResponse } },
      },
      '/api/deadlines': {
        get: {
          tags: ['Plazos'],
          summary: 'Listar plazos (el que vence antes, primero)',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING', 'DONE'] } },
            { name: 'clientId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'caseId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: { description: 'Plazos con los días que faltan y su estado (vencido, hoy, próximo, en curso, cumplido)' }, 400: errorResponse },
        },
        post: {
          tags: ['Plazos'],
          summary: 'Guardar un plazo',
          description:
            'El día de la notificación no se cuenta: el plazo empieza al día siguiente. El vencimiento lo calcula el sistema con el calendario (días hábiles: sin sábados, domingos, feriados nacionales ni los días inhábiles cargados).',
          requestBody: { required: true, ...json(jsonSchema(createDeadlineSchema)) },
          responses: { 201: { description: 'Plazo creado, con su vencimiento' }, 400: errorResponse },
        },
      },
      '/api/deadlines/batch': {
        post: {
          tags: ['Plazos'],
          summary: 'Guardar varios plazos juntos (los de un mismo documento): todos o ninguno',
          requestBody: { required: true, ...json(jsonSchema(createDeadlinesBatchSchema)) },
          responses: { 201: { description: 'Plazos creados' }, 400: errorResponse },
        },
      },
      '/api/deadlines/calculate': {
        post: {
          tags: ['Plazos'],
          summary: 'Calcular un vencimiento sin guardar nada',
          requestBody: { required: true, ...json(jsonSchema(calculateSchema)) },
          responses: { 200: { description: 'Vencimiento y días que no se contaron, con el motivo' }, 400: errorResponse },
        },
      },
      '/api/deadlines/analyze': {
        post: {
          tags: ['Plazos'],
          summary: 'Leer una cédula, decreto o resolución y proponer los plazos que otorga',
          description:
            'La IA (Gemini) extrae los plazos, la fecha de notificación y la carátula; cada cita se verifica contra el texto del documento. El archivo (PDF, imagen, Word o texto) se lee y se descarta, y no se guarda nada: el abogado confirma cada plazo. El vencimiento no lo calcula la IA.',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
              },
            },
          },
          responses: {
            200: { description: 'Propuesta: resumen, fechas, carátula y plazos (con la cantidad de días en 0 si el documento no la indica)' },
            400: errorResponse,
            413: errorResponse,
            429: errorResponse,
            502: errorResponse,
            503: errorResponse,
          },
        },
      },
      '/api/deadlines/{id}': {
        parameters: [idParam],
        get: {
          tags: ['Plazos'],
          summary: 'Detalle de un plazo, con los días que no se contaron',
          responses: { 200: { description: 'OK' }, 404: errorResponse },
        },
        patch: {
          tags: ['Plazos'],
          summary: 'Guardar cambios (solo los campos enviados); marcar como cumplido o reabrir con status',
          description: 'Si cambia la notificación, los días o el tipo de días, el vencimiento se calcula de nuevo.',
          requestBody: { required: true, ...json(jsonSchema(updateDeadlineSchema)) },
          responses: { 200: { description: 'OK' }, 400: errorResponse, 404: errorResponse },
        },
        delete: { tags: ['Plazos'], summary: 'Eliminar un plazo', responses: { 204: { description: 'Eliminado' }, 404: errorResponse } },
      },
      '/api/calendar': {
        get: {
          tags: ['Calendario'],
          summary: 'Feriados nacionales de un año (calculados) y días inhábiles propios',
          parameters: [{ name: 'year', in: 'query', schema: { type: 'integer', example: 2026 } }],
          responses: { 200: { description: 'OK' }, 400: errorResponse },
        },
      },
      '/api/calendar/non-working-days': {
        post: {
          tags: ['Calendario'],
          summary: 'Agregar un día inhábil o un período (feria judicial, asueto, feriado local)',
          description: 'Los plazos pendientes se recalculan.',
          requestBody: { required: true, ...json(jsonSchema(nonWorkingDayInputSchema)) },
          responses: { 201: { description: 'Creado' }, 400: errorResponse },
        },
      },
      '/api/calendar/non-working-days/{id}': {
        parameters: [idParam],
        put: {
          tags: ['Calendario'],
          summary: 'Reemplazar un día inhábil propio',
          requestBody: { required: true, ...json(jsonSchema(nonWorkingDayInputSchema)) },
          responses: { 200: { description: 'OK' }, 400: errorResponse, 404: errorResponse },
        },
        delete: { tags: ['Calendario'], summary: 'Quitar un día inhábil propio', responses: { 204: { description: 'Eliminado' }, 404: errorResponse } },
      },
      '/api/notifications': {
        get: {
          tags: ['Avisos'],
          summary: 'Avisos sin leer (el más nuevo, primero)',
          description: 'Antes de responder, se generan los avisos que corresponden (3 días, 1 día, hoy, vencido).',
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/notifications/read-all': {
        post: { tags: ['Avisos'], summary: 'Marcar todos los avisos como leídos', responses: { 204: { description: 'Hecho' } } },
      },
      '/api/notifications/{id}/read': {
        parameters: [idParam],
        post: { tags: ['Avisos'], summary: 'Marcar un aviso como leído', responses: { 204: { description: 'Hecho' }, 404: errorResponse } },
      },
      '/api/drafts': {
        get: {
          tags: ['Borradores'],
          summary: 'Listar borradores (sin el texto)',
          parameters: [{ name: 'clientId', in: 'query', description: 'Solo los borradores de este cliente', schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'OK' }, 400: errorResponse },
        },
        post: {
          tags: ['Borradores'],
          summary: 'Redactar un borrador con el agente',
          description:
            'El agente busca en la biblioteca y lee el modelo base y la ficha del cliente (si se eligieron) antes de redactar. Puede tardar hasta un minuto.',
          requestBody: { required: true, ...json(jsonSchema(createDraftSchema)) },
          responses: { 201: { description: 'Borrador creado' }, 400: errorResponse, 429: errorResponse, 502: errorResponse, 503: errorResponse },
        },
      },
      '/api/drafts/{id}': {
        parameters: [idParam],
        get: { tags: ['Borradores'], summary: 'Detalle de un borrador', responses: { 200: { description: 'OK' }, 404: errorResponse } },
        patch: {
          tags: ['Borradores'],
          summary: 'Guardar cambios del abogado (título o texto)',
          requestBody: { required: true, ...json(jsonSchema(updateDraftSchema)) },
          responses: { 200: { description: 'OK' }, 400: errorResponse, 404: errorResponse },
        },
        delete: { tags: ['Borradores'], summary: 'Eliminar un borrador', responses: { 204: { description: 'Eliminado' }, 404: errorResponse } },
      },
      '/api/drafts/{id}/docx': {
        parameters: [idParam],
        get: { tags: ['Borradores'], summary: 'Descargar como Word (.docx)', responses: { 200: { description: 'Archivo .docx' }, 404: errorResponse } },
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
