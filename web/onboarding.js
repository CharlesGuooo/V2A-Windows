// Port of V2A/Views/OnboardingFlow.swift — three steps, same copy, same
// enable/disable rules, same completion behaviour.

import { h, pushPage, popPage } from './ui.js';
import { t } from './i18n.js';
import { api } from './api.js';

const SONIOX_CONSOLE = 'https://console.soniox.com/';
const TOTAL_STEPS = 5;

const PROVIDER_HINT = {
  deepseek: 'Deepseek 注册就送免费额度，对中文友好，推荐先用这家试试。',
  claude: 'Claude 质量最稳，但需要先在 Anthropic 充值才能用。',
  gemini: 'Google Gemini 每天有免费配额，量不大的话不用付钱。',
  openai: 'OpenAI 知名度最高，但要先充值才能用 API。',
  groq: 'Groq 速度飞快、免费额度大。适合刚开始试。',
};

export function openOnboarding(state, onComplete) {
  return pushPage((page) => {
    let step = 0;
    let sonioxKey = (state.keys.soniox || '').trim();
    let providerId = state.activeProviderId;
    const draftKeys = { ...state.keys };

    const stepHost = h('div', { class: 'onb-steps' });
    const dots = h('div', { class: 'onb-dots' },
      ...Array.from({ length: TOTAL_STEPS }, () => h('span', { class: 'onb-dot' })));

    const backBtn = h('button', {
      class: 'btn-secondary',
      onClick: () => { step -= 1; render(); },
    }, t('上一步'));

    const nextBtn = h('button', {
      class: 'btn-primary',
      onClick: () => {
        if (step === TOTAL_STEPS - 1) complete();
        else { step += 1; render(); }
      },
    });

    // ---------------------------------------------------------- steps

    function welcomeStep() {
      return h('div', { class: 'onb-step' },
        h('div', { class: 'onb-step__title' }, t('欢迎用 V2A')),
        h('div', { class: 'onb-step__body' },
          t('说一段话，自动转成文字，AI 帮你整理通顺，一键复制给 ChatGPT 或其他 agent。打字慢的时候特别好用。')),
        h('div', { class: 'onb-step__list' },
          ...[
            '接下来要填两个 key：',
            '· Soniox（把声音变文字）',
            '· 一家 AI 服务商（整理文字，5 家任选其一）',
            '两个 key 都从对应官网注册账号免费拿。',
          ].map((line) => h('div', { class: 'onb-step__bullet' }, t(line))),
        ),
      );
    }

    function sonioxStep() {
      const field = h('input', {
        type: 'password',
        class: 'onb-field',
        placeholder: t('把 Soniox API key 粘进来'),
        autocomplete: 'off',
        spellcheck: 'false',
        value: sonioxKey,
        onInput: (e) => { sonioxKey = e.target.value; syncNav(); },
      });
      return h('div', { class: 'onb-step' },
        h('div', { class: 'onb-step__title onb-step__title--sub' }, t('第 1 步 · Soniox key')),
        h('div', { class: 'onb-step__body' }, t('Soniox 负责把你说的话实时转成文字。')),
        field,
        h('button', {
          class: 'onb-link',
          onClick: () => api.openExternal(SONIOX_CONSOLE),
        }, t('还没有 key？打开 Soniox 注册 →')),
        h('div', { class: 'onb-hint' },
          t('拿 key 的步骤：注册账号 → 登录 → 左侧 API Keys → Create API Key → 复制。')),
      );
    }

    function providerStep() {
      const current = state.findProvider(providerId);
      const keyField = h('input', {
        type: 'password',
        class: 'onb-field',
        placeholder: t('把 %@ 的 API key 粘进来', current?.displayName ?? 'AI'),
        autocomplete: 'off',
        spellcheck: 'false',
        value: draftKeys[current?.account] || '',
        onInput: (e) => { draftKeys[current.account] = e.target.value; syncNav(); },
      });

      const picker = h('select', {
        class: 'onb-field',
        onChange: (e) => {
          // Keep what's typed for the provider we're leaving.
          if (current) draftKeys[current.account] = keyField.value;
          providerId = e.target.value;
          render();
        },
      }, ...state.providers.map((p) =>
        h('option', { value: p.id, selected: p.id === providerId }, p.displayName)));

      return h('div', { class: 'onb-step' },
        h('div', { class: 'onb-step__title onb-step__title--sub' }, t('第 2 步 · 选一家 AI')),
        h('div', { class: 'onb-step__body' }, t('用谁来帮你整理文字。5 家任选一家，以后随时可以切换。')),
        picker,
        keyField,
        current ? h('button', {
          class: 'onb-link',
          onClick: () => api.openExternal(current.apiKeyHelpURL),
        }, t('还没有 key？打开 %@ 注册 →', current.displayName)) : null,
        PROVIDER_HINT[providerId]
          ? h('div', { class: 'onb-hint' }, t(PROVIDER_HINT[providerId]))
          : null,
      );
    }

    // --- step 3: how to use it ---

    function howToStep() {
      const item = (n, title, desc) => h('div', { class: 'onb-howto__item' },
        h('div', { class: 'onb-howto__num' }, String(n)),
        h('div', { class: 'onb-howto__body' },
          h('div', { class: 'onb-howto__title' }, title),
          h('div', { class: 'onb-howto__desc' }, desc),
        ),
      );
      return h('div', { class: 'onb-step' },
        h('div', { class: 'onb-step__title onb-step__title--sub' }, t('第 3 步 · 怎么用')),
        h('div', { class: 'onb-step__body' }, t('三步就完事：')),
        h('div', { class: 'onb-howto' },
          item(1, t('说'),
            t('点「开始录音」或按 %@，说完再按一次停止。说错了直接改口重说，深度整理会自动只保留你最后的意思。',
              state.hotkeys.record)),
          item(2, t('整理'),
            t('「轻度整理」删语气词、修标点，尽量不动你的原话；「深度整理」会识别改口、把分点整理成 bullet，说得比较乱的时候用它。')),
          item(3, t('粘'),
            t('整理完自动进剪贴板，切到 ChatGPT 直接 Ctrl+V。不想自动复制可以在设置里关掉。')),
        ),
      );
    }

    // --- step 4: hotkeys ---

    function hotkeyStep() {
      const rows = [
        ['record', t('开始 / 停止录音')],
        ['light', t('轻度整理')],
        ['deep', t('深度整理')],
        ['copy', t('复制整理结果')],
      ];
      return h('div', { class: 'onb-step' },
        h('div', { class: 'onb-step__title onb-step__title--sub' }, t('第 4 步 · 快捷键')),
        h('div', { class: 'onb-step__body' }, t('这四个组合在任何窗口下都能用，不用先切回 V2A：')),
        h('div', { class: 'onb-keys' },
          ...rows.map(([action, label]) => h('div', { class: 'onb-keys__row' },
            h('span', { class: 'onb-keys__combo' }, state.hotkeys[action]),
            h('span', { class: 'onb-keys__what' }, label),
          )),
        ),
        h('div', { class: 'onb-hint' },
          t('关掉窗口后 V2A 会留在右下角托盘继续运行，快捷键照样能用；右键托盘图标可以彻底退出。想换组合键去「设置 → 全局快捷键」。')),
      );
    }

    // ----------------------------------------------------------- render

    function nextDisabled() {
      if (step === 1) return !sonioxKey.trim();
      if (step === 2) {
        const account = state.findProvider(providerId)?.account;
        return !(draftKeys[account] || '').trim();
      }
      return false;
    }

    function syncNav() {
      nextBtn.disabled = nextDisabled();
    }

    const STEPS = [welcomeStep, sonioxStep, providerStep, howToStep, hotkeyStep];

    function render() {
      stepHost.replaceChildren(STEPS[step]());
      dots.childNodes.forEach((dot, i) => dot.classList.toggle('is-active', i === step));
      backBtn.hidden = step === 0;
      nextBtn.textContent = step === TOTAL_STEPS - 1 ? t('完成，开始用') : t('下一步');
      syncNav();
      stepHost.querySelector('input')?.focus({ preventScroll: true });
    }

    async function complete() {
      const account = state.findProvider(providerId)?.account;
      const patch = { ...draftKeys, soniox: sonioxKey.trim() };
      if (account) patch[account] = (draftKeys[account] || '').trim();

      await state.saveKeys(patch);
      state.setActiveProvider(providerId);
      state.onboarded = true;
      state.persist({ onboarded: true });

      popPage(page);
      onComplete?.();
    }

    page.layer.classList.add('onboarding');
    page.layer.append(
      stepHost,
      dots,
      h('div', { class: 'onb-nav' },
        backBtn,
        h('div', { class: 'onb-nav__spacer' }),
        nextBtn,
      ),
    );
    render();
  }, 'sheet');
}
