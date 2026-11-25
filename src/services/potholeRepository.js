import AsyncStorage from '@react-native-async-storage/async-storage';
import { canCapturePotholePhotos } from '../utils/devicePlatform';
import { recordDiagnosticEvent } from './diagnosticLogService';
import {
  fetchPendingReviewsSummaryByPotholeIds,
  hasUserPendingReviewForPothole,
  notifyRepairSubmitted,
} from './notificationService';
import {
  cacheRemoteThumbnail,
  deletePotholePhotos,
  potholeMediaStorage,
} from './potholeMediaService';
import { formatDateTimePtBr } from './potholeSeedService';
import { isSupabaseConfigured, supabase } from './supabaseClient';

const REPORTS_STORAGE_KEY = '@olhonavia:reports';
const SEED_UPDATES_STORAGE_KEY = '@olhonavia:seed_updates';
const VISITOR_DEVICE_ID_KEY = '@olhonavia:visitor_device_id';

let cachedVisitorDeviceId = null;

function generateRandomVisitorUuid() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fallback para ambientes sem crypto.randomUUID
  }
  const part = () => Math.random().toString(36).slice(2, 10);
  return `v_${Date.now().toString(36)}_${part()}_${part()}`;
}

export async function getOrCreateVisitorDeviceId() {
  if (cachedVisitorDeviceId) {
    return cachedVisitorDeviceId;
  }

  try {
    const existing = await AsyncStorage.getItem(VISITOR_DEVICE_ID_KEY);
    if (existing && existing.trim()) {
      cachedVisitorDeviceId = existing.trim();
      return cachedVisitorDeviceId;
    }
  } catch {
    // Segue para gerar identificador em memória/storage
  }

  const created = generateRandomVisitorUuid();
  cachedVisitorDeviceId = created;
  try {
    await AsyncStorage.setItem(VISITOR_DEVICE_ID_KEY, created);
  } catch {
    // Ignora falha pontual de escrita
  }
  return created;
}

export async function recordUniquePotholeView(potholeId) {
  const idStr = String(potholeId || '').trim();
  if (
    !idStr ||
    !isSupabaseConfigured() ||
    idStr.startsWith('seed-') ||
    idStr.startsWith('rep_')
  ) {
    return null;
  }

  try {
    const visitorId = await getOrCreateVisitorDeviceId();
    const { data, error } = await supabase.rpc('record_pothole_view', {
      p_pothole_id: idStr,
      p_visitor_id: visitorId,
    });

    if (error || data === null || data === undefined) {
      return null;
    }

    const parsed = Number(data);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function createRepositoryError(message) {
  const err = new Error(message);
  err.isRepositoryError = true;
  return err;
}

function assertNotDemoSession(isDemoSession) {
  if (isDemoSession) {
    throw createRepositoryError(
      'Modo Demonstração é somente leitura. Crie uma conta gratuita ou faça login para registrar ou atualizar ocorrências.'
    );
  }
}

function assertMobilePlatform() {
  if (!canCapturePotholePhotos()) {
    throw createRepositoryError(
      'Registro exclusivo pelo celular. Abra o Olho na Via no navegador do seu smartphone ou no aplicativo Android.'
    );
  }
}

async function readSeedOverrides() {
  try {
    const raw = await AsyncStorage.getItem(SEED_UPDATES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function cleanupReportAllPhotos(report) {
  if (!report) return;
  const tasks = [deletePotholePhotos(report.thumbUri, report.fullUri)];
  if (Array.isArray(report.verifications)) {
    for (const entry of report.verifications) {
      tasks.push(deletePotholePhotos(entry.thumbUri, entry.fullUri));
    }
  }
  await Promise.all(tasks);
}

function maskPotholeForDemo(item) {
  if (!item) return item;
  const maskedVerifications = Array.isArray(item.verifications)
    ? item.verifications.map((v) => ({
        ...v,
        authorNickname: 'Cidadão (oculto)',
        authorUserId: null,
        isAnonymous: true,
      }))
    : [];

  return {
    ...item,
    authorNickname: 'Cidadão (oculto)',
    authorUserId: null,
    isAnonymous: true,
    verifications: maskedVerifications,
  };
}

async function mapCloudVerificationRow(row) {
  const cachedThumb = await cacheRemoteThumbnail(row.thumb_url);
  const isAnon = Boolean(row.is_anonymous);
  return {
    id: row.id,
    status: row.status === 'fixed' ? 'fixed' : 'open',
    statusLabel: row.status === 'fixed' ? 'Já foi Tampado' : 'Continua Aberto',
    note: row.note || '',
    isAnonymous: isAnon,
    authorNickname: isAnon ? 'Usuário Anônimo' : row.author_nickname || 'Cidadão',
    authorUserId: row.user_id || null,
    thumbUri: cachedThumb,
    remoteThumbUrl: row.thumb_url || null,
    fullUri: row.full_url || null,
    createdAt: formatDateTimePtBr(row.created_at),
    createdAtIso: row.created_at,
  };
}

async function mapCloudPotholeRow(
  row,
  updates = [],
  cachedThumbOverride = null,
  pendingSummary = null
) {
  const isAnon = Boolean(row.is_anonymous);
  const isFixed = row.status === 'fixed';
  const cachedThumb = cachedThumbOverride || (await cacheRemoteThumbnail(row.thumb_url));
  const pendingCount = isFixed ? 0 : Number(pendingSummary?.count) || 0;
  const pendingUpdateIds = isFixed
    ? []
    : Array.isArray(pendingSummary?.updateIds)
      ? pendingSummary.updateIds
      : [];

  return {
    id: row.id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    streetAddress: row.street_address || 'Via localizada por GPS',
    streetHint: row.street_address || 'Via localizada por GPS',
    comment: row.comment || '',
    status: isFixed ? 'fixed' : 'open',
    statusLabel: isFixed ? 'Tampado' : 'Aberto',
    isAnonymous: isAnon,
    authorNickname: isAnon ? 'Usuário Anônimo' : row.author_nickname || 'Cidadão',
    authorUserId: row.user_id || null,
    thumbUri: cachedThumb,
    remoteThumbUrl: row.thumb_url || null,
    fullUri: row.full_url || null,
    createdAt: formatDateTimePtBr(row.created_at),
    createdAtIso: row.created_at,
    confirmations: Number(row.confirmations) || 1,
    viewCount: Number(row.view_count ?? 0),
    pendingReviewCount: pendingCount,
    pendingReviewUpdateIds: pendingUpdateIds,
    verifications: updates,
    isCloudReport: true,
  };
}

/**
 * Adaptador local em AsyncStorage (usado em Modo Demonstração e fallback offline).
 */
export const LocalAsyncStoragePotholeAdapter = {
  async listReports() {
    try {
      const raw = await AsyncStorage.getItem(REPORTS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  async applySeedOverrides(seedList = []) {
    const overrides = await readSeedOverrides();
    return seedList.map((seed) => {
      const override = overrides[seed.id];
      if (!override) return seed;
      return {
        ...seed,
        ...override,
        verifications: Array.isArray(override.verifications)
          ? override.verifications
          : seed.verifications || [],
      };
    });
  },

  async createReport({
    latitude,
    longitude,
    streetAddress,
    comment,
    isAnonymous,
    authorNickname,
    authorUserId,
    thumbUri,
    fullUri,
    isDemoSession = false,
  }) {
    assertNotDemoSession(isDemoSession);
    assertMobilePlatform();
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw createRepositoryError('Coordenadas GPS inválidas para registrar o relato.');
    }

    const cleanComment = String(comment || '').trim();

    if (!thumbUri || !fullUri) {
      throw createRepositoryError('A foto do buraco é obrigatória para publicar o relato.');
    }

    const now = new Date();
    const anonymousFlag = Boolean(isAnonymous);
    const cleanStreet = String(streetAddress || '').trim() || 'Via localizada por GPS';

    const newReport = {
      id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      latitude,
      longitude,
      streetAddress: cleanStreet,
      streetHint: cleanStreet,
      comment: cleanComment,
      status: 'open',
      statusLabel: 'Aberto',
      isAnonymous: anonymousFlag,
      authorNickname: anonymousFlag
        ? 'Usuário Anônimo'
        : String(authorNickname || 'Cidadão').trim(),
      authorUserId: authorUserId || null,
      thumbUri,
      fullUri,
      createdAt: formatDateTimePtBr(now),
      createdAtIso: now.toISOString(),
      confirmations: 1,
      viewCount: 0,
      verifications: [],
      isLocalUserReport: true,
    };

    const current = await this.listReports();
    const next = [newReport, ...current];
    await AsyncStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(next));

    await recordDiagnosticEvent('RELATO', 'Novo relato publicado localmente', {
      isAnonymous: anonymousFlag,
      hasPhoto: Boolean(thumbUri),
    });

    return newReport;
  },

  async addVerification(
    potholeId,
    {
      nextStatus,
      note,
      isAnonymous,
      authorNickname,
      authorUserId,
      thumbUri,
      fullUri,
      currentPothole,
      isDemoSession = false,
    }
  ) {
    assertNotDemoSession(isDemoSession);
    assertMobilePlatform();
    if (nextStatus !== 'open' && nextStatus !== 'fixed') {
      throw createRepositoryError('Status de verificação inválido.');
    }
    if (!thumbUri || !fullUri) {
      throw createRepositoryError('Uma foto atualizada é obrigatória para verificar a via.');
    }

    const now = new Date();
    const anonymousFlag = Boolean(isAnonymous);
    const cleanNote = String(note || '').trim();

    const verificationEntry = {
      id: `ver_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: nextStatus,
      statusLabel: nextStatus === 'fixed' ? 'Já foi Tampado' : 'Continua Aberto',
      note: cleanNote,
      isAnonymous: anonymousFlag,
      authorNickname: anonymousFlag
        ? 'Usuário Anônimo'
        : String(authorNickname || 'Cidadão').trim(),
      authorUserId: authorUserId || null,
      thumbUri,
      fullUri,
      createdAt: formatDateTimePtBr(now),
      createdAtIso: now.toISOString(),
    };

    const nextStatusLabel = nextStatus === 'fixed' ? 'Tampado' : 'Aberto';
    const currentReports = await this.listReports();
    const reportIndex = currentReports.findIndex((item) => item.id === potholeId);

    let updatedPothole = null;

    if (reportIndex >= 0) {
      const target = currentReports[reportIndex];
      const existingVerifications = Array.isArray(target.verifications)
        ? target.verifications
        : [];
      updatedPothole = {
        ...target,
        status: nextStatus,
        statusLabel: nextStatusLabel,
        thumbUri,
        fullUri,
        confirmations: (target.confirmations || 1) + 1,
        verifications: [verificationEntry, ...existingVerifications],
      };
      const nextReports = [...currentReports];
      nextReports[reportIndex] = updatedPothole;
      await AsyncStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(nextReports));
    } else {
      const overrides = await readSeedOverrides();
      const baseSeed = currentPothole || { id: potholeId, verifications: [], confirmations: 1 };
      const prevOverride = overrides[potholeId] || {};
      const existingVerifications = Array.isArray(prevOverride.verifications)
        ? prevOverride.verifications
        : Array.isArray(baseSeed.verifications)
          ? baseSeed.verifications
          : [];
      const prevConfirmations =
        typeof prevOverride.confirmations === 'number'
          ? prevOverride.confirmations
          : baseSeed.confirmations || 1;

      const patch = {
        status: nextStatus,
        statusLabel: nextStatusLabel,
        thumbUri,
        fullUri,
        confirmations: prevConfirmations + 1,
        verifications: [verificationEntry, ...existingVerifications],
      };

      const nextOverrides = { ...overrides, [potholeId]: patch };
      await AsyncStorage.setItem(SEED_UPDATES_STORAGE_KEY, JSON.stringify(nextOverrides));
      updatedPothole = { ...baseSeed, ...patch };
    }

    await recordDiagnosticEvent('VERIFICACAO', 'Status da via atualizado pela comunidade', {
      nextStatus,
      isAnonymous: anonymousFlag,
      hasNote: Boolean(cleanNote),
    });

    return updatedPothole;
  },

  async getReportById(potholeId) {
    const current = await this.listReports();
    return current.find((item) => item.id === potholeId) || null;
  },

  async deleteReport(id, { isDemoSession = false } = {}) {
    assertNotDemoSession(isDemoSession);
    const current = await this.listReports();
    const target = current.find((item) => item.id === id);
    const next = current.filter((item) => item.id !== id);
    await AsyncStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(next));
    if (target) {
      await cleanupReportAllPhotos(target);
    }
    return true;
  },

  async clearAllReports({ isDemoSession = false } = {}) {
    assertNotDemoSession(isDemoSession);
    const [current, overrides] = await Promise.all([this.listReports(), readSeedOverrides()]);
    await Promise.all([
      AsyncStorage.removeItem(REPORTS_STORAGE_KEY),
      AsyncStorage.removeItem(SEED_UPDATES_STORAGE_KEY),
    ]);
    await Promise.all([
      ...current.map((item) => cleanupReportAllPhotos(item)),
      ...Object.values(overrides).map((item) => cleanupReportAllPhotos(item)),
    ]);
    return true;
  },
};

/**
 * Adaptador Supabase em nuvem com filtro geográfico por bounding box,
 * anonimato LGPD estrito (user_id: null e author_nickname: null) e cache exclusivo de miniaturas.
 */
export const SupabasePotholeAdapter = {
  async applySeedOverrides(seedList = []) {
    return LocalAsyncStoragePotholeAdapter.applySeedOverrides(seedList);
  },

  async listReports({ bounds, isDemoSession = false } = {}) {
    if (!isSupabaseConfigured()) {
      const local = await LocalAsyncStoragePotholeAdapter.listReports();
      return isDemoSession ? local.map(maskPotholeForDemo) : local;
    }

    try {
      let query = supabase
        .from('potholes')
        .select(
          'id, user_id, author_nickname, is_anonymous, latitude, longitude, street_address, comment, status, thumb_url, full_url, confirmations, view_count, created_at'
        )
        .order('created_at', { ascending: false })
        .limit(150);

      if (
        bounds &&
        Number.isFinite(bounds.minLat) &&
        Number.isFinite(bounds.maxLat) &&
        Number.isFinite(bounds.minLng) &&
        Number.isFinite(bounds.maxLng)
      ) {
        query = query
          .gte('latitude', bounds.minLat)
          .lte('latitude', bounds.maxLat)
          .gte('longitude', bounds.minLng)
          .lte('longitude', bounds.maxLng);
      }

      const { data: rows, error } = await query;
      if (error) {
        throw error;
      }

      const potholeRows = Array.isArray(rows) ? rows : [];
      if (potholeRows.length === 0) {
        return [];
      }

      const ids = potholeRows.map((r) => r.id);
      const [{ data: updateRows }, pendingByPothole] = await Promise.all([
        supabase
          .from('pothole_updates')
          .select(
            'id, pothole_id, user_id, author_nickname, is_anonymous, status, note, thumb_url, full_url, created_at'
          )
          .in('pothole_id', ids)
          .order('created_at', { ascending: false }),
        fetchPendingReviewsSummaryByPotholeIds(ids),
      ]);

      const updatesByPothole = {};
      if (Array.isArray(updateRows)) {
        const mappedUpdates = await Promise.all(
          updateRows.map(async (u) => ({
            potholeId: u.pothole_id,
            mapped: await mapCloudVerificationRow(u),
          }))
        );
        for (const item of mappedUpdates) {
          if (!updatesByPothole[item.potholeId]) {
            updatesByPothole[item.potholeId] = [];
          }
          updatesByPothole[item.potholeId].push(item.mapped);
        }
      }

      const mappedPotholes = await Promise.all(
        potholeRows.map((row) =>
          mapCloudPotholeRow(
            row,
            updatesByPothole[row.id] || [],
            null,
            pendingByPothole[row.id] || null
          )
        )
      );

      await recordDiagnosticEvent('SYNC', 'Ocorrências sincronizadas da nuvem', {
        count: mappedPotholes.length,
        maskedForDemo: Boolean(isDemoSession),
      });

      return isDemoSession ? mappedPotholes.map(maskPotholeForDemo) : mappedPotholes;
    } catch {
      await recordDiagnosticEvent('SYNC_FALLBACK', 'Falha de rede; usando cache local');
      const fallback = await LocalAsyncStoragePotholeAdapter.listReports();
      return isDemoSession ? fallback.map(maskPotholeForDemo) : fallback;
    }
  },

  async createReport(payload) {
    assertNotDemoSession(payload?.isDemoSession);
    assertMobilePlatform();
    if (!isSupabaseConfigured()) {
      return LocalAsyncStoragePotholeAdapter.createReport(payload);
    }

    const {
      latitude,
      longitude,
      streetAddress,
      comment,
      isAnonymous,
      authorNickname,
      thumbUri,
      fullUri,
      thumbBase64,
      fullBase64,
    } = payload;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw createRepositoryError('Coordenadas GPS inválidas para registrar o relato.');
    }

    const cleanComment = String(comment || '').trim();

    if (!thumbUri && !thumbBase64) {
      throw createRepositoryError('A foto do buraco é obrigatória para publicar o relato.');
    }

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    const activeUserId = authData?.user?.id || null;
    if (authErr || !activeUserId) {
      throw createRepositoryError(
        'Sessão expirada ou conta não autenticada. Entre novamente para publicar.'
      );
    }

    const anonymousFlag = Boolean(isAnonymous);
    const cleanStreet = String(streetAddress || '').trim() || 'Via localizada por GPS';
    const cleanNickname = String(authorNickname || 'Cidadão').trim();

    const uploaded = await potholeMediaStorage.uploadPhotoPair({
      thumbUri,
      fullUri,
      thumbBase64,
      fullBase64,
      isDemoSession: Boolean(payload?.isDemoSession),
    });

    // Exibe "Usuário Anônimo" ao público preservando user_id ativo (auth.uid()) para RLS e moderação
    const insertPayload = {
      user_id: activeUserId,
      author_nickname: anonymousFlag ? 'Usuário Anônimo' : cleanNickname,
      is_anonymous: anonymousFlag,
      latitude,
      longitude,
      street_address: cleanStreet,
      comment: cleanComment,
      status: 'open',
      thumb_url: uploaded.thumbUri,
      full_url: uploaded.fullUri,
      confirmations: 1,
    };

    const { data, error } = await supabase
      .from('potholes')
      .insert(insertPayload)
      .select(
        'id, user_id, author_nickname, is_anonymous, latitude, longitude, street_address, comment, status, thumb_url, full_url, confirmations, view_count, created_at'
      )
      .single();

    if (error || !data) {
      await potholeMediaStorage.removePhotoPair(uploaded).catch(() => {});
      throw createRepositoryError(
        error?.message || 'Não foi possível salvar o relato na nuvem.'
      );
    }

    await recordDiagnosticEvent('RELATO', 'Novo relato publicado no Supabase', {
      isAnonymous: anonymousFlag,
    });

    return mapCloudPotholeRow(data, [], uploaded.cachedThumbUri);
  },

  async addVerification(potholeId, payload) {
    assertNotDemoSession(payload?.isDemoSession);
    assertMobilePlatform();
    const idStr = String(potholeId || '');
    if (
      !isSupabaseConfigured() ||
      idStr.startsWith('seed-') ||
      idStr.startsWith('rep_')
    ) {
      return LocalAsyncStoragePotholeAdapter.addVerification(potholeId, payload);
    }

    const {
      nextStatus,
      note,
      isAnonymous,
      authorNickname,
      thumbUri,
      fullUri,
      thumbBase64,
      fullBase64,
      currentPothole,
    } = payload;

    if (nextStatus !== 'open' && nextStatus !== 'fixed') {
      throw createRepositoryError('Status de verificação inválido.');
    }
    if ((!thumbUri && !thumbBase64) || (!fullUri && !fullBase64)) {
      throw createRepositoryError('Uma foto atualizada é obrigatória para verificar a via.');
    }

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    const activeUserId = authData?.user?.id || null;
    if (authErr || !activeUserId) {
      throw createRepositoryError(
        'Sessão expirada ou conta não autenticada. Entre novamente para verificar.'
      );
    }

    const anonymousFlag = Boolean(isAnonymous);
    const cleanNote = String(note || '').trim();
    const cleanNickname = String(authorNickname || 'Cidadão').trim();

    const { data: dbPothole } = await supabase
      .from('potholes')
      .select('id, user_id, status, street_address')
      .eq('id', potholeId)
      .maybeSingle();

    const ownerUserId = dbPothole?.user_id || currentPothole?.authorUserId || null;
    const isOtherUserSuggestingFix =
      nextStatus === 'fixed' &&
      Boolean(ownerUserId) &&
      ownerUserId !== activeUserId;

    if (isOtherUserSuggestingFix) {
      const alreadyPending = await hasUserPendingReviewForPothole(activeUserId, potholeId);
      if (alreadyPending) {
        throw createRepositoryError(
          'Você já enviou uma revisão de correção para este local. Aguarde a avaliação do autor original.'
        );
      }
    }

    const uploaded = await potholeMediaStorage.uploadPhotoPair({
      thumbUri,
      fullUri,
      thumbBase64,
      fullBase64,
      isDemoSession: Boolean(payload?.isDemoSession),
    });

    // Exibe "Usuário Anônimo" ao público preservando user_id ativo (auth.uid()) para RLS e moderação
    const updateInsertPayload = {
      pothole_id: potholeId,
      user_id: activeUserId,
      author_nickname: anonymousFlag ? 'Usuário Anônimo' : cleanNickname,
      is_anonymous: anonymousFlag,
      status: nextStatus,
      note: cleanNote,
      thumb_url: uploaded.thumbUri,
      full_url: uploaded.fullUri,
    };

    const { data: insertedUpdate, error: insertError } = await supabase
      .from('pothole_updates')
      .insert(updateInsertPayload)
      .select(
        'id, pothole_id, user_id, author_nickname, is_anonymous, status, note, thumb_url, full_url, created_at'
      )
      .single();

    if (insertError || !insertedUpdate) {
      await potholeMediaStorage.removePhotoPair(uploaded).catch(() => {});
      throw createRepositoryError(
        insertError?.message || 'Não foi possível registrar a verificação na nuvem.'
      );
    }

    const persistedPotholeStatus = isOtherUserSuggestingFix ? 'open' : nextStatus;

    const nextConfirmations = (currentPothole?.confirmations || 1) + 1;
    const potholeUpdateFields = isOtherUserSuggestingFix
      ? {
          status: 'open',
          confirmations: nextConfirmations,
        }
      : {
          status: persistedPotholeStatus,
          thumb_url: uploaded.thumbUri,
          full_url: uploaded.fullUri,
          confirmations: nextConfirmations,
        };

    const { data: updatedRow, error: patchError } = await supabase
      .from('potholes')
      .update(potholeUpdateFields)
      .eq('id', potholeId)
      .select(
        'id, user_id, author_nickname, is_anonymous, latitude, longitude, street_address, comment, status, thumb_url, full_url, confirmations, view_count, created_at'
      )
      .single();

    if (patchError || !updatedRow) {
      throw createRepositoryError(
        patchError?.message || 'Verificação salva, mas houve falha ao atualizar o pino.'
      );
    }

    const mappedEntry = await mapCloudVerificationRow({
      ...insertedUpdate,
      thumb_url: uploaded.thumbUri,
    });
    mappedEntry.thumbUri = uploaded.cachedThumbUri || mappedEntry.thumbUri;

    const previousVerifications = Array.isArray(currentPothole?.verifications)
      ? currentPothole.verifications
      : [];

    await recordDiagnosticEvent('VERIFICACAO', 'Verificação publicada no Supabase', {
      nextStatus,
      persistedPotholeStatus,
      pendingAuthorApproval: isOtherUserSuggestingFix,
      isAnonymous: anonymousFlag,
    });

    if (isOtherUserSuggestingFix) {
      await notifyRepairSubmitted({
        pothole: {
          ...updatedRow,
          authorUserId: ownerUserId,
          streetAddress:
            updatedRow.street_address ||
            dbPothole?.street_address ||
            currentPothole?.streetAddress ||
            '',
        },
        updateId: insertedUpdate.id,
        actorUserId: activeUserId,
      });
    }

    const fetchedSummaryMap = await fetchPendingReviewsSummaryByPotholeIds([potholeId]);
    let pendingSummary = fetchedSummaryMap[potholeId] || null;
    if (isOtherUserSuggestingFix && (!pendingSummary || pendingSummary.count === 0)) {
      const prevIds = Array.isArray(currentPothole?.pendingReviewUpdateIds)
        ? currentPothole.pendingReviewUpdateIds
        : [];
      pendingSummary = {
        count: (Number(currentPothole?.pendingReviewCount) || 0) + 1,
        updateIds: [...prevIds, insertedUpdate.id],
      };
    }

    return mapCloudPotholeRow(
      updatedRow,
      [mappedEntry, ...previousVerifications],
      uploaded.cachedThumbUri,
      pendingSummary
    );
  },

  async getReportById(potholeId, { isDemoSession = false } = {}) {
    if (!potholeId) return null;
    if (!isSupabaseConfigured()) {
      const localItem = await LocalAsyncStoragePotholeAdapter.getReportById(potholeId);
      return isDemoSession ? maskPotholeForDemo(localItem) : localItem;
    }

    try {
      const { data: row, error } = await supabase
        .from('potholes')
        .select(
          'id, user_id, author_nickname, is_anonymous, latitude, longitude, street_address, comment, status, thumb_url, full_url, confirmations, view_count, created_at'
        )
        .eq('id', potholeId)
        .single();

      if (error || !row) {
        const localItem = await LocalAsyncStoragePotholeAdapter.getReportById(potholeId);
        return isDemoSession ? maskPotholeForDemo(localItem) : localItem;
      }

      const [{ data: updateRows }, pendingByPothole] = await Promise.all([
        supabase
          .from('pothole_updates')
          .select(
            'id, pothole_id, user_id, author_nickname, is_anonymous, status, note, thumb_url, full_url, created_at'
          )
          .eq('pothole_id', potholeId)
          .order('created_at', { ascending: false }),
        fetchPendingReviewsSummaryByPotholeIds([potholeId]),
      ]);

      const mappedUpdates = Array.isArray(updateRows)
        ? await Promise.all(updateRows.map((u) => mapCloudVerificationRow(u)))
        : [];

      const mapped = await mapCloudPotholeRow(
        row,
        mappedUpdates,
        null,
        pendingByPothole[row.id] || null
      );
      return isDemoSession ? maskPotholeForDemo(mapped) : mapped;
    } catch {
      const localItem = await LocalAsyncStoragePotholeAdapter.getReportById(potholeId);
      return isDemoSession ? maskPotholeForDemo(localItem) : localItem;
    }
  },

  async deleteReport(id, options = {}) {
    assertNotDemoSession(options?.isDemoSession);
    return LocalAsyncStoragePotholeAdapter.deleteReport(id, options);
  },

  async clearAllReports(options = {}) {
    assertNotDemoSession(options?.isDemoSession);
    return LocalAsyncStoragePotholeAdapter.clearAllReports(options);
  },
};

export function createPotholeRepository(adapter) {
  return {
    listReports: (options) => adapter.listReports(options),
    getReportById: (potholeId, options) => adapter.getReportById(potholeId, options),
    recordUniqueView: (potholeId) => recordUniquePotholeView(potholeId),
    applySeedOverrides: (seedList) => adapter.applySeedOverrides(seedList),
    createReport: (payload) => adapter.createReport(payload),
    createPothole: (payload) => adapter.createReport(payload),
    addVerification: (potholeId, payload) => adapter.addVerification(potholeId, payload),
    addPotholeUpdate: (potholeId, payload) => adapter.addVerification(potholeId, payload),
    updatePotholeStatus: (potholeId, payload) => adapter.addVerification(potholeId, payload),
    deleteReport: (id, options) => adapter.deleteReport(id, options),
    clearAllReports: (options) => adapter.clearAllReports(options),
  };
}

export const potholeRepository = createPotholeRepository(
  isSupabaseConfigured() ? SupabasePotholeAdapter : LocalAsyncStoragePotholeAdapter
);
