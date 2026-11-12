import type { Page } from '@playwright/test'

export const turnstileScript = 'https://challenges.cloudflare.com/turnstile/v0/api.js?*'

export function testVerificationToken(action: 'symbol-report' | 'symbol-withdraw', id: string) {
  return `e2e:${action}:${id}:${crypto.randomUUID()}`
}

export async function mockTurnstile(page: Page, { interactive = false } = {}) {
  await page.setExtraHTTPHeaders({ 'X-E2E-Source': crypto.randomUUID() })
  await page.route(turnstileScript, route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      const widgets = new Map();
      window.turnstile = {
        // Match the real SDK: ready() is incompatible with our async script tag.
        ready: () => { throw new Error('Use the async script load event, not turnstile.ready()'); },
        render(container, options) {
          if (options.sitekey !== 'local-e2e-sitekey') throw new Error('Unexpected sitekey');
          const id = crypto.randomUUID();
          const complete = () => {
            if (!widgets.has(id)) return;
            options.callback(['e2e', options.action, options.cData, id].join(':'));
          };
          widgets.set(id, container);
          if (${interactive}) {
            for (const [label, action] of [
              ['Complete test verification', complete],
              ['Expire test verification', options['expired-callback']],
            ]) {
              const button = document.createElement('button');
              button.textContent = label;
              button.addEventListener('click', action);
              container.append(button);
            }
          } else {
            setTimeout(complete, 0);
          }
          return id;
        },
        remove(id) {
          widgets.get(id)?.replaceChildren();
          widgets.delete(id);
        },
      };
    `,
  }))
}
