import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../../presentation/screens/auth/LoginScreen';
import { ForgotPasswordScreen } from '../../presentation/screens/auth/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../../presentation/screens/auth/ResetPasswordScreen';
import { OtpRegisterScreen } from '../../presentation/screens/auth/OtpRegisterScreen';
import { OtpLoginScreen } from '../../presentation/screens/auth/OtpLoginScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

/**
 * `RegisterScreen` (password-first) is deliberately not mounted here —
 * item 3 / GitHub issue #28: OTP-first (`OtpRegisterScreen`) is the only
 * normal public customer registration path, so nothing in the normal
 * shipped UI can reach password-first registration any more. The
 * component and its backend endpoint are untouched, kept for whatever
 * legacy/admin migration need might genuinely require them outside this
 * flow — they are just not part of it.
 */
export function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
      <Stack.Screen name="OtpRegister" component={OtpRegisterScreen} />
      <Stack.Screen name="OtpLogin" component={OtpLoginScreen} />
    </Stack.Navigator>
  );
}
