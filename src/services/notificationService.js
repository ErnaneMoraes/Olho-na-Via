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
  pothole,
  notificationId = null,
  approved,
  reviewerNote = '',
  authorNickname = 'Autor do relato',
}) {
  if (!isSupabaseConfigured() || !pothole?.id) {
    throw new Error('Sincronização com a nuvem indisponível para avaliar a correção.');
  }

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  const activeUserId = authData?.user?.id || null;
  if (authErr || !activeUserId) {
    throw new Error('Sessão expirada ou conta não autenticada. Entre novamente para avaliar.');
  }

  if (pothole.authorUserId && pothole.authorUserId !== activeUserId) {
    throw new Error('Apenas o autor original do relato pode aprovar ou reabrir esta correção.');
  }

  const nextStatus = approved ? 'fixed' : 'open';
  const cleanNote =
    String(reviewerNote || '').trim() ||
    (approved
      ? 'Correção aprovada pelo autor do relato.'
      : 'O autor informou que o buraco ainda não foi tampado (relato reaberto).');
  const cleanNickname = String(authorNickname || 'Autor do relato').trim();

  const { data: insertedUpdate, error: insertError } = await supabase
    .from('pothole_updates')
    .insert({
      pothole_id: pothole.id,
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

  const { error: patchError } = await supabase
    .from('potholes')
    .update({ status: nextStatus })
    .eq('id', pothole.id);

  if (patchError) {
    throw new Error(
      patchError.message || 'Avaliação registrada, mas houve falha ao atualizar o status do relato.'
    );
  }

  try {
    const decision = approved ? 'approved' : 'rejected';
    let notifQuery = supabase
      .from('user_notifications')
      .update({
        is_read: true,
        review_decision: decision,
      })
      .eq('recipient_user_id', activeUserId);

    if (notificationId) {
      notifQuery = notifQuery.eq('id', notificationId);
    } else {
      notifQuery = notifQuery.eq('pothole_id', pothole.id).eq('is_read', false);
    }

    await notifQuery;
  } catch (err) {
    await recordAppErrorLog('notificationService.markReviewNotification', err);
  }

  await recordDiagnosticEvent('AVALIACAO_AUTOR', 'Autor avaliou correção informada', {
    potholeId: pothole.id,
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
