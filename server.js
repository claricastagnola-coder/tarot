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
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const MEDIA_TYPES_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

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

const IDENTIFICACION_SCHEMA = {
  type: 'object',
  properties: {
    cartas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          carta: { type: 'string' },
          orientacion: { type: 'string', enum: ['derecha', 'invertida'] },
        },
        required: ['carta', 'orientacion'],
        additionalProperties: false,
      },
    },
  },
  required: ['cartas'],
  additionalProperties: false,
};

function construirPosicionesTexto(posiciones) {
  return posiciones
    .map(
      (p, i) =>
        `${i + 1}. Posición "${p.nombre}" (significado de la posición: ${p.significado}) → salió: ${p.carta}, ${
          p.orientacion === 'invertida' ? 'invertida' : 'derecha'
        }.`
    )
    .join('\n');
}

function construirMensajeUsuarioInicial(consultante, pregunta, tirada) {
  const posicionesTexto = construirPosicionesTexto(tirada.posiciones);
  return `Datos de la persona consultante:
- Nombre: ${consultante.nombre}
- Fecha de nacimiento: ${consultante.fecha_nacimiento}

Pregunta que trae la persona:
"${pregunta.trim()}"

Tirada utilizada: ${tirada.nombre}

Cartas que salieron, en orden de posición:
${posicionesTexto}

Hacé la lectura canalizada siguiendo tus reglas.`;
}

function construirResumenSesion(lectura, mensajes) {
  let resumen = `Pregunta original de la persona consultante: "${lectura.pregunta}"\n\n`;
  resumen += `Tirada ya realizada: ${JSON.parse(lectura.tirada_json).nombre}\n\n`;
  resumen += `Interpretación que ya se le dio:\n${lectura.interpretacion}\n`;

  if (mensajes.length > 0) {
    resumen += `\nConversación de seguimiento hasta ahora:\n`;
    for (const m of mensajes) {
      if (m.tirada_json) {
        resumen += `\n[La persona hizo una tirada adicional: "${JSON.parse(m.tirada_json).nombre}"]\n`;
      }
      resumen += `${m.rol === 'user' ? 'Persona consultante' : 'Lectora'}: ${m.contenido}\n`;
    }
  }

  return resumen;
}

function obtenerLecturaConMensajes(id) {
  const lectura = db.prepare('SELECT * FROM lecturas WHERE id = ?').get(id);
  if (!lectura) return null;
  const consultante = db
    .prepare('SELECT * FROM consultantes WHERE id = ?')
    .get(lectura.consultante_id);
  const mensajes = db
    .prepare('SELECT * FROM mensajes WHERE lectura_id = ? ORDER BY id ASC')
    .all(lectura.id);
  return { lectura, consultante, mensajes };
}

function construirHistorialConversacion(lectura, consultante, mensajes) {
  const tirada = JSON.parse(lectura.tirada_json);
  const mensajeInicial = construirMensajeUsuarioInicial(consultante, lectura.pregunta, tirada);
  const historial = [
    { role: 'user', content: mensajeInicial },
    { role: 'assistant', content: lectura.interpretacion },
  ];
  for (const m of mensajes) {
    historial.push({ role: m.rol, content: m.contenido });
  }
  return historial;
}

function iniciarRespuestaEnStreaming(res) {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
  });
}

async function transmitirYCapturar(res, messages, maxTokens) {
  let textoCompleto = '';
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    system: PROMPT_SISTEMA,
    messages,
  });
  stream.on('text', (delta) => {
    textoCompleto += delta;
    res.write(delta);
  });
  await stream.finalMessage();
  return textoCompleto;
}

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

app.post('/api/identificar-cartas-foto', async (req, res) => {
  const { imagenBase64, mediaType, posiciones } = req.body || {};

  if (!imagenBase64 || !mediaType || !Array.isArray(posiciones) || posiciones.length === 0) {
    return res.status(400).json({ error: 'Falta la foto o las posiciones de la tirada.' });
  }
  if (!MEDIA_TYPES_PERMITIDOS.includes(mediaType)) {
    return res.status(400).json({ error: 'Formato de imagen no soportado.' });
  }

  const listaPosiciones = posiciones.map((p, i) => `${i + 1}. ${p.nombre}`).join('\n');

  const promptTexto = `Esta es una foto de una tirada de tarot física ya revelada, con ${posiciones.length} carta(s), ordenadas de izquierda a derecha (o en el orden en que aparecen dispuestas en la imagen), correspondientes a estas posiciones en este orden:
${listaPosiciones}

Identificá qué carta del mazo de tarot Rider-Waite es cada una (nombre exacto en español: arcanos mayores como "El Loco", "La Torre", etc., o arcanos menores como "3 de Copas", "Caballero de Espadas", "As de Oros") y si cada una está derecha o invertida (al revés). Si alguna no se ve con total claridad, hacé tu mejor estimación de todas formas — la persona va a poder revisar y corregir el resultado después.

Devolvé exactamente ${posiciones.length} carta(s), en el mismo orden que las posiciones indicadas arriba.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      output_config: {
        format: { type: 'json_schema', schema: IDENTIFICACION_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imagenBase64 },
            },
            { type: 'text', text: promptTexto },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ error: 'No se pudieron identificar las cartas de la foto.' });
    }
    const resultado = JSON.parse(textBlock.text);
    res.json(resultado);
  } catch (err) {
    console.error('Error identificando cartas por foto:', err);
    res.status(502).json({ error: 'No se pudieron identificar las cartas de la foto.' });
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

  const mensajeUsuario = construirMensajeUsuarioInicial(consultante, pregunta, tirada);

  const insertInfo = db
    .prepare(
      `INSERT INTO lecturas (consultante_id, pregunta, tirada_json, interpretacion)
       VALUES (?, ?, ?, ?)`
    )
    .run(consultante_id, pregunta.trim(), JSON.stringify(tirada), '');
  const lecturaId = insertInfo.lastInsertRowid;

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
    'X-Lectura-Id': String(lecturaId),
  });

  try {
    const textoCompleto = await transmitirYCapturar(
      res,
      [{ role: 'user', content: mensajeUsuario }],
      4096
    );

    db.prepare('UPDATE lecturas SET interpretacion = ? WHERE id = ?').run(
      textoCompleto,
      lecturaId
    );

    res.end();
  } catch (err) {
    console.error('Error generando la lectura:', err);
    db.prepare('UPDATE lecturas SET interpretacion = ? WHERE id = ?').run(
      '(la lectura se interrumpió)',
      lecturaId
    );
    if (!res.headersSent) {
      res.status(502).json({ error: 'No se pudo generar la lectura.' });
    } else {
      res.end('\n\n[Se interrumpió la conexión con el oráculo. Probá de nuevo.]');
    }
  }
});

app.post('/api/lecturas/:id/preguntar', async (req, res) => {
  const { pregunta } = req.body || {};
  if (!pregunta || !pregunta.trim()) {
    return res.status(400).json({ error: 'Falta la pregunta.' });
  }

  const datos = obtenerLecturaConMensajes(req.params.id);
  if (!datos) {
    return res.status(404).json({ error: 'Lectura no encontrada.' });
  }
  const { lectura, consultante, mensajes } = datos;

  const historial = construirHistorialConversacion(lectura, consultante, mensajes);
  historial.push({ role: 'user', content: pregunta.trim() });

  iniciarRespuestaEnStreaming(res);

  try {
    const textoCompleto = await transmitirYCapturar(res, historial, 2048);

    const insertMensaje = db.prepare(
      'INSERT INTO mensajes (lectura_id, rol, contenido) VALUES (?, ?, ?)'
    );
    insertMensaje.run(lectura.id, 'user', pregunta.trim());
    insertMensaje.run(lectura.id, 'assistant', textoCompleto);

    res.end();
  } catch (err) {
    console.error('Error respondiendo la pregunta de seguimiento:', err);
    if (!res.headersSent) {
      res.status(502).json({ error: 'No se pudo generar la respuesta.' });
    } else {
      res.end('\n\n[Se interrumpió la conexión con el oráculo. Probá de nuevo.]');
    }
  }
});

app.post('/api/lecturas/:id/sugerir-tirada', async (req, res) => {
  const datos = obtenerLecturaConMensajes(req.params.id);
  if (!datos) {
    return res.status(404).json({ error: 'Lectura no encontrada.' });
  }
  const { lectura, mensajes } = datos;

  const resumen = construirResumenSesion(lectura, mensajes);
  const mensajeUsuario = `${resumen}\nProponé una tirada ADICIONAL y distinta a la ya realizada, pensada específicamente para profundizar en algún aspecto puntual que haya surgido en esta conversación.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: PROMPT_TIRADA,
      output_config: {
        format: { type: 'json_schema', schema: TIRADA_SCHEMA },
      },
      messages: [{ role: 'user', content: mensajeUsuario }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ error: 'La IA no devolvió una tirada válida.' });
    }
    const tirada = JSON.parse(textBlock.text);
    res.json({ tirada });
  } catch (err) {
    console.error('Error sugiriendo tirada adicional:', err);
    res.status(502).json({ error: 'No se pudo generar la tirada adicional.' });
  }
});

app.post('/api/lecturas/:id/tirada-adicional', async (req, res) => {
  const { tirada } = req.body || {};
  if (
    !tirada ||
    !Array.isArray(tirada.posiciones) ||
    tirada.posiciones.length === 0 ||
    tirada.posiciones.some((p) => !p.carta)
  ) {
    return res.status(400).json({ error: 'Faltan datos de la tirada adicional.' });
  }

  const datos = obtenerLecturaConMensajes(req.params.id);
  if (!datos) {
    return res.status(404).json({ error: 'Lectura no encontrada.' });
  }
  const { lectura, consultante, mensajes } = datos;

  const historial = construirHistorialConversacion(lectura, consultante, mensajes);

  const posicionesTexto = construirPosicionesTexto(tirada.posiciones);
  const mensajeNuevaTirada = `Para seguir profundizando en el mismo tema, la persona hizo esta tirada adicional: "${tirada.nombre}"

Cartas que salieron:
${posicionesTexto}

Interpretá esta tirada nueva conectándola con todo lo que ya se habló en la conversación, no como una lectura aislada.`;

  historial.push({ role: 'user', content: mensajeNuevaTirada });

  iniciarRespuestaEnStreaming(res);

  try {
    const textoCompleto = await transmitirYCapturar(res, historial, 4096);

    db.prepare(
      'INSERT INTO mensajes (lectura_id, rol, contenido, tirada_json) VALUES (?, ?, ?, ?)'
    ).run(lectura.id, 'user', mensajeNuevaTirada, JSON.stringify(tirada));
    db.prepare('INSERT INTO mensajes (lectura_id, rol, contenido) VALUES (?, ?, ?)').run(
      lectura.id,
      'assistant',
      textoCompleto
    );

    res.end();
  } catch (err) {
    console.error('Error interpretando la tirada adicional:', err);
    if (!res.headersSent) {
      res.status(502).json({ error: 'No se pudo interpretar la tirada adicional.' });
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
