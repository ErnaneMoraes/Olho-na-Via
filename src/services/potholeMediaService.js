import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { canCapturePotholePhotos, isMobileWebBrowser } from '../utils/devicePlatform';
import { recordDiagnosticEvent } from './diagnosticLogService';
import { isSupabaseConfigured, supabase } from './supabaseClient';

export const POTHOLE_PHOTOS_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}pothole_photos/`
  : '';
export const POTHOLE_THUMB_CACHE_DIR = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}pothole_thumbs/`
  : '';
const SUPABASE_BUCKET = 'pothole-photos';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToArrayBuffer(base64) {
  const clean = String(base64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const byteLength = Math.floor((clean.length * 3) / 4) - padding;
  const bytes = new Uint8Array(Math.max(0, byteLength));

  let byteIdx = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = BASE64_CHARS.indexOf(clean[i]);
    const c2 = BASE64_CHARS.indexOf(clean[i + 1]);
    const c3 = BASE64_CHARS.indexOf(clean[i + 2]);
    const c4 = BASE64_CHARS.indexOf(clean[i + 3]);

    const triplet =
      ((c1 & 0x3f) << 18) |
      ((c2 & 0x3f) << 12) |
      (((c3 >= 0 ? c3 : 0) & 0x3f) << 6) |
      ((c4 >= 0 ? c4 : 0) & 0x3f);

    if (byteIdx < byteLength) bytes[byteIdx++] = (triplet >> 16) & 0xff;
    if (byteIdx < byteLength && clean[i + 2] !== '=') {
      bytes[byteIdx++] = (triplet >> 8) & 0xff;
    }
    if (byteIdx < byteLength && clean[i + 3] !== '=') {
      bytes[byteIdx++] = triplet & 0xff;
    }
  }
  return bytes.buffer;
}

function estimateDataUriBytes(dataUri) {
  const idx = String(dataUri || '').indexOf(',');
  if (idx < 0) return 0;
  const b64 = dataUri.slice(idx + 1);
  return Math.floor((b64.length * 3) / 4);
}

async function uriToArrayBuffer(uri) {
  if (!uri || typeof uri !== 'string') {
    throw new Error('URI de imagem inválida.');
  }
  if (uri.startsWith('data:')) {
    const commaIdx = uri.indexOf(',');
    const b64 = commaIdx >= 0 ? uri.slice(commaIdx + 1) : '';
    return base64ToArrayBuffer(b64);
  }
  if (Platform.OS === 'web' || uri.startsWith('blob:') || uri.startsWith('http')) {
    const res = await fetch(uri);
    return res.arrayBuffer();
  }
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  return base64ToArrayBuffer(base64);
}

function hashUrlForFilename(url) {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `thumb_${(hash >>> 0).toString(16)}.jpg`;
}

function stripDataUriPrefix(raw) {
  const str = String(raw || '');
  const idx = str.indexOf(',');
  return idx >= 0 && str.startsWith('data:') ? str.slice(idx + 1) : str;
}

async function ensureDir(dirPath) {
  if (!dirPath || Platform.OS === 'web') return;
  try {
    await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
  } catch {
    const dirInfo = await FileSystem.getInfoAsync(dirPath).catch(() => null);
    if (!dirInfo?.exists) {
      throw new Error('Não foi possível preparar o armazenamento local de fotos.');
    }
  }
}

export async function ensurePotholePhotosDir() {
  await ensureDir(POTHOLE_PHOTOS_DIR);
}

export async function deleteTempPhoto(uri) {
  if (!uri || typeof uri !== 'string') return;
  if (Platform.OS === 'web') {
    if (uri.startsWith('blob:') && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      try {
        URL.revokeObjectURL(uri);
      } catch {
        // Ignora erro ao revogar URL temporária
      }
    }
    return;
  }
  if (!uri.startsWith('file://')) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Limpeza idempotente de arquivo temporário
  }
}

export async function deletePotholePhotos(thumbUri, fullUri) {
  await Promise.all([deleteTempPhoto(thumbUri), deleteTempPhoto(fullUri)]);
}

/**
 * Baixa e armazena apenas miniaturas remotas em cache local para renderização rápida no mapa.
 * Na Web, delega diretamente ao cache nativo do navegador.
 */
export async function cacheRemoteThumbnail(remoteUrl) {
  if (!remoteUrl || typeof remoteUrl !== 'string' || !remoteUrl.startsWith('http')) {
    return remoteUrl || null;
  }
  if (Platform.OS === 'web' || !POTHOLE_THUMB_CACHE_DIR) {
    return remoteUrl;
  }

  try {
    await ensureDir(POTHOLE_THUMB_CACHE_DIR);
    const localTarget = `${POTHOLE_THUMB_CACHE_DIR}${hashUrlForFilename(remoteUrl)}`;
    const info = await FileSystem.getInfoAsync(localTarget);
    if (info.exists && typeof info.size === 'number' && info.size > 0) {
      return localTarget;
    }

    const download = await FileSystem.downloadAsync(remoteUrl, localTarget);
    return download?.status === 200 && download?.uri ? download.uri : remoteUrl;
  } catch {
    return remoteUrl;
  }
}

async function seedThumbnailCacheFromLocal(localThumbUri, remoteUrl) {
  if (Platform.OS === 'web' || !POTHOLE_THUMB_CACHE_DIR) return remoteUrl || localThumbUri;
  if (!localThumbUri || !remoteUrl || !remoteUrl.startsWith('http')) return localThumbUri;
  try {
    await ensureDir(POTHOLE_THUMB_CACHE_DIR);
    const localTarget = `${POTHOLE_THUMB_CACHE_DIR}${hashUrlForFilename(remoteUrl)}`;
    await FileSystem.copyAsync({ from: localThumbUri, to: localTarget });
    return localTarget;
  } catch {
    return remoteUrl;
  }
}

async function moveOrCopyToDestination(sourceUri, destinationUri) {
  try {
    await FileSystem.moveAsync({ from: sourceUri, to: destinationUri });
  } catch {
    await FileSystem.copyAsync({ from: sourceUri, to: destinationUri });
    await deleteTempPhoto(sourceUri);
  }
}

async function getSafeFileSize(uri) {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && typeof info.size === 'number' ? info.size : 0;
  } catch {
    return 0;
  }
}

async function persistBase64OrMove(base64Data, sourceUri, destinationUri) {
  await ensurePotholePhotosDir();
  if (base64Data) {
    const cleanB64 = stripDataUriPrefix(base64Data);
    try {
      await FileSystem.writeAsStringAsync(destinationUri, cleanB64, { encoding: 'base64' });
      return destinationUri;
    } catch {
      return `data:image/jpeg;base64,${cleanB64}`;
    }
  }
  await moveOrCopyToDestination(sourceUri, destinationUri);
  return destinationUri;
}

function loadBrowserImage(uri) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível carregar a foto capturada.'));
    img.src = uri;
  });
}

async function processPotholePhotoMobileWeb(rawUri, { redactionBars = [] } = {}) {
  if (!isMobileWebBrowser()) {
    throw new Error(
      'Registro exclusivo pelo celular. Abra o Olho na Via no navegador do seu smartphone ou no aplicativo Android.'
    );
  }

  const baseId = `pothole_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const img = await loadBrowserImage(rawUri);
    const srcW = img.naturalWidth || img.width || 1080;
    const srcH = img.naturalHeight || img.height || 720;
    const targetW = srcW > 1080 ? 1080 : srcW;
    const targetH = Math.max(1, Math.round((srcH * targetW) / Math.max(1, srcW)));

    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = targetW;
    fullCanvas.height = targetH;
    const fCtx = fullCanvas.getContext('2d');
    fCtx.drawImage(img, 0, 0, targetW, targetH);

    if (Array.isArray(redactionBars) && redactionBars.length > 0) {
      fCtx.fillStyle = '#111827';
      for (const bar of redactionBars) {
        fCtx.fillRect(
          Math.round(bar.x * targetW),
          Math.round(bar.y * targetH),
          Math.max(4, Math.round(bar.width * targetW)),
          Math.max(4, Math.round(bar.height * targetH))
        );
      }
    }

    const fullUri = fullCanvas.toDataURL('image/jpeg', 0.85);
    const fullBase64 = stripDataUriPrefix(fullUri);

    const thumbW = Math.min(200, targetW);
    const thumbH = Math.max(1, Math.round((targetH * thumbW) / Math.max(1, targetW)));
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbW;
    thumbCanvas.height = thumbH;
    const tCtx = thumbCanvas.getContext('2d');
    tCtx.drawImage(fullCanvas, 0, 0, thumbW, thumbH);
    const thumbUri = thumbCanvas.toDataURL('image/jpeg', 0.6);
    const thumbBase64 = stripDataUriPrefix(thumbUri);

    const thumbBytes = estimateDataUriBytes(thumbUri);
    const fullBytes = estimateDataUriBytes(fullUri);

    await recordDiagnosticEvent('MIDIA', 'Foto capturada no Mobile Web processada em Canvas', {
      thumbBytes,
      fullBytes,
      redactionsCount: Array.isArray(redactionBars) ? redactionBars.length : 0,
    });

    return {
      id: baseId,
      thumbUri,
      fullUri,
      thumbBase64,
      fullBase64,
      thumbBytes,
      fullBytes,
    };
  } finally {
    await deleteTempPhoto(rawUri);
  }
}

export async function saveProcessedPotholePhotoFromBase64({
  thumbBase64,
  fullBase64,
  rawUriToClean = null,
}) {
  if (!canCapturePotholePhotos()) {
    throw new Error(
      'Registro exclusivo pelo celular. Abra o Olho na Via no navegador do seu smartphone ou no aplicativo Android.'
    );
  }

  const cleanThumbB64 = stripDataUriPrefix(thumbBase64);
  const cleanFullB64 = stripDataUriPrefix(fullBase64);
  if (!cleanThumbB64 || !cleanFullB64) {
    throw new Error('Dados da foto revisada estão incompletos.');
  }

  const baseId = `pothole_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const thumbBytes = Math.floor((cleanThumbB64.length * 3) / 4);
  const fullBytes = Math.floor((cleanFullB64.length * 3) / 4);

  if (Platform.OS === 'web') {
    if (rawUriToClean) {
      await deleteTempPhoto(rawUriToClean);
    }
    return {
      id: baseId,
      thumbUri: `data:image/jpeg;base64,${cleanThumbB64}`,
      fullUri: `data:image/jpeg;base64,${cleanFullB64}`,
      thumbBase64: cleanThumbB64,
      fullBase64: cleanFullB64,
      thumbBytes,
      fullBytes,
    };
  }

  await ensurePotholePhotosDir();

  const thumbDest = `${POTHOLE_PHOTOS_DIR}${baseId}_thumb.jpg`;
  const fullDest = `${POTHOLE_PHOTOS_DIR}${baseId}_full.jpg`;

  let thumbUri = thumbDest;
  let fullUri = fullDest;

  try {
    await FileSystem.writeAsStringAsync(thumbDest, cleanThumbB64, { encoding: 'base64' });
  } catch {
    thumbUri = `data:image/jpeg;base64,${cleanThumbB64}`;
  }

  try {
    await FileSystem.writeAsStringAsync(fullDest, cleanFullB64, { encoding: 'base64' });
  } catch {
    fullUri = `data:image/jpeg;base64,${cleanFullB64}`;
  }

  if (rawUriToClean) {
    await deleteTempPhoto(rawUriToClean);
  }

  await recordDiagnosticEvent('MIDIA', 'Foto revisada e otimizada com base64 em memória', {
    thumbBytes,
    fullBytes,
  });

  return {
    id: baseId,
    thumbUri,
    fullUri,
    thumbBase64: cleanThumbB64,
    fullBase64: cleanFullB64,
    thumbBytes,
    fullBytes,
  };
}

export async function processPotholePhoto(rawUri, options = {}) {
  if (!canCapturePotholePhotos()) {
    throw new Error(
      'Registro exclusivo pelo celular. Abra o Olho na Via no navegador do seu smartphone ou no aplicativo Android.'
    );
  }
  if (!rawUri || typeof rawUri !== 'string') {
    throw new Error('Nenhuma imagem foi capturada para processamento.');
  }

  if (Platform.OS === 'web') {
    return processPotholePhotoMobileWeb(rawUri, options);
  }

  await ensurePotholePhotosDir();

  const baseId = `pothole_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const thumbDest = `${POTHOLE_PHOTOS_DIR}${baseId}_thumb.jpg`;
  const fullDest = `${POTHOLE_PHOTOS_DIR}${baseId}_full.jpg`;

  const tempUrisToClean = new Set([rawUri]);
  let finalThumbUri = thumbDest;
  let finalFullUri = fullDest;

  try {
    const thumbResult = await ImageManipulator.manipulateAsync(
      rawUri,
      [{ resize: { width: 200 } }],
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    if (thumbResult?.uri) {
      tempUrisToClean.add(thumbResult.uri);
    }
    finalThumbUri = await persistBase64OrMove(
      thumbResult?.base64,
      thumbResult?.uri,
      thumbDest
    );

    const shouldResizeFull = !options.width || options.width > 1080;
    const fullActions = shouldResizeFull ? [{ resize: { width: 1080 } }] : [];
    const fullResult = await ImageManipulator.manipulateAsync(rawUri, fullActions, {
      compress: 0.85,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    if (fullResult?.uri) {
      tempUrisToClean.add(fullResult.uri);
    }
    finalFullUri = await persistBase64OrMove(fullResult?.base64, fullResult?.uri, fullDest);

    const thumbBytes = thumbResult?.base64
      ? Math.floor((thumbResult.base64.length * 3) / 4)
      : await getSafeFileSize(finalThumbUri);
    const fullBytes = fullResult?.base64
      ? Math.floor((fullResult.base64.length * 3) / 4)
      : await getSafeFileSize(finalFullUri);

    await recordDiagnosticEvent('MIDIA', 'Foto otimizada em dupla resolução com base64', {
      thumbBytes,
      fullBytes,
    });

    return {
      id: baseId,
      thumbUri: finalThumbUri,
      fullUri: finalFullUri,
      thumbBase64: thumbResult?.base64 || null,
      fullBase64: fullResult?.base64 || null,
      thumbBytes,
      fullBytes,
    };
  } catch (error) {
    await deletePotholePhotos(finalThumbUri, finalFullUri);
    throw error;
  } finally {
    const cleanupTasks = Array.from(tempUrisToClean)
      .filter((uri) => uri !== finalThumbUri && uri !== finalFullUri)
      .map((uri) => deleteTempPhoto(uri));
    await Promise.all(cleanupTasks);
  }
}

/**
 * Adaptador local de armazenamento de mídia (Modo Demonstração / Offline).
 */
export const LocalPotholeMediaAdapter = {
  async uploadPhotoPair({ thumbUri, fullUri, isDemoSession = false }) {
    if (!canCapturePotholePhotos()) {
      throw new Error(
        'Registro exclusivo pelo celular. Abra o Olho na Via no navegador do seu smartphone ou no aplicativo Android.'
      );
    }
    if (isDemoSession) {
      throw new Error('Modo Demonstração é somente leitura. Crie uma conta para enviar fotos.');
    }
    return {
      thumbUri,
      cachedThumbUri: thumbUri,
      fullUri,
      isRemote: false,
    };
  },

  async removePhotoPair({ thumbUri, fullUri, isDemoSession = false }) {
    if (isDemoSession) {
      throw new Error('Modo Demonstração é somente leitura. Crie uma conta para remover fotos.');
    }
    await deletePotholePhotos(thumbUri, fullUri);
    return true;
  },
};

/**
 * Adaptador Supabase Storage enviando miniatura para thumbs/{uuid}.jpg
 * e foto original para originals/{uuid}.jpg no bucket pothole-photos.
 */
export const SupabasePotholeMediaAdapter = {
  async uploadPhotoPair({
    thumbUri,
    fullUri,
    thumbBase64 = null,
    fullBase64 = null,
    isDemoSession = false,
  }) {
    if (!canCapturePotholePhotos()) {
      throw new Error(
        'Registro exclusivo pelo celular. Abra o Olho na Via no navegador do seu smartphone ou no aplicativo Android.'
      );
    }
    if (isDemoSession) {
      throw new Error('Modo Demonstração é somente leitura. Crie uma conta para enviar fotos.');
    }
    if ((!thumbUri && !thumbBase64) || (!fullUri && !fullBase64)) {
      throw new Error('Arquivos de foto inválidos para envio à nuvem.');
    }

    const uuid = Crypto.randomUUID();
    const thumbStoragePath = `thumbs/${uuid}.jpg`;
    const fullStoragePath = `originals/${uuid}.jpg`;

    const [thumbBuffer, fullBuffer] = await Promise.all([
      thumbBase64 ? Promise.resolve(base64ToArrayBuffer(thumbBase64)) : uriToArrayBuffer(thumbUri),
      fullBase64 ? Promise.resolve(base64ToArrayBuffer(fullBase64)) : uriToArrayBuffer(fullUri),
    ]);

    const thumbUploadBody =
      Platform.OS === 'web' && typeof Blob !== 'undefined'
        ? new Blob([thumbBuffer], { type: 'image/jpeg' })
        : thumbBuffer;
    const fullUploadBody =
      Platform.OS === 'web' && typeof Blob !== 'undefined'
        ? new Blob([fullBuffer], { type: 'image/jpeg' })
        : fullBuffer;

    const [thumbUpload, fullUpload] = await Promise.all([
      supabase.storage.from(SUPABASE_BUCKET).upload(thumbStoragePath, thumbUploadBody, {
        contentType: 'image/jpeg',
        upsert: false,
      }),
      supabase.storage.from(SUPABASE_BUCKET).upload(fullStoragePath, fullUploadBody, {
        contentType: 'image/jpeg',
        upsert: false,
      }),
    ]);

    if (thumbUpload.error || fullUpload.error) {
      const pathsToRollback = [];
      if (!thumbUpload.error) pathsToRollback.push(thumbStoragePath);
      if (!fullUpload.error) pathsToRollback.push(fullStoragePath);
      if (pathsToRollback.length > 0) {
        await supabase.storage.from(SUPABASE_BUCKET).remove(pathsToRollback).catch(() => {});
      }
      const errMsg = thumbUpload.error?.message || fullUpload.error?.message || 'Erro no upload';
      throw new Error(`Falha ao enviar fotos para a nuvem: ${errMsg}`);
    }

    const thumbPublicUrl = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(thumbStoragePath)
      .data.publicUrl;
    const fullPublicUrl = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(fullStoragePath)
      .data.publicUrl;

    const cachedThumbUri = await seedThumbnailCacheFromLocal(thumbUri, thumbPublicUrl);
    await deletePotholePhotos(thumbUri, fullUri);

    await recordDiagnosticEvent('MIDIA', 'Par de fotos enviado ao Supabase Storage');

    return {
      thumbUri: thumbPublicUrl,
      cachedThumbUri,
      fullUri: fullPublicUrl,
      thumbStoragePath,
      fullStoragePath,
      isRemote: true,
    };
  },

  async removePhotoPair({
    thumbStoragePath,
    fullStoragePath,
    thumbUri,
    fullUri,
    isDemoSession = false,
  }) {
    if (isDemoSession) {
      throw new Error('Modo Demonstração é somente leitura. Crie uma conta para remover fotos.');
    }
    const remotePaths = [thumbStoragePath, fullStoragePath].filter(Boolean);
    if (remotePaths.length > 0 && supabase) {
      await supabase.storage.from(SUPABASE_BUCKET).remove(remotePaths).catch(() => {});
    }
    await deletePotholePhotos(thumbUri, fullUri);
    return true;
  },
};

export function createPotholeMediaStorage(adapter) {
  return {
    uploadPhotoPair: (payload) => adapter.uploadPhotoPair(payload),
    removePhotoPair: (payload) => adapter.removePhotoPair(payload),
  };
}

export const potholeMediaStorage = createPotholeMediaStorage(
  isSupabaseConfigured() ? SupabasePotholeMediaAdapter : LocalPotholeMediaAdapter
);
