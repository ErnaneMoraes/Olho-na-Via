import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { checkIsAdmin } from './adminService';
import { recordDiagnosticEvent } from './diagnosticLogService';
import { isSupabaseConfigured, supabase } from './supabaseClient';

const AUTH_USERS_KEY = '@olhonavia:auth_users';
const AUTH_SESSION_KEY = '@olhonavia:auth_session';
const REMEMBER_ME_KEY = '@olhonavia:remember_me';
const SAVED_EMAIL_KEY = '@olhonavia:saved_email';
const HASH_DOMAIN_TAG = 'OlhoNaVia::LGPD::v1';

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function generateRandomSaltHex() {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return bytesToHex(bytes);
}

async function hashPasswordWithSalt(password, saltHex) {
  const payload = `${HASH_DOMAIN_TAG}:${saltHex}:${password}`;
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function getRememberMePreferences() {
  try {
    const [rememberFlag, savedEmail] = await Promise.all([
      AsyncStorage.getItem(REMEMBER_ME_KEY),
      AsyncStorage.getItem(SAVED_EMAIL_KEY),
    ]);
    const rememberMe = rememberFlag !== 'false';
    return {
      rememberMe,
      savedEmail: rememberMe && savedEmail ? savedEmail : '',
    };
  } catch {
    return { rememberMe: true, savedEmail: '' };
  }
}

export async function saveRememberMePreferences({ rememberMe = true, email = '' } = {}) {
  const shouldRemember = Boolean(rememberMe);
  const cleanEmail = normalizeEmail(email);
  try {
    await AsyncStorage.setItem(REMEMBER_ME_KEY, shouldRemember ? 'true' : 'false');
    if (shouldRemember && cleanEmail) {
      await AsyncStorage.setItem(SAVED_EMAIL_KEY, cleanEmail);
    } else {
      await AsyncStorage.removeItem(SAVED_EMAIL_KEY);
    }
  } catch {
    // Preferência local não crítica
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createAuthError(message, code = null) {
  const err = new Error(message);
  err.isAuthError = true;
  if (code) err.code = code;
  return err;
}

function translateSupabaseAuthError(error) {
  const msg = String(error?.message || '').toLowerCase();
  if (msg.includes('invalid login credentials')) {
    return 'E-mail ou senha inválidos.';
  }
  if (msg.includes('user already registered') || msg.includes('already been registered')) {
    return 'Já existe uma conta cadastrada com este e-mail.';
  }
  if (msg.includes('password should be at least')) {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }
  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'Muitas tentativas seguidas. Aguarde alguns instantes e tente novamente.';
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'Sem conexão com a nuvem no momento. Verifique sua internet ou use o Modo Demonstração.';
  }
  return error?.message || 'Não foi possível autenticar na nuvem.';
}

/**
 * Adaptador local em conformidade com a LGPD usando AsyncStorage + expo-crypto.
 * Mantido para Modo Demonstração e fallback quando o .env não estiver configurado.
 */
export const LocalAsyncStorageAuthAdapter = {
  async getStoredUsers() {
    const raw = await AsyncStorage.getItem(AUTH_USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  },

  async saveStoredUsers(users) {
    await AsyncStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
  },

  async register({ nickname, email, password }) {
    const cleanNickname = String(nickname || '').trim();
    const cleanEmail = normalizeEmail(email);
    const rawPassword = String(password || '');

    if (cleanNickname.length < 2) {
      throw createAuthError('Informe um Apelido com pelo menos 2 caracteres.');
    }
    if (!isValidEmail(cleanEmail)) {
      throw createAuthError('Informe um endereço de e-mail válido.');
    }
    if (rawPassword.length < 6) {
      throw createAuthError('A senha deve ter pelo menos 6 caracteres.');
    }

    const users = await this.getStoredUsers();
    const existingUser = users.find((u) => u.email === cleanEmail);
    if (existingUser) {
      const candidateHash = await hashPasswordWithSalt(rawPassword, existingUser.salt);
      if (candidateHash === existingUser.passwordHash) {
        const session = {
          userId: existingUser.id,
          nickname: existingUser.nickname,
          isDemo: false,
          isAdmin: false,
          provider: 'local_lgpd',
          loggedInAt: new Date().toISOString(),
        };
        await AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
        await recordDiagnosticEvent('AUTH', 'E-mail já cadastrado: login automático local');
        return session;
      }
      throw createAuthError(
        'Este e-mail já possui cadastro. Alteramos para a aba Entrar — digite sua senha ou use outro e-mail.',
        'EMAIL_ALREADY_REGISTERED'
      );
    }

    const salt = await generateRandomSaltHex();
    const passwordHash = await hashPasswordWithSalt(rawPassword, salt);
    const nowIso = new Date().toISOString();

    const newUser = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      nickname: cleanNickname,
      email: cleanEmail,
      salt,
      passwordHash,
      createdAt: nowIso,
    };

    await this.saveStoredUsers([...users, newUser]);

    const session = {
      userId: newUser.id,
      nickname: newUser.nickname,
      isDemo: false,
      isAdmin: false,
      provider: 'local_lgpd',
      loggedInAt: nowIso,
    };
    await AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    await saveRememberMePreferences({ rememberMe: true, email: cleanEmail });
    await recordDiagnosticEvent('AUTH', 'Cadastro local concluído com hash SHA-256 + salt');
    return session;
  },

  async login({ email, password, rememberMe = true }) {
    const cleanEmail = normalizeEmail(email);
    const rawPassword = String(password || '');

    if (!isValidEmail(cleanEmail)) {
      throw createAuthError('Informe um endereço de e-mail válido.');
    }
    if (!rawPassword) {
      throw createAuthError('Informe sua senha para entrar.');
    }

    const users = await this.getStoredUsers();
    const user = users.find((u) => u.email === cleanEmail);
    if (!user) {
      throw createAuthError('E-mail ou senha inválidos.');
    }

    const candidateHash = await hashPasswordWithSalt(rawPassword, user.salt);
    if (candidateHash !== user.passwordHash) {
      await recordDiagnosticEvent('AUTH', 'Tentativa de login com credenciais inválidas');
      throw createAuthError('E-mail ou senha inválidos.');
    }

    const session = {
      userId: user.id,
      nickname: user.nickname,
      isDemo: false,
      isAdmin: false,
      provider: 'local_lgpd',
      loggedInAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    await saveRememberMePreferences({ rememberMe, email: cleanEmail });
    await recordDiagnosticEvent('AUTH', 'Login local autenticado com sucesso');
    return session;
  },

  async loginDemo() {
    const session = {
      userId: 'demo_olhonavia',
      nickname: 'Cidadão Demo',
      isDemo: true,
      isAdmin: false,
      provider: 'demo_local',
      loggedInAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    await recordDiagnosticEvent('AUTH', 'Sessão iniciada em Modo Demonstração');
    return session;
  },

  async getCurrentSession() {
    try {
      const rememberFlag = await AsyncStorage.getItem(REMEMBER_ME_KEY);
      if (rememberFlag === 'false') {
        await AsyncStorage.removeItem(AUTH_SESSION_KEY);
        return null;
      }
      const raw = await AsyncStorage.getItem(AUTH_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.userId ? parsed : null;
    } catch {
      return null;
    }
  },

  async updateSession(patch) {
    const current = await this.getCurrentSession();
    if (!current) return null;
    const updated = { ...current, ...patch };
    await AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(updated));
    return updated;
  },

  async logout() {
    await AsyncStorage.removeItem(AUTH_SESSION_KEY);
    await recordDiagnosticEvent('AUTH', 'Sessão encerrada pelo usuário');
  },

  async changeOwnPassword(currentPassword, newPassword) {
    const rawCurrent = String(currentPassword || '');
    const rawNext = String(newPassword || '');

    const rawSession = await AsyncStorage.getItem(AUTH_SESSION_KEY);
    const parsedSession = rawSession ? JSON.parse(rawSession) : null;
    if (!parsedSession?.userId || parsedSession?.isDemo) {
      throw createAuthError('Modo Demonstração não permite alteração de senha.');
    }
    if (!rawCurrent) {
      throw createAuthError('Informe sua senha atual.');
    }
    if (rawNext.length < 6) {
      throw createAuthError('A nova senha deve ter pelo menos 6 caracteres.');
    }
    if (rawNext === rawCurrent) {
      throw createAuthError('A nova senha deve ser diferente da senha atual.');
    }

    const users = await this.getStoredUsers();
    const userIndex = users.findIndex((u) => u.id === parsedSession.userId);
    if (userIndex < 0) {
      throw createAuthError('Conta local não encontrada.');
    }

    const targetUser = users[userIndex];
    const currentHash = await hashPasswordWithSalt(rawCurrent, targetUser.salt);
    if (currentHash !== targetUser.passwordHash) {
      throw createAuthError('Senha atual incorreta. Verifique e tente novamente.');
    }

    const nextSalt = await generateRandomSaltHex();
    const nextHash = await hashPasswordWithSalt(rawNext, nextSalt);
    users[userIndex] = {
      ...targetUser,
      salt: nextSalt,
      passwordHash: nextHash,
      updatedAt: new Date().toISOString(),
    };
    await this.saveStoredUsers(users);
    await recordDiagnosticEvent('AUTH', 'Senha local alterada pelo usuário');
    return { success: true, message: 'Senha alterada com sucesso!' };
  },
};

/**
 * Adaptador Supabase Auth (nuvem) com fallback seguro ao Modo Demonstração.
 */
export const SupabaseAuthAdapter = {
  async register({ nickname, email, password }) {
    const cleanNickname = String(nickname || '').trim();
    const cleanEmail = normalizeEmail(email);
    const rawPassword = String(password || '');

    if (cleanNickname.length < 2) {
      throw createAuthError('Informe um Apelido com pelo menos 2 caracteres.');
    }
    if (!isValidEmail(cleanEmail)) {
      throw createAuthError('Informe um endereço de e-mail válido.');
    }
    if (rawPassword.length < 6) {
      throw createAuthError('A senha deve ter pelo menos 6 caracteres.');
    }

    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password: rawPassword,
      options: {
        data: { nickname: cleanNickname },
      },
    });

    const errMsgLower = String(error?.message || '').toLowerCase();
    const isDuplicateEmail =
      errMsgLower.includes('already registered') ||
      errMsgLower.includes('already exists') ||
      errMsgLower.includes('already been registered') ||
      (!error &&
        Array.isArray(data?.user?.identities) &&
        data.user.identities.length === 0);

    if (isDuplicateEmail) {
      const autoSignIn = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: rawPassword,
      });

      if (autoSignIn.data?.user && autoSignIn.data?.session) {
        let resolvedNickname =
          autoSignIn.data.user.user_metadata?.nickname || cleanNickname || 'Cidadão';
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('nickname')
            .eq('id', autoSignIn.data.user.id)
            .maybeSingle();
          if (profile?.nickname) {
            resolvedNickname = profile.nickname;
          }
        } catch {
          // Mantém apelido disponível
        }

        const isAdmin = await checkIsAdmin(autoSignIn.data.user.id);
        const session = {
          userId: autoSignIn.data.user.id,
          nickname: resolvedNickname,
          isDemo: false,
          isAdmin: Boolean(isAdmin),
          provider: 'supabase',
          loggedInAt: new Date().toISOString(),
        };
        await AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
        await recordDiagnosticEvent('AUTH', 'E-mail já cadastrado: login automático Supabase');
        return session;
      }

      await recordDiagnosticEvent('AUTH', 'E-mail duplicado direcionado para aba Entrar');
      throw createAuthError(
        'Este e-mail já possui cadastro. Alteramos para a aba Entrar — digite sua senha ou use outro e-mail.',
        'EMAIL_ALREADY_REGISTERED'
      );
    }

    if (error) {
      await recordDiagnosticEvent('AUTH', 'Falha no cadastro Supabase');
      throw createAuthError(translateSupabaseAuthError(error));
    }

    let activeUser = data?.user || null;
    let activeSession = data?.session || null;

    if (!activeSession) {
      const signInRes = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: rawPassword,
      });
      if (signInRes.error || !signInRes.data?.session) {
        await recordDiagnosticEvent('AUTH', 'Cadastro criado, mas falha ao iniciar sessão imediata');
        throw createAuthError(
          translateSupabaseAuthError(signInRes.error) ||
            'Conta criada! Não foi possível iniciar sessão automática agora. Tente entrar novamente.'
        );
      }
      activeSession = signInRes.data.session;
      activeUser = signInRes.data.user || activeUser;
    }

    if (activeUser?.id) {
      try {
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({ id: activeUser.id, nickname: cleanNickname }, { onConflict: 'id' });
        if (profileError) {
          await recordDiagnosticEvent('AUTH', 'Aviso ao salvar perfil após cadastro');
        }
      } catch {
        // Não bloqueia a entrada se a gravação auxiliar de perfil falhar pontualmente
      }
    }

    const isAdmin = activeUser?.id ? await checkIsAdmin(activeUser.id) : false;
    const session = {
      userId: activeUser?.id || `usr_${Date.now()}`,
      nickname: cleanNickname,
      isDemo: false,
      isAdmin: Boolean(isAdmin),
      provider: 'supabase',
      loggedInAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    await saveRememberMePreferences({ rememberMe: true, email: cleanEmail });
    await recordDiagnosticEvent('AUTH', 'Cadastro em nuvem Supabase concluído com login imediato');
    return session;
  },

  async login({ email, password, rememberMe = true }) {
    const cleanEmail = normalizeEmail(email);
    const rawPassword = String(password || '');

    if (!isValidEmail(cleanEmail)) {
      throw createAuthError('Informe um endereço de e-mail válido.');
    }
    if (!rawPassword) {
      throw createAuthError('Informe sua senha para entrar.');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: rawPassword,
    });

    if (error || !data?.user) {
      await recordDiagnosticEvent('AUTH', 'Falha no login Supabase');
      throw createAuthError(translateSupabaseAuthError(error));
    }

    let resolvedNickname = data.user.user_metadata?.nickname || 'Cidadão';
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('nickname')
        .eq('id', data.user.id)
        .maybeSingle();
      if (profile?.nickname) {
        resolvedNickname = profile.nickname;
      } else {
        await supabase
          .from('profiles')
          .upsert({ id: data.user.id, nickname: resolvedNickname }, { onConflict: 'id' });
      }
    } catch {
      // Usa apelido dos metadados se a leitura de perfil falhar pontualmente
    }

    const isAdmin = await checkIsAdmin(data.user.id);
    const session = {
      userId: data.user.id,
      nickname: resolvedNickname,
      isDemo: false,
      isAdmin: Boolean(isAdmin),
      provider: 'supabase',
      loggedInAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    await saveRememberMePreferences({ rememberMe, email: cleanEmail });
    await recordDiagnosticEvent('AUTH', 'Login Supabase autenticado');
    return session;
  },

  async loginDemo() {
    return LocalAsyncStorageAuthAdapter.loginDemo();
  },

  async getCurrentSession() {
    try {
      const rememberFlag = await AsyncStorage.getItem(REMEMBER_ME_KEY);
      if (rememberFlag === 'false') {
        if (supabase) {
          try {
            await supabase.auth.signOut();
          } catch {
            // Garante limpeza local mesmo offline
          }
        }
        await AsyncStorage.removeItem(AUTH_SESSION_KEY);
        return null;
      }
    } catch {
      // Segue para leitura normal da sessão
    }

    const cached = await LocalAsyncStorageAuthAdapter.getCurrentSession();
    if (cached?.isDemo) {
      return cached;
    }

    try {
      const { data } = await supabase.auth.getSession();
      const activeUser = data?.session?.user;
      if (!activeUser) {
        if (cached && !cached.isDemo) {
          await AsyncStorage.removeItem(AUTH_SESSION_KEY);
        }
        return null;
      }

      let resolvedNickname =
        cached?.nickname || activeUser.user_metadata?.nickname || 'Cidadão';
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('nickname')
          .eq('id', activeUser.id)
          .maybeSingle();
        if (profile?.nickname) {
          resolvedNickname = profile.nickname;
        }
      } catch {
        // Mantém fallback em cache
      }

      const isAdmin = await checkIsAdmin(activeUser.id);
      const hydrated = {
        ...(cached || {}),
        userId: activeUser.id,
        nickname: resolvedNickname,
        isDemo: false,
        isAdmin: Boolean(isAdmin),
        provider: 'supabase',
        loggedInAt: cached?.loggedInAt || new Date().toISOString(),
      };
      await AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(hydrated));
      return hydrated;
    } catch {
      return cached ? { ...cached, isAdmin: false } : null;
    }
  },

  async updateSession(patch) {
    return LocalAsyncStorageAuthAdapter.updateSession(patch);
  },

  async logout() {
    const cached = await LocalAsyncStorageAuthAdapter.getCurrentSession();
    if (!cached?.isDemo && supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Garante limpeza local mesmo offline
      }
    }
    await LocalAsyncStorageAuthAdapter.logout();
  },

  async changeOwnPassword(currentPassword, newPassword) {
    const rawCurrent = String(currentPassword || '');
    const rawNext = String(newPassword || '');

    const rawSession = await AsyncStorage.getItem(AUTH_SESSION_KEY);
    const parsedSession = rawSession ? JSON.parse(rawSession) : null;
    if (!parsedSession?.userId || parsedSession?.isDemo) {
      throw createAuthError('Modo Demonstração não permite alteração de senha.');
    }
    if (!isSupabaseConfigured() || !supabase) {
      return LocalAsyncStorageAuthAdapter.changeOwnPassword(rawCurrent, rawNext);
    }
    if (!rawCurrent) {
      throw createAuthError('Informe sua senha atual.');
    }
    if (rawNext.length < 6) {
      throw createAuthError('A nova senha deve ter pelo menos 6 caracteres.');
    }
    if (rawNext === rawCurrent) {
      throw createAuthError('A nova senha deve ser diferente da senha atual.');
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const activeEmail = userData?.user?.email;
    if (userErr || !activeEmail) {
      throw createAuthError('Sessão expirada. Faça login novamente para alterar sua senha.');
    }

    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email: activeEmail,
      password: rawCurrent,
    });
    if (verifyErr) {
      throw createAuthError('Senha atual incorreta. Verifique e tente novamente.');
    }

    const { error: updateErr } = await supabase.auth.updateUser({
      password: rawNext,
    });
    if (updateErr) {
      throw createAuthError(translateSupabaseAuthError(updateErr));
    }

    await recordDiagnosticEvent('AUTH', 'Senha da conta alterada pelo usuário');
    return { success: true, message: 'Senha alterada com sucesso!' };
  },
};

/**
 * Fábrica desacoplada selecionando Supabase Auth quando configurado ou fallback local LGPD.
 */
export function createAuthService(adapter) {
  return {
    register: (payload) => adapter.register(payload),
    login: (payload) => adapter.login(payload),
    loginDemo: () => adapter.loginDemo(),
    getCurrentSession: () => adapter.getCurrentSession(),
    updateSession: (patch) => adapter.updateSession(patch),
    logout: () => adapter.logout(),
    changeOwnPassword: (currentPassword, newPassword) =>
      adapter.changeOwnPassword(currentPassword, newPassword),
    getRememberMePreferences,
    saveRememberMePreferences,
  };
}

export const authService = createAuthService(
  isSupabaseConfigured() ? SupabaseAuthAdapter : LocalAsyncStorageAuthAdapter
);
