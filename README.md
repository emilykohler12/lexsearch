# LexSearch

Sistema de inteligencia artificial personal para un abogado: una **biblioteca consultable** (leyes, jurisprudencia, doctrina y modelos propios) que responde preguntas en lenguaje natural **citando el fragmento exacto de cada fuente**, y un **asistente que redacta borradores** de escritos y contratos a partir de esa biblioteca. En las próximas fases: fichas de clientes, control de plazos y más.

> **Principio rector:** todo contenido generado es una propuesta que el abogado revisa y valida. El sistema no reemplaza el criterio profesional ni asesora por sí mismo.

## Estado del proyecto

| Fase | Entregable | Estado |
| --- | --- | --- |
| 0 | Setup: repo, entorno, PostgreSQL + pgvector, proveedor de LLM | ✅ Hecha |
| 1 | RAG básico: subir documentos, fragmentar, embeddings, búsqueda y respuestas con citas | ✅ Hecha |
| 2 | Generador de borradores de escritos y contratos | ✅ Hecha |
| 3 | Ficha de cliente / CRM simplificado | Siguiente |
| 4 | Control de plazos y notificaciones | Pendiente |
| 5 | Timeline automático de expediente | Pendiente |
| 6 | Detector de contradicciones | Pendiente |
| 7 | Vigía normativo (Boletín Oficial) | Pendiente |
| 8 | Simulador de audiencia | Pendiente |
| 9 | Estimador de probabilidad de éxito | Pendiente |
| 10 | Hosting y despliegue (VPS + Docker Compose + Tailscale) | Pendiente |

Las decisiones técnicas y su justificación están en [docs/decisiones.md](docs/decisiones.md).

## Qué hace hoy

- **Biblioteca:** subís PDF, Word (.docx), .txt o .md, o fotos y escaneos (JPG, PNG, WEBP, TIFF), eligiendo el tipo (legislación, jurisprudencia, doctrina, modelo propio, escrito, otro). Cada documento se procesa en segundo plano: extracción de texto por página, fragmentación respetando artículos y cláusulas, e indexado. Detecta duplicados por contenido.
- **OCR (reconocimiento de texto):** los PDF escaneados (o sus páginas escaneadas) y las fotos se leen automáticamente, en tu computadora: las imágenes no se envían a ningún servicio. Los documentos leídos así quedan marcados como «Leído con OCR», porque el texto puede tener errores de lectura.
- **Búsqueda híbrida:** combina búsqueda *por significado* (vectores) con búsqueda *por palabras exactas* en español sin acentos (útil para "art. 245" o "Ley 20.744"). Filtra por tipo de documento. Solo muestra fragmentos que de verdad se relacionan con la consulta: si buscás algo que no está en tu biblioteca, te lo dice en lugar de mostrar resultados al azar.
- **Respuestas con IA (Gemini):** redacta la respuesta usando solo los fragmentos recuperados y marca cada afirmación con su fuente. Antes de mostrar una cita, el servidor verifica que la frase exista textualmente en el fragmento. Al hacer clic en una cita ves ese texto resaltado y podés abrir el PDF original en esa página.
- **Borradores con IA:** elegís el tipo de documento (carta documento, contrato, demanda, contestación u otro escrito), opcionalmente un modelo base de tu biblioteca, y cargás los datos del caso y qué necesitás. Un asistente de IA lee el modelo, busca en tu biblioteca cláusulas, normas y jurisprudencia, y redacta el borrador. Solo cita normas que encontró en tu biblioteca; los datos que faltan quedan marcados como `[COMPLETAR: …]` y resaltados. Podés editarlo (se guarda solo), copiarlo o descargarlo en Word (.docx), y ver qué documentos consultó.
- **Historial:** cada consulta queda registrada con su respuesta, las fuentes, el modelo y la versión del prompt. Los borradores también quedan registrados en la base con el texto original de la IA, aunque después los edites.
- **API documentada** en `http://localhost:4000/api/docs` (Swagger).

## Requisitos

- **Node.js 24** (LTS) — `node --version`
- **Docker Desktop** — para la base de datos PostgreSQL con pgvector
- **API key de Gemini** (Google AI Studio) — opcional para empezar: sin ella la biblioteca y la búsqueda funcionan; solo se desactivan las respuestas redactadas por IA.

## Puesta en marcha

Todos los comandos se ejecutan en la carpeta del proyecto (`C:\Users\Emily Kohler\lexsearch`).

1. **Instalar dependencias** (solo la primera vez o cuando cambie `package.json`):

   ```bash
   npm install
   ```

2. **Configurar el entorno.** Si no existe el archivo `.env` en la raíz, copiá el de ejemplo:

   ```bash
   cp .env.example .env
   ```

3. **Abrir Docker Desktop** desde el menú Inicio y esperar a que diga *Engine running*. No se abre solo al prender la computadora, salvo que actives *Settings → General → Start Docker Desktop when you sign in*.

4. **Crear la base de datos y aplicar las migraciones:**

   ```bash
   npm run setup
   ```

5. **Descargar los modelos locales** (búsqueda ~280 MB y OCR en español ~15 MB, una sola vez; si ya están descargados, termina enseguida):

   ```bash
   npm run models:download
   ```

6. **Levantar el sistema** (API + interfaz web):

   ```bash
   npm run dev
   ```

7. Abrir **http://localhost:5180** en el navegador.

Para detenerlo: `Ctrl + C` en la terminal. La base de datos sigue corriendo en Docker; para apagarla, `npm run db:down` (los datos se conservan).

## Configurar Gemini

1. Entrá a **https://aistudio.google.com/apikey** con tu cuenta de Google.
2. Hacé clic en **Create API key**, elegí (o creá) un proyecto y copiá la clave.
3. Abrí el archivo `.env` de la raíz del proyecto con un editor de texto y pegá la clave en la línea:

   ```
   GEMINI_API_KEY=pegá-acá-tu-clave
   ```

4. Guardá el archivo y reiniciá el sistema (`Ctrl + C` y otra vez `npm run dev`). Para comprobarlo, hacé una consulta con «Preguntar a la IA»: si falta la clave, la página lo avisa.

> **Importante — privacidad.** Según los términos de la API de Gemini, en el **plan gratuito** Google puede usar lo que enviás (preguntas y fragmentos) para mejorar sus productos, y personas pueden revisarlo. Con la **facturación activada** en el proyecto, no lo usa con ese fin. Para probar con documentos ficticios alcanza el plan gratuito; **antes de usar documentos reales de clientes, activá la facturación** (en AI Studio: *Billing*). Conviene reconfirmar estas condiciones en los términos vigentes de Google.

La clave es un secreto: el `.env` está excluido de git y nunca debe compartirse ni subirse al repositorio. Opciones relacionadas en `.env`:

- `GEMINI_MODEL` (por defecto `gemini-3.5-flash-lite`): el modelo que redacta las respuestas. Responde en 2 o 3 segundos.
- `GEMINI_FALLBACK_MODELS` (por defecto `gemini-3.5-flash`): modelos de respaldo, separados por coma. Se usan si el principal está saturado, sin cupo, fue retirado por Google o no contesta en 30 segundos.
- `GEMINI_THINKING_LEVEL` (por defecto `low`): cuánto razona el modelo antes de responder (`minimal` · `low` · `medium` · `high`). Más alto puede ayudar en consultas complejas, pero es bastante más lento.

## Comandos útiles

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Levanta la API (puerto 4000) y la web (puerto 5180) con recarga automática |
| `npm run setup` | Levanta la base en Docker y aplica las migraciones |
| `npm run db:up` / `npm run db:down` | Enciende / apaga el contenedor de PostgreSQL |
| `npm run models:download` | Descarga y prueba el modelo local de embeddings |
| `npm test` | Tests unitarios + de integración (necesita la base en Docker) |
| `npm run test:unit` | Solo tests unitarios (no necesita base de datos) |
| `npm run lint` / `npm run typecheck` | Controles de calidad del código |
| `npm run db:studio -w backend` | Explorador visual de la base de datos (Prisma Studio) |

## Estructura

```
lexsearch/
├── backend/                  API (Node.js + TypeScript + Express + Prisma)
│   ├── prisma/               Esquema de datos y migraciones
│   ├── prompts/              Prompts versionados (se editan acá, no en el código)
│   ├── scripts/              Utilidades (descarga del modelo de embeddings)
│   ├── src/
│   │   ├── config/           Variables de entorno validadas
│   │   ├── lib/              Logger, errores, almacenamiento de archivos, Prisma
│   │   ├── middlewares/      Manejo centralizado de errores
│   │   ├── docs/             Especificación OpenAPI
│   │   └── modules/
│   │       ├── documents/    Biblioteca: subida, extracción, fragmentación, indexado
│   │       ├── embeddings/   Modelo local de embeddings
│   │       ├── rag/          Búsqueda híbrida y respuestas con citas
│   │       ├── drafts/       Borradores: asistente de redacción, edición y exportación a Word
│   │       ├── llm/          Proveedor de IA (Gemini) detrás de una interfaz
│   │       ├── interactions/ Historial de interacciones con la IA
│   │       └── health/       Estado del sistema
│   └── tests/                Tests unitarios y de integración
├── frontend/                 Interfaz web (React + TypeScript + Vite + Tailwind)
├── docker/                   Inicialización de la base de datos
├── docs/                     Decisiones técnicas
└── docker-compose.yml        PostgreSQL 17 + pgvector
```

Cada módulo del backend sigue la misma separación de capas: `routes → controller → service → repository`. Los controllers solo validan la entrada (con zod) y delegan; la lógica vive en los services.

## Cómo funciona por dentro

1. **Al subir un documento:** se guarda el original con un nombre aleatorio → se extrae el texto por página → se divide en fragmentos de ~1.200 caracteres respetando párrafos → cada fragmento se convierte en un vector con un modelo que corre en tu computadora → se guarda en PostgreSQL (pgvector).
2. **Al preguntar:** la pregunta se convierte en vector → se buscan los fragmentos más parecidos por significado y por palabras, descartando los que no alcanzan una similitud mínima → se combinan ambos rankings → los 8 mejores se envían a Gemini → Gemini responde en bloques, indicando para cada uno el fragmento que lo respalda y una frase copiada textualmente → el servidor verifica cada frase contra el fragmento original y solo resalta las que existen de verdad. Si no hay ningún fragmento relacionado, responde eso mismo sin consultar a Gemini.
3. **Al pedir un borrador:** el pedido (tipo, datos del caso, indicaciones y modelo base) se envía a Gemini junto con dos herramientas: *buscar en la biblioteca* y *leer un documento*. Gemini decide qué buscar y qué leer (hasta 4 rondas); cada búsqueda la ejecuta el servidor en tu base local y le devuelve solo esos resultados. Con eso redacta el borrador, que se guarda junto con la lista de lo que consultó.

## Privacidad y seguridad

- Los documentos completos **no salen de tu computadora**: el indexado usa un modelo local. A Gemini solo viajan la pregunta y los fragmentos relevantes de cada consulta; al redactar un borrador, también los datos del caso que cargaste y el texto del modelo base (o de los documentos que el asistente decida leer). Con el plan gratuito de la API, Google puede usar ese contenido para mejorar sus productos: activá la facturación antes de trabajar con datos reales de clientes (ver «Configurar Gemini»).
- La API y la base escuchan solo en `127.0.0.1`: no son accesibles desde otras computadoras de la red.
- Los logs no registran contenido de documentos, preguntas ni respuestas (solo ids, cantidades y tiempos). Las consultas viajan en el cuerpo de la solicitud, nunca en la URL.
- El contenido de los documentos se trata como **datos, nunca como instrucciones** (mitigación de inyección de prompt), y cada afirmación de la IA debe poder rastrearse a su fuente.
- Antes de exponer el sistema fuera de esta computadora (Fase 10) hay que agregar autenticación, HTTPS, backups cifrados y la capa de anonimización. Ver [docs/decisiones.md](docs/decisiones.md).

## Solución de problemas

**Docker Desktop muestra "An unexpected error occurred ... sailor-ingest.sock" o "... docker-secrets-engine/engine.sock ... El sistema no tiene acceso al archivo".** Quedaron archivos de conexión viejos de una sesión anterior. Solución:

1. En la ventana de error, clic en **Quit** (no en *Reset to factory defaults*, que borra imágenes y volúmenes).
2. En el Explorador de archivos, escribí `%LOCALAPPDATA%` en la barra de direcciones.
3. Renombrá la carpeta `docker-secrets-engine` a `docker-secrets-engine.old` (si existe).
4. Dentro de la carpeta `Docker`, renombrá `run` a `run.old` (si existe).
5. Abrí Docker Desktop **desde el menú Inicio**.

**"Gemini no está disponible en este momento" o "límite de uso".** El modelo está saturado o se agotó el cupo (en el plan gratuito es bajo). La app ya prueba sola el modelo de respaldo (`GEMINI_FALLBACK_MODELS`); si el error sigue, esperá unos minutos o agregá otro modelo de respaldo. La lista de modelos disponibles está en Google AI Studio.

**La búsqueda no encuentra algo que sí está en un documento.** Probá con las palabras exactas del texto (esa búsqueda no tiene umbral). Si igual hace falta, bajá un poco `SEARCH_MIN_SIMILARITY` en `.env` (por defecto `0.8`; más bajo muestra más resultados, pero también algunos sin relación) y reiniciá.

**Redactar un borrador tarda o falla.** El asistente consulta varias veces tu biblioteca y a Gemini: puede tardar hasta un minuto. Si Gemini está saturado se prueba solo el modelo de respaldo; si el error sigue, esperá unos minutos y volvé a intentar.

**"El modelo … ya no está disponible".** Google retira modelos viejos con frecuencia. Cambiá `GEMINI_MODEL` en `.env` por uno vigente (por ejemplo, el Flash más nuevo) y reiniciá.

**"El puerto 5180 / 4000 / 5433 está en uso".** Otro programa lo está usando. Cerralo, o cambiá el puerto en `.env` (`PORT`, `POSTGRES_PORT` + `DATABASE_URL`) y en `frontend/vite.config.ts`.

**Un escaneo o una foto queda en "Error: no se pudo reconocer texto".** El OCR no pudo leerlo: suele pasar con fotos borrosas, torcidas o con poca luz. Volvé a sacar la foto (derecha, con buena luz y de cerca) o escaneá el documento. Si tenés la versión digital, siempre es mejor subir esa.

**Una foto del iPhone (HEIC) es rechazada.** El formato HEIC no es compatible: mandala como JPG (en el iPhone: *Ajustes → Cámara → Formatos → Más compatible*).

**"No se pudo usar el reconocimiento de texto (OCR)".** La primera vez el OCR descarga los datos del idioma español; hace falta conexión a internet. Corré `npm run models:download` y después usá «Reprocesar» en el documento.

**"Motor de búsqueda: error al cargar".** La primera vez el modelo se descarga de Hugging Face; hace falta conexión a internet. Corré `npm run models:download` para ver el detalle.
