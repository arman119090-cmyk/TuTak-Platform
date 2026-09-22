import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LegalDocumentScreen, renderMarkdown } from './LegalDocumentScreen';

jest.mock('../../../data/api/legalApi', () => ({
  legalApi: { document: jest.fn(), fileUrl: jest.fn(() => 'https://example.test/file.md') },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { legalApi } = require('../../../data/api/legalApi');
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');
/* eslint-enable @typescript-eslint/no-require-imports */

let activeClient: QueryClient | undefined;

const renderScreen = (params: Record<string, unknown> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  activeClient = client;
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <NavigationContainer>
          <LegalDocumentScreen
            navigation={{ navigate: jest.fn() } as never}
            route={
              {
                key: 'LegalDocument',
                name: 'LegalDocument',
                params: { documentKey: 'privacy', language: 'ru', title: 'Политика', ...params },
              } as never
            }
          />
        </NavigationContainer>
      </ThemeProvider>
    </QueryClientProvider>,
  );
};

/**
 * Reading a legal text on a phone.
 *
 * Two things are load-bearing and are what these check: the text is shown as
 * published (nothing rewritten, nothing summarised), and an unapproved draft
 * says so on its own face rather than looking like the real thing.
 */
describe('a legal document on screen', () => {
  afterEach(() => {
    activeClient?.clear();
    activeClient = undefined;
    jest.clearAllMocks();
  });

  const published = {
    key: 'privacy',
    title: 'Политика',
    revision: '1.0-test',
    language: 'ru',
    contentHash: 'a'.repeat(64),
    isDraft: false,
    content: '# Заголовок\n\nПервый абзац.\n\n## Раздел\n\nВторой абзац.',
  };

  it('shows the whole text, the edition and the checksum a saved copy is checked against', async () => {
    legalApi.document.mockResolvedValue(published);
    renderScreen();

    expect(await screen.findByText('Первый абзац.')).toBeTruthy();
    expect(screen.getByText('Второй абзац.')).toBeTruthy();
    expect(screen.getByText('Заголовок')).toBeTruthy();
    expect(screen.getByText('legal.revision')).toBeTruthy();
    expect(screen.getByText('legal.checksum')).toBeTruthy();
    expect(screen.getByText('legal.saveCopy')).toBeTruthy();
    expect(screen.queryByTestId('legal-draft-banner')).toBeNull();
  });

  it('marks a draft as a draft', async () => {
    legalApi.document.mockResolvedValue({ ...published, isDraft: true });
    renderScreen();

    expect(await screen.findByTestId('legal-draft-banner')).toBeTruthy();
  });

  it('says so when the text cannot be shown instead of showing an empty page', async () => {
    legalApi.document.mockRejectedValue(new Error('404'));
    renderScreen();

    await waitFor(() => expect(screen.getByText('legal.loadFailed')).toBeTruthy());
  });

  it('keeps every character of the source when it splits it into blocks', () => {
    const source = '# One\n\nParagraph with {{NOT_A_PLACEHOLDER_HERE}} inside.\n\n## Two\n\nLast.';
    const blocks = renderMarkdown(source);

    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph', 'heading', 'paragraph']);
    expect(blocks[1]!.value).toBe('Paragraph with {{NOT_A_PLACEHOLDER_HERE}} inside.');
    expect(blocks[2]!.value).toBe('Two');
  });
});
