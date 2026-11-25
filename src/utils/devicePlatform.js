import { Platform } from 'react-native';

/**
 * Detecta se o app está rodando em um navegador web genuinamente móvel
 * (smartphone/tablet com UA móvel + hardware touch-first).
 */
export function isMobileWebBrowser() {
  if (Platform.OS !== 'web') {
    return false;
  }
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return false;
  }

  const ua = String(navigator.userAgent || '');
  const isMobileUa =
    navigator.userAgentData?.mobile === true ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

  const hasCoarsePointer =
    typeof window.matchMedia === 'function' &&
    Boolean(window.matchMedia('(pointer: coarse)')?.matches);
  const hasTouchHardware = Number(navigator.maxTouchPoints) > 0 || hasCoarsePointer;

  return Boolean(isMobileUa && hasTouchHardware);
}

/**
 * Retorna true apenas em navegadores Web de computadores/notebooks (bloqueados para captura/upload).
 */
export function isDesktopWebBrowser() {
  return Platform.OS === 'web' && !isMobileWebBrowser();
}

/**
 * Retorna true no aplicativo nativo (Android/iOS) ou em navegadores móveis reais (câmera traseira).
 */
export function canCapturePotholePhotos() {
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    return true;
  }
  if (Platform.OS === 'web') {
    return isMobileWebBrowser();
  }
  return false;
}
