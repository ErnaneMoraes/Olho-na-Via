# Olho na Via

Aplicativo colaborativo para **Android** e **Navegadores Web** (**Expo SDK 58 / React Native 0.88**) voltado ao mapeamento cidadão de buracos e problemas de pavimentação na sua cidade, com foco em privacidade (**LGPD**) e operação **100% livre de chaves pagas para mapas**.

> **Versão atual:** `v1.6.0` (`2026.11.25-fix-upload-rls-photo-verification`) • **Plataformas:** Android nativo & Web Desktop/Mobile

---

## Principais Recursos

### Painel Admin Responsivo, Lembrar-me & Modo Demo Somente Leitura (`v1.5.1`)
- **Painel Administrativo Aprimorado (`AdminPanelModal.js` & `adminService.js`):**
  - Cabeçalho responsivo sem cortes em `"Painel Administrativo"`, barra de abas rolável horizontalmente com `"Auditoria"` integrada ao lado de `"Registros & Fotos"`, `"Comentários"` e `"Perfis & Contas"`, além de consulta robusta em `admin_audit_logs` e remoção resiliente de imagens no Storage.
- **Opção `"Lembrar-me"` no Login (`AuthScreen.js` & `authService.js`):**
  - Controle Material You para salvar apenas preferência e e-mail (nunca senhas em texto puro), exigindo novo login ao reabrir o app quando desativado.
- **Modo Demonstração Somente Leitura:**
  - Visitantes visualizam todas as ocorrências, fotos e comentários reais da nuvem com bloqueio completo de criação, edição, votação, fotos e configurações de postagem, com atalho direto para `"Criar Conta"`.

### Suporte Completo para Navegadores Web (`v1.5.0`)
- **Mapa Leaflet.js Multiplataforma (`LeafletMapView.js`):**
  - No Android utiliza `react-native-webview` e na Web renderiza um `<iframe>` (`srcDoc` + `postMessage`) com os mesmos azulejos oficiais **OpenStreetMap**, ponto azul pulsante e marcadores progressivos por zoom.
  - Na Web, solicita geolocalização do navegador com fallback automático para centro padrão da cidade caso o usuário recuse no desktop.
- **Envio de Fotos na Web (`PotholeCameraModal.js` + `potholeMediaService.js`):**
  - Suporta tanto captura por webcam quanto escolha direta de arquivo do computador (`<input type="file">`), com compressão em dupla resolução (`200px` e `1080px`) via HTML5 `<canvas>` e envio ao Supabase Storage.
- **Layout Responsivo para Desktop:**
  - Conteúdos, formulários, Onboarding, Bottom Sheet e Painel Administrativo centralizados com largura máxima de `520px` em telas largas.

### Moderação, Onboarding, Bottom Sheet e Nuvem (`v1.0.0` – `v1.4.0`)
- **Moderação Administrativa Restrita (`AdminPanelModal.js` + `adminService.js`):** verificação na tabela `public.app_admins`, remoção de registros/fotos no Storage, comentários, perfis, exclusão completa de conta (`admin_delete_user_account`) e trilha em `admin_audit_logs`.
- **Guia Inicial (`OnboardingScreen.js`) & Bottom Sheet 85% (`PotholeDetailModal.js`):** 3 slides Material You no primeiro acesso e painel interativo com gesto de arraste e zoom por pinça/toque.
- **Nuvem Supabase & Anonimato LGPD:** cadastro com sessão imediata, tratamento automático de e-mail duplicado e gravação estrita de `user_id: null` e `author_nickname: null` quando `is_anonymous === true`.
- **Build Automatizado de APK e Web:** `npm run build:apk` (`./builds/olho-na-via-v<versão>.apk`) e `npm run build:web`.

---

## Configuração do Supabase e Administrador

1. Crie um arquivo `.env` na raiz do projeto (ignorado pelo Git) com:
   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=SUA_CHAVE_ANON_PUBLICA
   ```
2. Aplique o script SQL de referência [supabase/schema.sql](file:///c:/Users/Ernane/Documents/GitHub/Olho%20na%20Via/supabase/schema.sql) no SQL Editor do seu projeto Supabase.
3. Para conceder privilégio administrativo a um usuário já cadastrado, execute no SQL Editor do Supabase:
   ```sql
   insert into public.app_admins (user_id)
   select id from auth.users where email = 'seu-admin@exemplo.com';
   ```

---

## Como Executar (Android e Web)

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Inicie no navegador Web:
   ```bash
   npx expo start --web
   ```
3. Para gerar o bundle estático de produção Web:
   ```bash
   npm run build:web
   ```
4. Para publicar a versão Web gratuitamente no **GitHub Pages** (`gh-pages`):
   ```bash
   npm run deploy:web
   ```
   - URL pública publicada: `https://ernanemoraes.github.io/Olho-na-Via/`
   - Configure no painel do **Supabase Auth > URL Configuration > Redirect URLs**: `https://ernanemoraes.github.io/Olho-na-Via/**`
   - Caso o GitHub Pages ainda não esteja ativado no repositório, acesse **Settings > Pages** no GitHub e selecione a branch `gh-pages` (`/ (root)`).
5. Para rodar em dispositivo/emulador Android via ADB:
   ```bash
   npx expo run:android
   ```
6. Para gerar e baixar o APK de preview via EAS:
   ```bash
   npm run build:apk
   ```
