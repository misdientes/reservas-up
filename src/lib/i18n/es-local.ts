// Textos SOLO del entorno local (pasarela de prueba). Archivo aparte para
// que el build de producción no los incluya: solo los importa
// MockGatewayPage, que se carga en el modo 'localdb'.

export const esLocal = {
  mockGateway: {
    metaTitle: 'Pasarela de prueba',
    title: 'Pasarela de prueba',
    warning: 'Solo existe en el entorno local de desarrollo. No se cobra dinero real.',
    amount: 'Monto a pagar',
    approve: 'Aprobar pago',
    reject: 'Rechazar pago',
    abandon: 'Abandonar',
    sending: 'Enviando el aviso de pago…',
    error: 'No se pudo enviar el aviso de pago.',
  }
} as const
