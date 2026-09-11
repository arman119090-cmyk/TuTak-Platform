import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScroll } from '../../components/KeyboardAwareScroll';
import { BackButton } from '../../components/BackButton';
import { useCompactLayout } from '../../components/useCompactLayout';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { JakoWingMark } from '../../components/V2NavIcon';
import { authApi } from '../../../data/api/authApi';
import { apiErrorCode, describeApiError, isTransportFailure } from '../../../data/api/errors';
import { useAuthStore } from '../../../data/stores/authStore';
import type { AuthStackParamList } from '../../../app/navigation/types';
import { useMountTrace } from '../../../diagnostics/instanceTrace';
import { useDimensionsTrace } from '../../../diagnostics/useDimensionsTrace';

type Props = NativeStackScreenProps<AuthStackParamList, 'OtpRegister'>;

/**
 * Public customer registration: phone -> SMS code -> a password the customer
 * chooses -> account.
 *
 * This is the only normal public registration path — LoginScreen's "create
 * account" link comes straight here. `RegisterScreen` (password first) still
 * exists but is not mounted in `AuthNavigator`, and the order matters: proving
 * the number comes before the account exists, never after.
 *
 * ## Why there is a third stage
 *
 * There used to be two, and the account was created the moment the code was
 * accepted — with a random password the customer never saw. They were signed
 * in and then met a sign-in screen asking for a password that did not exist.
 * The only way back into their own account was another SMS.
 *
 * So the code no longer completes anything by itself. It is held here until
 * the customer has chosen a password, and one request carries both.
 *
 * ## What the single final request costs, and why it is still right
 *
 * The code is not checked when it is typed: stage two only moves the form
 * along, and a wrong code is not discovered until the password has been
 * entered. The alternative — verify the code, hand back a short-lived
 * registration token, take the password on a second call — removes that
 * surprise and adds a second credential to issue, scope, expire and test,
 * for a flow that takes twenty seconds end to end.
 *
 * The surprise is paid for instead: on a code error the form returns to stage
 * two with the field marked, **and keeps the password already typed**, so
 * correcting a digit costs one field rather than three. Nothing is stored;
 * the password lives in this component's state and dies with it.
 *
 * A wrong code also costs no SMS. The password is validated by the API's
 * `ValidationPipe` before the handler runs, so a short password is refused
 * without the code being consumed.
 *
 * Name/email are still not collected here — optional, completable later in
 * the profile screen.
 */
export function OtpRegisterScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const { color, space, text, layout } = useTheme();
  const compact = useCompactLayout();
  const { deviceId, setSession } = useAuthStore();

  /*
   * The instrumentation, and what it is for.
   *
   * The sign-in screen was instrumented in September and the fault is now
   * reported here instead, on a screen the earlier investigation never
   * touched. Two things make this screen genuinely different rather than
   * another instance of the same page: it has two inputs rather than one
   * interesting one, and they ask for *different keyboards* — `number-pad`
   * for the phone, the default alphabetic one for the referral code.
   *
   * That matters because the reported sequence includes the keyboard
   * changing type before it closes. A keyboard that changes type is a
   * keyboard that was asked for by a different input, or by the same input
   * with different props — and neither of those is something `focus`, `blur`
   * and a keyboard height can distinguish. Hence the mount trace here and on
   * each field: the log has to be able to say *which* input the keyboard was
   * serving, and whether that input is the same object it was a moment ago.
   *
   * `useDimensionsTrace` comes across unchanged from the sign-in screen —
   * window against screen is still what separates a window that is being
   * resized under the IME from one that is not.
   */
  useMountTrace('OtpRegister');
  useDimensionsTrace();

  const [phone, setPhone] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [revealed, setRevealed] = useState(false);
  /*
   * Which of the three the form is on.
   *
   * A named stage rather than the `codeSent` boolean this grew out of: two
   * booleans for three states is the shape that produces a fourth, impossible
   * one, and every branch below has to be read twice to rule it out.
   */
  const [stage, setStage] = useState<'phone' | 'code' | 'password'>('phone');
  /*
   * Three slots, because one error state was being shown in the wrong place.
   *
   * `error` used to be a single string handed to whichever field happened to
   * be last on the step — which on step one is the **referral code**. So
   * "could not send the verification code" was drawn under the referral
   * field, in the field's own error colour, and read as "your referral code
   * is wrong". Two things make that not a near-miss but always wrong:
   * `handleSendCode` does not send the referral code at all, and the API
   * treats an unknown referral code as a silent no-op rather than an error
   * (`ReferralService.createAttribution`: `if (!code) return`). So no failure
   * of this flow has ever been the referral field's fault.
   *
   * `formError` is for anything that is not one field's doing. `codeError`
   * marks the OTP field, which is the one input a verify call can actually
   * reject. `referralError` marks the referral field and is set only when the
   * API names a referral problem in its own error code — nothing does today,
   * which is the point: the rule is executable rather than a comment, and
   * whoever adds such a response gets the field marking for free.
   */
  const [formError, setFormError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const fullPhone = `+374${phone}`;

  const clearErrors = () => {
    setFormError(null);
    setCodeError(null);
    setReferralError(null);
  };

  const handleSendCode = async () => {
    clearErrors();
    setSending(true);
    try {
      await authApi.requestRegistrationOtp({ phone: fullPhone });
      setStage('code');
    } catch (err) {
      // Never a field: this request carries the phone number and nothing
      // else, and the referral code it is drawn next to is not in it.
      setFormError(describeApiError(err) ?? t('auth.sendCodeFailed'));
    } finally {
      setSending(false);
    }
  };

  /*
   * Stage two advances the form and nothing else — deliberately.
   *
   * There is no "check this code" call to make: the code is single-use, and an
   * endpoint that reported whether one is valid without spending it would be a
   * free oracle for guessing. So the code is carried forward and judged once,
   * by the request that also creates the account.
   */
  const handleCodeEntered = () => {
    clearErrors();
    setStage('password');
  };

  const handleCreateAccount = async () => {
    clearErrors();
    setVerifying(true);
    try {
      const result = await authApi.verifyRegistrationOtp({
        phone: fullPhone,
        code,
        password,
        locale: i18n.language,
        referralCode: referralCode || undefined,
        deviceId,
      });
      // The one place a session is created. Reaching it means the code was
      // accepted, the password was accepted, and the account exists.
      await setSession(result.user, result.tokens);
    } catch (err) {
      const message = describeApiError(err) ?? t('auth.confirmCodeFailed');
      if (isTransportFailure(err)) {
        // The request never reached the API, so nothing the user typed was
        // judged. Marking a field here would blame them for the network, and
        // sending them back a stage would lose work for no reason.
        setFormError(message);
      } else if (apiErrorCode(err)?.startsWith('REFERRAL')) {
        // The referral field lives on stage one, so the message has to go
        // back with it or it is shown against nothing.
        setReferralError(message);
        setStage('phone');
      } else {
        /*
         * Everything else the API can refuse here is about the code or the
         * number — wrong digits, an expired challenge, a number taken in the
         * meantime — and all of them are corrected on stage two.
         *
         * The password is kept. It was never the thing that was wrong, and
         * making someone retype it (twice) to fix one digit is how a form
         * turns a small mistake into an abandoned registration.
         */
        setCodeError(message);
        setStage('code');
      }
    } finally {
      setVerifying(false);
    }
  };

  const canSend = phone.length === 8 && !sending;
  const canContinue = code.length === 6;

  /*
   * Said while it is being typed, not on press.
   *
   * The button is disabled until the two match, which is the behaviour asked
   * for — and a disabled button can never explain itself. Pressing it does
   * nothing and says nothing, so the customer is left to work out which of two
   * masked fields is wrong. Deriving the message from the fields instead means
   * the block and the reason for it appear together.
   *
   * Held back until the second field has something in it: complaining that
   * two fields differ while one of them is still empty is telling someone
   * they are wrong for not having finished.
   */
  const mismatch = confirmation.length > 0 && password !== confirmation;
  // `PASSWORD_MIN` on the API side. Stated here too because a button that
  // waits for the server to say "too short" is a round trip to learn what the
  // hint under the field already says.
  const canCreate = password.length >= 8 && password === confirmation && !verifying;

  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: color.background }]}
      edges={['top', 'bottom']}
    >
      <KeyboardAwareScroll
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: layout.screenPaddingX, paddingTop: space[6] },
        ]}
      >
        <BackButton />
        <Text style={[text.titleLg, { color: color.textPrimary }]}>
          {stage === 'password' ? t('auth.createPasswordTitle') : t('auth.otpRegisterTitle')}
        </Text>
        <Text
          style={[
            text.bodySm,
            { color: color.textSecondary, marginTop: space[2], marginBottom: compact ? space[5] : space[8] },
          ]}
        >
          {stage === 'phone'
            ? t('auth.otpRegisterSubtitle')
            : stage === 'code'
              ? t('auth.otpRegisterCodeSubtitle', { phone: fullPhone })
              : t('auth.createPasswordSubtitle')}
        </Text>

        {stage === 'phone' ? (
          <>
            <TextField
              label={t('auth.phoneNumber')}
              traceId="phone"
              prefix="+374"
              value={phone}
              onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 8))}
              keyboardType="number-pad"
              placeholder="00 000 000"
              maxLength={8}
            />
            <TextField
              label={t('auth.referralCodeOptional')}
              traceId="referral"
              value={referralCode}
              onChangeText={(v) => setReferralCode(v.toUpperCase())}
              autoCapitalize="characters"
              placeholder="TT-XXXXXXXX"
              error={referralError ?? undefined}
            />
            {/* Form-level, and deliberately not attached to any field: see
                the error-state comment above for what happens when it is. */}
            {formError ? (
              <Text
                accessibilityRole="alert"
                style={[text.caption, { color: color.dangerText, marginTop: space[2] }]}
              >
                {formError}
              </Text>
            ) : null}
            <View style={{ marginTop: space[3] }}>
              <Button
                label={t('auth.sendVerificationCode')}
                onPress={handleSendCode}
                loading={sending}
                disabled={!canSend}
                icon={<JakoWingMark size={16} color={color.textInverse} />}
              />
            </View>
          </>
        ) : stage === 'code' ? (
          <>
            <TextField
              label={t('auth.resetCode')}
              traceId="otp"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder="000000"
              maxLength={6}
              error={codeError ?? undefined}
            />
            {/* Form-level, and deliberately not attached to any field: see
                the error-state comment above for what happens when it is. */}
            {formError ? (
              <Text
                accessibilityRole="alert"
                style={[text.caption, { color: color.dangerText, marginTop: space[2] }]}
              >
                {formError}
              </Text>
            ) : null}
            <View style={{ marginTop: space[3] }}>
              <Button
                label={t('common.next')}
                onPress={handleCodeEntered}
                disabled={!canContinue}
                icon={<JakoWingMark size={16} color={color.textInverse} />}
              />
              <Button
                label={t('auth.resendCode')}
                onPress={handleSendCode}
                variant="tertiary"
                loading={sending}
                icon={<JakoWingMark size={16} color={color.textBrand} />}
              />
            </View>
          </>
        ) : (
          <>
            <TextField
              label={t('auth.password')}
              traceId="password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!revealed}
              placeholder="••••••••"
              hint={t('auth.passwordHint')}
              revealToggle={{
                revealed,
                onToggle: () => setRevealed((on) => !on),
                label: revealed ? t('auth.hidePassword') : t('auth.showPassword'),
              }}
            />
            <TextField
              label={t('auth.confirmPassword')}
              traceId="password-confirm"
              value={confirmation}
              onChangeText={setConfirmation}
              secureTextEntry={!revealed}
              placeholder="••••••••"
              // The mismatch is this screen's own judgement, so it is marked
              // on the second field — the one that can be corrected without
              // retyping the first.
              error={mismatch ? t('auth.passwordsDoNotMatch') : undefined}
            />
            {formError ? (
              <Text
                accessibilityRole="alert"
                style={[text.caption, { color: color.dangerText, marginTop: space[2] }]}
              >
                {formError}
              </Text>
            ) : null}
            <View style={{ marginTop: space[3] }}>
              <Button
                label={t('auth.registerButton')}
                onPress={handleCreateAccount}
                loading={verifying}
                disabled={!canCreate}
                icon={<JakoWingMark size={16} color={color.textInverse} />}
              />
            </View>
          </>
        )}

        <View style={[styles.footer, { marginTop: space[7], gap: space[1] }]}>
          <Text style={[text.bodySm, { color: color.textSecondary }]}>
            {t('auth.haveAccount')}
          </Text>
          <Pressable onPress={() => navigation.navigate('Login')} hitSlop={8}>
            <Text style={[text.label, { color: color.primary }]}>{t('auth.login')}</Text>
          </Pressable>
        </View>
      </KeyboardAwareScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 40 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
});
