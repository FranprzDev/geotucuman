import { normalize } from './catalog.js';

export const TOPICS: Record<string, string[]> = {
  water: [
    'agua', 'aguas', 'hidro', 'hidrico', 'hidrica', 'rio', 'rios', 'arroyo', 'acequia', 'zanja', 'zanj',
    'acueducto', 'canal', 'canales', 'dique', 'diques', 'embalse', 'espejo', 'corriente', 'cuenca',
    'catarata', 'pozo', 'pozos', 'riego', 'laguna', 'lago', 'humedal', 'water', 'hydro', 'river',
    'stream', 'reservoir', 'dam', 'well', 'irrigation', 'watershed', 'basin',
  ],
  transport: [
    'calle', 'calles', 'camino', 'caminos', 'vial', 'ruta', 'rutas', 'ferro', 'ferrocarril', 'aero',
    'aeropuerto', 'transporte', 'puente', 'puentes', 'colectivo', 'bus', 'road', 'roads', 'street',
    'transport', 'railway', 'rail', 'airport', 'bridge', 'route', 'highway',
  ],
  population: [
    'radio', 'radios', 'censo', 'censal', 'localidad', 'localidades', 'departamento', 'departamentos',
    'comuna', 'comunas', 'poblacion', 'municipio', 'municipios', 'asentamiento', 'ciudad', 'barrio',
    'vivienda', 'population', 'census', 'locality', 'settlement', 'city', 'municipality', 'district',
    'neighborhood', 'household',
  ],
  rural: [
    'cultivo', 'cultivos', 'agro', 'agropecuario', 'agropecuaria', 'suelo', 'suelos', 'edafo', 'parcela',
    'parcelas', 'rural', 'soja', 'maiz', 'trigo', 'papa', 'garbanzo', 'citrus', 'citrico', 'citricos',
    'tabaco', 'cana', 'canera', 'ingenio', 'vid', 'vides', 'uva', 'uvas', 'siembra', 'cosecha', 'ganado',
    'granja', 'agriculture', 'crop', 'crops', 'farm', 'soil', 'vineyard', 'grape', 'tobacco', 'livestock',
    'plantation', 'orchard',
  ],
  environment: [
    'ambiente', 'ambiental', 'vegetacion', 'bosque', 'bosques', 'protegida', 'protegido', 'geomorfo',
    'geomorphologia', 'glacio', 'glaciar', 'desmonte', 'erosion', 'contaminacion', 'clima', 'environment',
    'vegetation', 'forest', 'protected', 'geomorphology', 'glacier', 'climate', 'pollution', 'conservation',
  ],
  services: [
    'salud', 'educacion', 'comunicacion', 'energia', 'equipamiento', 'hospital', 'escuela', 'universidad',
    'electricidad', 'gas', 'saneamiento', 'servicio', 'servicios', 'health', 'education', 'communication',
    'energy', 'equipment', 'hospital', 'school', 'university', 'electricity', 'sanitation', 'utility',
  ],
  tourism: [
    'turismo', 'turistico', 'turisticos', 'turistica', 'circuito', 'circuitos', 'atractivo', 'atractivos',
    'hotel', 'hoteles', 'hostel', 'alojamiento', 'recreacion', 'esparcimiento', 'excursion', 'tourism',
    'tourist', 'tour', 'attraction', 'lodging', 'recreation', 'leisure',
  ],
  topography: [
    'topografia', 'topografico', 'topografica', 'curva', 'curvas', 'nivel', 'niveles', 'cota', 'cotas',
    'altura', 'alturas', 'elevacion', 'pendiente', 'relieve', 'hipsometria', 'hipsometrico', 'montana',
    'cerro', 'sierra', 'topography', 'topographic', 'contour', 'elevation', 'height', 'slope', 'relief',
    'hill', 'mountain', 'hypsometry',
  ],
  industry: [
    'industria', 'industrias', 'industrial', 'industriales', 'fabrica', 'fabricacion', 'procesamiento',
    'mineria', 'minero', 'extraccion', 'cantera', 'manufactura', 'industry', 'factory', 'manufacturing',
    'processing', 'mining', 'extraction', 'quarry',
  ],
  fires: [
    'foco', 'focos', 'calor', 'incendio', 'incendios', 'quema', 'quemas', 'fuego', 'fuegos', 'modis',
    'viirs', 'hotspot', 'hotspots', 'fire', 'fires', 'wildfire', 'wildfires', 'burn', 'burned',
  ],
  protected_areas: [
    'protegida', 'protegido', 'parque', 'parques', 'reserva', 'reservas', 'conservacion', 'patrimonio',
    'natural', 'protected', 'park', 'reserve', 'conservation', 'heritage', 'nature',
  ],
};

export const STOPWORDS = new Set([
  'quiero', 'quisiera', 'hacer', 'armar', 'armando', 'armo', 'necesito', 'saber', 'cuanto', 'cuanta',
  'cuantos', 'cuantas', 'cual', 'cuales', 'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'de',
  'del', 'en', 'y', 'o', 'a', 'por', 'para', 'con', 'sobre', 'que', 'me', 'te', 'se', 'lo', 'es', 'hay',
  'mapa', 'mapas', 'capa', 'capas', 'dato', 'datos', 'dataset', 'datasets', 'tucuman', 'puedo', 'puede',
  'podemos', 'podria', 'podrias', 'ir', 'usar', 'utilizar', 'mostrar', 'mostrame', 'ver', 'buscar',
  'encontrar', 'tengo', 'tiene', 'tienen', 'esta', 'este', 'estas', 'estos', 'algo', 'algun', 'alguna',
  'algunos', 'algunas', 'como', 'donde', 'cuando', 'porque', 'pero', 'si', 'no', 'todo', 'toda', 'todos',
  'todas', 'mas', 'muy', 'sin', 'tambien', 'solo', 'want', 'need', 'build', 'show', 'make', 'create',
  'find', 'search', 'get', 'see', 'use', 'using', 'can', 'could', 'would', 'should', 'please', 'with',
  'without', 'for', 'from', 'about', 'the', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'my', 'our',
  'your', 'some', 'any', 'all', 'map', 'maps', 'layer', 'layers', 'data', 'dataset', 'datasets', 'list',
  'suggest', 'recommend', 'available', 'help', 'what', 'which', 'where', 'when', 'how', 'do', 'does',
  'is', 'are', 'i', 'we', 'you', 'it', 'this', 'that', 'these', 'those', 'there', 'here',
]);

const NORMALIZED_TOPICS = Object.entries(TOPICS).map(([topic, words]) => ({
  topic,
  words: words.map(normalize),
}));

export function topicExpansion(terms: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const raw of terms) {
    const term = normalize(raw);
    if (!term) continue;
    const topics: string[] = [];
    for (const { topic, words } of NORMALIZED_TOPICS) {
      const hit = words.some((word) => {
        if (word === term) return true;
        if (term.length < 3) return false;
        return word.startsWith(term) || term.startsWith(word);
      });
      if (hit) topics.push(topic);
    }
    if (topics.length > 0) result.set(raw, Array.from(new Set(topics)));
  }
  return result;
}