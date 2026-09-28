# LexSearch

Sistema de inteligencia artificial personal para un abogado: una **biblioteca consultable** (leyes, jurisprudencia, doctrina y modelos propios) que responde preguntas en lenguaje natural **citando el fragmento exacto de cada fuente**, y —en las próximas fases— un asistente que redacta borradores, arma fichas de clientes y controla plazos.

> **Principio rector:** todo contenido generado es una propuesta que el abogado revisa y valida. El sistema no reemplaza el criterio profesional ni asesora por sí mismo.

## Estado del proyecto

| Fase | Entregable | Estado |
| --- | --- | --- |
| 0 | Setup: repo, entorno, PostgreSQL + pgvector, proveedor de LLM | ✅ Hecha |
| 1 | RAG básico: subir documentos, fragmentar, embeddings, búsqueda y respuestas con citas | ✅ Hecha |
| 2 | Generador de borradores de escritos y contratos | Siguiente |
| 3 | Ficha de cliente / CRM simplificado | Pendiente |
| 4 | Control de plazos y notificaciones | Pendiente |
| 5 | Timeline automático de expediente | Pendiente |
| 6 | Detector de contradicciones | Pendiente |
| 7 | Vigía normativo (Boletín Oficial) | Pendiente |
| 8 | Simulador de audiencia | Pendiente |
| 9 | Estimador de probabilidad de éxito | Pendiente |
| 10 | Hosting y despliegue (VPS + Docker Compose + Tailscale) | Pendiente |

Las decisiones técnicas y su justificación están en [docs/decisiones.md](docs/decisiones.md).

## Qué hace hoy

- **Biblioteca:** subís PDF (con texto), Word (.docx), .txt o .md, eligiendo el tipo (legislación, jurisprudencia, doctrina, modelo propio, escrito, otro). Cada documento se procesa en segundo plano: extracción de texto por página, fragmentación respetando artículos y cláusulas, e indexado. Detecta duplicados por contenido y avisa si un PDF está escaneado (sin texto).
- **Búsqueda híbrida:** combina búsqueda *por significado* (vectores) con búsqueda *por palabras exactas* en español sin acentos (útil para "art. 245" o "Ley 20.744"). Filtra por tipo de documento.
- **Respuestas con IA (Claude):** redacta la respuesta usando solo los fragmentos recuperados y marca cada afirmación con su fuente. Al hacer clic en una cita ves el texto exacto resaltado y podés abrir el PDF original en esa página.
- **Historial:** cada consulta queda registrada con su respuesta, las fuentes, el modelo y la versión del prompt.
- **API documentada** en `http://localhost:4000/api/docs` (Swagger).

## Requisitos

- **Node.js 24** (LTS) — `node --version`
- **Docker Desktop** — para la base de datos PostgreSQL con pgvector
- **Cuenta de Anthropic con API key** — opcional para empezar: sin ella la biblioteca y la búsqueda funcionan; solo se desactivan las respuestas redactadas por IA.

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

3. **Abrir Docker Desktop** desde el menú Inicio y esperar a que diga *Engine running*.

4. **Crear la base de datos y aplicar las migraciones:**

   ```bash
   npm run setup
   ```

5. **Descargar el modelo de búsqueda** (~280 MB, una sola vez; si ya está descargado, termina enseguida):

   ```bash
   npm run models:download
   ```

6. **Levantar el sistema** (API + interfaz web):

   ```bash
   npm run dev
   ```

7. Abrir **http://localhost:5180** en el navegador.

Para detenerlo: `Ctrl + C` en la terminal. La base de datos sigue corriendo en Docker; para apagarla, `npm run db:down` (los datos se conservan).

## Configurar Claude

1. Entrá a **https://console.anthropic.com** e iniciá sesión (o creá una cuenta).
2. En **Billing**, cargá crédito (la API se paga por uso; una consulta típica cuesta aproximadamente entre USD 0,03 y 0,08 con el modelo por defecto).
3. En **API Keys**, hacé clic en **Create Key**, ponele un nombre (por ejemplo `lexsearch-local`) y copiá la clave. Se muestra una sola vez.
4. Abrí el archivo `.env` de la raíz del proyecto con un editor de texto y pegá la clave en la línea:

   ```
   ANTHROPIC_API_KEY=pegá-acá-tu-clave
   ```

5. Guardá el archivo y reiniciá el sistema (`Ctrl + C` y otra vez `npm run dev`). Abajo a la izquierda de la interfaz, "Claude" debería aparecer en verde.

La clave es un secreto: el `.env` está excluido de git y nunca debe compartirse ni subirse al repositorio. Opciones relacionadas en `.env`:

- `ANTHROPIC_MODEL` (por defecto `claude-opus-5`): el modelo que redacta las respuestas.
- `LLM_EFFORT` (por defecto `medium`): cuánto razona el modelo antes de responder (`low` · `medium` · `high` · `xhigh` · `max`). Más alto suele ser más preciso, pero más lento y caro.

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
│   │       ├── llm/          Proveedor de IA (Claude) detrás de una interfaz
│   │       ├── interactions/ Historial de interacciones con la IA
│   │       └── health/       Estado del sistema
│   └── tests/                Tests unitarios y de integración
├── frontend/                 Interfaz web (React + TypeScript + Vite + Tailwind)
├── docker/                   Inicialización de la base de datos
├── docs/                     Decisiones técnicas
└── docker-compose.yml        PostgreSQL 17 + pgvector
```

Cada módulo del backend sigue la misma separación de capas: `routes → controller → service → repository`. Los controllers solo validan la entrada (con zod) y delegan; la lógica vive en los services.

## Cómo funciona una consulta

1. **Al subir un documento:** se guarda el original con un nombre aleatorio → se extrae el texto por página → se divide en fragmentos de ~1.200 caracteres respetando párrafos → cada fragmento se convierte en un vector con un modelo que corre en tu computadora → se guarda en PostgreSQL (pgvector).
2. **Al preguntar:** la pregunta se convierte en vector → se buscan los fragmentos más parecidos por significado y por palabras → se combinan ambos rankings → los 8 mejores se envían a Claude como documentos citables → Claude responde citando el texto exacto de cada uno.

## Privacidad y seguridad

- Los documentos completos **no salen de tu computadora**: el indexado usa un modelo local. A Claude solo viajan la pregunta y los fragmentos relevantes de cada consulta. Según la documentación de Anthropic, los datos enviados por API no se usan para entrenar modelos por defecto (conviene reconfirmarlo en su política vigente).
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
5. Abrí Docker Desktop **desde el menú Inicio** (no desde la terminal de Claude).

**"El puerto 5180 / 4000 / 5433 está en uso".** Otro programa lo está usando. Cerralo, o cambiá el puerto en `.env` (`PORT`, `POSTGRES_PORT` + `DATABASE_URL`) y en `frontend/vite.config.ts`.

**Un PDF queda en "Error: parece ser un documento escaneado".** El PDF es una imagen sin capa de texto. El reconocimiento de texto (OCR) se agrega más adelante; mientras tanto, usá la versión digital del documento.

**"Motor de búsqueda: error al cargar".** La primera vez el modelo se descarga de Hugging Face; hace falta conexión a internet. Corré `npm run models:download` para ver el detalle.
