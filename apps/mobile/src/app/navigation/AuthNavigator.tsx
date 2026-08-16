import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../../presentation/screens/auth/LoginScreen';
import { RegisterScreen } from '../../presentation/screens/auth/RegisterScreen';
import { ForgotPasswordScreen } from '../../presentation/screens/auth/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../../presentation/screens/auth/ResetPasswordScreen';
import { OtpRegisterScreen } from '../../presentation/screens/auth/OtpRegisterScreen';
import { OtpLoginScreen } from '../../presentation/screens/auth/OtpLoginScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
      <Stack.Screen name="OtpRegister" component={OtpRegisterScreen} />
      <Stack.Screen name="OtpLogin" component={OtpLoginScreen} />
    </Stack.Navigator>
  );
}
