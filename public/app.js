(() => {
  const estado = {
    consultante: null,
    cartas: [],
    pregunta: '',
    tirada: null,
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

  function renderizarTirada() {
    document.getElementById('titulo-tirada').textContent = estado.tirada.nombre;
    const contenedor = document.getElementById('posiciones-contenedor');
    contenedor.innerHTML = '';

    estado.tirada.posiciones.forEach((pos, idx) => {
      const div = document.createElement('div');
      div.className = 'posicion';

      const opciones = ['<option value="">Elegí la carta…</option>']
        .concat(estado.cartas.map((c) => `<option value="${c}">${c}</option>`))
        .join('');

      div.innerHTML = `
        <p class="posicion-nombre">${idx + 1}. ${pos.nombre}</p>
        <p class="posicion-significado">${pos.significado}</p>
        <div class="posicion-controles">
          <select data-idx="${idx}" class="select-carta">${opciones}</select>
          <div class="orientacion-toggle">
            <label><input type="radio" name="orientacion-${idx}" value="derecha" checked><span>Derecha</span></label>
            <label><input type="radio" name="orientacion-${idx}" value="invertida"><span>Invertida</span></label>
          </div>
        </div>
      `;
      contenedor.appendChild(div);
    });
  }

  const formTirada = document.getElementById('form-tirada');
  formTirada.addEventListener('submit', async (e) => {
    e.preventDefault();
    quitarError(formTirada);

    const selects = formTirada.querySelectorAll('.select-carta');
    let faltante = false;
    selects.forEach((select) => {
      const idx = Number(select.dataset.idx);
      const carta = select.value;
      if (!carta) faltante = true;
      const orientacion = formTirada.querySelector(
        `input[name="orientacion-${idx}"]:checked`
      ).value;
      estado.tirada.posiciones[idx].carta = carta;
      estado.tirada.posiciones[idx].orientacion = orientacion;
    });

    if (faltante) {
      mostrarError(formTirada, 'Falta elegir una carta en alguna posición.');
      return;
    }

    mostrarPaso('resultado');
    await pedirLectura();
  });

  // ---------- Paso 4: lectura en streaming ----------

  const textoResultado = document.getElementById('texto-resultado');
  const cargandoLectura = document.getElementById('cargando-lectura');

  async function pedirLectura() {
    textoResultado.textContent = '';
    cargandoLectura.hidden = false;

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
    mostrarPaso('pregunta');
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
