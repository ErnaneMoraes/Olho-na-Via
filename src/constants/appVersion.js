export const APP_NAME = 'Olho na Via';
export const APP_VERSION = '1.6.2';
export const APP_BUILD_TAG = '2026.11.25-password-management';

export const APP_CHANGELOG = [
  {
    version: '1.6.2',
    date: '25/11/2026',
    title: 'Alteração de Senha pelo Usuário e Redefinição Administrativa',
    highlights: [
      'Adicionada seção "Segurança da Conta" em Configurações para alteração de própria senha com verificação da senha atual.',
      'Implementada RPC SECURITY DEFINER admin_reset_user_password e modal administrativo "Alterar Senha" na aba Perfis & Contas.',
    ],
  },
  {
    version: '1.6.0',
    date: '25/11/2026',
    title: 'Correção ENOENT/RLS, Revisão com Tarja e Captura Exclusiva Android',
    highlights: [
      'Corrigido erro ENOENT ao salvar e enviar fotos garantindo criação recursiva do diretório e uso direto de base64 em memória na geração e upload.',
      'Garantido vínculo user_id = auth.uid() nas inserções de buracos e verificações mesmo em postagens anônimas, resolvendo violação RLS.',
      'Bloqueado envio de fotos por webcam ou arquivo no navegador Web, exibindo aviso exclusivo para o aplicativo Android.',
      'Adicionado termo de responsabilidade pré-captura, detecção automática de rostos no dispositivo e tela de revisão com tarjas por toque e confirmação obrigatória.',
    ],
  },
  {
    version: '1.5.3',
    date: '25/11/2026',
    title: 'Identificação de Autores para Admin, Ajustes Limpos e Card Opaco',
    highlights: [
      'Preservado user_id interno em relatos e comentários anônimos para moderação administrativa via RPC admin_get_user_identities.',
      'Badges exclusivos de administrador revelando apelido e e-mail real de postagens anônimas no Painel Admin e nos detalhes da via.',
      'Diagnóstico e histórico de versões restritos a administradores; seção Sobre simplificada com botão Ver Tutorial Inicial para todos.',
      'Corrigida a elevação do cartão Área Restrita — Moderação Administrativa com fundo sólido Material You sem artefato cinza.',
    ],
  },
  {
    version: '1.5.2',
    date: '25/11/2026',
    title: 'Ícones Web no GitHub Pages, Flash/Lanterna e Obturador Silencioso',
    highlights: [
      'Corrigida a publicação das fontes @expo/vector-icons no GitHub Pages em dist/fonts/ com injeção @font-face na Web.',
      'Adicionado controle de prontidão da câmera (onCameraReady) e ativação conjunta de flash e lanterna (enableTorch) na captura de buracos.',
      'Som do obturador da câmera silenciado por padrão, com opção "Som da câmera ao fotografar" em Configurações.',
    ],
  },
  {
    version: '1.5.1',
    date: '25/11/2026',
    title: 'Painel Admin Responsivo, Lembrar-me e Modo Demo Somente Leitura',
    highlights: [
      'Cabeçalho do Painel Administrativo ajustado para não cortar o título e barra horizontal de abas com Auditoria integrada e consulta flexível em admin_audit_logs.',
      'Nova opção "Lembrar-me" na aba Entrar para manter ou limpar automaticamente a sessão entre reinicializações (armazenando apenas preferência e e-mail).',
      'Modo Demonstração agora exibe registros e fotos reais da nuvem em modo estritamente somente leitura, com atalho direto para Criar Conta.',
    ],
  },
  {
    version: '1.5.0',
    date: '25/11/2026',
    title: 'Suporte Completo para Navegadores Web e Desktop',
    highlights: [
      'Mapa Leaflet.js compatível com navegadores via iframe + postMessage usando os mesmos azulejos gratuitos OpenStreetMap.',
      'Geolocalização no navegador com fallback automático para centro padrão caso a permissão de GPS no desktop seja recusada.',
      'Envio de fotos no computador via seletor de arquivos ou webcam, com compressão Canvas em dupla resolução (200px e 1080px).',
      'Layout responsivo centralizado (maxWidth: 520) em telas largas para Autenticação, Onboarding e modais.',
    ],
  },
  {
    version: '1.4.0',
    date: '25/11/2026',
    title: 'Sistema de Moderação Administrativa Restrita e Auditoria',
    highlights: [
      'Verificação estrita de privilégios administrativos diretamente na tabela public.app_admins (sem credenciais ou chaves privilegiadas no app).',
      'Moderação inline no Bottom Sheet para administradores excluírem registros com fotos (thumbs/ e originals/) ou comentários individuais com dupla confirmação.',
      'Novo Painel Administrativo em Configurações com abas Registros & Fotos, Comentários, Perfis & Contas e Auditoria.',
      'Exclusão segura de contas via função PostgreSQL SECURITY DEFINER (admin_delete_user_account) e trilha em admin_audit_logs.',
    ],
  },
  {
    version: '1.3.2',
    date: '25/11/2026',
    title: 'Onboarding Rápido, Bottom Sheet Interativo e Cadastro Inteligente',
    highlights: [
      'Novo guia inicial em 3 slides explicando o mapa colaborativo, segurança ao fotografar e privacidade LGPD (reabrível em Configurações > Sobre).',
      'Detalhes do buraco convertidos em Bottom Sheet Material You (85% da tela) com abertura suave e gesto de arrastar para baixo na alça superior.',
      'Tratamento inteligente de e-mail já cadastrado: entra automaticamente se a senha coincidir ou alterna para a aba Entrar sem gerar tela vermelha de erro.',
    ],
  },
  {
    version: '1.3.1',
    date: '24/11/2026',
    title: 'Correção de Loop de GPS, Mapa Leaflet Zero-Chave, Cadastro Imediato e Material You Único',
    highlights: [
      'Corrigido loop infinito de recarregamento de GPS/mapa com inicialização única na montagem e aquisição rápida via última posição conhecida + timeout de 10s.',
      'Substituído o mapa nativo dependente de API Key por Leaflet.js em WebView com azulejos oficiais OpenStreetMap, ponto azul pulsante e marcadores progressivos por zoom.',
      'Adicionado botão flutuante "Minha Localização" para centralizar a câmera sob demanda sem recarregar a tela.',
      'Removida a exigência de confirmação por e-mail no cadastro: login automático imediato após criar conta.',
      'Tema unificado permanentemente em Material You (#1A73E8) em todo o aplicativo.',
    ],
  },
  {
    version: '1.3.0',
    date: '24/11/2026',
    title: 'Sincronização na Nuvem com Supabase, Anonimato LGPD Estrito e Pipeline APK',
    highlights: [
      'Integração com Supabase Auth (cadastro com perfil, login e sessão persistida) mantendo fallback para Modo Demonstração offline.',
      'Envio das fotos para o bucket pothole-photos (thumbs/ e originals/) com cache local exclusivo de miniaturas e carregamento sob demanda da foto original.',
      'Garantia estrita de anonimato LGPD: relatos e verificações anônimas gravam user_id: null e author_nickname: null no banco.',
      'Sincronização geográfica por área visível do mapa (bounding box) com botão de atualização manual no topo.',
      'Configuração EAS Build (eas.json) e script automatizado npm run build:apk para geração do .apk Android.',
    ],
  },
  {
    version: '1.2.0',
    date: '24/11/2026',
    title: 'Marcadores Progressivos por Zoom, Foto Original Sob Demanda e Verificação Comunitária',
    highlights: [
      'Transição automática dos pinos no mapa conforme o zoom: ícones compactos de longe e miniaturas 48x48 arredondadas de perto.',
      'Barra de filtros rápida no mapa para alternar entre Todos, Abertos e Tampados.',
      'Tela de detalhes do buraco com carregamento sob demanda da foto original em alta resolução e visualizador com gesto de pinça/toque.',
      'Fluxo comunitário de atualização de status ("Continua Aberto" ou "Já foi Tampado") com nova foto comprobatória e linha do tempo cronológica.',
    ],
  },
  {
    version: '1.1.0',
    date: '24/11/2026',
    title: 'Captura de Foto, Compressão em Dupla Resolução e Publicação no Mapa',
    highlights: [
      'Nova câmera nativa em tela cheia com guia de enquadramento, controle de flash e pré-visualização imediata.',
      'Compressão automática em duas resoluções (miniatura 200px para o mapa e HD até 1080px para inspeção em tela cheia).',
      'Formulário de novo relato com captura de GPS de alta precisão, endereço editável via Nominatim e opção de publicação anônima.',
      'Persistência local de relatos publicados com visualização instantânea no mapa e foto em alta resolução.',
    ],
  },
  {
    version: '1.0.0',
    date: '24/11/2026',
    title: 'Lançamento Inicial — Fundação, LGPD e Mapa Nativo',
    highlights: [
      'Identidade inicial do Olho na Via para Android (Expo SDK 58 / React Native 0.88).',
      'Design system Material You, autenticação em conformidade com a LGPD e bloqueio obrigatório de GPS.',
      'Três ocorrências de exemplo geradas próximas à sua localização para validação imediata.',
    ],
  },
];
