const ARCANOS_MAYORES = [
  'El Loco',
  'El Mago',
  'La Sacerdotisa',
  'La Emperatriz',
  'El Emperador',
  'El Hierofante',
  'Los Enamorados',
  'El Carro',
  'La Fuerza',
  'El Ermitaño',
  'La Rueda de la Fortuna',
  'La Justicia',
  'El Colgado',
  'La Muerte',
  'La Templanza',
  'El Diablo',
  'La Torre',
  'La Estrella',
  'La Luna',
  'El Sol',
  'El Juicio',
  'El Mundo',
];

const PALOS = ['Bastos', 'Copas', 'Espadas', 'Oros'];

const RANGOS_MENORES = [
  'As',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'Sota',
  'Caballero',
  'Reina',
  'Rey',
];

function construirMazo() {
  const mazo = [...ARCANOS_MAYORES];
  for (const palo of PALOS) {
    for (const rango of RANGOS_MENORES) {
      mazo.push(`${rango} de ${palo}`);
    }
  }
  return mazo;
}

const MAZO_COMPLETO = construirMazo();

module.exports = { MAZO_COMPLETO, ARCANOS_MAYORES, PALOS, RANGOS_MENORES };
