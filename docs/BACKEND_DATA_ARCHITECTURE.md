# Backend, Data Persistence & Native Services Architecture

> **Reference App:** Minha Lista de Compras (`v1.0.8`, Expo SDK 58 / React Native 0.88)  
> **Companion Docs:** `@docs/DEV_MASTER_GUIDE.md`, `@docs/FRONTEND_ARCHITECTURE.md`

---

## 1. Offline-First Persistence (`AsyncStorage` + `expo-file-system`)

100% offline-first: no proprietary backend, no auth, zero network latency for CRUD. Structured JSON lives in `AsyncStorage`; compressed JPEG assets live in private `FileSystem.documentDirectory`.

### 1.1. `AsyncStorage` Key Inventory

| Key | Module | Purpose | Cleared on Full Reset |
| :--- | :--- | :--- | :---: |
| `@mlc_offline:lists` | `src/storage/shoppingStorage.js` | Shopping lists (open & finalized) + nested items | Yes |
| `@mlc_offline:history` | `src/storage/shoppingStorage.js` | Finalized purchase snapshots for reports/charts | Yes |
| `@mlc_offline:reminders` | `src/storage/shoppingStorage.js` | Reusable reminder lists + items | Yes |
| `@mlc_offline:settings` | `src/storage/shoppingStorage.js` | `themeId`, `darkMode`, `cameraSoundEnabled`, `saveTagPhotos`, `autoDeleteTagPhotos`, `tagPhotoRetentionDays`, `simplifiedItemForm` (default `true`) | Preserved (default) |
| `@mlc_offline:custom_theme` | `src/storage/shoppingStorage.js` | Custom theme config (`baseMode`, `primaryColor`, `borderStyle`, `borderThickness`) | Preserved |
| `@mlc_offline:onboarding_completed` | `src/storage/shoppingStorage.js` | `'true'` / `'false'` first-launch gate | Preserved |
| `@mlc_offline:learned_categories` | `src/utils/categoryDictionary.js` | Local `normalizedTerm -> category` learning map | Yes |
| `@mlc_offline:off_product_cache` | `src/services/productLookupService.js` | Compact LRU cache (max `300` entries, `< 25 KB`, `{ n, c, ts }`) | Yes |
| `@mlc_temp:app_diagnostic_logs` | `src/services/diagnosticLogService.js` | Circular buffer (max `50` entries) of crashes, API/OCR & telemetry | Yes |

### 1.2. Entity Schema & IDs
- **Local IDs (`generateId()`):** `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.
- **Item fields:** `id`, `name`, `quantity`, `unit`, `category`, `price`, `description`, `checked`, `photoFilename` (short filename, never Base64), `photoCapturedAt`.
- **Reactive Invalidation (`AppSettingsContext.js`):** `dataVersion` counter + `notifyDataRestored()`. Any restore, bulk delete, or retention cleanup increments `dataVersion` so screens re-read `AsyncStorage` without tight coupling.

---

## 2. Local Media Lifecycle (`src/services/tagPhotoStorage.js`)

- **Compression:** `expo-image-manipulator` resizes to `MAX_TAG_WIDTH = 600`, `JPEG_COMPRESS = 0.65` (~25–50 KB), stored in `${documentDirectory}tag_photos/tag_<ts>_<rand>.jpg`. Temporary crop/OCR files are deleted immediately (`idempotent: true`).
- **Cascade Delete & Orphan Cleanup:** Deleting an item or list deletes its `.jpg` files; `getTagPhotosStorageStats(lists)` computes storage usage and prunes unreferenced files.
- **Retention Policy:** Configurable `30`, `60` (default), `90`, or `120` days (`findAndDeleteExpiredTagPhotos`), executed on boot when `autoDeleteTagPhotos` is enabled.

---

## 3. Portable Backup & Restore (`src/services/backupArchiveService.js`)

Uses `jszip` (DEFLATE level 6), `expo-file-system`, `expo-sharing`, and `expo-document-picker`, plus Android `"Open with..."` `intentFilters` in `app.json`.

- **4 Export Scopes:** `all_zip` (`backup.json` + `etiquetas/*.jpg`), `photos_zip` (`photos_manifest.json` + `etiquetas/*.jpg`), `lists` (`.json`), `reminders` (`.json`).
- **4-Level Android `content://` Binary Reader (`parseBackupArchiveFromUri`):**
  1. Copy to `cacheDirectory` -> `new File(uri).bytes()`
  2. `LegacyFileSystem.readAsStringAsync(uri, { encoding: 'base64' })`
  3. Direct `new File(uri).bytes()` on original URI
  4. `fetch(uri).then(r => r.arrayBuffer())`
- **Granular Delete vs. Full Reset:** Granular deletes always show `ConfirmModal` with a chained *"Fazer Backup Antes"* action. Full Reset wipes lists, history, reminders, learned categories, `tag_photos/`, product cache (`clearProductLookupCache`), and diagnostic logs (`clearApiDiagnosticLogs`).

---

## 4. External API Enrichment, LRU Cache & Network Resilience (`productLookupService.js`)

1. **Strict Pre-Network Gate (`isValidGtinBarcode`):** Only Brazilian GS1 `EAN-13` (`789`/`790`) or commercial `EAN-8` (not starting with `'2'`) with valid **Modulo-10** checksum. No external text search (eliminates `HTTP 503` failures).
2. **LRU Cache:** Checked first (`< 10ms`, zero data). Max `300` entries `{ n, c, ts }`; purges numeric/invalid names and re-evaluates generic `'Outros'`/`'Hortifruti'` categories.
3. **Minimal REST Request (`fetchJsonWithTimeout`):** Open Food Facts v2 with `?fields=product_name,product_name_pt,generic_name_pt,brands,categories_tags,quantity` (~1 KB). Timeout `6500ms` (`AbortController`); **1 retry (`1500ms`)** only on network/timeout/`5xx`. On `HTTP 404` / `status !== 1`, automatically falls back to **Open Products Facts** (`world.openproductsfacts.org/api/v2/product/{ean}.json`) for non-food supermarket items before falling back to local OCR.
4. **Quality Gate (`isValidApiProductName`):** Rejects numeric/EAN product names while preserving `categories_tags`/`quantity`; falls back cleanly to `origem: 'ocr_local'`.

---

## 5. Semantic Versioning & LGPD Diagnostic Telemetry

- **Single Source of Truth (`src/constants/appVersion.js`):** Exports `APP_VERSION` (`'1.0.8'`), `APP_BUILD_TAG`, and `APP_CHANGELOG` (PT-BR). Synced with `app.json` and `package.json`, consumed by `SobreScreen`, diagnostic headers, `.zip` bundles, and `scripts/build-apk.js`.
- **Voice Dictation Service (`src/services/voiceInputService.js`):** Verifies native binding availability (`globalThis.expo.modules` / `NativeModules` / `NativeModulesProxy`) before lazy-requiring `expo-speech-recognition` (`lang: 'pt-BR'`, `interimResults: true`, `continuous: false`), ensuring zero crashes and safe no-op `abortVoiceNameDictation()` in Expo Go. Diagnostic logs record only anonymous origin tags (`voice_name` / `Ditado por voz`)—never raw audio or PII.
- **Automated APK Build & Download (`scripts/build-apk.js`):** Cross-platform Node script (`fs`, `path`, `child_process`) invoked via `npm run build:apk`. Reads `expo.version` from `app.json` (fallback `appVersion.js`), ensures `builds/` exists, runs `npx eas-cli build -p android --profile preview --wait`, and downloads `./builds/minha-lista-compras-v<version>.apk`. Both `builds/` and `*.apk` are excluded in `.gitignore`.
- **LGPD-Compliant Telemetry (`src/services/diagnosticLogService.js`):**
  - **Allowed (anonymous, local-only):** `Platform.OS`, OS release, generic device brand/model, screen dimensions, `APP_VERSION`, `APP_BUILD_TAG`, `ErrorBoundary` crashes, API/OCR status/latency, and auto-vs-manual edit telemetry (`[CONFIRMAÇÃO ITEM]`, `[ADIÇÃO MANUAL]`).
  - **Strictly Prohibited:** PII (names, emails, accounts, IPs, GPS, contacts, IMEI, Android ID, ad IDs). Zero automatic background uploads; export (`.txt` or `diagnostico_completo_minha_lista_DD-MM-AAAA.zip`) is strictly user-initiated.

---

## 6. Domain Reuse Guide

1. **Reuse verbatim:** `appVersion.js` (reset to `1.0.0`), `diagnosticLogService.js` (change key prefix), `tagPhotoStorage.js` (rename folder if needed), `backupArchiveService.js` (update `BACKUP_APP_ID`).
2. **Swap domain storage:** Clone `shoppingStorage.js`, change `@mlc_offline:` prefix, keep settings/theme/onboarding/backup validation helpers, replace CRUD entities.
3. **Drop supermarket modules if unused:** `labelParser.js`, `labelOcr.*.js`, `tagPreprocess.js`, `NativeOcrBridge.*.js`, `categoryDictionary.js` are fully isolated.
