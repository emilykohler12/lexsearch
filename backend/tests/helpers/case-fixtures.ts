/** A listing of movements like the one the court's system shows, and what the model "returns" for it. */
export const movimientos = [
  'JUZGADO CIVIL Y COMERCIAL N° 7 — Expte. 18.452/2025 «RAMÍREZ, LUCÍA C/ TRANSPORTES DEL SUR S.A. S/ DAÑOS Y PERJUICIOS»',
  'Movimientos:',
  '12/03/2025 Escrito presentado: Demanda',
  '14/03/2025 Providencia: Por presentada, parte y domicilio constituido. Traslado por 15 días.',
  '21/04/2025 Escrito presentado: Contesta demanda (Transportes del Sur S.A.)',
].join('\n');

/** In the order of the text, not of the dates: the system is the one that orders them. */
export const modelAnswer = {
  caseTitle: 'RAMÍREZ, LUCÍA C/ TRANSPORTES DEL SUR S.A. S/ DAÑOS Y PERJUICIOS',
  caseNumber: '18.452/2025',
  court: 'Juzgado Civil y Comercial N° 7',
  proceedings: [
    {
      date: '2025-04-21',
      kind: 'ESCRITO',
      title: 'Contestación de demanda',
      description: 'Contesta la demandada.',
      quote: '21/04/2025 Escrito presentado: Contesta demanda (Transportes del Sur S.A.)',
    },
    { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda', description: '', quote: '12/03/2025 Escrito presentado: Demanda' },
    {
      date: '2025-03-14',
      kind: 'RESOLUCION',
      title: 'Traslado de la demanda',
      description: 'Se corre traslado por 15 días.',
      quote: '14/03/2025 Providencia: Por presentada, parte y domicilio constituido. Traslado por 15 días.',
    },
  ],
};
