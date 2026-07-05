# Tarot Canalizado

Web de lecturas de tarot personalizadas: pide nombre y fecha de nacimiento, hace preguntar por la consulta, propone una tirada a medida (elegida por la IA), y una vez que cargás las cartas que salieron físicamente, genera una interpretación canalizada usando la API de Claude.

## Requisitos

- Node.js 18+
- Una API key de Anthropic ([platform.claude.com](https://platform.claude.com))

## Instalación

```bash
npm install
cp .env.example .env
# Editá .env y pegá tu ANTHROPIC_API_KEY
```

## Ejecutar

```bash
npm start
```

Abrí `http://localhost:3000`.

## Cómo funciona

1. **Datos de la persona** → se guardan en SQLite (`tarot.db`, se crea sola al arrancar).
2. **Pregunta** → se le pide a Claude que proponga la tirada más adecuada (nombre + posiciones) en JSON.
3. **Cartas** → elegís de un selector las 78 cartas del mazo (arcanos mayores y menores) y si salieron derechas o invertidas, para cada posición de la tirada.
4. **Lectura** → Claude interpreta la tirada completa de forma tejida (no carta por carta) y personalizada, respondiendo en streaming.
5. **Historial** → cada lectura queda guardada por consultante y se puede volver a ver desde el panel "Mis lecturas".

## Estructura

- `server.js` — servidor Express y endpoints de la API
- `db.js` — inicialización de SQLite
- `data/cartas.js` — mazo completo de 78 cartas
- `promptSistema.js` — prompt de la lectora de tarot (interpretación final)
- `promptTirada.js` — prompt para sugerir la tirada según la pregunta
- `public/` — frontend (HTML/CSS/JS vanilla, sin build)
