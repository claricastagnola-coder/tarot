(() => {
  const estado = {
    consultante: null,
    cartas: [],
    pregunta: '',
    tirada: null,
    lecturaId: null,
    tiradaAdicional: null,
  };

  const pasos = {
    datos: document.getElementById('paso-datos'),
    pregunta: document.getElementById('paso-pregunta'),
    tirada: document.getElementById('paso-tirada'),
    resultado: document.getElementById('paso-resultado'),
  };

  function mostrarPaso(nombre) {
    Object.values(pasos).forEach((el) => el.classList.remove('paso-activo'));
    pasos[nombre].classList.add('paso-activo');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function mostrarError(form, mensaje) {
    quitarError(form);
    const p = document.createElement('p');
    p.className = 'error-mensaje';
    p.textContent = mensaje;
    form.appendChild(p);
  }

  function quitarError(form) {
    const existente = form.querySelector('.error-mensaje');
    if (existente) existente.remove();
  }

  async function cargarCartas() {
    const res = await fetch('/api/cartas');
    const data = await res.json();
    estado.cartas = data.cartas;
  }

  // ---------- Paso 1: datos ----------

  const formDatos = document.getElementById('form-datos');
  formDatos.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('input-nombre').value.trim();
    const fecha_nacimiento = document.getElementById('input-fecha').value;
    if (!nombre || !fecha_nacimiento) return;

    const boton = formDatos.querySelector('button');
    boton.disabled = true;
    try {
      const res = await fetch('/api/consultantes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, fecha_nacimiento }),
      });
      if (!res.ok) throw new Error('No se pudo guardar tus datos.');
      estado.consultante = await res.json();

      document.getElementById('nombre-en-saludo').textContent = estado.consultante.nombre;
      document.getElementById('btn-historial-toggle').hidden = false;
      cargarHistorial();
      mostrarPaso('pregunta');
    } catch (err) {
      mostrarError(formDatos, err.message);
    } finally {
      boton.disabled = false;
    }
  });

  // ---------- Paso 2: pregunta -> tirada sugerida ----------

  const formPregunta = document.getElementById('form-pregunta');
  const cargandoTirada = document.getElementById('cargando-tirada');

  formPregunta.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pregunta = document.getElementById('input-pregunta').value.trim();
    if (!pregunta) return;
    estado.pregunta = pregunta;

    quitarError(formPregunta);
    const boton = formPregunta.querySelector('button');
    boton.disabled = true;
    cargandoTirada.hidden = false;

    try {
      const res = await fetch('/api/tirada-sugerida', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pregunta, consultante_id: estado.consultante.id }),
      });
      if (!res.ok) throw new Error('No se pudo generar la tirada. Probá de nuevo.');
      const data = await res.json();
      estado.tirada = data.tirada;
      estado.tirada.posiciones = estado.tirada.posiciones.map((p) => ({
        ...p,
        carta: '',
        orientacion: 'derecha',
      }));
      renderizarTirada();
      mostrarPaso('tirada');
    } catch (err) {
      mostrarError(formPregunta, err.message);
    } finally {
      boton.disabled = false;
      cargandoTirada.hidden = true;
    }
  });

  // ---------- Paso 3: tirada y selección de cartas ----------

  function renderizarPosicionesEnContenedor(contenedor, posiciones, prefijo) {
    contenedor.innerHTML = '';

    posiciones.forEach((pos, idx) => {
      const div = document.createElement('div');
      div.className = 'posicion';

      const opciones = ['<option value="">Elegí la carta…</option>']
        .concat(estado.cartas.map((c) => `<option value="${c}">${c}</option>`))
        .join('');

      div.innerHTML = `
        <p class="posicion-nombre">${idx + 1}. ${pos.nombre}</p>
        <p class="posicion-significado">${pos.significado}</p>
        <div class="posicion-controles">
          <select data-idx="${idx}" class="select-carta-${prefijo}">${opciones}</select>
          <div class="orientacion-toggle">
            <label><input type="radio" name="orientacion-${prefijo}-${idx}" value="derecha" checked><span>Derecha</span></label>
            <label><input type="radio" name="orientacion-${prefijo}-${idx}" value="invertida"><span>Invertida</span></label>
          </div>
        </div>
      `;
      contenedor.appendChild(div);
    });
  }

  function leerSeleccionesDeContenedor(contenedor, posiciones, prefijo) {
    let faltante = false;
    const selects = contenedor.querySelectorAll(`.select-carta-${prefijo}`);
    selects.forEach((select) => {
      const idx = Number(select.dataset.idx);
      const carta = select.value;
      if (!carta) faltante = true;
      const orientacion = contenedor.querySelector(
        `input[name="orientacion-${prefijo}-${idx}"]:checked`
      ).value;
      posiciones[idx].carta = carta;
      posiciones[idx].orientacion = orientacion;
    });
    return !faltante;
  }

  function renderizarTirada() {
    document.getElementById('titulo-tirada').textContent = estado.tirada.nombre;
    renderizarPosicionesEnContenedor(
      document.getElementById('posiciones-contenedor'),
      estado.tirada.posiciones,
      'principal'
    );
  }

  const formTirada = document.getElementById('form-tirada');
  formTirada.addEventListener('submit', async (e) => {
    e.preventDefault();
    quitarError(formTirada);

    const completo = leerSeleccionesDeContenedor(
      document.getElementById('posiciones-contenedor'),
      estado.tirada.posiciones,
      'principal'
    );

    if (!completo) {
      mostrarError(formTirada, 'Falta elegir una carta en alguna posición.');
      return;
    }

    mostrarPaso('resultado');
    await pedirLectura();
  });

  // ---------- Identificar cartas por foto ----------

  function redimensionarImagen(file, maxDimension) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);

        canvas.toBlob(
          (blob) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('No se pudo procesar la imagen.'));
            reader.readAsDataURL(blob);
          },
          'image/jpeg',
          0.85
        );
      };
      img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      img.src = url;
    });
  }

  async function identificarCartasDesdeFoto(file, posiciones) {
    const dataUrl = await redimensionarImagen(file, 1600);
    const [meta, base64] = dataUrl.split(',');
    const mediaType = meta.match(/data:(.*);base64/)[1];

    const res = await fetch('/api/identificar-cartas-foto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imagenBase64: base64,
        mediaType,
        posiciones: posiciones.map((p) => ({ nombre: p.nombre, significado: p.significado })),
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudieron identificar las cartas de la foto.');
    }

    const data = await res.json();
    return data.cartas;
  }

  function aplicarCartasIdentificadas(contenedor, prefijo, cartasIdentificadas) {
    cartasIdentificadas.forEach((c, idx) => {
      const select = contenedor.querySelector(`.select-carta-${prefijo}[data-idx="${idx}"]`);
      if (select && estado.cartas.includes(c.carta)) {
        select.value = c.carta;
      }
      const orientacion = c.orientacion === 'invertida' ? 'invertida' : 'derecha';
      const radio = contenedor.querySelector(
        `input[name="orientacion-${prefijo}-${idx}"][value="${orientacion}"]`
      );
      if (radio) radio.checked = true;
    });
  }

  function configurarBotonFoto({ inputId, botonId, cargandoId, contenedorId, prefijo, posicionesRef, mensajeExito }) {
    const input = document.getElementById(inputId);
    const boton = document.getElementById(botonId);
    const cargando = document.getElementById(cargandoId);
    const contenedor = document.getElementById(contenedorId);

    boton.addEventListener('click', async () => {
      const contenedorFoto = boton.closest('.foto-tirada');
      const errorPrevio = contenedorFoto.querySelector('.error-mensaje');
      if (errorPrevio) errorPrevio.remove();

      const file = input.files[0];
      if (!file) {
        const p = document.createElement('p');
        p.className = 'error-mensaje';
        p.textContent = 'Elegí o sacá una foto primero.';
        contenedorFoto.appendChild(p);
        return;
      }

      cargando.hidden = false;
      boton.disabled = true;

      try {
        const cartasIdentificadas = await identificarCartasDesdeFoto(file, posicionesRef());
        aplicarCartasIdentificadas(contenedor, prefijo, cartasIdentificadas);

        const p = document.createElement('p');
        p.className = 'ayuda-foto';
        p.textContent = mensajeExito;
        contenedorFoto.appendChild(p);
      } catch (err) {
        const p = document.createElement('p');
        p.className = 'error-mensaje';
        p.textContent = err.message;
        contenedorFoto.appendChild(p);
      } finally {
        cargando.hidden = true;
        boton.disabled = false;
      }
    });
  }

  configurarBotonFoto({
    inputId: 'input-foto-tirada',
    botonId: 'btn-identificar-foto',
    cargandoId: 'cargando-foto',
    contenedorId: 'posiciones-contenedor',
    prefijo: 'principal',
    posicionesRef: () => estado.tirada.posiciones,
    mensajeExito: 'Listo, revisá que las cartas identificadas sean correctas antes de continuar.',
  });

  configurarBotonFoto({
    inputId: 'input-foto-tirada-adicional',
    botonId: 'btn-identificar-foto-adicional',
    cargandoId: 'cargando-foto-adicional',
    contenedorId: 'posiciones-tirada-adicional',
    prefijo: 'adicional',
    posicionesRef: () => estado.tiradaAdicional.posiciones,
    mensajeExito: 'Listo, revisá que las cartas identificadas sean correctas antes de interpretar.',
  });

  // ---------- Paso 4: lectura en streaming ----------

  const textoResultado = document.getElementById('texto-resultado');
  const cargandoLectura = document.getElementById('cargando-lectura');
  const seguimientoDiv = document.getElementById('seguimiento');
  const hiloConversacion = document.getElementById('hilo-conversacion');
  const tiradaAdicionalDiv = document.getElementById('tirada-adicional');

  async function pedirLectura() {
    textoResultado.textContent = '';
    cargandoLectura.hidden = false;
    seguimientoDiv.hidden = true;
    hiloConversacion.innerHTML = '';
    tiradaAdicionalDiv.hidden = true;
    estado.lecturaId = null;
    estado.tiradaAdicional = null;

    try {
      const res = await fetch('/api/lecturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consultante_id: estado.consultante.id,
          pregunta: estado.pregunta,
          tirada: estado.tirada,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo generar la lectura.');
      }

      estado.lecturaId = res.headers.get('X-Lectura-Id');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let primerFragmento = true;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (primerFragmento) {
          cargandoLectura.hidden = true;
          primerFragmento = false;
        }
        textoResultado.textContent += decoder.decode(value, { stream: true });
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }

      if (estado.lecturaId) {
        seguimientoDiv.hidden = false;
      }
      cargarHistorial();
    } catch (err) {
      cargandoLectura.hidden = true;
      textoResultado.textContent = '';
      const p = document.createElement('p');
      p.className = 'error-mensaje';
      p.textContent = err.message;
      textoResultado.appendChild(p);
    }
  }

  document.getElementById('btn-nueva-pregunta').addEventListener('click', () => {
    document.getElementById('input-pregunta').value = '';
    estado.pregunta = '';
    estado.tirada = null;
    estado.lecturaId = null;
    estado.tiradaAdicional = null;
    hiloConversacion.innerHTML = '';
    seguimientoDiv.hidden = true;
    tiradaAdicionalDiv.hidden = true;
    mostrarPaso('pregunta');
  });

  // ---------- Seguimiento: streaming genérico hacia una burbuja ----------

  async function streamHaciaBurbuja(url, body, indicadorCargaEl) {
    const burbuja = document.createElement('div');
    burbuja.className = 'mensaje-asistente';
    hiloConversacion.appendChild(burbuja);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo generar la respuesta.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let primerFragmento = true;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (primerFragmento && indicadorCargaEl) {
          indicadorCargaEl.hidden = true;
          primerFragmento = false;
        }
        burbuja.textContent += decoder.decode(value, { stream: true });
        burbuja.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    } catch (err) {
      if (indicadorCargaEl) indicadorCargaEl.hidden = true;
      burbuja.classList.add('error-mensaje');
      burbuja.textContent = err.message;
    }
  }

  // ---------- Preguntar sobre la misma tirada ----------

  const formSeguimiento = document.getElementById('form-seguimiento');
  const cargandoSeguimiento = document.getElementById('cargando-seguimiento');

  formSeguimiento.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('input-seguimiento');
    const pregunta = input.value.trim();
    if (!pregunta || !estado.lecturaId) return;

    const burbujaUsuario = document.createElement('div');
    burbujaUsuario.className = 'mensaje-usuario';
    burbujaUsuario.textContent = pregunta;
    hiloConversacion.appendChild(burbujaUsuario);
    burbujaUsuario.scrollIntoView({ behavior: 'smooth', block: 'end' });

    input.value = '';
    const boton = formSeguimiento.querySelector('button');
    boton.disabled = true;
    cargandoSeguimiento.hidden = false;

    await streamHaciaBurbuja(
      `/api/lecturas/${estado.lecturaId}/preguntar`,
      { pregunta },
      cargandoSeguimiento
    );

    boton.disabled = false;
    cargandoSeguimiento.hidden = true;
  });

  // ---------- Sugerir tirada adicional ----------

  const btnSugerirTiradaAdicional = document.getElementById('btn-sugerir-tirada-adicional');
  const cargandoSugerencia = document.getElementById('cargando-sugerencia');
  const btnInterpretarTiradaAdicional = document.getElementById(
    'btn-interpretar-tirada-adicional'
  );
  const cargandoTiradaAdicional = document.getElementById('cargando-tirada-adicional');

  btnSugerirTiradaAdicional.addEventListener('click', async () => {
    if (!estado.lecturaId) return;

    cargandoSugerencia.hidden = false;
    btnSugerirTiradaAdicional.disabled = true;

    try {
      const res = await fetch(`/api/lecturas/${estado.lecturaId}/sugerir-tirada`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('No se pudo generar la tirada adicional.');
      const data = await res.json();

      estado.tiradaAdicional = data.tirada;
      estado.tiradaAdicional.posiciones = estado.tiradaAdicional.posiciones.map((p) => ({
        ...p,
        carta: '',
        orientacion: 'derecha',
      }));

      document.getElementById('titulo-tirada-adicional').textContent =
        estado.tiradaAdicional.nombre;
      renderizarPosicionesEnContenedor(
        document.getElementById('posiciones-tirada-adicional'),
        estado.tiradaAdicional.posiciones,
        'adicional'
      );
      tiradaAdicionalDiv.hidden = false;
      tiradaAdicionalDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      tiradaAdicionalDiv.hidden = false;
      const p = document.createElement('p');
      p.className = 'error-mensaje';
      p.textContent = err.message;
      tiradaAdicionalDiv.appendChild(p);
    } finally {
      cargandoSugerencia.hidden = true;
      btnSugerirTiradaAdicional.disabled = false;
    }
  });

  btnInterpretarTiradaAdicional.addEventListener('click', async () => {
    if (!estado.tiradaAdicional) return;

    const contenedor = document.getElementById('posiciones-tirada-adicional');
    const completo = leerSeleccionesDeContenedor(
      contenedor,
      estado.tiradaAdicional.posiciones,
      'adicional'
    );

    if (!completo) {
      const p = document.createElement('p');
      p.className = 'error-mensaje';
      p.textContent = 'Falta elegir una carta en alguna posición.';
      tiradaAdicionalDiv.appendChild(p);
      return;
    }

    const etiqueta = document.createElement('p');
    etiqueta.className = 'mensaje-tirada-etiqueta';
    etiqueta.textContent = `✦ Tirada adicional: ${estado.tiradaAdicional.nombre}`;
    hiloConversacion.appendChild(etiqueta);

    btnInterpretarTiradaAdicional.disabled = true;
    cargandoTiradaAdicional.hidden = false;

    await streamHaciaBurbuja(
      `/api/lecturas/${estado.lecturaId}/tirada-adicional`,
      { tirada: estado.tiradaAdicional },
      cargandoTiradaAdicional
    );

    btnInterpretarTiradaAdicional.disabled = false;
    cargandoTiradaAdicional.hidden = true;
    tiradaAdicionalDiv.hidden = true;
    estado.tiradaAdicional = null;
  });

  // ---------- Historial ----------

  const panelHistorial = document.getElementById('panel-historial');
  const btnHistorialToggle = document.getElementById('btn-historial-toggle');
  const listaHistorial = document.getElementById('lista-historial');

  btnHistorialToggle.addEventListener('click', () => {
    panelHistorial.hidden = !panelHistorial.hidden;
  });
  document.getElementById('btn-cerrar-historial').addEventListener('click', () => {
    panelHistorial.hidden = true;
  });

  async function cargarHistorial() {
    if (!estado.consultante) return;
    const res = await fetch(`/api/consultantes/${estado.consultante.id}/lecturas`);
    if (!res.ok) return;
    const data = await res.json();

    listaHistorial.innerHTML = '';
    data.lecturas.forEach((l) => {
      const li = document.createElement('li');
      const fecha = new Date(l.created_at.replace(' ', 'T') + 'Z');
      li.innerHTML = `${l.pregunta}<span class="item-fecha">${fecha.toLocaleString('es-AR')}</span>`;
      li.addEventListener('click', () => mostrarModalLectura(l));
      listaHistorial.appendChild(li);
    });
  }

  const modal = document.getElementById('modal-lectura');
  function mostrarModalLectura(lectura) {
    modal.querySelector('.modal-pregunta').textContent = `"${lectura.pregunta}"`;
    modal.querySelector('.modal-tirada').textContent = lectura.tirada?.nombre || '';
    modal.querySelector('.modal-texto').textContent =
      lectura.interpretacion || '(sin interpretación guardada)';
    modal.hidden = false;
  }
  document.getElementById('btn-cerrar-modal').addEventListener('click', () => {
    modal.hidden = true;
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });

  cargarCartas();
})();
