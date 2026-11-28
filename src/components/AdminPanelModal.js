import { FontAwesome6 } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SharedStyles } from '../../components/StyleSheet/Styles';
import {
  DangerButton,
  PrimaryButton,
  SaveButton,
  SecondaryButton,
} from '../../components/common/Buttons';
import { useAppSettings } from '../context/AppSettingsContext';
import {
  adminDeleteFullAccount,
  adminDeletePothole,
  adminDeletePotholeUpdate,
  adminDeleteProfile,
  adminResetUserPassword,
  adminSetUserAdminRole,
  adminSetUserBlocked,
  fetchAdminPanelSnapshot,
  formatAdminRealAuthorLabel,
} from '../services/adminService';
import { submitAdminStatusModeration } from '../services/notificationService';
import { formatDateTimePtBr } from '../services/potholeSeedService';

function notifyAdminError(title, message) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function notifyAdminInfo(title, message) {
  notifyAdminError(title, message);
}

function confirmSingle(title, message, confirmLabel, onConfirmed) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    if (window.confirm(`${title}\n\n${message}`)) {
      onConfirmed();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancelar', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirmed },
  ]);
}

function confirmDouble(title1, msg1, title2, msg2, confirmLabel, onConfirmed) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    if (window.confirm(`${title1}\n\n${msg1}`)) {
      if (window.confirm(`${title2}\n\n${msg2}`)) {
        onConfirmed();
      }
    }
    return;
  }
  Alert.alert(title1, msg1, [
    { text: 'Cancelar', style: 'cancel' },
    {
      text: 'Continuar',
      style: 'destructive',
      onPress: () => {
        Alert.alert(title2, msg2, [
          { text: 'Voltar', style: 'cancel' },
          { text: confirmLabel, style: 'destructive', onPress: onConfirmed },
        ]);
      },
    },
  ]);
}

function shortId(id) {
  const s = String(id || '');
  return s.length > 12 ? `${s.slice(0, 8)}…` : s;
}

function translateAuditAction(action) {
  const map = {
    DELETE_POTHOLE: 'Exclusão de Registro e Fotos',
    DELETE_UPDATE: 'Remoção de Comentário/Atualização',
    DELETE_PROFILE: 'Remoção de Perfil Público',
    DELETE_FULL_ACCOUNT: 'Exclusão Completa de Conta',
    RESET_USER_PASSWORD: 'Redefinição de Senha de Usuário',
    GRANT_ADMIN: 'Concessão de Privilégio Admin',
    REVOKE_ADMIN: 'Remoção de Privilégio Admin',
    BLOCK_USER: 'Bloqueio de Usuário',
    UNBLOCK_USER: 'Desbloqueio de Usuário',
  };
  return map[action] || action;
}

export function AdminPanelModal({
  visible = true,
  inline = false,
  session,
  onClose,
  onModerationChange,
}) {
  const insets = useSafeAreaInsets();
  const {
    colors,
    isDark,
    radiusCard,
    radiusButton,
    radiusInput,
    borderWidth,
    cardShadow,
    typography,
    notifyDataRestored,
  } = useAppSettings();

  const [activeTab, setActiveTab] = useState('users'); // 'users' | 'potholes' | 'audit'
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [reportStatusFilter, setReportStatusFilter] = useState('all'); // 'all' | 'open' | 'review' | 'fixed'
  const [selectedPotholeId, setSelectedPotholeId] = useState(null);

  const [potholes, setPotholes] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [moderationBusy, setModerationBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [passwordTargetProfile, setPasswordTargetProfile] = useState(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');

  const [zoomMedia, setZoomMedia] = useState(null);
  const [zoomFullStatus, setZoomFullStatus] = useState('idle');

  const { width: windowWidth } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isCompactWidth = windowWidth < 600;
  const isDesktopWeb = isWeb && windowWidth >= 768;

  const topSafePadding = isWeb
    ? 16
    : Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 12) + 8;

  const isAdmin = Boolean(session?.isAdmin);

  const amberBg = isDark ? 'rgba(245, 158, 11, 0.2)' : '#FEF3C7';
  const amberBorder = '#F59E0B';
  const amberText = isDark ? '#FDE68A' : '#92400E';

  const loadSnapshot = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const snap = await fetchAdminPanelSnapshot();
      const nextProfiles = (snap.profiles || []).map((p) =>
        p.id === session?.userId ? { ...p, is_admin: true } : p
      );
      setProfiles(nextProfiles);
      setPotholes(snap.potholes || []);
      setUpdates(snap.updates || []);
      setAuditLogs(snap.auditLogs || []);
    } catch (err) {
      setErrorMsg(err?.message || 'Erro ao carregar dados administrativos.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, session?.userId]);

  useEffect(() => {
    if (visible && isAdmin) {
      loadSnapshot();
    } else if (!visible) {
      setSelectedUserId(null);
      setSelectedPotholeId(null);
      setUserSearch('');
      setReportStatusFilter('all');
      setPasswordTargetProfile(null);
      setResetPasswordInput('');
      setShowResetPassword(false);
      setResetError('');
      setZoomMedia(null);
      setZoomFullStatus('idle');
    }
  }, [visible, isAdmin, loadSnapshot]);

  const updatesByPotholeId = useMemo(() => {
    const map = {};
    for (const u of updates) {
      if (!u?.pothole_id) continue;
      if (!map[u.pothole_id]) map[u.pothole_id] = [];
      map[u.pothole_id].push(u);
    }
    return map;
  }, [updates]);

  const reportCountByUserId = useMemo(() => {
    const map = {};
    for (const p of potholes) {
      if (!p?.user_id) continue;
      map[p.user_id] = (map[p.user_id] || 0) + 1;
    }
    return map;
  }, [potholes]);

  const updateCountByUserId = useMemo(() => {
    const map = {};
    for (const u of updates) {
      if (!u?.user_id) continue;
      map[u.user_id] = (map[u.user_id] || 0) + 1;
    }
    return map;
  }, [updates]);

  const filteredProfiles = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => {
      const nick = String(p.nickname || '').toLowerCase();
      const mail = String(p.email || '').toLowerCase();
      const uid = String(p.id || '').toLowerCase();
      return nick.includes(q) || mail.includes(q) || uid.includes(q);
    });
  }, [profiles, userSearch]);

  const reportFilterCounts = useMemo(() => {
    let open = 0;
    let review = 0;
    let fixed = 0;
    for (const item of potholes) {
      if (item.status === 'fixed') {
        fixed += 1;
      } else if ((item.pending_review_count || 0) > 0) {
        review += 1;
      } else {
        open += 1;
      }
    }
    return {
      all: potholes.length,
      open,
      review,
      fixed,
    };
  }, [potholes]);

  const filteredPotholes = useMemo(() => {
    if (reportStatusFilter === 'all') return potholes;
    return potholes.filter((item) => {
      const isFixed = item.status === 'fixed';
      const hasReview = !isFixed && (item.pending_review_count || 0) > 0;
      if (reportStatusFilter === 'fixed') return isFixed;
      if (reportStatusFilter === 'review') return hasReview;
      return !isFixed && !hasReview;
    });
  }, [potholes, reportStatusFilter]);

  const selectedUser = useMemo(
    () => profiles.find((p) => p.id === selectedUserId) || null,
    [profiles, selectedUserId]
  );

  const selectedPothole = useMemo(
    () => potholes.find((p) => p.id === selectedPotholeId) || null,
    [potholes, selectedPotholeId]
  );

  const handleTabPress = (tabId) => {
    setActiveTab(tabId);
    setSelectedUserId(null);
    setSelectedPotholeId(null);
  };

  const openZoomViewer = (mediaInput) => {
    const thumbUri =
      typeof mediaInput === 'string' ? mediaInput : mediaInput?.thumbUri || null;
    const fullUri =
      typeof mediaInput === 'string' ? mediaInput : mediaInput?.fullUri || null;
    const resolvedFull = fullUri || thumbUri || null;
    const resolvedThumb = thumbUri || resolvedFull;
    if (!resolvedFull && !resolvedThumb) return;
    const hasDistinctFull = Boolean(
      resolvedFull && resolvedThumb && resolvedFull !== resolvedThumb
    );
    setZoomFullStatus(hasDistinctFull ? 'loading' : 'loaded');
    setZoomMedia({
      thumbUri: resolvedThumb,
      fullUri: resolvedFull,
      hasDistinctFull,
    });
  };

  const closeZoomViewer = useCallback(() => {
    setZoomMedia(null);
    setZoomFullStatus('idle');
  }, []);

  const openResetPasswordPrompt = (profile) => {
    setPasswordTargetProfile(profile);
    setResetPasswordInput('');
    setShowResetPassword(false);
    setResetError('');
  };

  const closeResetPasswordPrompt = () => {
    if (resetBusy) return;
    setPasswordTargetProfile(null);
    setResetPasswordInput('');
    setShowResetPassword(false);
    setResetError('');
  };

  const handleConfirmResetPassword = async () => {
    if (!passwordTargetProfile?.id || resetBusy) return;
    setResetError('');
    if (resetPasswordInput.length < 6) {
      setResetError('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setResetBusy(true);
    try {
      await adminResetUserPassword(passwordTargetProfile.id, resetPasswordInput);
      const targetName = passwordTargetProfile.nickname || shortId(passwordTargetProfile.id);
      setPasswordTargetProfile(null);
      setResetPasswordInput('');
      setShowResetPassword(false);
      notifyAdminInfo('Senha Redefinida', `Senha redefinida com sucesso para ${targetName}.`);
      loadSnapshot();
    } catch (err) {
      setResetError(err?.message || 'Não foi possível redefinir a senha do usuário.');
    } finally {
      setResetBusy(false);
    }
  };

  const handleToggleAdminRole = (profile) => {
    if (!profile?.id || busyId) return;
    const makeAdmin = !profile.is_admin;
    const actionLabel = makeAdmin ? 'Conceder Admin' : 'Remover Admin';
    confirmSingle(
      makeAdmin ? 'Conceder Privilégio de Admin?' : 'Remover Privilégio de Admin?',
      makeAdmin
        ? `Deseja conceder acesso administrativo completo para "${profile.nickname}"?`
        : `Deseja remover os privilégios administrativos de "${profile.nickname}"?`,
      actionLabel,
      async () => {
        setBusyId(profile.id);
        try {
          await adminSetUserAdminRole(profile.id, makeAdmin);
          setProfiles((prev) =>
            prev.map((p) => (p.id === profile.id ? { ...p, is_admin: makeAdmin } : p))
          );
          notifyAdminInfo(
            'Privilégios Atualizados',
            makeAdmin
              ? `"${profile.nickname}" agora é administrador.`
              : `"${profile.nickname}" voltou a ser cidadão comum.`
          );
          loadSnapshot();
        } catch (err) {
          notifyAdminError('Erro', err?.message || 'Não foi possível alterar o papel do usuário.');
        } finally {
          setBusyId(null);
        }
      }
    );
  };

  const handleToggleBlockedUser = (profile) => {
    if (!profile?.id || busyId) return;
    const nextBlocked = !profile.is_blocked;
    confirmSingle(
      nextBlocked ? 'Bloquear Usuário?' : 'Desbloquear Usuário?',
      nextBlocked
        ? `Deseja bloquear "${profile.nickname}" para impedir novas ações na plataforma?`
        : `Deseja restaurar o acesso normal de "${profile.nickname}"?`,
      nextBlocked ? 'Bloquear Agora' : 'Desbloquear',
      async () => {
        setBusyId(profile.id);
        try {
          await adminSetUserBlocked(profile.id, nextBlocked);
          setProfiles((prev) =>
            prev.map((p) => (p.id === profile.id ? { ...p, is_blocked: nextBlocked } : p))
          );
          notifyAdminInfo(
            nextBlocked ? 'Usuário Bloqueado' : 'Usuário Desbloqueado',
            nextBlocked
              ? `"${profile.nickname}" foi marcado como bloqueado.`
              : `O bloqueio de "${profile.nickname}" foi removido.`
          );
          loadSnapshot();
        } catch (err) {
          notifyAdminError('Erro', err?.message || 'Não foi possível atualizar o bloqueio.');
        } finally {
          setBusyId(null);
        }
      }
    );
  };

  const confirmDeleteProfile = (profile) => {
    confirmSingle(
      'Apagar Apenas o Perfil?',
      `Remover o registro de perfil de "${profile.nickname}" (${shortId(profile.id)}) da tabela pública? A conta de autenticação permanecerá ativa.`,
      'Apagar Perfil',
      async () => {
        setBusyId(profile.id);
        try {
          await adminDeleteProfile(profile.id);
          setProfiles((prev) => prev.filter((p) => p.id !== profile.id));
          setSelectedUserId(null);
          loadSnapshot();
        } catch (err) {
          notifyAdminError('Erro', err?.message || 'Falha ao apagar perfil.');
        } finally {
          setBusyId(null);
        }
      }
    );
  };

  const confirmDeleteFullAccount = (profile) => {
    confirmDouble(
      'Excluir Conta Completa?',
      `Atenção: isto removerá "${profile.nickname}" (${shortId(profile.id)}) de auth.users e apagará o perfil em cascata.`,
      'Ação Irreversível',
      'Tem certeza absoluta de que deseja excluir permanentemente esta conta de usuário?',
      'Excluir Conta Agora',
      async () => {
        setBusyId(profile.id);
        try {
          await adminDeleteFullAccount(profile.id);
          setProfiles((prev) => prev.filter((p) => p.id !== profile.id));
          setSelectedUserId(null);
          loadSnapshot();
        } catch (err) {
          notifyAdminError('Erro', err?.message || 'Falha ao excluir conta.');
        } finally {
          setBusyId(null);
        }
      }
    );
  };

  const handleModerationDecision = async (item, approved) => {
    if (!item?.id || moderationBusy || busyId) return;
    setModerationBusy(true);
    try {
      await submitAdminStatusModeration({
        pothole: item,
        approved,
        adminNickname: session?.nickname || 'Administrador',
      });
      const nextStatus = approved ? 'fixed' : 'open';
      setPotholes((prev) =>
        prev.map((p) =>
          p.id === item.id ? { ...p, status: nextStatus, pending_review_count: 0 } : p
        )
      );
      notifyDataRestored();
      onModerationChange?.();
      await loadSnapshot();
      notifyAdminInfo(
        'Status Atualizado',
        approved
          ? 'Relato aprovado e marcado como tampado.'
          : 'Relato recusado para revisão e mantido em aberto.'
      );
    } catch (err) {
      notifyAdminError('Erro de Moderação', err?.message || 'Não foi possível alterar o status.');
    } finally {
      setModerationBusy(false);
    }
  };

  const confirmDeletePothole = (item) => {
    confirmDouble(
      'Excluir Registro e Fotos?',
      `Registro ${shortId(item.id)} (${item.is_anonymous ? 'Usuário Anônimo' : item.author_nickname || 'Cidadão'}). Esta ação removerá também todas as fotos e comentários ligados a ele.`,
      'Confirmação Final',
      'Os arquivos serão apagados permanentemente do Storage. Confirmar exclusão?',
      'Excluir Agora',
      async () => {
        setBusyId(item.id);
        try {
          await adminDeletePothole(item.id);
          setPotholes((prev) => prev.filter((p) => p.id !== item.id));
          setUpdates((prev) => prev.filter((u) => u.pothole_id !== item.id));
          setSelectedPotholeId(null);
          notifyDataRestored();
          onModerationChange?.();
          loadSnapshot();
        } catch (err) {
          notifyAdminError('Erro', err?.message || 'Falha ao excluir registro.');
        } finally {
          setBusyId(null);
        }
      }
    );
  };

  const confirmDeleteUpdate = (item) => {
    confirmSingle(
      'Apagar Comentário/Foto?',
      `Atualização ${shortId(item.id)} (${item.is_anonymous ? 'Usuário Anônimo' : item.author_nickname || 'Cidadão'}). A foto associada também será removida.`,
      'Confirmar Remoção',
      async () => {
        setBusyId(item.id);
        try {
          await adminDeletePotholeUpdate(item.id);
          setUpdates((prev) => prev.filter((u) => u.id !== item.id));
          notifyDataRestored();
          onModerationChange?.();
          loadSnapshot();
        } catch (err) {
          notifyAdminError('Erro', err?.message || 'Falha ao apagar atualização.');
        } finally {
          setBusyId(null);
        }
      }
    );
  };

  const handleRequestClose = () => {
    if (zoomMedia) {
      closeZoomViewer();
      return;
    }
    if (passwordTargetProfile) {
      closeResetPasswordPrompt();
      return;
    }
    if (activeTab === 'users' && selectedUserId) {
      setSelectedUserId(null);
      return;
    }
    if (activeTab === 'potholes' && selectedPotholeId) {
      setSelectedPotholeId(null);
      return;
    }
    onClose?.();
  };

  const getUserRoleBadge = (profile) => {
    if (profile?.is_blocked) {
      return {
        label: 'Bloqueado',
        bg: colors.dangerSoft,
        color: colors.dangerText || colors.danger,
        border: colors.danger,
      };
    }
    if (profile?.is_admin) {
      return {
        label: 'Admin',
        bg: colors.accentSoft,
        color: colors.primary,
        border: colors.primary,
      };
    }
    return {
      label: 'Cidadão',
      bg: colors.surfaceMuted,
      color: colors.textSecondary,
      border: colors.border,
    };
  };

  const getReportStatusMeta = (item) => {
    const isFixed = item?.status === 'fixed';
    const pendingCount = Number(item?.pending_review_count) || 0;
    const isReview = !isFixed && pendingCount > 0;
    if (isFixed) {
      return {
        key: 'fixed',
        shortLabel: 'Tampado',
        fullLabel: 'Já foi Tampado',
        bg: colors.successSoft,
        color: colors.success,
        border: colors.success,
        icon: 'circle-check',
      };
    }
    if (isReview) {
      return {
        key: 'review',
        shortLabel: 'Revisão',
        fullLabel: `Revisão solicitada (${pendingCount})`,
        bg: amberBg,
        color: amberText,
        border: amberBorder,
        icon: 'clock',
      };
    }
    return {
      key: 'open',
      shortLabel: 'Aberto',
      fullLabel: 'Buraco Aberto',
      bg: colors.dangerSoft,
      color: colors.danger,
      border: colors.danger,
      icon: 'triangle-exclamation',
    };
  };

  const renderSegmentedTabs = () => {
    const tabs = [
      { id: 'users', label: 'Usuários', count: profiles.length, flex: 1 },
      { id: 'potholes', label: 'Registros & Fotos', count: potholes.length, flex: 1.35 },
      { id: 'audit', label: 'Auditoria', count: auditLogs.length, flex: 1 },
    ];

    return (
      <View
        style={[
          SharedStyles.contentContainer,
          styles.segmentedBar,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderWidth,
            borderRadius: radiusButton,
          },
        ]}
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => handleTabPress(tab.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={({ hovered, pressed }) => [
                styles.segmentedTabBtn,
                {
                  flex: tab.flex,
                  borderRadius: Math.max(8, radiusButton - 4),
                  backgroundColor: active
                    ? colors.primary
                    : isWeb && hovered
                      ? colors.card
                      : 'transparent',
                  opacity: pressed ? 0.85 : 1,
                },
                isWeb ? styles.webPointer : null,
              ]}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                style={[
                  styles.segmentedTabText,
                  { color: active ? colors.primaryText : colors.textSecondary },
                ]}
              >
                {tab.label} ({tab.count})
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderUsersTab = () => {
    if (selectedUser) {
      const isSelf = selectedUser.id === session?.userId;
      const roleMeta = getUserRoleBadge(selectedUser);
      const userReportsCount = reportCountByUserId[selectedUser.id] || 0;
      const userUpdatesCount = updateCountByUserId[selectedUser.id] || 0;
      const isRowBusy = busyId === selectedUser.id;

      return (
        <View style={styles.detailStack}>
          <Pressable
            onPress={() => setSelectedUserId(null)}
            style={({ hovered, pressed }) => [
              styles.backBtn,
              {
                backgroundColor: isWeb && hovered ? colors.accentSoft : colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusButton,
                opacity: pressed ? 0.82 : 1,
              },
              isWeb ? styles.webPointer : null,
            ]}
          >
            <FontAwesome6 name="arrow-left" size={14} color={colors.primary} />
            <Text style={[styles.backBtnText, { color: colors.primary }]}>
              Voltar para usuários
            </Text>
          </Pressable>

          <View
            style={[
              styles.itemCard,
              cardShadow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusCard,
              },
            ]}
          >
            <View style={styles.itemTopRow}>
              <View style={styles.detailTitleWrap}>
                <Text style={[styles.detailTitle, { color: colors.text }]}>
                  {selectedUser.nickname || 'Cidadão'} {isSelf ? '(Sua conta)' : ''}
                </Text>
              </View>
              <View
                style={[
                  styles.rolePill,
                  {
                    backgroundColor: roleMeta.bg,
                    borderColor: roleMeta.border,
                    borderWidth: 1,
                  },
                ]}
              >
                <Text style={[styles.rolePillText, { color: roleMeta.color }]}>
                  {roleMeta.label}
                </Text>
              </View>
            </View>

            <View style={[styles.detailMetaBlock, { borderTopColor: colors.dividerColor }]}>
              <View style={styles.detailMetaRow}>
                <FontAwesome6 name="envelope" size={12} color={colors.textMuted} />
                <Text selectable style={[styles.detailMetaText, { color: colors.text }]}>
                  {selectedUser.email || 'E-mail indisponível'}
                </Text>
              </View>
              <View style={styles.detailMetaRow}>
                <FontAwesome6 name="fingerprint" size={12} color={colors.textMuted} />
                <Text
                  selectable
                  style={[
                    styles.detailMetaText,
                    { color: colors.textSecondary, fontVariant: typography.fontVariant },
                  ]}
                >
                  UID: {selectedUser.id}
                </Text>
              </View>
              <View style={styles.detailMetaRow}>
                <FontAwesome6 name="calendar" size={12} color={colors.textMuted} />
                <Text
                  style={[
                    styles.detailMetaText,
                    { color: colors.textSecondary, fontVariant: typography.fontVariant },
                  ]}
                >
                  Criado em: {formatDateTimePtBr(selectedUser.created_at)}
                </Text>
              </View>
            </View>

            <View style={styles.metricsRow}>
              <View
                style={[
                  styles.metricTile,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    borderRadius: radiusInput,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.metricValue,
                    { color: colors.primary, fontVariant: typography.fontVariant },
                  ]}
                >
                  {userReportsCount}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Relatos</Text>
              </View>
              <View
                style={[
                  styles.metricTile,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    borderRadius: radiusInput,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.metricValue,
                    { color: colors.primary, fontVariant: typography.fontVariant },
                  ]}
                >
                  {userUpdatesCount}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  Verificações
                </Text>
              </View>
            </View>
          </View>

          <View
            style={[
              styles.itemCard,
              cardShadow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusCard,
              },
            ]}
          >
            <Text style={[styles.sectionHeading, { color: colors.text }]}>
              Ações Administrativas
            </Text>

            <SecondaryButton
              compact
              label="Alterar Senha"
              icon="lock"
              disabled={Boolean(busyId) || resetBusy}
              onPress={() => openResetPasswordPrompt(selectedUser)}
            />

            <View style={styles.actionsGridRow}>
              <SecondaryButton
                compact
                label={selectedUser.is_admin ? 'Remover Admin' : 'Conceder Admin'}
                icon="user-shield"
                disabled={isSelf || Boolean(busyId)}
                loading={isRowBusy}
                numberOfLines={1}
                adjustsFontSizeToFit
                onPress={() => handleToggleAdminRole(selectedUser)}
                style={[styles.flexOne, styles.actionBtnGuard]}
              />
              {selectedUser.is_blocked ? (
                <SecondaryButton
                  compact
                  label="Desbloquear"
                  icon="user-check"
                  disabled={isSelf || Boolean(busyId)}
                  loading={isRowBusy}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  onPress={() => handleToggleBlockedUser(selectedUser)}
                  style={[styles.flexOne, styles.actionBtnGuard]}
                />
              ) : (
                <DangerButton
                  compact
                  label="Bloquear Usuário"
                  icon="ban"
                  disabled={isSelf || Boolean(busyId)}
                  loading={isRowBusy}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  onPress={() => handleToggleBlockedUser(selectedUser)}
                  style={[styles.flexOne, styles.actionBtnGuard]}
                />
              )}
            </View>

            <View style={styles.actionsGridRow}>
              <SecondaryButton
                compact
                label="Apagar Perfil"
                icon="user-slash"
                disabled={isSelf || Boolean(busyId)}
                loading={isRowBusy}
                numberOfLines={1}
                adjustsFontSizeToFit
                onPress={() => confirmDeleteProfile(selectedUser)}
                style={[styles.flexOne, styles.actionBtnGuard]}
              />
              <DangerButton
                compact
                label="Excluir Conta"
                icon="user-xmark"
                disabled={isSelf || Boolean(busyId)}
                loading={isRowBusy}
                numberOfLines={1}
                adjustsFontSizeToFit
                onPress={() => confirmDeleteFullAccount(selectedUser)}
                style={[styles.flexOne, styles.actionBtnGuard]}
              />
            </View>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.listStack}>
        <View
          style={[
            styles.searchWrap,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
              borderWidth,
              borderRadius: radiusInput,
            },
          ]}
        >
          <FontAwesome6 name="magnifying-glass" size={14} color={colors.textMuted} />
          <TextInput
            value={userSearch}
            onChangeText={setUserSearch}
            placeholder="Buscar por apelido ou e-mail..."
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.text }]}
          />
          {userSearch ? (
            <Pressable
              onPress={() => setUserSearch('')}
              hitSlop={8}
              accessibilityLabel="Limpar busca"
              style={isWeb ? styles.webPointer : null}
            >
              <FontAwesome6 name="xmark" size={14} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {filteredProfiles.length === 0 ? (
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            {profiles.length === 0
              ? 'Nenhum perfil cadastrado encontrado.'
              : 'Nenhum usuário corresponde à busca informada.'}
          </Text>
        ) : (
          <View
            style={[
              styles.denseListCard,
              cardShadow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusCard,
              },
            ]}
          >
            {filteredProfiles.map((profile, idx) => {
              const isSelf = profile.id === session?.userId;
              const roleMeta = getUserRoleBadge(profile);
              return (
                <Pressable
                  key={profile.id}
                  onPress={() => setSelectedUserId(profile.id)}
                  style={({ hovered, pressed }) => [
                    styles.denseRow,
                    idx > 0 ? { borderTopWidth: 1, borderTopColor: colors.dividerColor } : null,
                    isWeb && hovered ? { backgroundColor: colors.surfaceMuted } : null,
                    pressed ? { opacity: 0.8 } : null,
                    isWeb ? styles.webPointer : null,
                  ]}
                >
                  <View style={styles.denseRowMain}>
                    <Text numberOfLines={1} style={[styles.denseRowTitle, { color: colors.text }]}>
                      {profile.nickname || 'Cidadão'} {isSelf ? '(Você)' : ''}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.denseRowSubtitle, { color: colors.textSecondary }]}
                    >
                      {profile.email || `UID: ${shortId(profile.id)}`}
                    </Text>
                  </View>

                  <View style={styles.denseRowTrailing}>
                    <View
                      style={[
                        styles.compactPill,
                        {
                          backgroundColor: roleMeta.bg,
                          borderColor: roleMeta.border,
                          borderWidth: 1,
                        },
                      ]}
                    >
                      <Text style={[styles.compactPillText, { color: roleMeta.color }]}>
                        {roleMeta.label}
                      </Text>
                    </View>
                    <FontAwesome6 name="chevron-right" size={12} color={colors.textMuted} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  const renderReportsTab = () => {
    if (selectedPothole) {
      const statusMeta = getReportStatusMeta(selectedPothole);
      const linkedUpdates = updatesByPotholeId[selectedPothole.id] || [];
      const primaryPreviewUri = selectedPothole.thumb_url || selectedPothole.full_url || null;
      const isRowBusy = busyId === selectedPothole.id || moderationBusy;
      const authorName = selectedPothole.is_anonymous
        ? 'Usuário Anônimo'
        : selectedPothole.author_nickname || 'Cidadão';
      const realAuthorLabel = selectedPothole.is_anonymous
        ? formatAdminRealAuthorLabel(selectedPothole.real_author, selectedPothole.user_id)
        : `Autor: ${selectedPothole.real_author?.nickname || authorName}${
            selectedPothole.real_author?.email ? ` (${selectedPothole.real_author.email})` : ''
          }`;

      return (
        <View style={styles.detailStack}>
          <Pressable
            onPress={() => setSelectedPotholeId(null)}
            style={({ hovered, pressed }) => [
              styles.backBtn,
              {
                backgroundColor: isWeb && hovered ? colors.accentSoft : colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusButton,
                opacity: pressed ? 0.82 : 1,
              },
              isWeb ? styles.webPointer : null,
            ]}
          >
            <FontAwesome6 name="arrow-left" size={14} color={colors.primary} />
            <Text style={[styles.backBtnText, { color: colors.primary }]}>
              Voltar para registros
            </Text>
          </Pressable>

          {primaryPreviewUri ? (
            <Pressable
              onPress={() =>
                openZoomViewer({
                  thumbUri: selectedPothole.thumb_url || null,
                  fullUri: selectedPothole.full_url || selectedPothole.thumb_url || null,
                })
              }
              style={[
                styles.heroPhotoCard,
                cardShadow,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderWidth,
                  borderRadius: radiusCard,
                },
                isWeb ? styles.webPointer : null,
              ]}
            >
              <View style={[styles.heroPhotoBox, { backgroundColor: colors.surfaceMuted }]}>
                <Image
                  source={{ uri: primaryPreviewUri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
                <View style={[styles.zoomHintPill, { backgroundColor: colors.overlay }]}>
                  <FontAwesome6 name="expand" size={11} color="#FFFFFF" />
                  <Text style={styles.zoomHintText}>Toque para ampliar</Text>
                </View>
              </View>
            </Pressable>
          ) : null}

          <View
            style={[
              styles.itemCard,
              cardShadow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusCard,
              },
            ]}
          >
            <View style={styles.itemTopRow}>
              <View
                style={[
                  styles.rolePill,
                  {
                    backgroundColor: statusMeta.bg,
                    borderColor: statusMeta.border,
                    borderWidth: 1,
                  },
                ]}
              >
                <FontAwesome6 name={statusMeta.icon} size={11} color={statusMeta.color} />
                <Text style={[styles.rolePillText, { color: statusMeta.color }]}>
                  {statusMeta.fullLabel}
                </Text>
              </View>
              <Text
                style={[
                  styles.itemDate,
                  { color: colors.textMuted, fontVariant: typography.fontVariant },
                ]}
              >
                {formatDateTimePtBr(selectedPothole.created_at)}
              </Text>
            </View>

            <View style={styles.detailMetaRow}>
              <FontAwesome6 name="location-dot" size={13} color={colors.primary} />
              <Text style={[styles.detailAddressText, { color: colors.text }]}>
                {selectedPothole.street_address || 'Localização detectada por GPS'}
              </Text>
            </View>

            <Text style={[styles.itemPreview, { color: colors.textSecondary }]}>
              {selectedPothole.comment?.trim()
                ? selectedPothole.comment
                : 'Sem comentário adicional registrado.'}
            </Text>

            <View
              style={[
                styles.adminAuthorBadge,
                {
                  backgroundColor: colors.adminCardBg,
                  borderColor: colors.adminCardBorder,
                },
              ]}
            >
              <FontAwesome6 name="user-shield" size={11} color={colors.adminCardTitle} />
              <Text style={[styles.adminAuthorBadgeText, { color: colors.adminCardTitle }]}>
                {realAuthorLabel}
              </Text>
            </View>

            <Text
              style={[
                styles.itemMeta,
                { color: colors.textMuted, fontVariant: typography.fontVariant },
              ]}
            >
              ID do Registro: {shortId(selectedPothole.id)} • {selectedPothole.confirmations || 1}{' '}
              confirmações
            </Text>
          </View>

          <View
            style={[
              styles.itemCard,
              cardShadow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusCard,
              },
            ]}
          >
            <View style={styles.sectionHeaderRow}>
              <FontAwesome6 name="gavel" size={13} color={colors.danger} />
              <Text style={[styles.sectionHeading, { color: colors.text }]}>
                Moderação Administrativa
              </Text>
            </View>

            <View style={styles.actionsGridRow}>
              <SaveButton
                compact
                label="Aprovar"
                icon="circle-check"
                loading={moderationBusy}
                disabled={isRowBusy}
                numberOfLines={1}
                adjustsFontSizeToFit
                onPress={() => handleModerationDecision(selectedPothole, true)}
                style={[styles.flexOne, styles.actionBtnGuard]}
              />
              <SecondaryButton
                compact
                label="Recusar"
                icon="rotate-left"
                loading={moderationBusy}
                disabled={isRowBusy}
                numberOfLines={1}
                adjustsFontSizeToFit
                onPress={() => handleModerationDecision(selectedPothole, false)}
                style={[styles.flexOne, styles.actionBtnGuard]}
              />
            </View>

            <DangerButton
              compact
              label={busyId === selectedPothole.id ? 'Excluindo...' : 'Excluir Registro e Fotos'}
              icon="trash-can"
              loading={busyId === selectedPothole.id}
              disabled={isRowBusy}
              onPress={() => confirmDeletePothole(selectedPothole)}
            />
          </View>

          <View
            style={[
              styles.itemCard,
              cardShadow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusCard,
              },
            ]}
          >
            <View style={styles.sectionHeaderRow}>
              <FontAwesome6 name="images" size={13} color={colors.primary} />
              <Text style={[styles.sectionHeading, { color: colors.text }]}>
                Atualizações e Fotos Vinculadas ({linkedUpdates.length})
              </Text>
            </View>

            {linkedUpdates.length === 0 ? (
              <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>
                Nenhuma atualização ou foto comunitária vinculada a este registro.
              </Text>
            ) : (
              <View style={styles.linkedUpdatesList}>
                {linkedUpdates.map((upd) => {
                  const updFixed = upd.status === 'fixed';
                  const updThumb = upd.thumb_url || upd.full_url || null;
                  const updAuthor = upd.is_anonymous
                    ? 'Usuário Anônimo'
                    : upd.author_nickname || 'Cidadão';

                  return (
                    <View
                      key={upd.id}
                      style={[
                        styles.linkedUpdateCard,
                        {
                          backgroundColor: colors.surfaceMuted,
                          borderColor: colors.border,
                          borderRadius: radiusInput,
                        },
                      ]}
                    >
                      <View style={styles.linkedUpdateRow}>
                        {updThumb ? (
                          <Pressable
                            onPress={() =>
                              openZoomViewer({
                                thumbUri: upd.thumb_url || null,
                                fullUri: upd.full_url || upd.thumb_url || null,
                              })
                            }
                            style={[
                              styles.linkedThumbWrap,
                              { borderColor: colors.border, borderRadius: radiusInput },
                              isWeb ? styles.webPointer : null,
                            ]}
                          >
                            <Image
                              source={{ uri: updThumb }}
                              style={styles.fullImg}
                              resizeMode="cover"
                            />
                          </Pressable>
                        ) : (
                          <View
                            style={[
                              styles.linkedThumbPlaceholder,
                              {
                                backgroundColor: updFixed ? colors.successSoft : colors.dangerSoft,
                                borderColor: updFixed ? colors.success : colors.danger,
                                borderRadius: radiusInput,
                              },
                            ]}
                          >
                            <FontAwesome6
                              name={updFixed ? 'circle-check' : 'rotate-left'}
                              size={15}
                              color={updFixed ? colors.success : colors.danger}
                            />
                          </View>
                        )}

                        <View style={styles.denseRowMain}>
                          <View style={styles.itemTopRow}>
                            <View
                              style={[
                                styles.compactPill,
                                {
                                  backgroundColor: updFixed
                                    ? colors.successSoft
                                    : colors.dangerSoft,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.compactPillText,
                                  { color: updFixed ? colors.success : colors.danger },
                                ]}
                              >
                                {updFixed ? 'Já foi Tampado' : 'Continua Aberto'}
                              </Text>
                            </View>
                            <Text
                              style={[
                                styles.itemDate,
                                { color: colors.textMuted, fontVariant: typography.fontVariant },
                              ]}
                            >
                              {formatDateTimePtBr(upd.created_at)}
                            </Text>
                          </View>

                          <Text style={[styles.denseRowTitle, { color: colors.text }]}>
                            {updAuthor}
                          </Text>

                          {upd.note ? (
                            <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>
                              {upd.note}
                            </Text>
                          ) : null}

                          {upd.is_anonymous ? (
                            <Text
                              style={[styles.linkedRealAuthor, { color: colors.adminCardTitle }]}
                            >
                              {formatAdminRealAuthorLabel(upd.real_author, upd.user_id)}
                            </Text>
                          ) : null}
                        </View>

                        <Pressable
                          onPress={() => confirmDeleteUpdate(upd)}
                          disabled={Boolean(busyId)}
                          accessibilityLabel="Apagar atualização vinculada"
                          style={({ pressed }) => [
                            styles.deleteSmallBtn,
                            {
                              backgroundColor: colors.dangerSoft,
                              opacity: pressed ? 0.72 : 1,
                            },
                            isWeb ? styles.webPointer : null,
                          ]}
                        >
                          {busyId === upd.id ? (
                            <ActivityIndicator size="small" color={colors.danger} />
                          ) : (
                            <FontAwesome6 name="trash-can" size={14} color={colors.danger} />
                          )}
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      );
    }

    const filterPills = [
      { id: 'all', label: 'Todos', count: reportFilterCounts.all },
      { id: 'open', label: 'Abertos', count: reportFilterCounts.open },
      { id: 'review', label: 'Revisão', count: reportFilterCounts.review },
      { id: 'fixed', label: 'Tampados', count: reportFilterCounts.fixed },
    ];

    return (
      <View style={styles.listStack}>
        <View style={styles.filterPillsRow}>
          {filterPills.map((fp) => {
            const active = reportStatusFilter === fp.id;
            return (
              <Pressable
                key={fp.id}
                onPress={() => setReportStatusFilter(fp.id)}
                style={({ hovered, pressed }) => [
                  styles.filterPill,
                  {
                    backgroundColor: active
                      ? colors.primary
                      : isWeb && hovered
                        ? colors.surfaceMuted
                        : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                    borderWidth,
                    opacity: pressed ? 0.85 : 1,
                  },
                  isWeb ? styles.webPointer : null,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.filterPillText,
                    { color: active ? colors.primaryText : colors.text },
                  ]}
                >
                  {fp.label} ({fp.count})
                </Text>
              </Pressable>
            );
          })}
        </View>

        {filteredPotholes.length === 0 ? (
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            {potholes.length === 0
              ? 'Nenhum registro na nuvem no momento.'
              : 'Nenhum registro encontrado com este filtro.'}
          </Text>
        ) : (
          <View
            style={[
              styles.denseListCard,
              cardShadow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusCard,
              },
            ]}
          >
            {filteredPotholes.map((item, idx) => {
              const statusMeta = getReportStatusMeta(item);
              const linkedList = updatesByPotholeId[item.id] || [];
              const extraPhotoCount = linkedList.filter((u) => u.thumb_url || u.full_url).length;
              const photoCount = (item.thumb_url || item.full_url ? 1 : 0) + extraPhotoCount;

              return (
                <Pressable
                  key={item.id}
                  onPress={() => setSelectedPotholeId(item.id)}
                  style={({ hovered, pressed }) => [
                    styles.denseReportRow,
                    idx > 0 ? { borderTopWidth: 1, borderTopColor: colors.dividerColor } : null,
                    isWeb && hovered ? { backgroundColor: colors.surfaceMuted } : null,
                    pressed ? { opacity: 0.8 } : null,
                    isWeb ? styles.webPointer : null,
                  ]}
                >
                  {item.thumb_url ? (
                    <Image
                      source={{ uri: item.thumb_url }}
                      style={[
                        styles.reportListThumb,
                        { borderColor: colors.border, borderRadius: radiusInput },
                      ]}
                      resizeMode="cover"
                    />
                  ) : (
                    <View
                      style={[
                        styles.reportListThumbPlaceholder,
                        {
                          backgroundColor: colors.surfaceMuted,
                          borderColor: colors.border,
                          borderRadius: radiusInput,
                        },
                      ]}
                    >
                      <FontAwesome6 name="camera" size={16} color={colors.textMuted} />
                    </View>
                  )}

                  <View style={styles.denseRowMain}>
                    <Text numberOfLines={1} style={[styles.denseRowTitle, { color: colors.text }]}>
                      {item.street_address || 'Localização por GPS'}
                    </Text>
                    <View style={styles.reportMetaLine}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.denseRowSubtitle,
                          { color: colors.textSecondary, fontVariant: typography.fontVariant },
                        ]}
                      >
                        {formatDateTimePtBr(item.created_at)}
                      </Text>
                      <View
                        style={[
                          styles.photoCountBadge,
                          { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                        ]}
                      >
                        <FontAwesome6 name="images" size={10} color={colors.primary} />
                        <Text
                          style={[
                            styles.photoCountText,
                            { color: colors.text, fontVariant: typography.fontVariant },
                          ]}
                        >
                          {photoCount}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.denseRowTrailing}>
                    <View
                      style={[
                        styles.compactPill,
                        {
                          backgroundColor: statusMeta.bg,
                          borderColor: statusMeta.border,
                          borderWidth: 1,
                        },
                      ]}
                    >
                      <Text style={[styles.compactPillText, { color: statusMeta.color }]}>
                        {statusMeta.shortLabel}
                      </Text>
                    </View>
                    <FontAwesome6 name="chevron-right" size={12} color={colors.textMuted} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  const renderContent = () => {
    if (!isAdmin) {
      return (
        <View style={[styles.centerBox, SharedStyles.contentContainer]}>
          <FontAwesome6 name="shield-halved" size={32} color={colors.danger} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Acesso Restrito</Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            Esta área é exclusiva para administradores autorizados.
          </Text>
        </View>
      );
    }

    if (loading) {
      return (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            Carregando dados de moderação...
          </Text>
        </View>
      );
    }

    if (errorMsg) {
      return (
        <View style={[styles.centerBox, SharedStyles.contentContainer]}>
          <FontAwesome6 name="triangle-exclamation" size={26} color={colors.danger} />
          <Text style={[styles.emptyBody, { color: colors.danger }]}>{errorMsg}</Text>
          <SecondaryButton compact label="Tentar Novamente" icon="rotate" onPress={loadSnapshot} />
        </View>
      );
    }

    if (activeTab === 'audit') {
      return auditLogs.length === 0 ? (
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
          Nenhum registro de auditoria administrativa encontrado.
        </Text>
      ) : (
        auditLogs.map((log) => (
          <View
            key={log.id}
            style={[
              styles.itemCard,
              cardShadow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusCard,
              },
            ]}
          >
            <View style={styles.itemTopRow}>
              <Text style={[styles.itemTitle, { color: colors.primary }]}>
                {translateAuditAction(log.action)}
              </Text>
              <Text
                style={[
                  styles.itemDate,
                  { color: colors.textMuted, fontVariant: typography.fontVariant },
                ]}
              >
                {formatDateTimePtBr(log.created_at)}
              </Text>
            </View>
            <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>
              Alvo: {log.target_type || '-'} ({shortId(log.target_id)}) • Admin:{' '}
              {shortId(log.admin_user_id || log.actor_id)}
            </Text>
          </View>
        ))
      );
    }

    if (activeTab === 'potholes') {
      return renderReportsTab();
    }

    return renderUsersTab();
  };

  const content = (
    <View
      style={[
        isWeb ? styles.screenCardWeb : styles.screen,
        isDesktopWeb ? styles.screenCardWebWide : null,
        {
          backgroundColor: colors.background,
          paddingTop: topSafePadding,
          paddingBottom: isWeb ? 16 : Math.max(12, insets.bottom),
          minHeight: isWeb && (passwordTargetProfile || zoomMedia) ? 340 : undefined,
        },
        isWeb ? [cardShadow, { borderColor: colors.border, borderWidth }] : null,
      ]}
    >
      <View style={[SharedStyles.contentContainer, styles.header]}>
        <View style={styles.headerLeft}>
          <FontAwesome6 name="gavel" size={18} color={colors.danger} />
          <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.text }]}>
            Painel Administrativo
          </Text>
        </View>

        <View style={styles.headerRight}>
          <Pressable
            onPress={loadSnapshot}
            accessibilityLabel="Recarregar moderação"
            style={({ hovered, pressed }) => [
              styles.iconBtn,
              {
                backgroundColor: isWeb && hovered ? colors.accentSoft : colors.surfaceMuted,
                opacity: pressed ? 0.8 : 1,
              },
              isWeb ? styles.webPointer : null,
            ]}
          >
            <FontAwesome6 name="rotate" size={14} color={colors.primary} />
          </Pressable>

          <Pressable
            onPress={onClose}
            accessibilityLabel="Fechar painel administrativo"
            style={({ hovered, pressed }) => [
              styles.iconBtn,
              {
                backgroundColor: isWeb && hovered ? colors.dangerSoft : colors.surfaceMuted,
                opacity: pressed ? 0.8 : 1,
              },
              isWeb ? styles.webPointer : null,
            ]}
          >
            <FontAwesome6 name="xmark" size={16} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {isAdmin ? renderSegmentedTabs() : null}

      <ScrollView
        style={isWeb ? styles.webScroll : undefined}
        contentContainerStyle={[SharedStyles.contentContainer, styles.scrollBody]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {renderContent()}
      </ScrollView>

      {passwordTargetProfile ? (
        <View style={styles.resetOverlay}>
          <View
            style={[
              SharedStyles.contentContainer,
              styles.resetCard,
              cardShadow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth,
                borderRadius: radiusCard,
              },
            ]}
          >
            <View style={styles.itemTopRow}>
              <Text style={[styles.resetTitle, { color: colors.text }]}>
                Alterar Senha do Usuário
              </Text>
              <Pressable
                onPress={closeResetPasswordPrompt}
                disabled={resetBusy}
                hitSlop={8}
                style={[
                  styles.iconBtn,
                  { backgroundColor: colors.surfaceMuted },
                  isWeb ? styles.webPointer : null,
                ]}
              >
                <FontAwesome6 name="xmark" size={14} color={colors.text} />
              </Pressable>
            </View>

            <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>
              Usuário: {passwordTargetProfile.nickname || 'Cidadão'}
              {passwordTargetProfile.email
                ? ` (${passwordTargetProfile.email})`
                : ` (UID ${shortId(passwordTargetProfile.id)})`}
            </Text>

            <View
              style={[
                styles.resetInputWrap,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                  borderWidth,
                  borderRadius: radiusInput,
                },
              ]}
            >
              <FontAwesome6 name="lock" size={14} color={colors.textMuted} />
              <TextInput
                value={resetPasswordInput}
                onChangeText={setResetPasswordInput}
                placeholder="Nova senha (mín. 6 caracteres)"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showResetPassword}
                autoCapitalize="none"
                style={[styles.resetInput, { color: colors.text }]}
              />
              <Pressable onPress={() => setShowResetPassword((v) => !v)} hitSlop={8}>
                <FontAwesome6
                  name={showResetPassword ? 'eye-slash' : 'eye'}
                  size={15}
                  color={colors.textMuted}
                />
              </Pressable>
            </View>

            {resetError ? (
              <Text style={[styles.resetErrorText, { color: colors.danger }]}>{resetError}</Text>
            ) : null}

            <View style={styles.actionsGridRow}>
              <SecondaryButton
                compact
                label="Cancelar"
                disabled={resetBusy}
                onPress={closeResetPasswordPrompt}
                style={styles.flexOne}
              />
              <PrimaryButton
                compact
                label={resetBusy ? 'Salvando...' : 'Redefinir Senha'}
                icon="check"
                loading={resetBusy}
                disabled={resetBusy}
                onPress={handleConfirmResetPassword}
                style={styles.flexOne}
              />
            </View>
          </View>
        </View>
      ) : null}

      {zoomMedia ? (
        <View
          style={[
            styles.zoomOverlay,
            {
              backgroundColor: colors.overlay,
              paddingTop: Math.max(insets.top, 20) + 8,
              paddingBottom: Math.max(16, insets.bottom + 12),
            },
          ]}
        >
          <View style={styles.zoomHeader}>
            <View
              style={[
                styles.zoomPill,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderWidth,
                  borderRadius: radiusButton,
                },
              ]}
            >
              <FontAwesome6 name="magnifying-glass" size={12} color={colors.primary} />
              <Text style={[styles.zoomPillText, { color: colors.text }]}>Foto Original</Text>
            </View>

            <Pressable
              onPress={closeZoomViewer}
              accessibilityLabel="Fechar foto ampliada"
              style={[
                styles.zoomCloseBtn,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderWidth,
                  borderRadius: radiusButton,
                },
                isWeb ? styles.webPointer : null,
              ]}
            >
              <FontAwesome6 name="xmark" size={18} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.zoomStage}>
            <View style={styles.zoomImageFrame}>
              {zoomMedia.thumbUri ? (
                <Image
                  source={{ uri: zoomMedia.thumbUri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                />
              ) : null}

              {zoomMedia.hasDistinctFull && zoomMedia.fullUri && zoomFullStatus !== 'error' ? (
                <Image
                  key={zoomMedia.fullUri}
                  source={{ uri: zoomMedia.fullUri }}
                  style={[
                    StyleSheet.absoluteFill,
                    { opacity: zoomFullStatus === 'loaded' ? 1 : 0 },
                  ]}
                  resizeMode="contain"
                  onLoad={() => setZoomFullStatus('loaded')}
                  onError={() => setZoomFullStatus('error')}
                />
              ) : null}
            </View>

            {zoomFullStatus === 'loading' ? (
              <View
                pointerEvents="none"
                style={[styles.zoomLoadingPill, { backgroundColor: colors.overlay }]}
              >
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.zoomHintText}>Carregando foto original...</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );

  if (inline) {
    return content;
  }

  return (
    <Modal
      visible={visible}
      transparent={isWeb}
      animationType={isWeb ? 'fade' : 'slide'}
      onRequestClose={handleRequestClose}
    >
      {isWeb ? (
        <View
          style={[
            styles.webBackdrop,
            { justifyContent: isCompactWidth ? 'flex-end' : 'center' },
          ]}
        >
          {content}
        </View>
      ) : (
        content
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  webBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  screenCardWeb: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '88dvh',
    borderRadius: 24,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  screenCardWebWide: {
    maxWidth: 640,
  },
  webScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  screen: {
    flex: 1,
    paddingHorizontal: 16,
  },
  webPointer: {
    cursor: 'pointer',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    gap: 8,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    gap: 4,
    marginBottom: 12,
  },
  segmentedTabBtn: {
    minHeight: 44,
    paddingHorizontal: 6,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedTabText: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  scrollBody: {
    gap: 12,
    paddingBottom: 24,
  },
  centerBox: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  emptyBody: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  listStack: {
    gap: 10,
  },
  detailStack: {
    gap: 12,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    minHeight: 44,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  denseListCard: {
    overflow: 'hidden',
  },
  denseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 58,
    gap: 10,
  },
  denseReportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 68,
    gap: 10,
  },
  denseRowMain: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  denseRowTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  denseRowSubtitle: {
    fontSize: 12,
    flexShrink: 1,
  },
  denseRowTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  compactPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  compactPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  filterPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterPill: {
    minHeight: 38,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  reportListThumb: {
    width: 48,
    height: 48,
    borderWidth: 1,
  },
  reportListThumbPlaceholder: {
    width: 48,
    height: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  photoCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  photoCountText: {
    fontSize: 11,
    fontWeight: '700',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    gap: 8,
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  detailTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  detailMetaBlock: {
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 7,
  },
  detailMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  detailMetaText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  detailAddressText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricTile: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    alignItems: 'center',
    gap: 2,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionsGridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtnGuard: {
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  heroPhotoCard: {
    overflow: 'hidden',
  },
  heroPhotoBox: {
    width: '100%',
    height: 190,
    position: 'relative',
  },
  zoomHintPill: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 6,
  },
  zoomHintText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  linkedUpdatesList: {
    gap: 10,
  },
  linkedUpdateCard: {
    padding: 10,
    borderWidth: 1,
  },
  linkedUpdateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  linkedThumbWrap: {
    width: 52,
    height: 52,
    borderWidth: 1,
    overflow: 'hidden',
  },
  linkedThumbPlaceholder: {
    width: 44,
    height: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullImg: {
    width: '100%',
    height: '100%',
  },
  linkedRealAuthor: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
  },
  deleteSmallBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  itemCard: {
    padding: 14,
    gap: 10,
  },
  flexOne: {
    flex: 1,
  },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  itemDate: {
    fontSize: 11,
  },
  itemMeta: {
    fontSize: 11,
    lineHeight: 16,
  },
  itemPreview: {
    fontSize: 13,
    lineHeight: 19,
  },
  adminAuthorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  adminAuthorBadgeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  resetOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 50,
  },
  resetCard: {
    padding: 18,
    gap: 12,
  },
  resetTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  resetInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    minHeight: 48,
    gap: 10,
  },
  resetInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
  },
  resetErrorText: {
    fontSize: 12,
    fontWeight: '600',
  },
  zoomOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  zoomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  zoomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 8,
  },
  zoomPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  zoomCloseBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomStage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 12,
  },
  zoomImageFrame: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  zoomLoadingPill: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 7,
  },
});

export default AdminPanelModal;
