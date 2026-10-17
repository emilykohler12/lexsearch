/** Three documents of a rental dispute, with an amount in conflict and a date that could be reconciled. */
export const CONTRATO = [
  'CONTRATO DE LOCACIÓN. En la Ciudad de Córdoba, a los 3 días del mes de marzo de 2023, entre Marta Ejemplo (locadora) y Pablo Muestra (locatario) se celebra el presente contrato.',
  'CLÁUSULA SEGUNDA: el plazo es de tres años contados desde la entrega de las llaves, que se realiza en este acto.',
  'CLÁUSULA TERCERA: el alquiler mensual es de $180.000, pagadero del 1 al 10 de cada mes.',
].join('\n');

export const TESTIGO = [
  'Dijo que es vecina del inmueble de calle Ficticia 123.',
  'Que recuerda que el señor Muestra se mudó a fines de abril de 2023, porque antes estaban pintando.',
  'Que sabe que el alquiler era de ciento cincuenta mil pesos por mes porque él se lo comentó.',
].join('\n');

export const RECIBO = 'Recibí de Pablo Muestra la suma de $180.000 en concepto de alquiler del mes de abril de 2023. Córdoba, 5 de abril de 2023.';

/** What the model "returns" when it is given [CONTRATO, TESTIGO, RECIBO] in that order (D1, D2, D3). */
export const modelAnswer = {
  findings: [
    {
      kind: 'FECHA',
      confidence: 'POSIBLE',
      title: 'Fecha en que el locatario empezó a usar la vivienda',
      explanation: 'El contrato dice que las llaves se entregaron el 3 de marzo; la testigo ubica la mudanza a fines de abril.',
      statements: [
        { document: 'D1', quote: 'contados desde la entrega de las llaves, que se realiza en este acto' },
        { document: 'D2', quote: 'se mudó a fines de abril de 2023, porque antes estaban pintando' },
      ],
    },
    {
      kind: 'MONTO',
      confidence: 'DIRECTA',
      title: 'Monto del alquiler mensual',
      explanation: 'El contrato y el recibo fijan $180.000 por mes; la testigo dice ciento cincuenta mil pesos.',
      statements: [
        { document: 'D1', quote: 'el alquiler mensual es de $180.000, pagadero del 1 al 10 de cada mes' },
        { document: 'D3', quote: 'la suma de $180.000 en concepto de alquiler del mes de abril de 2023' },
        { document: 'D2', quote: 'el alquiler era de ciento cincuenta mil pesos por mes' },
      ],
    },
  ],
};
