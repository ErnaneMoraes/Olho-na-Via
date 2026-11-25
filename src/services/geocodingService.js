import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_VERSION } from '../constants/appVersion';
import { recordDiagnosticEvent } from './diagnosticLogService';

const GEOCODE_CACHE_KEY = '@olhonavia:geocode_cache';
const MAX_CACHE_ENTRIES = 100;
const REQUEST_TIMEOUT_MS = 6500;

const memoryCache = new Map();

function buildCacheKey(latitude, longitude) {
  return `${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)}`;
}

function buildFallbackAddress() {
  return {
    street: 'Via local próxima',
    neighborhood: 'Região detectada por GPS',
    city: 'Sua cidade',
    formattedAddress: 'Via local próxima — Região detectada por GPS',
    fromCache: false,
    isFallback: true,
  };
}

function parseNominatimAddress(data) {
  const addr = data?.address || {};
  const street =
    addr.road ||
    addr.pedestrian ||
    addr.residential ||
    addr.avenue ||
    addr.highway ||
    addr.suburb ||
    'Via não identificada';
  const neighborhood =
    addr.neighbourhood || addr.suburb || addr.quarter || addr.city_district || '';
  const city = addr.city || addr.town || addr.village || addr.municipality || '';

  const parts = [street, neighborhood, city].filter(Boolean);
  return {
    street,
    neighborhood: neighborhood || city || 'Bairro não informado',
    city: city || 'Cidade não informada',
    formattedAddress: parts.length ? parts.join(' — ') : 'Via localizada no mapa',
    fromCache: false,
    isFallback: false,
  };
}

async function readPersistentCache() {
  try {
    const raw = await AsyncStorage.getItem(GEOCODE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writePersistentCache(key, value) {
  try {
    const current = await readPersistentCache();
    const entries = Object.entries(current).filter(([k]) => k !== key);
    entries.unshift([key, { ...value, cachedAt: Date.now() }]);
    const trimmed = Object.fromEntries(entries.slice(0, MAX_CACHE_ENTRIES));
    await AsyncStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignora falha pontual de cache local
  }
}

export async function reverseGeocodeCoordinate(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return buildFallbackAddress();
  }

  const key = buildCacheKey(latitude, longitude);
  if (memoryCache.has(key)) {
    return { ...memoryCache.get(key), fromCache: true };
  }

  const persisted = await readPersistentCache();
  if (persisted[key]) {
    memoryCache.set(key, persisted[key]);
    return { ...persisted[key], fromCache: true };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}` +
      `&accept-language=pt-BR&addressdetails=1`;

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': `OlhoNaVia/${APP_VERSION} (Android; app-colaborativo)`,
      },
    });

    const elapsedMs = Date.now() - startedAt;

    if (!response.ok) {
      await recordDiagnosticEvent('GEOCODE', 'Nominatim retornou status não OK', {
        status: response.status,
        elapsedMs,
      });
      return buildFallbackAddress();
    }

    const json = await response.json();
    const resolved = parseNominatimAddress(json);
    memoryCache.set(key, resolved);
    await writePersistentCache(key, resolved);

    await recordDiagnosticEvent('GEOCODE', 'Endereço resolvido via Nominatim', {
      status: 200,
      elapsedMs,
    });
    return resolved;
  } catch {
    const elapsedMs = Date.now() - startedAt;
    await recordDiagnosticEvent('GEOCODE', 'Fallback offline/timeout na geocodificação', {
      elapsedMs,
    });
    return buildFallbackAddress();
  } finally {
    clearTimeout(timeoutId);
  }
}
