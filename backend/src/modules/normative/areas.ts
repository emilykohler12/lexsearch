import type { PracticeArea } from '../clients/clients.schemas.js';

export interface AreaProfile {
  /** What the area covers: it tells the model what to look for in a norm. */
  description: string;
  /** Words that point to the area: used when the model isn't available, and as a hint when it is. */
  keywords: string[];
}

/** The areas that can be followed as a whole ("Otro" has no profile: it is followed with topics of its own). */
export type FollowableArea = Exclude<PracticeArea, 'OTRO'>;

export const AREA_PROFILES: Record<FollowableArea, AreaProfile> = {
  LABORAL: {
    description:
      'Relaciones de trabajo y de empleo: contratos, despidos e indemnizaciones, salarios y paritarias, convenios colectivos de trabajo, jornada, riesgos del trabajo (ART), registración laboral, asociaciones sindicales y conflictos colectivos.',
    keywords: ['convenio colectivo', 'convenciones colectivas', 'convención colectiva', 'trabajador', 'empleador', 'relación laboral', 'salario mínimo', 'remuneración', 'despido', 'indemnización', 'riesgos del trabajo', 'asociación sindical', 'paritaria'],
  },
  CIVIL: {
    description:
      'Obligaciones y contratos, responsabilidad civil y daños, derechos reales y propiedad, locaciones (alquileres), registros de la propiedad, personas jurídicas privadas (asociaciones civiles, fundaciones, entidades religiosas), Código Civil y Comercial.',
    keywords: ['código civil y comercial', 'locación', 'alquiler', 'daños y perjuicios', 'responsabilidad civil', 'derechos reales', 'propiedad horizontal', 'registro de la propiedad', 'usucapión'],
  },
  COMERCIAL: {
    description:
      'Sociedades y registro público, concursos y quiebras, títulos de crédito, contratos comerciales, seguros, entidades financieras y mercado de capitales, defensa de la competencia.',
    keywords: ['sociedades', 'inspección general de justicia', 'concurso preventivo', 'quiebra', 'cheque', 'pagaré', 'mercado de capitales', 'entidades financieras', 'defensa de la competencia'],
  },
  FAMILIA: {
    description:
      'Matrimonio y divorcio, alimentos, responsabilidad parental y cuidado personal, adopción, filiación, violencia familiar, capacidad de las personas.',
    keywords: ['divorcio', 'alimentos', 'responsabilidad parental', 'adopción', 'filiación', 'violencia familiar', 'régimen de comunicación', 'cuota alimentaria'],
  },
  SUCESIONES: {
    description: 'Herencias y sucesiones, declaratorias de herederos, testamentos, impuestos y tasas sobre la transmisión de bienes.',
    keywords: ['sucesión', 'herencia', 'testamento', 'declaratoria de herederos', 'herederos', 'transmisión gratuita'],
  },
  PENAL: {
    description:
      'Delitos y penas, Código Penal y procesos penales, ejecución de la pena, narcotráfico, lavado de activos y financiamiento del terrorismo, régimen penal tributario y cambiario.',
    keywords: ['código penal', 'código procesal penal', 'delito', 'lavado de activos', 'unidad de información financiera', 'ejecución de la pena', 'narcotráfico', 'régimen penal'],
  },
  ADMINISTRATIVO: {
    description:
      'Procedimiento administrativo, contrataciones públicas, empleo público, responsabilidad del Estado, regulación de servicios públicos y habilitaciones.',
    keywords: ['procedimiento administrativo', 'contrataciones públicas', 'empleo público', 'servicios públicos', 'ente regulador', 'licitación', 'responsabilidad del estado'],
  },
  PREVISIONAL: {
    description: 'Jubilaciones y pensiones, ANSES, haberes previsionales y su movilidad, regímenes especiales y cajas profesionales.',
    keywords: ['previsional', 'jubilación', 'jubilaciones', 'pensión', 'anses', 'haber mínimo', 'movilidad jubilatoria', 'sistema integrado previsional'],
  },
  CONSUMO: {
    description:
      'Defensa del consumidor y relaciones de consumo, lealtad comercial, publicidad y etiquetado, precios, garantías, servicios financieros y de telecomunicaciones al consumidor.',
    keywords: ['defensa del consumidor', 'relaciones de consumo', 'lealtad comercial', 'consumidores', 'garantía legal', 'etiquetado', 'precios cuidados'],
  },
};

export function isFollowableArea(value: string | null | undefined): value is FollowableArea {
  return value != null && Object.hasOwn(AREA_PROFILES, value);
}
