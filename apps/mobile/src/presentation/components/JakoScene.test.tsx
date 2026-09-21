import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Image } from 'expo-image';
import { JakoScene } from './JakoScene';
import { jakoAsset } from './JakoHero';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../app/theme/ThemeProvider');

const hidden = { includeHiddenElements: true };

function renderScene(props: Partial<React.ComponentProps<typeof JakoScene>> = {}) {
  return render(
    <ThemeProvider>
      <JakoScene state="login" title="Welcome back" {...props}>
        <Text>form</Text>
      </JakoScene>
    </ThemeProvider>,
  );
}

/**
 * The contract a screen relies on: the state picks the bird, the words are
 * drawn, the sheet carries the form, and nothing here needs a navigator or a
 * safe-area provider to render (screen tests have neither).
 */
describe('JakoScene', () => {
  it('draws the state\'s Jako over the ground, and the form on the sheet', () => {
    renderScene({ subtitle: 'More possibilities, closer', note: 'Onward together', bubble: 'Your smart partner' });
    const images = screen.UNSAFE_getAllByType(Image).map((i) => i.props.source);
    expect(images).toContain(jakoAsset('login'));
    expect(screen.getByText('Welcome back')).toBeTruthy();
    expect(screen.getByText('More possibilities, closer')).toBeTruthy();
    expect(screen.getByTestId('scene-note', hidden).props.children).toBe('Onward together');
    expect(screen.getByTestId('scene-bubble', hidden).props.children).toBe('Your smart partner');
    expect(screen.getByText('form')).toBeTruthy();
  });

  it('names itself after the state so a screen test can find it', () => {
    renderScene({ state: 'partner-welcome' });
    expect(screen.getByTestId('scene-partner-welcome', hidden)).toBeTruthy();
  });

  it('shows no back control when there is nowhere to go back to', () => {
    renderScene();
    expect(screen.queryByLabelText('Back')).toBeNull();
  });

  it('keeps the note and bubble off when not given, and can drop the logo', () => {
    renderScene({ logo: false });
    expect(screen.queryByTestId('scene-note', hidden)).toBeNull();
    expect(screen.queryByTestId('scene-bubble', hidden)).toBeNull();
    expect(screen.queryByLabelText('TuTak')).toBeNull();
  });

  it('renders the non-scrolling variant the lock screen uses', () => {
    renderScene({ scroll: false, size: 'compact' });
    expect(screen.getByText('form')).toBeTruthy();
  });
});
