# Development Master Guide — Minha Lista de Compras

> **Baseline:** `v1.0.8` (`2026.11.24-simplified-onboarding`) • **Stack:** Expo SDK 58 / React Native 0.88 / React 19.3  
> **Companion Blueprints:** `@docs/FRONTEND_ARCHITECTURE.md` & `@docs/BACKEND_DATA_ARCHITECTURE.md`

---

## 1. Purpose & Invocation

This file is the authoritative, self-contained specification for AI coding agents and developers evolving this app or cloning its architecture. Referencing `@docs/DEV_MASTER_GUIDE.md` in any prompt automatically enforces all language, UI, theme, offline-storage, OCR/API, versioning, LGPD, and validation rules below.

- **Feature/Fix Prompt:** `Strictly follow @docs/DEV_MASTER_GUIDE.md and implement: <task>.`
- **New App Prompt:** `Use @docs/DEV_MASTER_GUIDE.md, @docs/FRONTEND_ARCHITECTURE.md, and @docs/BACKEND_DATA_ARCHITECTURE.md as the blueprint for a new Expo SDK 58 app for: <domain>.`

---

## 2. Non-Negotiable Language, Progress & Compatibility Rules

1. **Language Split (CRITICAL):**
   - **100% Brazilian Portuguese (`pt-BR`)** for ALL user-facing app UI strings, titles, buttons, placeholders, badges, categories, alerts, confirmation modals, `APP_CHANGELOG`, `Configurações > Ajuda`, `Sobre`, and `README.md` — even when the user prompt is in English. (Keep official design-system names like `Material You`, `Rose Quartz`, `AMOLED`, `Neon Matrix`, `Cyberpunk Neon` intact.)
   - **100% Concise Technical English** inside `docs/*.md` for token efficiency.
2. **Mandatory Progress Reporting:**
   - Before each numbered step, print: `Progresso total: [XX]% — Executando Passo [N]/[Total]: [Título curto do passo em PT-BR]`
   - End final summary with: `Progresso total: 100% — Concluído!`
3. **Expo SDK 58 / RN 0.88 Compatibility:**
   - Preserve folder structure, navigation, themes, `AsyncStorage` schemas, `.zip`/`.json` backups, and `package-lock.json`.
   - Never add native dependencies unless explicitly requested; reuse existing packages in `package.json`.

---

## 3. Authoritative File Map

| Area | Path | Key Responsibility |
| :--- | :--- | :--- |
| Root & Navigation | `App.js` | `ErrorBoundary` -> `AppSettingsProvider` -> `Onboarding` / `NavigationContainer` + deep links |
| Versioning | `src/constants/appVersion.js` | Single source of truth: `APP_VERSION`, `APP_BUILD_TAG`, `APP_CHANGELOG` |
| Themes | `src/theme/themes.js` | 8 presets (incl. `Material You` w/ legacy `google_maps` alias) + `Personalizado` |
| Global State | `src/context/AppSettingsContext.js` | `useAppSettings()`: `colors`, `shape`, `cardShadow`, `typography`, `isMaterialYouTheme`, `dataVersion` |
| Offline Storage | `src/storage/shoppingStorage.js` | Lists, history, reminders, settings, JSON backup import/export |
| ZIP & Diagnostics | `src/services/backupArchiveService.js` | `buildFullZipBackup`, `buildPhotosOnlyZipBackup`, `buildDiagnosticZipBundle`, 4-level Android reader |
| Media Lifecycle | `src/services/tagPhotoStorage.js` | `600px` JPEG `0.65` in `tag_photos/`, cascade delete, `30/60/90/120`d retention |
| Camera & Crop | `components/modals/ShoppingModals/CameraCaptureModal.js` | Self-closing `<CameraView />`, EAN lock, mute toggle, `+12%` top crop margin |
| OCR Engine | `src/services/labelOcr.native.js`, `components/common/NativeOcrBridge.native.js` | `1100px` upscale, `48px` white padding, yellow-tag grayscale fallback |
| Label Parser | `src/services/labelParser.js` | 2D superscript cents, `DE/POR/TOTAL` rules, `isReadableProductTitle` gibberish filter |
| API & Cache | `src/services/productLookupService.js` | GS1 Brazil `789`/`790` + Mod-10, `6500ms` timeout, 1 retry on `5xx`/network, 300-item LRU |
| Categories | `src/utils/categoryDictionary.js` | 420+ PT-BR keywords/brands + `@mlc_offline:learned_categories` |
| Telemetry (LGPD) | `src/services/diagnosticLogService.js` | Anonymous device context, crashes, API/OCR logs, auto-vs-manual confirmation telemetry |
| Crash Guard | `components/common/ErrorBoundary.js` | Catches render crashes -> `recordAppErrorLog` + recovery button |
| Settings UI | `components/modals/ShoppingModals/SettingsModal.js` | Collapsible accordions (`Temas`, `Cadastro de Itens`, `Câmera e Fotos das Etiquetas`, etc.) + 4-subsection Diagnostics + EAN API Tester |
| Onboarding/Docs | `OnboardingScreen.js`, `AjudaScreen.js`, `SobreScreen.js` | Compact onboarding w/ unified camera/photo block + `OnboardingReplay`, PT-BR help, changelog |
| APK Build Automation | `scripts/build-apk.js` | `npm run build:apk`: EAS preview build (`--wait`) + auto-download to `builds/minha-lista-compras-v<ver>.apk` |
| Voice Name Dictation | `src/services/voiceInputService.js` | Lazy `expo-speech-recognition` (`pt-BR`) wrapper exclusively for `Nome do produto` in `ItemFormModal.js` |

---

## 4. Mandatory UI/UX & Component Rules

1. **Theme Tokens Only:** Never hardcode hex colors when a semantic token from `useAppSettings()` exists (`colors.*`, `radiusCard`, `radiusButton`, `radiusInput`, `borderWidth`, `cardShadow`, `typography`). Preserve backward compatibility via `normalizeThemeId()` whenever renaming a theme key.
2. **Spacing & Grids:** Accordion container `gap: 14`, `marginTop: 16` above footer CTA, subsection cards `gap: 12`, action buttons in **2×2 grids** (`gap: 10`, `minHeight: 40`).
3. **Valid `FontAwesome6` Icons Only:** Never use non-existent names like `sparkles`; use valid icons (`wand-magic-sparkles`, `barcode`, `file-zipper`, `file-lines`, `trash-can`, `expand`, `rotate`, `magnifying-glass`, `clock-rotate-left`).
4. **Strictly Self-Closing `<CameraView />`:** Never nest children inside `<CameraView />`. Wrap in `<View style={{ flex: 1, position: 'relative' }}>`, render `<CameraView style={StyleSheet.absoluteFill} ... />` alone, and place overlays as `StyleSheet.absoluteFill` siblings (`pointerEvents="box-none"`).

---

## 5. Offline Data, Hybrid Scanner & OCR Rules

1. **Reactive Refresh:** Always call `notifyDataRestored()` after backup imports or bulk deletes.
2. **Full Reset Completeness:** *"Excluir Todos os Dados do Aplicativo"* MUST clear lists, history, reminders, learned categories, `tag_photos/`, `clearProductLookupCache()`, and `clearApiDiagnosticLogs()`, always offering *"Fazer Backup Antes"* in `ConfirmModal`.
3. **Barcode Lock:** Restrict `barcodeTypes` to `['ean13', 'ean8']`. Accept only GS1 Brazil (`789`/`790`) or commercial `EAN-8` (no `'2'` scale prefix) passing **Modulo-10**. Lock `lockedBarcode` until photo capture or `Recomeçar`. Never guess EANs from OCR text (`extractBarcodeFromOcr()` returns `null`).
4. **Geometric OCR:** Apply `+12%` top margin, normalize `1000–1200px` (`compress: 0.92`), merge 2D superscript cents (`height >= 1.35 * medianHeight`), exclude struck/unit prices (`DE:`, `VALOR 100GR`, `R$/kg`, `P/ NÃO COOPERADO`, `IBPT`, `TARA`, `PESO`), prioritize `POR:`/`À VISTA`/`TOTAL`, guard against `R$` misread as leading digit, and return `""` on gibberish titles (`isReadableProductTitle`).
5. **API Resilience:** EAN-only lookup (`6500ms` timeout, 1 retry at `1500ms` on network/`5xx`, never retry `404`). Reject numeric API names (`isValidApiProductName`) while keeping `categories_tags`/`quantity`.

---

## 6. Semantic Versioning & LGPD Protocol

- **On every functional/UI release (e.g., `1.0.5` -> `1.0.6`):**
  1. Bump `APP_VERSION` and `APP_BUILD_TAG` in `src/constants/appVersion.js`.
  2. Sync `"version"` in `app.json` and `package.json`.
  3. Prepend a PT-BR entry to `APP_CHANGELOG` (`version`, `date` as `DD/MM/AAAA`, `title`, `highlights`).
- **Automated APK Release Workflow:** Run `npm run build:apk` (`scripts/build-apk.js`) to build on EAS (`preview --wait`) and download `builds/minha-lista-compras-v<version>.apk`. Keep `builds/` and `*.apk` in `.gitignore` so binaries are never committed.
- **LGPD Strictness:** Never collect or export PII (names, emails, IPs, GPS, contacts, IMEI, Android ID, ad tokens). All logs remain local-only until explicitly exported by the user.

---

## 7. Mandatory Pre-Completion Checklist

- [ ] **Language:** 100% of user-facing strings, `Ajuda`, `APP_CHANGELOG`, and `README.md` in natural `pt-BR`; `docs/*.md` in concise technical English.
- [ ] **Versioning:** `appVersion.js`, `app.json`, and `package.json` synchronized.
- [ ] **Tests:** Run targeted automated checks when altering parser/GTIN/storage logic and remove any temporary scripts.
- [ ] **Expo Health:** `npx expo-doctor` -> `20/20 checks passed`.
- [ ] **Android Bundle:** `npx expo export --platform android` -> exit code `0`, then delete `dist/`.
- [ ] **Report:** End with `Progresso total: 100% — Concluído!` and clickable file links.
