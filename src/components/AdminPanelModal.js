import { FontAwesome6 } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
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
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SharedStyles } from '../../components/StyleSheet/Styles';
import { DangerButton, PrimaryButton, SecondaryButton } from '../../components/common/Buttons';
import { useAppSettings } from '../context/AppSettingsContext';
import {
  adminDeleteFullAccount,
  adminDeletePothole,
  adminDeletePotholeUpdate,
  adminDeleteProfile,
  adminResetUserPassword,
  fetchAdminAuditLogs,
  fetchAdminPotholes,
  fetchAdminProfiles,
  fetchAdminUpdates,
  formatAdminRealAuthorLabel,
} from '../services/adminService';
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
    radiusCard,
    radiusButton,
    radiusInput,
    borderWidth,
    cardShadow,
    typography,
    notifyDataRestored,
  } = useAppSettings();

  const [activeTab, setActiveTab] = useState('potholes'); // 'potholes' | 'updates' | 'profiles' | 'audit'

  const [potholes, setPotholes] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [passwordTargetProfile, setPasswordTargetProfile] = useState(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');

  const topSafePadding =
    Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 12) + 8;

  const isAdmin = Boolean(session?.isAdmin);

  const loadCurrentData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setErrorMsg('');
    try {
      if (activeTab === 'audit') {
        const list = await fetchAdminAuditLogs(50);
        setAuditLogs(list);
      } else if (activeTab === 'potholes') {
        const list = await fetchAdminPotholes(50);
        setPotholes(list);
      } else if (activeTab === 'updates') {
        const list = await fetchAdminUpdates(50);
        setUpdates(list);
      } else {
        const list = await fetchAdminProfiles(50);
        setProfiles(list);
      }
    } catch (err) {
      setErrorMsg(err?.message || 'Erro ao carregar dados administrativos.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (visible && isAdmin) {
      loadCurrentData();
    } else if (!visible) {
      setPasswordTargetProfile(null);
      setResetPasswordInput('');
      setShowResetPassword(false);
      setResetError('');
    }
  }, [visible, isAdmin, loadCurrentData]);

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
    } catch (err) {
      setResetError(err?.message || 'Não foi possível redefinir a senha do usuário.');
    } finally {
      setResetBusy(false);
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
          notifyDataRestored();
          onModerationChange?.();
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
      'Apagar Comentário/Atualização?',
      `Atualização ${shortId(item.id)} (${item.is_anonymous ? 'Usuário Anônimo' : item.author_nickname || 'Cidadão'}). A foto associada também será removida.`,
      'Confirmar Remoção',
      async () => {
        setBusyId(item.id);
        try {
          await adminDeletePotholeUpdate(item.id);
          setUpdates((prev) => prev.filter((u) => u.id !== item.id));
          notifyDataRestored();
          onModerationChange?.();
        } catch (err) {
          notifyAdminError('Erro', err?.message || 'Falha ao apagar comentário.');
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
        } catch (err) {
          notifyAdminError('Erro', err?.message || 'Falha ao excluir conta.');
        } finally {
          setBusyId(null);
        }
      }
    );
  };

  const renderTabs = () => {
    const tabs = [
      { id: 'potholes', label: 'Registros & Fotos', icon: 'road-circle-exclamation' },
      { id: 'updates', label: 'Comentários', icon: 'comments' },
      { id: 'profiles', label: 'Perfis & Contas', icon: 'users' },
      { id: 'audit', label: 'Auditoria', icon: 'clipboard-list' },
    ];
    return (
      <View style={[SharedStyles.contentContainer, styles.tabBarWrap]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabRowScroll}
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={[
                  styles.tabPill,
                  cardShadow,
                  {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                    borderWidth,
                    borderRadius: radiusButton,
                  },
                ]}
              >
                <FontAwesome6
                  name={tab.icon}
                  size={12}
                  color={active ? colors.primaryText : colors.textSecondary}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.tabText,
                    { color: active ? colors.primaryText : colors.text },
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
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
          <SecondaryButton compact label="Tentar Novamente" icon="rotate" onPress={loadCurrentData} />
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
      return potholes.length === 0 ? (
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
          Nenhum registro na nuvem no momento.
        </Text>
      ) : (
        potholes.map((item) => {
          const isFixed = item.status === 'fixed';
          const author = item.is_anonymous
            ? 'Usuário Anônimo'
            : item.author_nickname || 'Cidadão';
          return (
            <View
              key={item.id}
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
              <View style={styles.cardBodyRow}>
                {item.thumb_url ? (
                  <Image
                    source={{ uri: item.thumb_url }}
                    style={[
                      styles.previewThumb,
                      { borderColor: colors.border, borderRadius: radiusInput },
                    ]}
                    resizeMode="cover"
                  />
                ) : null}
                <View style={styles.flexOne}>
                  <View style={styles.itemTopRow}>
                    <Text style={[styles.itemTitle, { color: colors.text }]}>{author}</Text>
                    <View
                      style={[
                        styles.statusPill,
                        { backgroundColor: isFixed ? colors.successSoft : colors.dangerSoft },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusPillText,
                          { color: isFixed ? colors.success : colors.danger },
                        ]}
                      >
                        {isFixed ? 'Tampado' : 'Aberto'}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.itemMeta,
                      { color: colors.textMuted, fontVariant: typography.fontVariant },
                    ]}
                  >
                    ID: {shortId(item.id)} • {formatDateTimePtBr(item.created_at)}
                  </Text>
                  <Text style={[styles.itemPreview, { color: colors.textSecondary }]} numberOfLines={2}>
                    {item.street_address} — {item.comment}
                  </Text>
                  {item.is_anonymous ? (
                    <View style={styles.adminAuthorBadge}>
                      <FontAwesome6 name="user-shield" size={11} color="#B3261E" />
                      <Text style={styles.adminAuthorBadgeText}>
                        {formatAdminRealAuthorLabel(item.real_author, item.user_id)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              <DangerButton
                compact
                label="Excluir Registro e Fotos"
                icon="trash-can"
                loading={busyId === item.id}
                disabled={Boolean(busyId)}
                onPress={() => confirmDeletePothole(item)}
              />
            </View>
          );
        })
      );
    }

    if (activeTab === 'updates') {
      return updates.length === 0 ? (
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
          Nenhum comentário/atualização na nuvem no momento.
        </Text>
      ) : (
        updates.map((item) => {
          const isFixed = item.status === 'fixed';
          const author = item.is_anonymous
            ? 'Usuário Anônimo'
            : item.author_nickname || 'Cidadão';
          return (
            <View
              key={item.id}
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
              <View style={styles.cardBodyRow}>
                {item.thumb_url ? (
                  <Image
                    source={{ uri: item.thumb_url }}
                    style={[
                      styles.previewThumb,
                      { borderColor: colors.border, borderRadius: radiusInput },
                    ]}
                    resizeMode="cover"
                  />
                ) : null}
                <View style={styles.flexOne}>
                  <View style={styles.itemTopRow}>
                    <Text style={[styles.itemTitle, { color: colors.text }]}>{author}</Text>
                    <View
                      style={[
                        styles.statusPill,
                        { backgroundColor: isFixed ? colors.successSoft : colors.dangerSoft },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusPillText,
                          { color: isFixed ? colors.success : colors.danger },
                        ]}
                      >
                        {isFixed ? 'Já foi Tampado' : 'Continua Aberto'}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.itemMeta,
                      { color: colors.textMuted, fontVariant: typography.fontVariant },
                    ]}
                  >
                    ID: {shortId(item.id)} • Buraco: {shortId(item.pothole_id)} •{' '}
                    {formatDateTimePtBr(item.created_at)}
                  </Text>
                  <Text style={[styles.itemPreview, { color: colors.textSecondary }]} numberOfLines={2}>
                    {item.note || 'Sem observação adicional.'}
                  </Text>
                  {item.is_anonymous ? (
                    <View style={styles.adminAuthorBadge}>
                      <FontAwesome6 name="user-shield" size={11} color="#B3261E" />
                      <Text style={styles.adminAuthorBadgeText}>
                        {formatAdminRealAuthorLabel(item.real_author, item.user_id)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              <DangerButton
                compact
                label="Apagar Comentário"
                icon="comment-slash"
                loading={busyId === item.id}
                disabled={Boolean(busyId)}
                onPress={() => confirmDeleteUpdate(item)}
              />
            </View>
          );
        })
      );
    }

    return profiles.length === 0 ? (
      <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
        Nenhum perfil cadastrado encontrado.
      </Text>
    ) : (
      profiles.map((profile) => {
        const isSelf = profile.id === session?.userId;
        return (
          <View
            key={profile.id}
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
              <Text style={[styles.itemTitle, { color: colors.text }]}>
                {profile.nickname} {isSelf ? '(Sua conta)' : ''}
              </Text>
              <Text
                style={[
                  styles.itemDate,
                  { color: colors.textMuted, fontVariant: typography.fontVariant },
                ]}
              >
                {formatDateTimePtBr(profile.created_at)}
              </Text>
            </View>
            <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>
              UID: {shortId(profile.id)}
              {profile.email ? ` • ${profile.email}` : ''}
            </Text>

            <SecondaryButton
              compact
              label="Alterar Senha"
              icon="lock"
              disabled={Boolean(busyId) || resetBusy}
              onPress={() => openResetPasswordPrompt(profile)}
            />

            <View style={styles.profileActionsRow}>
              <SecondaryButton
                compact
                label="Apagar Perfil"
                icon="user-slash"
                disabled={isSelf || Boolean(busyId)}
                loading={busyId === profile.id}
                onPress={() => confirmDeleteProfile(profile)}
                style={styles.flexOne}
              />
              <DangerButton
                compact
                label="Excluir Conta Completa"
                icon="user-xmark"
                disabled={isSelf || Boolean(busyId)}
                loading={busyId === profile.id}
                onPress={() => confirmDeleteFullAccount(profile)}
                style={styles.flexOne}
              />
            </View>
          </View>
        );
      })
    );
  };

  const content = (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
          paddingTop: topSafePadding,
          paddingBottom: Math.max(12, insets.bottom),
        },
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
            onPress={loadCurrentData}
            accessibilityLabel="Recarregar moderação"
            style={[styles.iconBtn, { backgroundColor: colors.surfaceMuted }]}
          >
            <FontAwesome6 name="rotate" size={14} color={colors.primary} />
          </Pressable>

          <Pressable
            onPress={onClose}
            accessibilityLabel="Fechar painel administrativo"
            style={[styles.iconBtn, { backgroundColor: colors.surfaceMuted }]}
          >
            <FontAwesome6 name="xmark" size={16} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {isAdmin ? renderTabs() : null}

      <ScrollView
        contentContainerStyle={[SharedStyles.contentContainer, styles.scrollBody]}
        showsVerticalScrollIndicator={false}
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
                style={[styles.iconBtn, { backgroundColor: colors.surfaceMuted }]}
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

            <View style={styles.profileActionsRow}>
              <SecondaryButton
                compact
                label="Cancelar"
                disabled={resetBusy}
                onPress={closeResetPasswordPrompt}
                style={styles.flexOne}
              />
              <PrimaryButton
                compact
                label={resetBusy ? 'Salvando...' : 'Redefinir Senha do Usuário'}
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
    </View>
  );

  if (inline) {
    return content;
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 16,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarWrap: {
    marginBottom: 12,
  },
  tabRowScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
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
  itemCard: {
    padding: 14,
    gap: 10,
  },
  cardBodyRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  previewThumb: {
    width: 60,
    height: 60,
    borderWidth: 1,
  },
  flexOne: {
    flex: 1,
    gap: 4,
  },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    fontSize: 12,
    lineHeight: 18,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  profileActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  adminAuthorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#FCE8E6',
    borderWidth: 1,
    borderColor: '#F5C2C0',
  },
  adminAuthorBadgeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: '#8C1D18',
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
});

export default AdminPanelModal;
