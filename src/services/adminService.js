import { recordDiagnosticEvent } from './diagnosticLogService';
import { isSupabaseConfigured, supabase } from './supabaseClient';

const STORAGE_BUCKET = 'pothole-photos';

function createAdminError(message) {
  const err = new Error(message);
  err.isAdminError = true;
  return err;
}

/**
 * Extrai o caminho relativo dentro do bucket `pothole-photos` (ex.: `thumbs/uuid.jpg`).
 */
export function extractStoragePathFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const marker = `/object/public/${STORAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx >= 0) {
    const rest = url.slice(idx + marker.length).split('?')[0];
    return decodeURIComponent(rest);
  }
  const directMarker = `${STORAGE_BUCKET}/`;
  const dIdx = url.indexOf(directMarker);
  if (dIdx >= 0 && !url.startsWith('http')) {
    return url.slice(dIdx + directMarker.length).split('?')[0];
  }
  return null;
}

/**
 * Verifica estritamente no servidor (tabela `public.app_admins`) se o usuário autenticado é administrador.
 * Retorna `false` sempre em Modo Demonstração, offline ou sem sessão válida.
 */
export async function checkIsAdmin(explicitUserId = null) {
  if (!isSupabaseConfigured() || !supabase) return false;

  try {
    let targetUid = explicitUserId;
    if (!targetUid) {
      const { data } = await supabase.auth.getUser();
      targetUid = data?.user?.id || null;
    }
    if (!targetUid) return false;

    const { data, error } = await supabase
      .from('app_admins')
      .select('user_id')
      .eq('user_id', targetUid)
      .maybeSingle();

    if (error) return false;
    return Boolean(data?.user_id);
  } catch {
    return false;
  }
}

async function requireAdminSession() {
  if (!isSupabaseConfigured() || !supabase) {
    throw createAdminError('Modo administrativo requer conexão ativa com o Supabase.');
  }
  const { data: userData } = await supabase.auth.getUser();
  const adminUser = userData?.user;
  if (!adminUser?.id) {
    throw createAdminError('Sessão expirada. Faça login novamente como administrador.');
  }
  const isAdmin = await checkIsAdmin(adminUser.id);
  if (!isAdmin) {
    throw createAdminError('Acesso negado: privilégios de administrador não confirmados.');
  }
  return adminUser;
}

async function writeAdminAuditLog(adminUserId, action, targetType, targetId, details = {}) {
  try {
    await supabase.from('admin_audit_logs').insert({
      admin_user_id: adminUserId,
      action,
      target_type: targetType,
      target_id: String(targetId || ''),
      details,
    });
  } catch {
    // Log de auditoria é complementar e não deve travar o retorno após exclusão efetivada
  }
}

async function removeStorageUrls(urls = []) {
  const paths = Array.from(
    new Set(urls.map((u) => extractStoragePathFromUrl(u)).filter(Boolean))
  );
  if (paths.length === 0) return 0;

  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
  if (error) {
    const msg = String(error.message || '').toLowerCase();
    const status = error.statusCode ?? error.status;
    const isNotFound =
      status === 404 ||
      msg.includes('not found') ||
      msg.includes('does not exist') ||
      msg.includes('no such') ||
      msg.includes('404');
    if (!isNotFound) {
      throw createAdminError(`Falha ao remover arquivos do Storage: ${error.message}`);
    }
  }
  return paths.length;
}

/**
 * Exclui um registro de buraco, todas as suas atualizações e todas as fotos associadas no Storage.
 */
export async function adminDeletePothole(potholeId) {
  if (!potholeId) throw createAdminError('ID do registro inválido.');
  const adminUser = await requireAdminSession();

  const { data: potholeRow, error: fetchErr } = await supabase
    .from('potholes')
    .select('id, thumb_url, full_url, is_anonymous, status')
    .eq('id', potholeId)
    .maybeSingle();

  if (fetchErr) {
    throw createAdminError(`Não foi possível consultar o registro: ${fetchErr.message}`);
  }
  if (!potholeRow) {
    throw createAdminError('Registro de buraco não encontrado ou já excluído.');
  }

  const { data: updateRows } = await supabase
    .from('pothole_updates')
    .select('id, thumb_url, full_url')
    .eq('pothole_id', potholeId);

  const urlsToRemove = [potholeRow.thumb_url, potholeRow.full_url];
  if (Array.isArray(updateRows)) {
    for (const u of updateRows) {
      urlsToRemove.push(u.thumb_url, u.full_url);
    }
  }

  const removedFilesCount = await removeStorageUrls(urlsToRemove);

  const { error: deleteErr } = await supabase.from('potholes').delete().eq('id', potholeId);
  if (deleteErr) {
    throw createAdminError(`Não foi possível excluir o registro no banco: ${deleteErr.message}`);
  }

  await writeAdminAuditLog(adminUser.id, 'DELETE_POTHOLE', 'pothole', potholeId, {
    removedFilesCount,
    updatesCount: Array.isArray(updateRows) ? updateRows.length : 0,
  });
  await recordDiagnosticEvent('ADMIN', 'Registro e fotos removidos por moderação', {
    removedFilesCount,
  });

  return { potholeId, removedFilesCount };
}

/**
 * Exclui uma única atualização/comentário de buraco e suas fotos no Storage.
 */
export async function adminDeletePotholeUpdate(updateId) {
  if (!updateId) throw createAdminError('ID do comentário inválido.');
  const adminUser = await requireAdminSession();

  const { data: updateRow, error: fetchErr } = await supabase
    .from('pothole_updates')
    .select('id, pothole_id, thumb_url, full_url')
    .eq('id', updateId)
    .maybeSingle();

  if (fetchErr) {
    throw createAdminError(`Não foi possível consultar o comentário: ${fetchErr.message}`);
  }
  if (!updateRow) {
    throw createAdminError('Comentário/atualização não encontrado ou já excluído.');
  }

  const removedFilesCount = await removeStorageUrls([updateRow.thumb_url, updateRow.full_url]);

  const { error: deleteErr } = await supabase
    .from('pothole_updates')
    .delete()
    .eq('id', updateId);
  if (deleteErr) {
    throw createAdminError(`Falha ao excluir comentário no banco: ${deleteErr.message}`);
  }

  await writeAdminAuditLog(adminUser.id, 'DELETE_UPDATE', 'pothole_update', updateId, {
    potholeId: updateRow.pothole_id,
    removedFilesCount,
  });
  await recordDiagnosticEvent('ADMIN', 'Comentário/atualização removido por moderação', {
    removedFilesCount,
  });

  return { updateId, potholeId: updateRow.pothole_id, removedFilesCount };
}

/**
 * Remove apenas o perfil público (`public.profiles`) de um usuário, com trava de autoexclusão.
 */
export async function adminDeleteProfile(targetUserId) {
  if (!targetUserId) throw createAdminError('ID do perfil inválido.');
  const adminUser = await requireAdminSession();

  if (targetUserId === adminUser.id) {
    throw createAdminError('Operação bloqueada: você não pode apagar o próprio perfil de administrador.');
  }

  const { error } = await supabase.from('profiles').delete().eq('id', targetUserId);
  if (error) {
    throw createAdminError(`Falha ao apagar perfil: ${error.message}`);
  }

  await writeAdminAuditLog(adminUser.id, 'DELETE_PROFILE', 'profile', targetUserId, {});
  await recordDiagnosticEvent('ADMIN', 'Perfil público removido por moderação');
  return true;
}

/**
 * Exclui a conta completa do usuário em `auth.users` (e cascata em `profiles`) via RPC SECURITY DEFINER.
 */
export async function adminDeleteFullAccount(targetUserId) {
  if (!targetUserId) throw createAdminError('ID da conta inválido.');
  const adminUser = await requireAdminSession();

  if (targetUserId === adminUser.id) {
    throw createAdminError(
      'Operação bloqueada: você não pode excluir a própria conta de administrador.'
    );
  }

  const { error } = await supabase.rpc('admin_delete_user_account', {
    target_user_id: targetUserId,
  });

  if (error) {
    throw createAdminError(`Falha ao excluir conta completa: ${error.message}`);
  }

  await recordDiagnosticEvent('ADMIN', 'Conta completa excluída via RPC administrativa');
  return true;
}

export async function fetchAdminPotholes(limit = 50) {
  await requireAdminSession();
  const { data, error } = await supabase
    .from('potholes')
    .select(
      'id, user_id, author_nickname, is_anonymous, street_address, comment, status, thumb_url, full_url, confirmations, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw createAdminError(`Erro ao carregar registros: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

export async function fetchAdminUpdates(limit = 50) {
  await requireAdminSession();
  const { data, error } = await supabase
    .from('pothole_updates')
    .select(
      'id, pothole_id, user_id, author_nickname, is_anonymous, status, note, thumb_url, full_url, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw createAdminError(`Erro ao carregar comentários: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

export async function fetchAdminProfiles(limit = 50) {
  await requireAdminSession();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nickname, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw createAdminError(`Erro ao carregar perfis: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

export async function fetchAdminAuditLogs(limit = 50) {
  await requireAdminSession();
  const { data, error } = await supabase
    .from('admin_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw createAdminError(`Erro ao carregar auditoria: ${error.message}`);
  return Array.isArray(data) ? data : [];
}
