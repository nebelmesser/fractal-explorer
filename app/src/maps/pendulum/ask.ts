import { onUiChange, t } from '../../i18n';

const CHATGPT_QUERY = 'https://chatgpt.com/?q=';
const COPIED_MS = 1600;

function promptBody(): string {
  const node = document.getElementById('ask-prompt');
  return (node?.innerText ?? node?.textContent ?? '').trim();
}

function fullPrompt(): string {
  return `${promptBody()}\n\n----\n${t('ask_prompt_tail')}\n\n`;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
}

export function bindAskPrompt(): void {
  const link = document.getElementById('ask-chatgpt');
  const copy = document.getElementById('ask-copy');
  if (!(link instanceof HTMLAnchorElement) || !(copy instanceof HTMLButtonElement)) return;

  const copyBtn = copy;
  const askLink = link;

  function syncHref(): void {
    askLink.href = `${CHATGPT_QUERY}${encodeURIComponent(fullPrompt())}`;
  }

  let copiedAt = 0;
  let copiedTimer = 0;

  function syncCopyLabel(copied: boolean): void {
    copyBtn.setAttribute('aria-label', t(copied ? 'prompt_copied' : 'copy_prompt'));
    copyBtn.classList.toggle('is-copied', copied);
  }

  copyBtn.addEventListener('click', () => {
    void copyText(fullPrompt()).then(() => {
      copiedAt = performance.now();
      syncCopyLabel(true);
      window.clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => {
        if (performance.now() - copiedAt >= COPIED_MS - 30) syncCopyLabel(false);
      }, COPIED_MS);
    });
  });

  syncHref();
  onUiChange(() => {
    syncHref();
    syncCopyLabel(copyBtn.classList.contains('is-copied'));
  });
}
