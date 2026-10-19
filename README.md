# LexSearch

Sistema de inteligencia artificial personal para un abogado: una **biblioteca consultable** (leyes, jurisprudencia, doctrina y modelos propios) que responde preguntas en lenguaje natural **citando el fragmento exacto de cada fuente**, un **asistente que redacta borradores** de escritos y contratos a partir de esa biblioteca, **fichas de cliente** que se arman a partir de las notas de la primera reunión, un **control de plazos** que lee cédulas y resoluciones, calcula los vencimientos y avisa antes de que venzan, **expedientes con una línea de tiempo** que ordena sus actuaciones y vencimientos, un **detector de contradicciones** que compara los documentos de un expediente y señala dónde se contradicen entre sí, y un **vigía normativo** que lee el Boletín Oficial de la Nación y el de la Provincia de Misiones y avisa cuando sale una norma que toca las áreas o los temas que seguís. En las próximas fases: simulador de audiencia y más.

> **Principio rector:** todo contenido generado es una propuesta que el abogado revisa y valida. El sistema no reemplaza el criterio profesional ni asesora por sí mismo.

## Estado del proyecto

| Fase | Entregable | Estado |
| --- | --- | --- |
| 0 | Setup: repo, entorno, PostgreSQL + pgvector, proveedor de LLM | ✅ Hecha |
| 1 | RAG básico: subir documentos, fragmentar, embeddings, búsqueda y respuestas con citas | ✅ Hecha |
| 2 | Generador de borradores de escritos y contratos | ✅ Hecha |
| 3 | Ficha de cliente / CRM simplificado | ✅ Hecha |
| 4 | Control de plazos y notificaciones | ✅ Hecha |
| 5 | Timeline automático de expediente | ✅ Hecha |
| 6 | Detector de contradicciones | ✅ Hecha |
| 7 | Vigía normativo (Boletín Oficial: Nación y Misiones) | ✅ Hecha |
| 8 | Simulador de audiencia | Pendiente |
| 9 | Estimador de probabilidad de éxito | Pendiente |
| 10 | Hosting y despliegue (VPS + Docker Compose + Tailscale) | Pendiente |

Las decisiones técnicas y su justificación están en [docs/decisiones.md](docs/decisiones.md).

## Qué hace hoy

- **Biblioteca:** subís PDF, Word (.docx), .txt o .md, o fotos y escaneos (JPG, PNG, WEBP, TIFF), eligiendo el tipo (legislación, jurisprudencia, doctrina, modelo propio, escrito, otro). Cada documento se procesa en segundo plano: extracción de texto por página, fragmentación respetando artículos y cláusulas, e indexado. Detecta duplicados por contenido.
- **OCR (reconocimiento de texto):** los PDF escaneados (o sus páginas escaneadas) y las fotos se leen automáticamente, en tu computadora: las imágenes no se envían a ningún servicio. Los documentos leídos así quedan marcados como «Leído con OCR», porque el texto puede tener errores de lectura.
- **Búsqueda híbrida:** combina búsqueda *por significado* (vectores) con búsqueda *por palabras exactas* en español sin acentos (útil para "art. 245" o "Ley 20.744"). Filtra por tipo de documento. Solo muestra fragmentos que de verdad se relacionan con la consulta: si buscás algo que no está en tu biblioteca, te lo dice en lugar de mostrar resultados al azar.
- **Respuestas con IA (Gemini):** redacta la respuesta usando solo los fragmentos recuperados y marca cada afirmación con su fuente. Antes de mostrar una cita, el servidor verifica que la frase exista textualmente en el fragmento. Al hacer clic en una cita ves ese texto resaltado y podés abrir el PDF original en esa página.
- **Borradores con IA:** elegís el tipo de documento (carta documento, contrato, demanda, contestación u otro escrito), opcionalmente un modelo base de tu biblioteca, y cargás los datos del caso y qué necesitás. Un asistente de IA lee el modelo, busca en tu biblioteca cláusulas, normas y jurisprudencia, y redacta el borrador. Solo cita normas que encontró en tu biblioteca (si no la encuentra, deja `[COMPLETAR: norma aplicable]` en lugar de escribirla de memoria; igual conviene revisar siempre las citas); los datos que faltan quedan marcados como `[COMPLETAR: …]` y resaltados. Si elegís un cliente, el asistente lee su ficha (datos propios y de la contraparte, conflicto y notas) antes de redactar. Podés editarlo y guardarlo (botón «Guardar» o `Ctrl + S`), copiarlo o descargarlo en Word (.docx), y ver qué documentos consultó.
- **Clientes:** una ficha por cliente con sus datos, la contraparte, el resumen del conflicto, la pretensión y un checklist de la documentación que falta reunir. Podés cargarla a mano o pegar las notas (o la transcripción) de la primera reunión y tocar «Completar con IA»: la IA propone los datos y el checklist, resaltados para que los revises; solo completa lo que está vacío, no pisa lo que escribiste, y no guarda nada hasta que tocás «Guardar». Desde la ficha podés redactar un borrador para ese cliente.
- **Plazos:** cargás un plazo a mano (fecha de notificación + cantidad de días, hábiles o corridos) o subís una cédula o resolución (PDF, foto o escaneo, Word o texto) y la IA propone los plazos que otorga, con la frase exacta del documento. El vencimiento **lo calcula el sistema**, nunca la IA: el día de la notificación no cuenta, y en días hábiles se saltan sábados, domingos, feriados nacionales y Semana Santa. Podés ver día por día cuáles no se contaron para chequearlo contra el juzgado. En «Días inhábiles» cargás lo que cambia según tu juzgado (feria judicial, asuetos, feriados locales, días no laborables que decreta el Gobierno): al agregarlos o quitarlos, los plazos pendientes se recalculan solos. Un vigía revisa cada hora y te avisa a los 3 días, a 1 día, el día del vencimiento y cuando ya venció (aviso en la pantalla y un globito rojo en el menú).
- **Expedientes:** un expediente reúne la carátula, el número, el juzgado, el área, el estado y los clientes (puede tener más de uno). Su pantalla tiene tres pestañas (línea de tiempo, documentos y contradicciones); la primera es una **línea de tiempo**: las actuaciones (escritos, resoluciones, notificaciones, audiencias, pruebas) y los vencimientos de sus plazos, ordenados por fecha y agrupados por mes, con una marca en «Hoy», un aviso cuando pasó mucho tiempo sin movimiento y las audiencias futuras señaladas como «Próxima». Las actuaciones se cargan a mano o con **«Importar con IA»**: pegás el listado de movimientos del expediente (o subís un PDF, una foto o un Word) y la IA propone las actuaciones con su fecha y la frase del texto que las respalda; vos revisás, corregís lo que haga falta y confirmás cuáles agregar. Las que el expediente ya tiene vienen sin tildar, las frases se verifican contra el texto y nada se guarda hasta que confirmás. Los plazos se vinculan a un expediente (al leer una cédula, se elige solo si el número coincide con uno de los tuyos).
- **Contradicciones:** cada expediente reúne sus **documentos** (las pruebas: declaraciones de testigos y de las partes, contratos, recibos, cartas documento, informes…), que se suben desde su pestaña «Documentos» (quedan también en la biblioteca, con el tipo «Prueba») o se vinculan desde la biblioteca; quitarlos del expediente no los borra. En la pestaña «Contradicciones» elegís de 2 a 8 documentos y, si querés, qué revisar primero, y la IA los compara y propone las contradicciones que encuentra —fechas, montos o afirmaciones que no pueden ser ciertas a la vez—, cada una con la frase de cada documento y un enlace al original. El servidor busca cada frase en el texto del documento (si no la encuentra, la marca), las que ya guardaste vienen sin tildar y nada se guarda hasta que confirmás cuáles conservar. Las guardadas se pueden anotar, eliminar y copiar como resumen para pegar en un escrito. La búsqueda no es exhaustiva: dos corridas sobre los mismos documentos pueden señalar cosas distintas, y que no encuentre nada no significa que no haya contradicciones.
- **Normativa:** un vigía lee dos boletines: el **Boletín Oficial de la República Argentina** (primera sección: leyes, decretos, resoluciones, disposiciones y convenios colectivos de trabajo) y el **Boletín Oficial de la Provincia de Misiones** (decretos, resoluciones y leyes provinciales, que el sitio publica en un PDF por día), cada tres horas y cada vez que abrís la pantalla después de una pausa larga, y te avisa cuando sale una norma que toca un tema que seguís. En «Temas» elegís **áreas de práctica** enteras (Laboral, Civil, Comercial…) o armás **temas propios** con palabras clave. La IA lee el comienzo y el primer artículo de cada norma y señala las que afectan a esos temas: cada alerta dice qué establece la norma, por qué importa, la frase de la norma que lo respalda (el servidor verifica que exista en el texto; si no la encuentra, la alerta pasa a relevancia media y te avisa) y a cuántos de tus clientes y expedientes abiertos de esa área alcanza. Podés marcarla como vista, descartarla (y restaurarla) o abrir la norma en el Boletín (cada alerta dice si es de Nación o de Misiones); el menú muestra un globito rojo con las novedades sin ver. En «Boletín» elegís Nación o Misiones y recorrés todo lo que se publicó cada día, con búsqueda y filtro por rubro. Sin la clave de Gemini también funciona, pero solo por palabras clave (con más ruido). Lee solo lo que los sitios permiten (del nacional, no la segunda sección; del de Misiones, solo los decretos, resoluciones y leyes de la primera sección de cada PDF: sin suplementos, municipalidades ni edictos), de a una página por vez y despacio, y si un sitio le pide esperar, espera y reintenta solo. Cada boletín se revisa por separado: si uno falla, el otro sigue.
- **Historial:** cada consulta queda registrada con su respuesta, las fuentes, el modelo y la versión del prompt. Los borradores también quedan registrados en la base con el texto original de la IA, aunque después los edites.
- **API documentada** en `http://localhost:4000/api/docs` (Swagger).

## Requisitos

- **Node.js 24** (LTS) — `node --version`
- **Docker Desktop** — para la base de datos PostgreSQL con pgvector
- **API key de Gemini** (Google AI Studio) — opcional para empezar: sin ella la biblioteca y la búsqueda funcionan; solo se desactivan las respuestas redactadas por IA.

## Puesta en marcha

Todos los comandos se ejecutan en la carpeta del proyecto (la que contiene este archivo).

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

## Integración y entrega continuas (CI/CD)

Corren solas en GitHub (pestaña **Actions** del repositorio) y se definen en [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

| Cuándo | Qué hace |
| --- | --- |
| Cada push a `main` y cada pull request | **CI:** instala las dependencias, revisa el código (lint y tipos), compila, corre todos los tests con una base PostgreSQL real y comprueba que el esquema coincida con las migraciones |
| Cada push a `main` que pasó el CI | **CD:** construye las imágenes de Docker de la API y de la web, prueba el sistema completo con ellas y las publica en `ghcr.io` (con las etiquetas `latest` y `sha-…` del commit) |

Una imagen que no arranca no se publica. Además, Dependabot abre pull requests con actualizaciones de dependencias (las de npm cada lunes; las de GitHub Actions y de las imágenes base, una vez por mes) y el CI las prueba antes de que decidas aceptarlas.

**Usar las imágenes publicadas** (sin instalar Node ni compilar nada):

1. Abrí Docker Desktop y esperá a que diga *Engine running*.
2. En el `.env`, revisá `POSTGRES_PASSWORD` (para un uso real, poné una propia, solo con letras y números) y, si querés usar la IA, `GEMINI_API_KEY`.
3. Bajá las imágenes y levantá todo:

   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

4. Abrí **http://localhost:8080**.

La primera vez, la API descarga los modelos de búsqueda y de OCR (hace falta internet y tarda unos minutos). La base, los documentos y los modelos quedan en volúmenes de Docker propios, separados de los del entorno de desarrollo (`npm run dev`). Para pasar a la última versión publicada: `docker compose -f docker-compose.prod.yml pull` y de nuevo `up -d`. Para apagarlo: `docker compose -f docker-compose.prod.yml down` (los datos se conservan).

Queda disponible solo en esta computadora: el sistema todavía no tiene usuarios ni contraseña, así que no lo expongas a internet antes de la Fase 10.

## Estructura

```
lexsearch/
├── backend/                  API (Node.js + TypeScript + Express + Prisma)
│   ├── Dockerfile            Imagen de Docker de la API
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
│   │       ├── calendar/     Feriados nacionales, días inhábiles propios y cálculo de vencimientos
│   │       ├── clients/      Fichas de cliente y lectura de las notas de la primera reunión con IA
│   │       ├── cases/        Expedientes, actuaciones, línea de tiempo y lectura de movimientos con IA
│   │       ├── contradictions/ Comparación de los documentos de un expediente con IA y contradicciones guardadas
│   │       ├── deadlines/    Plazos y lectura de cédulas y resoluciones con IA
│   │       ├── notifications/ Avisos y vigía de plazos por vencer (node-cron)
│   │       ├── normative/    Vigía de los boletines oficiales (Nación y Misiones): lectura de los sitios, análisis con IA, alertas y temas
│   │       ├── drafts/       Borradores: asistente de redacción, edición y exportación a Word
│   │       ├── llm/          Proveedor de IA (Gemini) detrás de una interfaz
│   │       ├── interactions/ Historial de interacciones con la IA
│   │       └── health/       Estado del sistema
│   └── tests/                Tests unitarios y de integración
├── frontend/                 Interfaz web (React + TypeScript + Vite + Tailwind), Dockerfile y nginx.conf
├── .github/                  CI/CD (GitHub Actions) y actualizaciones automáticas (Dependabot)
├── docker/                   Inicialización de la base de datos
├── docs/                     Decisiones técnicas
├── docker-compose.yml        Desarrollo: PostgreSQL 17 + pgvector
└── docker-compose.prod.yml   Sistema completo con las imágenes publicadas (base + API + web)
```

Cada módulo del backend sigue la misma separación de capas: `routes → controller → service → repository`. Los controllers solo validan la entrada (con zod) y delegan; la lógica vive en los services.

## Cómo funciona por dentro

1. **Al subir un documento:** se guarda el original con un nombre aleatorio → se extrae el texto por página → se divide en fragmentos de ~1.200 caracteres respetando párrafos → cada fragmento se convierte en un vector con un modelo que corre en tu computadora → se guarda en PostgreSQL (pgvector).
2. **Al preguntar:** la pregunta se convierte en vector → se buscan los fragmentos más parecidos por significado y por palabras, descartando los que no alcanzan una similitud mínima → se combinan ambos rankings → los 8 mejores se envían a Gemini → Gemini responde en bloques, indicando para cada uno el fragmento que lo respalda y una frase copiada textualmente → el servidor verifica cada frase contra el fragmento original y solo resalta las que existen de verdad. Si no hay ningún fragmento relacionado, responde eso mismo sin consultar a Gemini.
3. **Al pedir un borrador:** el pedido (tipo, datos del caso, indicaciones y modelo base) se envía a Gemini junto con dos herramientas: *buscar en la biblioteca* y *leer un documento*. Gemini decide qué buscar y qué leer (hasta 4 rondas); cada búsqueda la ejecuta el servidor en tu base local y le devuelve solo esos resultados. Si elegiste un cliente, también tiene una herramienta para leer la ficha de ese cliente (y solo la de ese). Con eso redacta el borrador, que se guarda junto con la lista de lo que consultó.
4. **Al leer una cédula o resolución:** se extrae el texto del archivo (con OCR si es una foto o un escaneo) → se envía a Gemini con la instrucción de devolver solo los plazos que el documento otorga, la fecha de notificación (únicamente si consta de forma expresa) y la carátula → el servidor verifica que la frase citada exista en el documento y limpia la respuesta → la pantalla te muestra los plazos para que los confirmes. El archivo se lee y se descarta: no se guarda ni se agrega a la biblioteca. El vencimiento lo calcula después el servidor con el calendario.
5. **Al completar una ficha con IA:** las notas de la reunión se envían a Gemini con la instrucción de devolver los datos de la ficha en un formato fijo, dejando vacío lo que no figura. El servidor limpia la respuesta (códigos válidos, sin marcadores tipo «no consta», sin documentos repetidos) y la interfaz la vuelca en el formulario sin guardar nada.
6. **Al importar actuaciones:** el texto (pegado, o extraído del archivo con OCR si hace falta) se envía a Gemini con la instrucción de devolver cada actuación con su fecha, su tipo, un título breve y la frase del texto que la respalda → el servidor descarta las que no tienen una fecha real, verifica cada frase contra el texto, las ordena por fecha y marca las que el expediente ya tiene → la pantalla te las muestra para que las revises. Las que confirmás se guardan junto con la frase; el archivo se lee y se descarta.
7. **Al buscar contradicciones:** el servidor lee el texto de los documentos elegidos (de 2 a 8; los muy largos se leen por el principio y el final y se avisa) y los envía **todos juntos** a Gemini, cada uno con un número (D1, D2…) y tratado como dato, no como instrucciones. Gemini devuelve los hallazgos: qué se contradice, de qué tipo (fecha, monto, declaración u otro), si es directa o posible, y las afirmaciones en conflicto, cada una con una frase copiada del documento → el servidor busca cada frase en el texto de **su propio documento** y muestra la del documento, no la de la IA; marca las que no encuentra y las que ya tenías guardadas → la pantalla te las muestra para que las verifiques contra los originales. Las que confirmás se guardan con las frases y podés anotarlas. En el historial queda el resultado (con las frases citadas), no el texto completo de los documentos.
8. **Al revisar los boletines oficiales:** por cada boletín (Nación y Misiones), el vigía lee el listado de la edición más reciente (y de las dos anteriores si no se leyeron) y guarda las normas. En Nación el listado solo dice quién la dictó, de qué tipo es y su número, así que lee la página de cada norma (de a una, con pausas); en Misiones baja el PDF de la edición y separa cada decreto, resolución y ley por su encabezado. De cada norma guarda el comienzo y el primer artículo, textuales → las normas todavía no comparadas con tus temas se envían a Gemini de a 8 (diciéndole de qué boletín viene cada una), junto con los temas (su descripción y sus palabras clave), con la instrucción de señalar solo las que regulan o pueden afectar cada tema, con una oración neutra de lo que establecen y una frase copiada → el servidor busca cada frase en el texto de la norma (muestra siempre la de la norma, no la de la IA) y crea las alertas → la pantalla las muestra con a cuántos clientes y expedientes del área alcanzan. Un tema nuevo se compara también con las normas de los últimos días ya guardadas.

## Privacidad y seguridad

- La biblioteca **no se envía a ningún servicio para indexarse ni para buscar**: el indexado usa un modelo local. A Gemini solo viajan la pregunta y los fragmentos relevantes de cada consulta; al redactar un borrador, también los datos del caso que cargaste, el texto del modelo base (o de los documentos que el asistente decida leer) y la ficha del cliente elegido; al tocar «Completar con IA» en una ficha, las notas de la reunión; al leer una cédula o resolución, el texto del documento; al importar actuaciones, el texto o el archivo que pegás; al buscar contradicciones, el texto completo de los documentos que elegís comparar; y al revisar los boletines oficiales, el comienzo y el primer artículo de normas públicas junto con los nombres y las palabras de los temas que seguís (nada de tus clientes). A los boletines oficiales no se les envía nada tuyo: solo se piden sus páginas y PDF públicos. Con el plan gratuito de la API, Google puede usar ese contenido para mejorar sus productos: activá la facturación antes de trabajar con datos reales de clientes (ver «Configurar Gemini»).
- La API y la base escuchan solo en `127.0.0.1`: no son accesibles desde otras computadoras de la red. Con `docker-compose.prod.yml` pasa lo mismo: solo se publica la web, y solo en `127.0.0.1`.
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

**El vencimiento no coincide con el del juzgado.** Abrí el plazo y mirá «Cómo se contó»: ahí figura cada día que no se contó y por qué. Si el juzgado cuenta otros días inhábiles (feria judicial, asueto, un feriado local o un día no laborable decretado, por ejemplo los «puentes» turísticos), cargalos en Plazos → «Días inhábiles» y el plazo se recalcula. Tené en cuenta que el sistema no modela el plazo de gracia de las dos primeras horas del día hábil siguiente: el vencimiento que muestra es el último día; conviene presentar antes.

**«Importar con IA» no encontró una actuación o la trajo mal.** Solo toma las actuaciones que el texto presenta con una fecha completa; si falta el año o el día, la deja afuera y te avisa cuántas fueron. Corregí lo que haga falta en la propuesta antes de agregarla (la fecha, el tipo y el título se pueden editar), o cargá la actuación a mano con «Nueva actuación». Si una fila dice «No se pudo verificar en el texto», la frase que citó la IA no está en lo que pegaste: revisala. Las repetidas con otro título no se detectan solas: destildalas a mano.

**«Buscar contradicciones» no encontró una que sí hay, o tarda.** La IA propone, no garantiza: en pruebas con documentos ficticios, a veces una corrida dejó afuera la contradicción más sutil y otra la encontró. Volvé a buscar, o escribí en «Qué revisar primero» el hecho que te interesa (por ejemplo, «la fecha de ingreso»). Comparar menos documentos, todos sobre los mismos hechos, da resultados más precisos que sumar de más. Puede tardar hasta un minuto con documentos largos. El tipo que le pone a cada hallazgo (fecha, monto, declaración) es orientativo y puede variar de una corrida a otra. Si una frase dice «No se encontró esta frase en el documento», la IA citó algo que no está tal cual: buscalo a mano en el original antes de guardar el hallazgo. Si un documento escaneado no se puede leer bien, la frase tampoco se va a encontrar: mejorá la imagen y usá «Reprocesar».

**«No se pudo revisar todo el Boletín Oficial».** El aviso empieza con el boletín que falló (Nación o Misiones) y dice el motivo; el otro boletín se revisa igual. Si no hay conexión a internet, se vuelve a intentar solo en la próxima revisión (cada tres horas). Si el sitio pidió esperar («recibió demasiados pedidos»), el vigía deja de pedir y vuelve a intentar solo unos minutos después de lo que el sitio indicó. Si dice que puede haber cambiado el formato de la página, el sitio se actualizó y el lector de ese boletín hay que ajustarlo: mientras tanto no llegan novedades nuevas de él. «Buscar novedades» fuerza una revisión.

**El vigía no me avisó de una norma que sí me importa.** Solo lee el comienzo y el primer artículo de cada norma (6.000 caracteres), y la IA propone, no garantiza: una norma que toca tu tema recién en un artículo posterior puede pasar de largo. Si seguís un área, probá sumar un tema propio con las palabras que te importan (por ejemplo «tope indemnizatorio»). En la pestaña «Boletín» podés ver todo lo publicado cada día y buscar. Si no hay clave de Gemini, el aviso es solo por palabras clave.

**De Misiones no aparece una norma.** Del PDF de cada día se leen los decretos (completos y «sintetizados»), resoluciones, disposiciones y leyes de la primera sección. No se leen los suplementos (anexos de cientos de páginas, como las tablas del presupuesto), las normas de las municipalidades ni los edictos y avisos: para esas, abrí el boletín en el sitio oficial (boletin.misiones.gov.ar).

**La búsqueda no encuentra algo que sí está en un documento.** Probá con las palabras exactas del texto (esa búsqueda no tiene umbral). Si igual hace falta, bajá un poco `SEARCH_MIN_SIMILARITY` en `.env` (por defecto `0.8`; más bajo muestra más resultados, pero también algunos sin relación) y reiniciá.

**Redactar un borrador tarda o falla.** El asistente consulta varias veces tu biblioteca y a Gemini: puede tardar hasta un minuto. Si Gemini está saturado se prueba solo el modelo de respaldo; si el error sigue, esperá unos minutos y volvé a intentar.

**"El modelo … ya no está disponible".** Google retira modelos viejos con frecuencia. Cambiá `GEMINI_MODEL` en `.env` por uno vigente (por ejemplo, el Flash más nuevo) y reiniciá.

**"El puerto 5180 / 4000 / 5433 está en uso".** Otro programa lo está usando (a veces, otro LexSearch que quedó abierto: si es el de la API, la terminal dice «El puerto 4000 ya está en uso» y se cierra). Cerralo, o cambiá el puerto en `.env` (`PORT`, `POSTGRES_PORT` + `DATABASE_URL`) y en `frontend/vite.config.ts`. Con `docker-compose.prod.yml`, el de la web es `WEB_PORT` (por defecto `8080`).

**Un escaneo o una foto queda en "Error: no se pudo reconocer texto".** El OCR no pudo leerlo: suele pasar con fotos borrosas, torcidas o con poca luz. Volvé a sacar la foto (derecha, con buena luz y de cerca) o escaneá el documento. Si tenés la versión digital, siempre es mejor subir esa.

**Una foto del iPhone (HEIC) es rechazada.** El formato HEIC no es compatible: mandala como JPG (en el iPhone: *Ajustes → Cámara → Formatos → Más compatible*).

**"No se pudo usar el reconocimiento de texto (OCR)".** La primera vez el OCR descarga los datos del idioma español; hace falta conexión a internet. Corré `npm run models:download` y después usá «Reprocesar» en el documento.

**"Motor de búsqueda: error al cargar".** La primera vez el modelo se descarga de Hugging Face; hace falta conexión a internet. Corré `npm run models:download` para ver el detalle.
