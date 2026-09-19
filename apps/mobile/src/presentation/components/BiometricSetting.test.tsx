import React from 'react';
import { Alert, Switch } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { BiometricSetting } from './BiometricSetting';
import { useBiometricStore } from '../../data/stores/biometricStore';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../data/stores/biometricStore', () => ({ useBiometricStore: jest.fn() }));
const configure = jest.fn().mockResolvedValue(true);
const alert = jest.spyOn(Alert, 'alert');
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useBiometricStore).mockReturnValue({ kind: 'face', enabled: false, busy: false, configure });
});
it('remains disabled when the person declines the offer', () => {
  const view = render(<BiometricSetting />);
  expect(view.UNSAFE_getByType(Switch).props.value).toBe(false);
  fireEvent(view.UNSAFE_getByType(Switch), 'valueChange', true);
  expect(configure).not.toHaveBeenCalled();
  act(() => { alert.mock.calls[0][2]?.[0].onPress?.(); });
  expect(configure).not.toHaveBeenCalled();
  expect(view.UNSAFE_getByType(Switch).props.value).toBe(false);
});
it('enrolls only after explicit consent', async () => {
  const view = render(<BiometricSetting />);
  fireEvent(view.UNSAFE_getByType(Switch), 'valueChange', true);
  await act(async () => { alert.mock.calls[0][2]?.[1].onPress?.(); });
  expect(configure).toHaveBeenCalledWith(true, 'biometric.prompt');
});
it('does not offer a nonworking switch on unsupported devices', () => {
  jest.mocked(useBiometricStore).mockReturnValue({ kind: null, enabled: false, busy: false, configure });
  expect(render(<BiometricSetting />).UNSAFE_queryByType(Switch)).toBeNull();
});
