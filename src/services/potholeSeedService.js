export function formatDateTimePtBr(dateInput) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return 'Data indisponível';
  }
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} às ${hh}:${min}`;
}

export function generateSeedPotholes(latitude, longitude) {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  return [
    {
      id: 'seed-pothole-1',
      latitude: latitude + 0.0014,
      longitude: longitude + 0.0011,
      status: 'open',
      statusLabel: 'Aberto',
      isAnonymous: false,
      authorNickname: 'Carlos M.',
      createdAt: formatDateTimePtBr(new Date(now - 14 * hourMs)),
      comment:
        'Buraco fundo próximo à faixa da direita, água acumulada após a chuva dificulta a visualização.',
      confirmations: 7,
      streetHint: 'Proximidade nordeste da sua posição',
      verifications: [
        {
          id: 'seed-verif-1',
          status: 'open',
          statusLabel: 'Continua Aberto',
          note: 'Ainda sem sinalização ou reparo no trecho após as chuvas de ontem.',
          isAnonymous: false,
          authorNickname: 'Marcos R.',
          createdAt: formatDateTimePtBr(new Date(now - 3 * hourMs)),
          thumbUri: null,
          fullUri: null,
        },
      ],
    },
    {
      id: 'seed-pothole-2',
      latitude: latitude - 0.0012,
      longitude: longitude + 0.0016,
      status: 'open',
      statusLabel: 'Aberto',
      isAnonymous: true,
      authorNickname: 'Usuário Anônimo',
      createdAt: formatDateTimePtBr(new Date(now - 19 * hourMs)),
      comment:
        'Asfalto cedendo perto da esquina. Motociclistas e ciclistas precisam desviar com cuidado.',
      confirmations: 12,
      streetHint: 'Proximidade sudeste da sua posição',
      verifications: [],
    },
    {
      id: 'seed-pothole-3',
      latitude: latitude + 0.0008,
      longitude: longitude - 0.0015,
      status: 'fixed',
      statusLabel: 'Tampado',
      isAnonymous: false,
      authorNickname: 'Fernanda S.',
      createdAt: formatDateTimePtBr(new Date(now - 42 * hourMs)),
      comment:
        'Buraco próximo à faixa de pedestres causando freadas bruscas no horário de pico.',
      confirmations: 5,
      streetHint: 'Proximidade oeste da sua posição',
      verifications: [
        {
          id: 'seed-verif-3',
          status: 'fixed',
          statusLabel: 'Já foi Tampado',
          note: 'Equipe de manutenção realizou operação tapa-buraco nesta manhã. Via liberada com segurança.',
          isAnonymous: false,
          authorNickname: 'Fernanda S.',
          createdAt: formatDateTimePtBr(new Date(now - 5 * hourMs)),
          thumbUri: null,
          fullUri: null,
        },
      ],
    },
  ];
}
