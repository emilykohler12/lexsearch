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
import { analyzeSchema, createFindingsBatchSchema, updateFindingSchema } from '../modules/contradictions/contradictions.schemas.js';
import { createTopicSchema, updateAlertSchema, updateTopicSchema } from '../modules/normative/normative.schemas.js';
import {
  calculateSchema,
  createDeadlineSchema,
  createDeadlinesBatchSchema,
  updateDeadlineSchema,
} from '../modules/deadlines/deadlines.schemas.js';
import { updateDocumentSchema, uploadFieldsSchema } from '../modules/documents/documents.schemas.js';
import { createDraftSchema, updateDraftSchema } from '../modules/drafts/drafts.schemas.js';
import { loginSchema } from '../modules/auth/auth.controller.js';
import { analyzeEstimateSchema, saveEstimateSchema, updateEstimateSchema } from '../modules/estimates/estimates.schemas.js';
import { createHearingSchema, sendTurnSchema } from '../modules/hearings/hearings.schemas.js';
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
      { name: 'Contradicciones', description: 'Comparación de los documentos de un expediente para encontrar contradicciones de fechas, montos o declaraciones' },
      { name: 'Plazos', description: 'Plazos procesales y contractuales: vencimientos calculados con el calendario, y lectura de cédulas y resoluciones' },
      { name: 'Calendario', description: 'Feriados nacionales (calculados) y días inhábiles propios (feria judicial, asuetos)' },
      { name: 'Avisos', description: 'Avisos generados por el sistema (plazos por vencer)' },
      { name: 'Normativa', description: 'Vigía normativo: normas nuevas de los boletines oficiales (Nación y Provincia de Misiones) que tocan las áreas y los temas que el abogado sigue' },
      { name: 'Borradores', description: 'Escritos y contratos redactados por el agente con la biblioteca como referencia' },
      { name: 'Audiencia', description: 'Simulador de audiencia: el abogado practica frente a una IA que hace de juez o de abogado de la contraparte y recibe una devolución' },
      { name: 'Acceso', description: 'Usuario y contraseña del abogado: sin una sesión abierta, todo lo demás responde 401 (salvo el estado del sistema)' },
      { name: 'Estimador', description: 'Orientación sobre qué tan favorables son los antecedentes de jurisprudencia de la biblioteca para un caso parecido (no es una predicción)' },
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
            { name: 'caseId', in: 'query', description: 'Solo los documentos de este expediente', schema: { type: 'string', format: 'uuid' } },
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
          summary: 'Cambiar título o categoría, o vincular el documento a un expediente (caseId; null lo devuelve a la biblioteca general)',
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
      '/api/cases/{id}/contradictions': {
        parameters: [idParam],
        get: {
          tags: ['Contradicciones'],
          summary: 'Contradicciones confirmadas del expediente (en el orden en que se confirmaron)',
          responses: { 200: { description: 'Cada una con sus afirmaciones y el documento al que remiten (null si se borró)' }, 404: errorResponse },
        },
        post: {
          tags: ['Contradicciones'],
          summary: 'Guardar las contradicciones que el abogado confirmó (las de una misma comparación): todas o ninguna',
          requestBody: { required: true, ...json(jsonSchema(createFindingsBatchSchema)) },
          responses: { 201: { description: 'Contradicciones guardadas' }, 400: errorResponse, 404: errorResponse },
        },
      },
      '/api/cases/{id}/contradictions/analyze': {
        parameters: [idParam],
        post: {
          tags: ['Contradicciones'],
          summary: 'Comparar documentos del expediente y proponer las contradicciones entre ellos',
          description:
            'La IA (Gemini) lee los documentos elegidos (entre 2 y 8, todos del expediente y ya procesados) y señala contradicciones de fechas, montos o declaraciones. Cada afirmación trae una frase que se verifica contra el texto del documento que cita; si no aparece, el hallazgo se marca como no verificado. No se guarda nada: el abogado confirma cada hallazgo. Puede tardar hasta un minuto y medio.',
          requestBody: { required: true, ...json(jsonSchema(analyzeSchema)) },
          responses: {
            200: { description: 'Propuesta: hallazgos (los directos primero) y los documentos leídos, con aviso de los que se leyeron solo en parte' },
            400: errorResponse,
            404: errorResponse,
            429: errorResponse,
            502: errorResponse,
            503: errorResponse,
          },
        },
      },
      '/api/cases/{id}/contradictions/{contradictionId}': {
        parameters: [idParam, { name: 'contradictionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        patch: {
          tags: ['Contradicciones'],
          summary: 'Guardar las observaciones del abogado sobre una contradicción',
          requestBody: { required: true, ...json(jsonSchema(updateFindingSchema)) },
          responses: { 200: { description: 'OK' }, 400: errorResponse, 404: errorResponse },
        },
        delete: { tags: ['Contradicciones'], summary: 'Eliminar una contradicción', responses: { 204: { description: 'Eliminada' }, 404: errorResponse } },
      },
      '/api/normativa/status': {
        get: {
          tags: ['Normativa'],
          summary: 'Estado del vigía: si está revisando y, por cada boletín (Nación, Misiones), la última revisión, la última edición leída y si falló',
          responses: { 200: { description: 'OK (stale = la última revisión de algún boletín es vieja: conviene pedir una nueva)' } },
        },
      },
      '/api/normativa/refresh': {
        post: {
          tags: ['Normativa'],
          summary: 'Revisar los boletines oficiales ahora (en segundo plano)',
          description:
            'Lee las últimas ediciones del Boletín Oficial de la Nación (primera sección) y del de la Provincia de Misiones, el texto de las normas nuevas y las compara con los temas que se siguen. Responde enseguida; el avance se ve en el estado. Hasta 6 por cada 10 minutos.',
          responses: { 202: { description: 'La revisión empezó (o ya estaba en marcha)' }, 429: errorResponse },
        },
      },
      '/api/normativa/alerts': {
        get: {
          tags: ['Normativa'],
          summary: 'Alertas: normas nuevas que tocan un tema que se sigue (las más recientes primero)',
          parameters: [{ name: 'status', in: 'query', description: 'ACTIVE (nuevas y vistas; por defecto), NEW, SEEN o DISMISSED', schema: { type: 'string' } }],
          responses: { 200: { description: 'Cada alerta trae la norma, el tema, por qué importa, la frase que lo respalda y a cuántos clientes y expedientes del área alcanza' } },
        },
      },
      '/api/normativa/alerts/unread-count': {
        get: { tags: ['Normativa'], summary: 'Cantidad de alertas sin ver', responses: { 200: { description: 'OK' } } },
      },
      '/api/normativa/alerts/read-all': {
        post: { tags: ['Normativa'], summary: 'Marcar como vistas todas las alertas nuevas', responses: { 204: { description: 'Hecho' } } },
      },
      '/api/normativa/alerts/{id}': {
        parameters: [idParam],
        patch: {
          tags: ['Normativa'],
          summary: 'Marcar una alerta como nueva, vista o descartada',
          requestBody: { required: true, ...json(jsonSchema(updateAlertSchema)) },
          responses: { 200: { description: 'OK' }, 400: errorResponse, 404: errorResponse },
        },
      },
      '/api/normativa/items': {
        get: {
          tags: ['Normativa'],
          summary: 'Normas de una edición de un boletín oficial (la más reciente guardada si no se indica fecha; el nacional si no se indica boletín)',
          parameters: [
            { name: 'source', in: 'query', description: 'Boletín: BO_NACIONAL o BO_MISIONES', schema: { type: 'string' } },
            { name: 'date', in: 'query', description: 'AAAA-MM-DD', schema: { type: 'string' } },
            { name: 'q', in: 'query', description: 'Busca en el organismo, el tipo, el número, el resumen y el texto', schema: { type: 'string' } },
            { name: 'category', in: 'query', description: 'Rubro: RESOLUCIONES, DISPOSICIONES...', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Las normas, los boletines disponibles, las fechas con ediciones guardadas y los rubros de la edición' }, 400: errorResponse },
        },
      },
      '/api/normativa/topics': {
        get: { tags: ['Normativa'], summary: 'Temas que se siguen (áreas de práctica enteras o temas propios con palabras clave)', responses: { 200: { description: 'OK' } } },
        post: {
          tags: ['Normativa'],
          summary: 'Seguir un área de práctica o un tema propio',
          description: 'Con practiceArea se sigue el área entera; sin ella hace falta un nombre y al menos una palabra clave. Al crearlo se revisan también las normas de los últimos días.',
          requestBody: { required: true, ...json(jsonSchema(createTopicSchema)) },
          responses: { 201: { description: 'Creado' }, 400: errorResponse, 409: errorResponse },
        },
      },
      '/api/normativa/topics/{id}': {
        parameters: [idParam],
        patch: {
          tags: ['Normativa'],
          summary: 'Editar un tema o pausarlo',
          requestBody: { required: true, ...json(jsonSchema(updateTopicSchema)) },
          responses: { 200: { description: 'OK' }, 400: errorResponse, 404: errorResponse },
        },
        delete: { tags: ['Normativa'], summary: 'Dejar de seguir un tema (se borran sus alertas)', responses: { 204: { description: 'Eliminado' }, 404: errorResponse } },
      },
      '/api/hearings': {
        get: {
          tags: ['Audiencia'],
          summary: 'Listar las prácticas de audiencia (la más reciente primero)',
          responses: { 200: { description: 'Cada práctica con su rol, su estado, el escrito, el expediente vinculado y cuántos turnos lleva' } },
        },
        post: {
          tags: ['Audiencia'],
          summary: 'Empezar una práctica: la IA abre la audiencia',
          description:
            'La IA hace de juez (JUDGE) o de abogado de la contraparte (OPPONENT) y lee el escrito (un borrador, un documento de la biblioteca o texto pegado) y, si se indica, la carátula y las actuaciones de un expediente. Responde con la práctica y el primer turno de la IA. Requiere GEMINI_API_KEY. Hasta 10 por minuto.',
          requestBody: { required: true, ...json(jsonSchema(createHearingSchema)) },
          responses: { 201: { description: 'Práctica creada con su primer turno' }, 400: errorResponse, 429: errorResponse, 502: errorResponse, 503: errorResponse },
        },
      },
      '/api/hearings/{id}': {
        parameters: [idParam],
        get: { tags: ['Audiencia'], summary: 'Una práctica con toda la conversación y, si terminó, la devolución', responses: { 200: { description: 'OK' }, 404: errorResponse } },
        delete: { tags: ['Audiencia'], summary: 'Eliminar una práctica', responses: { 204: { description: 'Eliminada' }, 404: errorResponse } },
      },
      '/api/hearings/{id}/turns': {
        parameters: [idParam],
        post: {
          tags: ['Audiencia'],
          summary: 'Responder en la audiencia: la IA contesta',
          description:
            'La respuesta del abogado se guarda aunque la IA falle; en ese caso hay que pedir la contestación con /reply. Cada turno de la IA marca las normas o fallos que nombró y que no figuran en el material (unverifiedCitations). Hasta 20 por minuto; 30 respuestas por práctica.',
          requestBody: { required: true, ...json(jsonSchema(sendTurnSchema)) },
          responses: { 200: { description: 'La práctica con el turno del abogado y el de la IA' }, 400: errorResponse, 404: errorResponse, 409: errorResponse, 429: errorResponse, 502: errorResponse },
        },
      },
      '/api/hearings/{id}/reply': {
        parameters: [idParam],
        post: {
          tags: ['Audiencia'],
          summary: 'Pedir de nuevo la contestación de la IA a la última respuesta del abogado',
          responses: { 200: { description: 'La práctica con el turno de la IA' }, 404: errorResponse, 409: errorResponse, 429: errorResponse, 502: errorResponse },
        },
      },
      '/api/hearings/{id}/finish': {
        parameters: [idParam],
        post: {
          tags: ['Audiencia'],
          summary: 'Terminar la práctica y recibir la devolución',
          description:
            'La devolución resume cómo se desenvolvió el abogado, lo que salió bien, lo que conviene reforzar y qué tener listo. Cada frase citada se busca en lo que dijo el abogado o en su escrito: solo se muestra la que se encuentra. Si ya estaba terminada, devuelve la misma. Hasta 10 por minuto.',
          responses: { 200: { description: 'La práctica terminada, con la devolución' }, 400: errorResponse, 404: errorResponse, 429: errorResponse, 502: errorResponse },
        },
      },
      '/api/auth/me': {
        get: { tags: ['Acceso'], summary: 'Si hay que iniciar sesión y si ya está iniciada', responses: { 200: { description: 'authRequired, authenticated y username' } } },
      },
      '/api/auth/login': {
        post: {
          tags: ['Acceso'],
          summary: 'Iniciar sesión',
          description: 'Abre una sesión y la deja en una cookie HttpOnly con SameSite=Strict. Si el segundo factor está activado (authenticator: totpRequired en /api/auth/me), también hay que mandar `code`, los 6 dígitos de la app: cada código sirve una vez. Lo que cambia datos (POST, PATCH, DELETE) responde 403 si el navegador dice que viene de otro origen. Responde igual a un usuario inexistente que a una contraseña incorrecta. Después de 8 intentos fallidos en 15 minutos hay que esperar.',
          requestBody: { required: true, ...json(jsonSchema(loginSchema)) },
          responses: { 200: { description: 'Sesión abierta' }, 400: errorResponse, 401: errorResponse, 429: errorResponse },
        },
      },
      '/api/auth/activity': {
        get: { tags: ['Acceso'], summary: 'Los ingresos recientes (buenos, fallidos y frenados), con su dirección', responses: { 200: { description: 'events: los últimos eventos, el más reciente primero' }, 401: errorResponse } },
      },
      '/api/auth/logout': {
        post: { tags: ['Acceso'], summary: 'Cerrar la sesión', responses: { 204: { description: 'Sesión cerrada' } } },
      },
      '/api/estimates': {
        get: { tags: ['Estimador'], summary: 'Listar las estimaciones guardadas (la más reciente primero)', responses: { 200: { description: 'OK' } } },
        post: {
          tags: ['Estimador'],
          summary: 'Guardar una estimación revisada',
          requestBody: { required: true, ...json(jsonSchema(saveEstimateSchema)) },
          responses: { 201: { description: 'Estimación guardada' }, 400: errorResponse },
        },
      },
      '/api/estimates/analyze': {
        post: {
          tags: ['Estimador'],
          summary: 'Estimar con IA qué tan favorables son los antecedentes para un caso (propuesta: no guarda nada)',
          description:
            'Busca jurisprudencia parecida en la biblioteca, la IA clasifica cada antecedente (comparable o no, a favor o en contra) con una frase del fallo y el servidor verifica cada frase y cuenta. La orientación (favorables, divididos, desfavorables o insuficientes) la calcula el servidor; no hay porcentajes. Con menos de 3 antecedentes comparables y verificados es «insuficiente». Requiere GEMINI_API_KEY. Hasta 10 por minuto.',
          requestBody: { required: true, ...json(jsonSchema(analyzeEstimateSchema)) },
          responses: { 200: { description: 'La propuesta, con el aviso que siempre debe mostrarse' }, 400: errorResponse, 429: errorResponse, 502: errorResponse, 503: errorResponse },
        },
      },
      '/api/estimates/{id}': {
        parameters: [idParam],
        get: { tags: ['Estimador'], summary: 'Una estimación guardada', responses: { 200: { description: 'OK' }, 404: errorResponse } },
        patch: {
          tags: ['Estimador'],
          summary: 'Editar la nota del abogado',
          requestBody: { required: true, ...json(jsonSchema(updateEstimateSchema)) },
          responses: { 200: { description: 'OK' }, 400: errorResponse, 404: errorResponse },
        },
        delete: { tags: ['Estimador'], summary: 'Eliminar una estimación', responses: { 204: { description: 'Eliminada' }, 404: errorResponse } },
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
