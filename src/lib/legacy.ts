export type LegacyTool = 'search_layers' | 'describe_layer' | 'query_layer' | 'geocode';

const KEY_MAPS: Record<LegacyTool, Record<string, string>> = {
  search_layers: {
    layers: 'capas',
    title: 'titulo',
    abstract: 'resumen',
    source: 'fuente',
    province: 'provincia',
    defaultCrs: 'crsPorDefecto',
    license: 'licencia',
    attribution: 'atribucion',
    note: 'nota',
  },
  describe_layer: {
    title: 'titulo',
    abstract: 'resumen',
    source: 'fuente',
    defaultCrs: 'crsPorDefecto',
    fields: 'campos',
    license: 'licencia',
    sources: 'fuentes',
  },
  query_layer: {
    returned: 'devueltos',
    note: 'nota',
    sources: 'fuentes',
    truncated: 'truncada',
  },
  geocode: {
    candidates: 'candidatos',
    note: 'nota',
    type: 'tipo',
    name: 'nombre',
    province: 'provincia',
    department: 'departamento',
    source: 'fuente',
  },
};

interface GuardError {
  pattern: RegExp;
  replace: (match: RegExpMatchArray) => string;
}

const GUARD_ERRORS: Partial<Record<LegacyTool, GuardError[]>> = {
  describe_layer: [
    {
      pattern: /^Layer not found in catalog: (.+)\. Use search_layers first\.$/,
      replace: (m) => `Capa no encontrada en el catálogo: ${m[1]}. Usá buscar_capas primero.`,
    },
  ],
  query_layer: [
    {
      pattern: /^Layer not found in catalog: (.+)\. Use search_layers first\.$/,
      replace: (m) => `Capa no encontrada en el catálogo: ${m[1]}. Usá buscar_capas primero.`,
    },
    {
      pattern: /^Rule describe-before-query: call describe_layer\("(.+)"\) first to learn the real fields\.$/,
      replace: (m) => `Regla describe-antes-de-consultar: llamá describir_capa("${m[1]}") primero para conocer los campos reales.`,
    },
  ],
};

function mapKeys(value: unknown, keyMap: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => mapKeys(item, keyMap));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[keyMap[k] ?? k] = mapKeys(v, keyMap);
    }
    return out;
  }
  return value;
}

function translateGuardError(tool: LegacyTool, message: string): string {
  for (const guard of GUARD_ERRORS[tool] ?? []) {
    const match = message.match(guard.pattern);
    if (match) return guard.replace(match);
  }
  return message;
}

export function toLegacyPayload(tool: LegacyTool, payload: unknown): Record<string, unknown> {
  const mapped = mapKeys(payload, KEY_MAPS[tool]) as Record<string, unknown>;
  if (typeof mapped.error === 'string') {
    mapped.error = translateGuardError(tool, mapped.error);
  }
  return mapped;
}
