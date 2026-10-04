# Decisiones técnicas

Registro breve de las decisiones de arquitectura de LexSearch: qué se decidió, por qué y qué implica. Complementa el documento técnico y la hoja de ruta del proyecto.

## D1 · Monolito modular

Una sola aplicación backend con módulos internos bien separados (`documents`, `rag`, `drafts`, `llm`, `embeddings`, `interactions`), cada uno con capas `routes → controller → service → repository`. Es un sistema para un único usuario: microservicios agregarían complejidad operativa sin beneficio.

## D2 · PostgreSQL 17 + pgvector en Docker

- Una sola base para datos relacionales y vectores (imagen `pgvector/pgvector:pg17`).
- En desarrollo el contenedor publica el puerto **5433** solo en `127.0.0.1` (el 5432 ya lo usa otro Postgres de esta máquina).
- Base aparte `lexsearch_test` para los tests de integración; los tests nunca corren contra la base real (el setup lo verifica).

## D3 · Embeddings locales (`Xenova/multilingual-e5-base`)

- **Por qué:** los documentos de clientes están protegidos por secreto profesional. Indexar con un modelo local significa que la biblioteca completa **nunca** se envía a terceros; solo viajan al LLM los fragmentos relevantes de cada consulta. Además no tiene costo por uso ni requiere API key para empezar.
- **Modelo:** multilingüe (buen desempeño en español), 768 dimensiones, versión cuantizada de ~280 MB que corre en CPU con ONNX (transformers.js). Usa los prefijos `query:` / `passage:` que requiere la familia e5.
- **Costo:** calidad algo menor que los mejores modelos comerciales. Si en el uso real la búsqueda se queda corta, se puede cambiar el proveedor detrás de la interfaz `EmbeddingProvider`.
- **Cambiar de modelo** implica: nueva dimensión en `schema.prisma` y en `EMBEDDING_DIMENSIONS`, una migración, y reprocesar todos los documentos (el modelo usado queda registrado en cada documento).

## D4 · LLM: Gemini (Google), detrás de una interfaz propia

- La decisión pendiente del documento técnico (sección 4.4) se resuelve a favor de **Gemini**: plan gratuito para practicar, modelos Flash rápidos y económicos, ventana de contexto de 1M tokens, uso de herramientas (necesario para los agentes de las fases 2+) y buena redacción en español.
- **Modelo:** `gemini-3.5-flash-lite` con razonamiento `low`: responde en 2 o 3 segundos y, en las pruebas, con la misma calidad y citas verificadas que `gemini-3.5-flash`, que en cambio estaba congestionado (respuestas de 30 a 50 s y errores 503). Con el razonamiento por defecto, las respuestas tardaban unos 30 s sin mejorar sobre fragmentos provistos. Todo es configurable en `.env`.
- **Modelos de respaldo:** los modelos más nuevos suelen saturarse (error 503) y Google retira modelos viejos con frecuencia (404; por ejemplo, la familia 2.5 ya no está disponible para cuentas nuevas). Ante 404, 429, 5xx o si un modelo no contesta en 30 s, se prueba el siguiente de `GEMINI_FALLBACK_MODELS` (por defecto `gemini-3.5-flash`). Los errores de la solicitud misma (400) no se ocultan detrás de un respaldo.
- **Citas verificadas:** Gemini no tiene citas nativas sobre documentos provistos, así que responde con **salida estructurada** (JSON con esquema): bloques de texto, cada uno con el número de fragmento que lo respalda y una frase corta copiada textualmente. El servidor busca esa frase en el fragmento original (tolerando mayúsculas, espacios y comillas) y **solo la resalta si existe**; el texto resaltado se toma del fragmento, nunca de lo que escribió el modelo. Si la frase no aparece, se conserva la referencia al fragmento sin presentarla como cita textual.
- **Recitación:** si Gemini corta la respuesta por reproducir textos públicos (por ejemplo, el artículo de una ley), se reintenta una vez pidiendo solo números de fragmento.
- **Filtros de seguridad:** se configuran en `BLOCK_NONE` para acoso, odio, contenido sexual y peligroso, porque los expedientes pueden describir delitos en detalle y un bloqueo impediría trabajo profesional legítimo. Las protecciones propias del modelo siguen activas.
- **Privacidad:** en el plan gratuito Google puede usar el contenido enviado para mejorar sus productos. Antes de procesar datos reales de clientes hay que activar la facturación del proyecto (ver también D12).
- Toda la app habla con la interfaz `LlmProvider`; cambiar de proveedor es escribir otra implementación.

## D5 · Búsqueda híbrida con Reciprocal Rank Fusion

La búsqueda por vectores entiende paráfrasis ("irse del local antes de tiempo" → "rescisión anticipada") pero diluye referencias exactas ("art. 245", "Ley 20.744"). Por eso se combinan dos búsquedas: semántica (pgvector, distancia coseno) y por palabras (full-text de Postgres con configuración `es_unaccent`: español con *stemming* y sin acentos). Los dos rankings se fusionan con RRF, que usa solo las posiciones y no requiere calibrar puntajes incomparables.

**Umbral de relevancia.** RRF solo ordena: sin un piso, cualquier consulta (incluso «ghfghfgh») devolvía los fragmentos «menos lejanos» de la biblioteca. Medido con el modelo e5, las consultas sin relación dan una similitud coseno de 0,73 a 0,76 y las relacionadas, de 0,79 en adelante. Por eso los resultados que llegan solo por significado tienen que alcanzar **0,80** (`SEARCH_MIN_SIMILARITY`); los que coinciden por palabras exactas se muestran siempre. Si no queda ninguno, «Preguntar a la IA» responde que no encontró material, sin llamar a Gemini: no se gasta cupo ni se le da pie a inventar. La escala depende del modelo (por eso el valor vive en el `EmbeddingProvider`): si se cambia el modelo de embeddings, hay que recalibrarlo.

## D6 · Fragmentación por párrafos

Fragmentos de hasta 1.200 caracteres (el modelo lee hasta ~512 tokens), con hasta 200 caracteres de solapamiento. Se priorizan los cortes entre párrafos para no partir artículos o cláusulas; los párrafos largos se cortan por oración, sin romper en abreviaturas jurídicas ("art.", "inc.", "Dr.", "S.A."). Cada fragmento guarda sus páginas de origen para citar "pág. 12". El título del documento se antepone al texto solo para calcular el vector.

## D7 · Procesamiento en segundo plano sin Redis

La subida responde enseguida y el indexado corre en una cola en memoria, de a un documento por vez. Si el servidor se reinicia a mitad de camino, los documentos pendientes se retoman al arrancar (el estado vive en la base). Para un solo usuario no se justifica BullMQ/Redis.

## D8 · Partes de la base escritas a mano

Prisma no modela el tipo `vector`, las columnas generadas ni los índices HNSW. La migración inicial incluye SQL propio (extensiones, configuración `es_unaccent`, columna `search_vector` generada, índices HNSW y GIN) y `schema.prisma` los declara explícitamente para que `prisma migrate dev` no intente borrarlos en migraciones futuras (verificado: el diff contra la base queda vacío). No usar `prisma db push`: siempre migraciones.

## D9 · Registro sin datos sensibles

Los logs registran método, ruta, estado, ids, cantidades y tiempos; nunca el contenido de documentos, preguntas ni respuestas. Las consultas viajan en el cuerpo (POST), no en la URL. El historial completo de cada interacción con la IA (pregunta, fragmentos usados, respuesta, modelo, versión del prompt, tokens) se guarda en la base de datos, que es el lugar protegido, para poder depurar prompts.

## D10 · Prompts versionados en archivos

Los prompts viven en `backend/prompts/*.md` y se referencian por versión (`rag-answer.v1`). Para cambiar un prompt se crea una versión nueva; el historial registra qué versión produjo cada respuesta.

## D11 · Hosting (a implementar en la Fase 10)

Decisión tomada en principio: **VPS chico + Docker Compose, sin exponerlo a internet**, con acceso solo por red privada (Tailscale/WireGuard). Backups diarios con `pg_dump`, cifrados (por ejemplo con `age`) y subidos a un almacenamiento S3-compatible (por ejemplo Backblaze B2). Antes de salir del entorno local hay que sumar autenticación (contraseña + JWT en cookie httpOnly), HTTPS y revisar límites de uso.

## D12 · Anonimización (a implementar en la Fase 10)

Anonimización **parcial y reversible** de identificadores directos (nombre, DNI, teléfono, email, dirección) antes de enviar texto al LLM: se reemplazan por tokens (`[CLIENTE_1]`), el mapeo queda solo en la base local y se revierte en la respuesta. No se anonimizan fechas, montos ni hechos, porque son necesarios para que la respuesta sirva; es una mitigación, no una garantía absoluta. Se vuelve obligatoria cuando el sistema procese datos reales de clientes fuera del entorno controlado.

## D13 · OCR local con Tesseract

- **Por qué local:** las fotos y escaneos suelen ser los documentos más sensibles (cédulas, DNI, recibos). Tesseract (compilado a WebAssembly con `tesseract.js`) corre en la computadora: ninguna imagen sale de ahí. Solo se descargan una vez los datos del idioma español (~15 MB).
- **Cuándo se usa:** en cada página de PDF con menos de 25 caracteres de texto (escaneos, o páginas escaneadas sueltas dentro de un PDF digital) y en imágenes JPG, PNG, WEBP y TIFF (los TIFF de varias páginas se leen página por página). Las páginas de PDF con texto real no pasan por OCR.
- **Cómo:** la página del PDF se dibuja como imagen al doble de tamaño (`pdf-parse`); las fotos se corrigen con `sharp` (rotación según el celular, escala de grises, contraste y tamaño) antes de leerlas. En pruebas, una cédula escaneada se leyó con 94 % de confianza en menos de medio segundo por página.
- **Transparencia:** cada documento guarda cuántas páginas se leyeron con OCR (`ocr_page_count`) y la biblioteca lo marca como «Leído con OCR», porque el texto puede tener errores de lectura.
- **Fuera de alcance por ahora:** las fotos HEIC del iPhone (se pide mandarlas como JPG) y la escritura manuscrita.

## D14 · Borradores con un agente que usa herramientas

- **Por qué un agente:** un buen borrador necesita material que el abogado no eligió de antemano (otro modelo parecido, una cláusula, la norma aplicable). En lugar de meter toda la biblioteca en el prompt, Gemini recibe dos herramientas y decide qué consultar: `buscar_en_biblioteca` (la misma búsqueda híbrida, 6 fragmentos por búsqueda, con filtro opcional por tipo) y `leer_documento` (texto completo de un documento procesado, hasta 40.000 caracteres). Tiene hasta 4 rondas de consultas; después ya no puede usarlas y tiene que escribir.
- **Solo lectura:** las herramientas solo leen la biblioteca; el agente no puede modificar nada. Lo que devuelven se trata como datos, no como instrucciones (inyección de prompt).
- **Interfaz neutral:** `LlmProvider.runAgent` recibe herramientas definidas como nombre + descripción + esquema JSON + función. La implementación de Gemini usa *function calling*, conserva intactos los turnos del modelo (incluidas sus firmas de razonamiento) y, si un modelo falla por saturación o cupo, reinicia toda la redacción con el modelo de respaldo.
- **Nada inventado:** el prompt (`draft-generator.v1`) prohíbe citar normas o fallos que no estén en la biblioteca (deja `[COMPLETAR: norma aplicable]`) e inventar datos de las partes (`[COMPLETAR: DNI del cliente]`). La interfaz resalta esos marcadores y cuenta cuántos quedan. En las pruebas con Gemini, el borrador citó solo la ley que figuraba en el modelo base y dejó marcadas las cosas que faltaban.
- **Formato:** el agente escribe un subconjunto de Markdown (títulos, cláusulas numeradas, negrita). La web lo muestra como vista previa y el servidor lo convierte a Word (.docx) con Times New Roman 12, texto justificado e interlineado 1,5. Las líneas de guiones bajos se mantienen como líneas de firma. El agente propone además un título breve («Título: …») para distinguir los borradores en la lista.
- **Trazabilidad:** cada borrador guarda la lista de lo que el agente consultó (documentos leídos y fragmentos), y el historial de interacciones guarda el texto original de la IA, las herramientas usadas, tokens y versión del prompt, aunque después el abogado edite el borrador.
- **Edición:** los cambios se guardan solos un segundo después de dejar de escribir; al salir de la página se guarda lo pendiente.
- **Privacidad:** a diferencia de las consultas, acá viajan a Gemini los datos del caso y el texto completo de los documentos que el agente lee. Vale la misma condición de D4 y D12: facturación activada (y anonimización en la Fase 10) antes de usar datos reales de clientes.
