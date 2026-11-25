import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, Platform } from 'react-native';
import { APP_BUILD_TAG, APP_NAME, APP_VERSION } from '../constants/appVersion';

const DIAGNOSTIC_LOGS_KEY = '@olhonavia:diagnostic_logs';
const MAX_LOGS = 50;

const PII_KEY_PATTERN = /(email|e-mail|nick|apelido|name|nome|password|senha|lat|lon|lng|coord|address|endereco|ip|imei|androidid|token|session)/i;

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const safe = {};
  for (const [key, value] of Object.entries(meta)) {
    if (PII_KEY_PATTERN.test(key)) continue;
    if (typeof value === 'string') {
      safe[key] = value.slice(0, 140);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value;
    }
  }
  return safe;
}

export function getAnonymousDeviceContext() {
  const { width, height } = Dimensions.get('window');
  return {
    appName: APP_NAME,
    appVersion: APP_VERSION,
    buildTag: APP_BUILD_TAG,
    platform: Platform.OS,
    osVersion: String(Platform.Version ?? 'desconhecido'),
    screenWidth: Math.round(width),
    screenHeight: Math.round(height),
    lgpdMode: 'Estritamente anônimo e local (sem PII/GPS/IP)',
  };
}

async function appendLogEntry(entry) {
  try {
    const raw = await AsyncStorage.getItem(DIAGNOSTIC_LOGS_KEY);
    const current = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(current) ? current : [];
    const next = [entry, ...list].slice(0, MAX_LOGS);
    await AsyncStorage.setItem(DIAGNOSTIC_LOGS_KEY, JSON.stringify(next));
    return entry;
  } catch {
    return entry;
  }
}

export async function recordDiagnosticEvent(category, message, meta = {}) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    level: 'info',
    category: String(category || 'GERAL').slice(0, 32),
    message: String(message || '').slice(0, 200),
    meta: sanitizeMeta(meta),
  };
  return appendLogEntry(entry);
}

export async function recordAppErrorLog(source, error, meta = {}) {
  const errorMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Erro desconhecido';
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    level: 'error',
    category: String(source || 'APP_ERROR').slice(0, 32),
    message: String(errorMessage).slice(0, 220),
    meta: sanitizeMeta(meta),
  };
  return appendLogEntry(entry);
}

export async function getDiagnosticLogs() {
  try {
    const raw = await AsyncStorage.getItem(DIAGNOSTIC_LOGS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function clearDiagnosticLogs() {
  try {
    await AsyncStorage.removeItem(DIAGNOSTIC_LOGS_KEY);
    return true;
  } catch {
    return false;
  }
}

export function formatDiagnosticReportText(logs = []) {
  const ctx = getAnonymousDeviceContext();
  const header = [
    `=== Relatório de Diagnóstico Anônimo — ${ctx.appName} ===`,
    `Versão: v${ctx.appVersion} (${ctx.buildTag})`,
    `Plataforma: ${ctx.platform} (OS ${ctx.osVersion})`,
    `Tela: ${ctx.screenWidth}x${ctx.screenHeight}px`,
    `Privacidade: ${ctx.lgpdMode}`,
    `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
    `Total de eventos: ${logs.length}`,
    '================================================',
    '',
  ].join('\n');

  if (!logs.length) {
    return `${header}Nenhum evento registrado até o momento.`;
  }

  const lines = logs.map((item, idx) => {
    const metaText =
      item.meta && Object.keys(item.meta).length > 0 ? ` | ${JSON.stringify(item.meta)}` : '';
    return `${idx + 1}. [${item.level?.toUpperCase() || 'INFO'}] [${item.category}] ${item.timestamp} — ${item.message}${metaText}`;
  });

  return `${header}${lines.join('\n')}`;
}
