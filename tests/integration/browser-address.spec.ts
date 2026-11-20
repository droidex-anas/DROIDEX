import { expect, test, type Page } from '@playwright/test';
import type { ClientCommand, ServerEvent } from '@droidex/protocol';
import { sessionSummary } from '../../src/test/sessionSummary';

async function openBrowser(page: Page) {
  const commands: ClientCommand[] = [];
  let emit: (event: ServerEvent) => void = () => {
    throw new Error('Bridge is not connected');
  };
  const navigate = (url: string, appSessionId = 'address-chat') =>
    emit({
      type: 'browser.updated',
      state: {
        appSessionId,
        browserSessionId: `${appSessionId}-browser`,
        url,
        viewport: { width: 1000, height: 700, deviceScaleFactor: 1 },
        viewportMode: 'fit',
        scroll: { x: 0, y: 0 },
      },
    });
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (socket) => {
      let seq = 0;
      emit = (event) => {
        seq += 1;
        socket.send(
          JSON.stringify({
            type: 'events.batch',
            generation: 'browser-address-test',
            firstSeq: seq,
            lastSeq: seq,
            events: [{ seq, event }],
          }),
        );
      };
      socket.onMessage((message) => {
        if (typeof message !== 'string') return;
        const command = JSON.parse(message) as ClientCommand;
        commands.push(command);
        if (command.type === 'connect') emit({ type: 'connection', status: 'connected' });
        if (command.type === 'sessions.list') {
          emit({
            type: 'sessions.list',
            sessions: [sessionSummary('address-chat'), sessionSummary('other-chat')],
            earlierSessionsByCwd: {},
          });
        }
        if (command.type === 'projects.list') emit({ type: 'projects.snapshot', projects: [] });
        if (command.type === 'session.create') {
          emit({
            type: 'session.created',
            clientRef: command.clientRef,
            session: sessionSummary('address-chat', { goal: command.goal }),
          });
          navigate('https://example.com/old');
        }
      });
    },
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Prompt' });
  await composer.fill('Check the browser');
  await composer.press('Enter');
  await page.getByRole('button', { name: 'Toggle utility pane', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Browser', exact: true }).click();
  const address = page.getByRole('textbox', { name: 'Browser address' });
  await expect(address).toHaveValue('https://example.com/old');
  return { address, navigate, commands };
}

test('an unedited focused address follows same-tab navigation and blur', async ({ page }) => {
  const { address, navigate } = await openBrowser(page);
  await address.focus();
  navigate('http://localhost:3232/new');
  await address.press('Tab');
  await expect(page.getByRole('img', { name: 'Secure connection' })).toHaveCount(0);
  if (process.env.ADDRESS_SCREENSHOT) {
    await page.screenshot({ path: process.env.ADDRESS_SCREENSHOT, animations: 'disabled' });
  }
  await expect(address).toHaveValue('http://localhost:3232/new');
});

test('a typed draft survives navigation and blur, Escape restores the committed URL', async ({
  page,
}) => {
  const { address, navigate } = await openBrowser(page);
  await address.fill('https://draft.example/path');
  navigate('http://localhost:3232/new');
  await address.press('Tab');
  await expect(address).toHaveValue('https://draft.example/path');
  await address.focus();
  await address.press('Escape');
  await expect(address).toHaveValue('http://localhost:3232/new');
  navigate('https://example.com/later');
  await expect(address).toHaveValue('https://example.com/later');
});

test('Enter submits the typed draft rather than the navigated page', async ({ page }) => {
  const { address, navigate, commands } = await openBrowser(page);
  await address.fill('https://draft.example/path');
  navigate('http://localhost:3232/new');
  await address.press('Enter');
  await expect
    .poll(() => commands.filter((command) => command.type === 'browser.open').at(-1))
    .toMatchObject({
      type: 'browser.open',
      appSessionId: 'address-chat',
      url: 'https://draft.example/path',
    });
});

test('switching chats never carries an address draft into the other browser', async ({ page }) => {
  const { address, navigate } = await openBrowser(page);
  await address.fill('https://draft.example/path');
  navigate('https://other.example/page', 'other-chat');
  await page.getByRole('button', { name: /^other-chat .*Droid chat$/ }).click();
  await page.keyboard.press('ControlOrMeta+Shift+b');
  await expect(address).toHaveValue('https://other.example/page');
  await page.getByRole('button', { name: /^address-chat .*Droid chat$/ }).click();
  await expect(address).toHaveValue('https://example.com/old');
});

test('an empty draft is preserved, and Escape clears it back to the page', async ({ page }) => {
  const { address, navigate } = await openBrowser(page);
  await address.fill('');
  navigate('http://localhost:3232/new');
  await address.press('Tab');
  await expect(address).toHaveValue('');
  await address.focus();
  await address.press('Escape');
  await expect(address).toHaveValue('http://localhost:3232/new');
});

test('a rejected shell address remains editable until Escape restores the page', async ({
  page,
}) => {
  const { address } = await openBrowser(page);
  const shellUrl = new URL('/blocked', page.url()).href;
  await address.fill(shellUrl);
  await address.press('Enter');
  await expect(
    page.getByText(/Cannot open the DROIDEX shell inside its own browser pane/),
  ).toBeVisible();
  await expect(address).toHaveValue(shellUrl);
  await address.press('Escape');
  await expect(address).toHaveValue('https://example.com/old');
});
