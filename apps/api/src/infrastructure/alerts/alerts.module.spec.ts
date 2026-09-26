import { ConsoleAlertChannel } from './console-alert.channel';
import { TelegramAlertChannel } from './telegram-alert.channel';
import { WebhookAlertChannel } from './webhook-alert.channel';
import { selectAlertChannel } from './alerts.module';

/**
 * Configured must mean chosen.
 *
 * Production on Railway ran with `ALERT_TELEGRAM_BOT_TOKEN` and
 * `ALERT_TELEGRAM_CHAT_ID` set and the console channel selected, because
 * nothing read them. These pin that every variable an operator can set for
 * alerting produces the channel it names — and that the one state which
 * looks configured but is not (half a Telegram pair) is called out.
 */
describe('selectAlertChannel', () => {
  const logger = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });
  const none = { webhookUrl: '', telegramBotToken: '', telegramChatId: '' };

  it('chooses the webhook when a URL is set, even with Telegram also configured', () => {
    const l = logger();
    const channel = selectAlertChannel(
      { webhookUrl: 'https://hooks.example/x', telegramBotToken: '1:a', telegramChatId: '-1' },
      'production',
      l,
    );
    expect(channel).toBeInstanceOf(WebhookAlertChannel);
    expect(channel.name).toBe('webhook');
    expect(l.warn).not.toHaveBeenCalled();
  });

  it('chooses Telegram when the bot token and chat id are both set', () => {
    const l = logger();
    const channel = selectAlertChannel(
      { ...none, telegramBotToken: '1:a', telegramChatId: '-1' },
      'production',
      l,
    );
    expect(channel).toBeInstanceOf(TelegramAlertChannel);
    expect(channel.name).toBe('telegram');
    expect(l.warn).not.toHaveBeenCalled();
    expect(l.error).not.toHaveBeenCalled();
  });

  it.each([
    ['token only', { ...none, telegramBotToken: '1:a' }],
    ['chat id only', { ...none, telegramChatId: '-1' }],
  ])('falls back to the console and says so for half a Telegram pair (%s)', (_label, alerts) => {
    const l = logger();
    const channel = selectAlertChannel(alerts, 'production', l);
    expect(channel).toBeInstanceOf(ConsoleAlertChannel);
    expect(l.error).toHaveBeenCalledWith(expect.stringMatching(/both are needed/));
  });

  it('falls back to the console with a production warning naming both options when nothing is set', () => {
    const l = logger();
    expect(selectAlertChannel(none, 'production', l)).toBeInstanceOf(ConsoleAlertChannel);
    expect(l.warn).toHaveBeenCalledWith(
      expect.stringMatching(/ALERT_WEBHOOK_URL nor ALERT_TELEGRAM_BOT_TOKEN \+ ALERT_TELEGRAM_CHAT_ID/),
    );
    // Development is quiet about it: the console is the intended channel there.
    const dev = logger();
    expect(selectAlertChannel(none, 'development', dev)).toBeInstanceOf(ConsoleAlertChannel);
    expect(dev.warn).not.toHaveBeenCalled();
  });
});
