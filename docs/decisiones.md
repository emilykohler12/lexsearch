# Decisiones técnicas

Registro breve de las decisiones de arquitectura de LexSearch: qué se decidió, por qué y qué implica. Complementa el documento técnico y la hoja de ruta del proyecto.

## D1 · Monolito modular

Una sola aplicación backend con módulos internos bien separados (`documents`, `rag`, `llm`, `embeddings`, `interactions`), cada uno con capas `routes → controller → service → repository`. Es un sistema para un único usuario: microservicios agregarían complejidad operativa sin beneficio.

## D2 · PostgreSQL 17 + pgvector en Docker

- Una sola base para datos relacionales y vectores (imagen `pgvector/pgvector:pg17`).
- En desarrollo el contenedor publica el puerto **5433** solo en `127.0.0.1` (el 5432 ya lo usa otro Postgres de esta máquina).
- Base aparte `lexsearch_test` para los tests de integración; los tests nunca corren contra la base real (el setup lo verifica).

## D3 · Embeddings locales (`Xenova/multilingual-e5-base`)

- **Por qué:** los documentos de clientes están protegidos por secreto profesional. Indexar con un modelo local significa que la biblioteca completa **nunca** se envía a terceros; solo viajan a Claude los fragmentos relevantes de cada consulta. Además no tiene costo por uso ni requiere API key para empezar.
- **Modelo:** multilingüe (buen desempeño en español), 768 dimensiones, versión cuantizada de ~280 MB que corre en CPU con ONNX (transformers.js). Usa los prefijos `query:` / `passage:` que requiere la familia e5.
- **Costo:** calidad algo menor que los mejores modelos comerciales. Si en el uso real la búsqueda se queda corta, se puede cambiar el proveedor detrás de la interfaz `EmbeddingProvider`.
- **Cambiar de modelo** implica: nueva dimensión en `schema.prisma` y en `EMBEDDING_DIMENSIONS`, una migración, y reprocesar todos los documentos (el modelo usado queda registrado en cada documento).

## D4 · LLM: Claude, detrás de una interfaz propia

- La decisión pendiente del documento técnico (sección 4.4) se resuelve a favor de **Claude (Anthropic)**: soporta uso de herramientas (necesario para los agentes de las fases 2+), ventana de contexto de 1M tokens, buena redacción en español jurídico, y su API no usa los datos enviados para entrenar por defecto.
- Modelo por defecto `claude-opus-5`, configurable con `ANTHROPIC_MODEL`; profundidad de razonamiento configurable con `LLM_EFFORT` (por defecto `medium`, buen equilibrio de latencia y costo para responder sobre fragmentos provistos).
- **Citas nativas:** cada fragmento se envía como un documento con citas habilitadas; la API devuelve el texto citado *extraído literalmente* del fragmento (no generado), con su posición. Eso permite resaltar la cita exacta y rastrear cada afirmación.
- **Rechazos:** se habilita el *fallback* del lado del servidor (`fallbacks: "default"`), que reintenta con el modelo recomendado si un filtro de seguridad declinara una consulta legítima.
- Toda la app habla con la interfaz `LlmProvider`; cambiar de proveedor es escribir otra implementación.

## D5 · Búsqueda híbrida con Reciprocal Rank Fusion

La búsqueda por vectores entiende paráfrasis ("irse del local antes de tiempo" → "rescisión anticipada") pero diluye referencias exactas ("art. 245", "Ley 20.744"). Por eso se combinan dos búsquedas: semántica (pgvector, distancia coseno) y por palabras (full-text de Postgres con configuración `es_unaccent`: español con *stemming* y sin acentos). Los dos rankings se fusionan con RRF, que usa solo las posiciones y no requiere calibrar puntajes incomparables.

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
