import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
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

async function ensureDir(dirPath) {
  if (!dirPath || Platform.OS === 'web') return;
  const dirInfo = await FileSystem.getInfoAsync(dirPath);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
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

function loadBrowserImage(uri) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível carregar a imagem selecionada.'));
    img.src = uri;
  });
}

function resizeBrowserImageToDataUri(img, maxWidth, quality) {
  const srcW = img.naturalWidth || img.width || maxWidth;
  const srcH = img.naturalHeight || img.height || maxWidth;
  const targetW = srcW > maxWidth ? maxWidth : srcW;
  const targetH = Math.max(1, Math.round((srcH * targetW) / Math.max(1, srcW)));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return canvas.toDataURL('image/jpeg', quality);
}

async function processPotholePhotoWeb(rawUri) {
  const baseId = `pothole_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const img = await loadBrowserImage(rawUri);
    const thumbUri = resizeBrowserImageToDataUri(img, 200, 0.6);
    const fullUri = resizeBrowserImageToDataUri(img, 1080, 0.85);
    const thumbBytes = estimateDataUriBytes(thumbUri);
    const fullBytes = estimateDataUriBytes(fullUri);

    await recordDiagnosticEvent('MIDIA', 'Foto otimizada via Canvas Web em dupla resolução', {
      thumbBytes,
      fullBytes,
    });

    return {
      id: baseId,
      thumbUri,
      fullUri,
      thumbBytes,
      fullBytes,
    };
  } finally {
    await deleteTempPhoto(rawUri);
  }
}

export async function processPotholePhoto(rawUri, options = {}) {
  if (!rawUri || typeof rawUri !== 'string') {
    throw new Error('Nenhuma imagem foi capturada para processamento.');
  }

  if (Platform.OS === 'web') {
    return processPotholePhotoWeb(rawUri);
  }

  await ensurePotholePhotosDir();

  const baseId = `pothole_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const thumbDest = `${POTHOLE_PHOTOS_DIR}${baseId}_thumb.jpg`;
  const fullDest = `${POTHOLE_PHOTOS_DIR}${baseId}_full.jpg`;

  const tempUrisToClean = new Set([rawUri]);
  let thumbMoved = false;
  let fullMoved = false;

  try {
    const thumbResult = await ImageManipulator.manipulateAsync(
      rawUri,
      [{ resize: { width: 200 } }],
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG }
    );
    if (thumbResult?.uri) {
      tempUrisToClean.add(thumbResult.uri);
      await moveOrCopyToDestination(thumbResult.uri, thumbDest);
      tempUrisToClean.delete(thumbResult.uri);
      thumbMoved = true;
    }

    const shouldResizeFull = !options.width || options.width > 1080;
    const fullActions = shouldResizeFull ? [{ resize: { width: 1080 } }] : [];
    const fullResult = await ImageManipulator.manipulateAsync(rawUri, fullActions, {
      compress: 0.85,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    if (fullResult?.uri) {
      tempUrisToClean.add(fullResult.uri);
      await moveOrCopyToDestination(fullResult.uri, fullDest);
      tempUrisToClean.delete(fullResult.uri);
      fullMoved = true;
    }

    const [thumbBytes, fullBytes] = await Promise.all([
      getSafeFileSize(thumbDest),
      getSafeFileSize(fullDest),
    ]);

    await recordDiagnosticEvent('MIDIA', 'Foto otimizada em dupla resolução', {
      thumbBytes,
      fullBytes,
    });

    return {
      id: baseId,
      thumbUri: thumbDest,
      fullUri: fullDest,
      thumbBytes,
      fullBytes,
    };
  } catch (error) {
    if (thumbMoved) await deleteTempPhoto(thumbDest);
    if (fullMoved) await deleteTempPhoto(fullDest);
    throw error;
  } finally {
    const cleanupTasks = Array.from(tempUrisToClean)
      .filter((uri) => uri !== thumbDest && uri !== fullDest)
      .map((uri) => deleteTempPhoto(uri));
    await Promise.all(cleanupTasks);
  }
}

/**
 * Adaptador local de armazenamento de mídia (Modo Demonstração / Offline).
 */
export const LocalPotholeMediaAdapter = {
  async uploadPhotoPair({ thumbUri, fullUri, isDemoSession = false }) {
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
  async uploadPhotoPair({ thumbUri, fullUri, isDemoSession = false }) {
    if (isDemoSession) {
      throw new Error('Modo Demonstração é somente leitura. Crie uma conta para enviar fotos.');
    }
    if (!thumbUri || !fullUri) {
      throw new Error('Arquivos de foto inválidos para envio à nuvem.');
    }

    const uuid = Crypto.randomUUID();
    const thumbStoragePath = `thumbs/${uuid}.jpg`;
    const fullStoragePath = `originals/${uuid}.jpg`;

    const [thumbBuffer, fullBuffer] = await Promise.all([
      uriToArrayBuffer(thumbUri),
      uriToArrayBuffer(fullUri),
    ]);

    const [thumbUpload, fullUpload] = await Promise.all([
      supabase.storage.from(SUPABASE_BUCKET).upload(thumbStoragePath, thumbBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      }),
      supabase.storage.from(SUPABASE_BUCKET).upload(fullStoragePath, fullBuffer, {
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
