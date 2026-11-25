import { recordAppErrorLog, recordDiagnosticEvent } from './diagnosticLogService';
import { formatDateTimePtBr } from './potholeSeedService';
import { isSupabaseConfigured, supabase } from './supabaseClient';

/**
 * Notifica o autor original de um relato quando outro usuário informa que o buraco foi tampado.
 */
export async function notifyRepairSubmitted({ pothole, updateId = null, actorUserId = null }) {
  if (!isSupabaseConfigured() || !pothole?.id || !actorUserId) {
    return false;
  }

  const recipientUserId = pothole.authorUserId || pothole.user_id || null;
  if (!recipientUserId || recipientUserId === actorUserId) {
    return false;
  }

  const street =
    String(
      pothole.streetAddress || pothole.street_address || pothole.streetHint || ''
    ).trim() || 'via localizada por GPS';

  try {
    const { error } = await supabase.from('user_notifications').insert({
      recipient_user_id: recipientUserId,
      actor_user_id: actorUserId,
      pothole_id: pothole.id,
      pothole_update_id: updateId || null,
      type: 'repair_review_requested',
      title: 'Correção informada no seu relato',
      body: `Alguém informou que o buraco em ${street} foi tampado. Toque para avaliar e confirmar.`,
      is_read: false,
      review_decision: null,
    });

    if (error) {
      await recordAppErrorLog('notificationService.notifyRepairSubmitted', error);
      return false;
    }

    await recordDiagnosticEvent('NOTIFICACAO', 'Notificação de correção enviada ao autor', {
      potholeId: pothole.id,
    });
    return true;
  } catch (err) {
    await recordAppErrorLog('notificationService.notifyRepairSubmitted', err);
    return false;
  }
}

/**
 * Busca notificações não lidas do usuário autenticado.
 */
export async function fetchUnreadNotifications(userId) {
  if (!isSupabaseConfigured() || !userId) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('user_notifications')
      .select(
        'id, recipient_user_id, actor_user_id, pothole_id, pothole_update_id, type, title, body, is_read, review_decision, created_at'
      )
      .eq('recipient_user_id', userId)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error || !Array.isArray(data)) {
      return [];
    }

    return data.map((row) => ({
      ...row,
      createdAtFormatted: formatDateTimePtBr(row.created_at),
    }));
  } catch {
    return [];
  }
}

/**
 * Busca revisões de correção pendentes (review_decision IS NULL) para o autor autenticado.
 */
export async function fetchPendingRepairReviews(userId) {
  if (!isSupabaseConfigured() || !userId) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('user_notifications')
      .select(
        'id, recipient_user_id, actor_user_id, pothole_id, pothole_update_id, type, title, body, is_read, review_decision, created_at'
      )
      .eq('recipient_user_id', userId)
      .eq('type', 'repair_review_requested')
      .is('review_decision', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !Array.isArray(data)) {
      return [];
    }

    return data.map((row) => ({
      ...row,
      createdAtFormatted: formatDateTimePtBr(row.created_at),
    }));
  } catch {
    return [];
  }
}

/**
 * Busca todas as revisões de correção pendentes (review_decision IS NULL) para um relato,
 * anexando foto (thumb_url / full_url), comentário e autor da atualização correspondente.
 */
export async function fetchPendingReviewsForPothole(potholeId) {
  if (!isSupabaseConfigured() || !potholeId) {
    return [];
  }

  try {
    const { data: notifRows, error } = await supabase
      .from('user_notifications')
      .select(
        'id, recipient_user_id, actor_user_id, pothole_id, pothole_update_id, type, title, body, is_read, review_decision, created_at'
      )
      .eq('pothole_id', potholeId)
      .eq('type', 'repair_review_requested')
      .is('review_decision', null)
      .order('created_at', { ascending: true });

    if (error || !Array.isArray(notifRows) || notifRows.length === 0) {
      return [];
    }

    const updateIds = notifRows.map((n) => n.pothole_update_id).filter(Boolean);
    const updatesById = {};

    if (updateIds.length > 0) {
      const { data: updateRows } = await supabase
        .from('pothole_updates')
        .select(
          'id, pothole_id, user_id, author_nickname, is_anonymous, status, note, thumb_url, full_url, created_at'
        )
        .in('id', updateIds);

      if (Array.isArray(updateRows)) {
        for (const u of updateRows) {
          updatesById[u.id] = u;
        }
      }
    }

    return notifRows.map((notif) => {
      const upd = notif.pothole_update_id ? updatesById[notif.pothole_update_id] : null;
      const isAnon = Boolean(upd?.is_anonymous);
      return {
        ...notif,
        createdAtFormatted: formatDateTimePtBr(notif.created_at),
        thumb_url: upd?.thumb_url || null,
        full_url: upd?.full_url || null,
        note: upd?.note || '',
        comment: upd?.note || '',
        is_anonymous: isAnon,
        author_nickname: isAnon
          ? 'Usuário Anônimo'
          : upd?.author_nickname || 'Cidadão colaborador',
      };
    });
  } catch {
    return [];
  }
}

/**
 * Verifica se o usuário autenticado já possui uma revisão pendente para o relato informado.
 */
export async function hasUserPendingReviewForPothole(userId, potholeId) {
  if (!isSupabaseConfigured() || !userId || !potholeId) {
    return false;
  }

  try {
    const { data, error } = await supabase
      .from('user_notifications')
      .select('id')
      .eq('pothole_id', potholeId)
      .eq('actor_user_id', userId)
      .eq('type', 'repair_review_requested')
      .is('review_decision', null)
      .limit(1);

    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Busca revisão de correção pendente (review_decision IS NULL) para um relato específico.
 */
export async function fetchPendingRepairReviewForPothole(userId, potholeId) {
  if (!isSupabaseConfigured() || !userId || !potholeId) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('user_notifications')
      .select(
        'id, recipient_user_id, actor_user_id, pothole_id, pothole_update_id, type, title, body, is_read, review_decision, created_at'
      )
      .eq('recipient_user_id', userId)
      .eq('pothole_id', potholeId)
      .eq('type', 'repair_review_requested')
      .is('review_decision', null)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !Array.isArray(data) || data.length === 0) {
      return null;
    }

    return {
      ...data[0],
      createdAtFormatted: formatDateTimePtBr(data[0].created_at),
    };
  } catch {
    return null;
  }
}

/**
 * Marca uma notificação específica como lida.
 */
export async function markNotificationRead(notificationId) {
  if (!isSupabaseConfigured() || !notificationId) {
    return false;
  }

  try {
    const { error } = await supabase
      .from('user_notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    return !error;
  } catch {
    return false;
  }
}

/**
 * Permite ao autor original do relato aprovar a correção informada ou reabrir o buraco no mapa.
 */
export async function submitRepairAuthorReview({
  pothole = null,
  potholeId = null,
  selectedNotificationId = null,
  notificationId = null,
  approvedReview = null,
  approved,
  reviewerNote = '',
  authorNickname = 'Autor do relato',
}) {
  const targetPotholeId = pothole?.id || potholeId || null;
  const targetNotificationId = selectedNotificationId || notificationId || null;

  if (!isSupabaseConfigured() || !targetPotholeId) {
    throw new Error('Sincronização com a nuvem indisponível para avaliar a correção.');
  }

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  const activeUserId = authData?.user?.id || null;
  if (authErr || !activeUserId) {
    throw new Error('Sessão expirada ou conta não autenticada. Entre novamente para avaliar.');
  }

  if (pothole?.authorUserId && pothole.authorUserId !== activeUserId) {
    throw new Error('Apenas o autor original do relato pode aprovar ou reabrir esta correção.');
  }

  const nextStatus = approved ? 'fixed' : 'open';
  const approvedCitizen =
    approvedReview?.is_anonymous
      ? 'Usuário Anônimo'
      : approvedReview?.author_nickname || '';
  const cleanNote =
    String(reviewerNote || '').trim() ||
    (approved
      ? approvedCitizen
        ? `Autor original aprovou a correção informada por ${approvedCitizen}.`
        : 'Autor original aprovou a correção informada.'
      : 'Autor original informou que o problema ainda persiste (reaberto).');
  const cleanNickname = String(authorNickname || 'Autor do relato').trim();

  const { data: insertedUpdate, error: insertError } = await supabase
    .from('pothole_updates')
    .insert({
      pothole_id: targetPotholeId,
      user_id: activeUserId,
      author_nickname: cleanNickname,
      is_anonymous: false,
      status: nextStatus,
      note: cleanNote,
      thumb_url: null,
      full_url: null,
    })
    .select(
      'id, pothole_id, user_id, author_nickname, is_anonymous, status, note, thumb_url, full_url, created_at'
    )
    .single();

  if (insertError) {
    throw new Error(
      insertError.message || 'Não foi possível registrar a avaliação do autor no histórico.'
    );
  }

  const potholePatch = { status: nextStatus };
  if (approved && approvedReview?.thumb_url && approvedReview?.full_url) {
    potholePatch.thumb_url = approvedReview.thumb_url;
    potholePatch.full_url = approvedReview.full_url;
  }

  const { error: patchError } = await supabase
    .from('potholes')
    .update(potholePatch)
    .eq('id', targetPotholeId);

  if (patchError) {
    throw new Error(
      patchError.message || 'Avaliação registrada, mas houve falha ao atualizar o status do relato.'
    );
  }

  try {
    const decision = approved ? 'approved' : 'rejected';

    if (approved || !targetNotificationId) {
      await supabase
        .from('user_notifications')
        .update({
          is_read: true,
          review_decision: decision,
        })
        .eq('recipient_user_id', activeUserId)
        .eq('pothole_id', targetPotholeId)
        .eq('type', 'repair_review_requested')
        .is('review_decision', null);
    }

    if (targetNotificationId) {
      await supabase
        .from('user_notifications')
        .update({
          is_read: true,
          review_decision: decision,
        })
        .eq('id', targetNotificationId)
        .eq('recipient_user_id', activeUserId);
    }
  } catch (err) {
    await recordAppErrorLog('notificationService.markReviewNotification', err);
  }

  await recordDiagnosticEvent('AVALIACAO_AUTOR', 'Autor avaliou correção informada', {
    potholeId: targetPotholeId,
    selectedNotificationId: targetNotificationId,
    approved: Boolean(approved),
    nextStatus,
  });

  return {
    updateId: insertedUpdate?.id || null,
    status: nextStatus,
    note: cleanNote,
    createdAt: insertedUpdate?.created_at || new Date().toISOString(),
  };
}
