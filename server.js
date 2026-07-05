require('dotenv').config();

const path = require('path');
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const db = require('./db');
const { MAZO_COMPLETO } = require('./data/cartas');
const { PROMPT_SISTEMA } = require('./promptSistema');
const { PROMPT_TIRADA } = require('./promptTirada');

const MODEL = 'claude-opus-4-8';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic();

const TIRADA_SCHEMA = {
  type: 'object',
  properties: {
    nombre: { type: 'string' },
    posiciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nombre: { type: 'string' },
          significado: { type: 'string' },
        },
        required: ['nombre', 'significado'],
        additionalProperties: false,
      },
    },
  },
  required: ['nombre', 'posiciones'],
  additionalProperties: false,
};

app.get('/api/cartas', (req, res) => {
  res.json({ cartas: MAZO_COMPLETO });
});

app.post('/api/consultantes', (req, res) => {
  const { nombre, fecha_nacimiento } = req.body || {};
  if (!nombre || !fecha_nacimiento) {
    return res.status(400).json({ error: 'Falta nombre o fecha de nacimiento.' });
  }
  const stmt = db.prepare(
    'INSERT INTO consultantes (nombre, fecha_nacimiento) VALUES (?, ?)'
  );
  const info = stmt.run(nombre.trim(), fecha_nacimiento);
  res.json({ id: info.lastInsertRowid, nombre: nombre.trim(), fecha_nacimiento });
});

app.post('/api/tirada-sugerida', async (req, res) => {
  const { pregunta } = req.body || {};
  if (!pregunta || !pregunta.trim()) {
    return res.status(400).json({ error: 'Falta la pregunta.' });
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: PROMPT_TIRADA,
      output_config: {
        format: { type: 'json_schema', schema: TIRADA_SCHEMA },
      },
      messages: [{ role: 'user', content: pregunta.trim() }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ error: 'La IA no devolvió una tirada válida.' });
    }
    const tirada = JSON.parse(textBlock.text);
    res.json({ tirada });
  } catch (err) {
    console.error('Error sugiriendo tirada:', err);
    res.status(502).json({ error: 'No se pudo generar la tirada sugerida.' });
  }
});

app.post('/api/lecturas', async (req, res) => {
  const { consultante_id, pregunta, tirada } = req.body || {};

  if (
    !consultante_id ||
    !pregunta ||
    !tirada ||
    !Array.isArray(tirada.posiciones) ||
    tirada.posiciones.length === 0
  ) {
    return res.status(400).json({ error: 'Faltan datos de la lectura.' });
  }
  if (tirada.posiciones.some((p) => !p.carta)) {
    return res.status(400).json({ error: 'Falta indicar una carta en alguna posición.' });
  }

  const consultante = db
    .prepare('SELECT * FROM consultantes WHERE id = ?')
    .get(consultante_id);
  if (!consultante) {
    return res.status(404).json({ error: 'Consultante no encontrado.' });
  }

  const posicionesTexto = tirada.posiciones
    .map(
      (p, i) =>
        `${i + 1}. Posición "${p.nombre}" (significado de la posición: ${p.significado}) → salió: ${p.carta}, ${
          p.orientacion === 'invertida' ? 'invertida' : 'derecha'
        }.`
    )
    .join('\n');

  const mensajeUsuario = `Datos de la persona consultante:
- Nombre: ${consultante.nombre}
- Fecha de nacimiento: ${consultante.fecha_nacimiento}

Pregunta que trae la persona:
"${pregunta.trim()}"

Tirada utilizada: ${tirada.nombre}

Cartas que salieron, en orden de posición:
${posicionesTexto}

Hacé la lectura canalizada siguiendo tus reglas.`;

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
  });

  let textoCompleto = '';

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: PROMPT_SISTEMA,
      messages: [{ role: 'user', content: mensajeUsuario }],
    });

    stream.on('text', (delta) => {
      textoCompleto += delta;
      res.write(delta);
    });

    await stream.finalMessage();

    db.prepare(
      `INSERT INTO lecturas (consultante_id, pregunta, tirada_json, interpretacion)
       VALUES (?, ?, ?, ?)`
    ).run(consultante_id, pregunta.trim(), JSON.stringify(tirada), textoCompleto);

    res.end();
  } catch (err) {
    console.error('Error generando la lectura:', err);
    if (!res.headersSent) {
      res.status(502).json({ error: 'No se pudo generar la lectura.' });
    } else {
      res.end('\n\n[Se interrumpió la conexión con el oráculo. Probá de nuevo.]');
    }
  }
});

app.get('/api/consultantes/:id/lecturas', (req, res) => {
  const lecturas = db
    .prepare(
      'SELECT id, pregunta, tirada_json, interpretacion, created_at FROM lecturas WHERE consultante_id = ? ORDER BY created_at DESC'
    )
    .all(req.params.id);

  res.json({
    lecturas: lecturas.map((l) => ({
      ...l,
      tirada: JSON.parse(l.tirada_json),
      tirada_json: undefined,
    })),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Tarot canalizado escuchando en http://localhost:${PORT}`);
});
