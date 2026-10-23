import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/ThemeContext';
import WebSafeTextInput from '../components/WebSafeTextInput';

const SIGN_UP_COOLDOWN_SECONDS = 60;

function getAuthErrorCopy(error) {
  const message = String(error?.message || '').toLowerCase();
  const status = Number(error?.status || 0);

  if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
    return {
      title: '確認信寄送過於頻繁',
      message:
        '系統目前的確認信寄送額度已達上限，請稍後再試。若剛才已收到確認信，請直接使用原信件，不要重複註冊。',
      shouldCooldown: true,
    };
  }

  if (message.includes('already registered') || message.includes('already been registered')) {
    return {
      title: '帳號已存在',
      message: '這個電子郵件已註冊，請切換到登入。',
    };
  }

  if (message.includes('invalid login credentials')) {
    return {
      title: '登入失敗',
      message: '電子郵件或密碼不正確。',
    };
  }

  if (message.includes('email not confirmed')) {
    return {
      title: '尚未完成驗證',
      message: '請先開啟確認信完成電子郵件驗證，再回來登入。',
    };
  }

  if (message.includes('password') && (message.includes('least') || message.includes('weak'))) {
    return {
      title: '密碼不符合規則',
      message: '密碼至少需要 6 個字元。',
    };
  }

  return {
    title: '操作失敗',
    message: '目前無法完成操作，請稍後再試。',
  };
}

export default function AuthScreen() {
  const { colors } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [signUpCooldown, setSignUpCooldown] = useState(0);

  useEffect(() => {
    if (signUpCooldown <= 0) return undefined;

    const timer = setInterval(() => {
      setSignUpCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [signUpCooldown]);

  const bg = colors.bg;
  const cardBg = colors.card;
  const textMain = colors.text;
  const textSub = colors.textSub;
  const border = colors.border;
  const inputBg = colors.input;

  const handleAuth = async () => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password) {
      Alert.alert('錯誤', '請輸入電子郵件和密碼');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      Alert.alert('電子郵件格式錯誤', '請輸入有效的電子郵件地址。');
      return;
    }
    if (isSignUp && password.length < 6) {
      Alert.alert('密碼不符合規則', '密碼至少需要 6 個字元。');
      return;
    }
    if (isSignUp && signUpCooldown > 0) return;

    setLoading(true);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;

        setSignUpCooldown(SIGN_UP_COOLDOWN_SECONDS);
        if (!data?.session) {
          Alert.alert(
            '確認信已寄出',
            '請至信箱開啟確認連結，完成驗證後再登入。若沒有看到信件，也請檢查垃圾郵件。',
          );
          setIsSignUp(false);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
      }
    } catch (error) {
      const copy = getAuthErrorCopy(error);
      if (copy.shouldCooldown) setSignUpCooldown(SIGN_UP_COOLDOWN_SECONDS);
      Alert.alert(copy.title, copy.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'web' ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: bg }]}
    >
      <View style={styles.content}>
        {/* Logo area */}
        <View style={styles.logoArea}>
          <View style={[styles.logoIcon, { backgroundColor: colors.accent, shadowColor: colors.accent }]}>
            <Text style={styles.logoEmoji}>💰</Text>
          </View>
          <Text style={[styles.title, { color: textMain }]}>WealthTracker</Text>
          <Text style={[styles.subtitle, { color: textSub }]}>個人資產管理系統</Text>
        </View>

        {/* Card */}
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: textMain }]}>
            {isSignUp ? '建立帳號' : '歡迎回來'}
          </Text>

          <WebSafeTextInput
            style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
            placeholder="電子郵件"
            placeholderTextColor={textSub}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!loading}
          />

          <WebSafeTextInput
            style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
            placeholder="密碼"
            placeholderTextColor={textSub}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!loading}
          />

          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: colors.accent, shadowColor: colors.accent },
              (loading || (isSignUp && signUpCooldown > 0)) && styles.buttonDisabled,
            ]}
            onPress={handleAuth}
            disabled={loading || (isSignUp && signUpCooldown > 0)}
          >
            <Text style={[styles.buttonText, { color: colors.accentContrast }]}>
              {loading
                ? '處理中...'
                : isSignUp && signUpCooldown > 0
                  ? `請稍候 ${signUpCooldown} 秒`
                  : isSignUp
                    ? '註冊'
                    : '登入'}
            </Text>
          </TouchableOpacity>

          {isSignUp ? (
            <Text style={[styles.signUpHint, { color: textSub }]}>註冊後會寄送確認信，請勿重複點擊。</Text>
          ) : null}

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => setIsSignUp(!isSignUp)}
            disabled={loading}
          >
            <Text style={[styles.linkText, { color: colors.accent }]}>
              {isSignUp ? '已有帳號？登入' : '沒有帳號？註冊'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  logoEmoji: {
    fontSize: 36,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    backgroundColor: '#94a3b8',
  },
  buttonText: {
    color: '#0B1F3A',
    fontSize: 16,
    fontWeight: '700',
  },
  linkButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  signUpHint: {
    marginTop: 10,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
