// Port of V2A/Services/AppError.swift.
//
// Turns raw provider / Soniox failures into friendly, actionable messages.
// Same branch order and same thresholds as the Swift original.

import { t } from './i18n.js';

export function appError(message, extra = {}) {
  return {
    message,
    actionTitle: null,
    actionURL: null,
    actionOpensSettings: false,
    ...extra,
  };
}

// `failure` is what server.js reports back on the cleanup stream:
//   { kind: 'http', status, body }  |  { kind: 'network', message }
export function classifyProvider(failure, provider) {
  const name = provider?.displayName ?? 'AI';

  // Network-level
  if (failure.kind === 'network') {
    const m = String(failure.message || '').toLowerCase();
    if (m.includes('timeout') || m.includes('timed out') || m.includes('etimedout')) {
      return appError(t('AI 响应超时，稍后重试。'));
    }
    if (
      m.includes('enotfound') || m.includes('econnrefused') || m.includes('econnreset') ||
      m.includes('network') || m.includes('fetch failed') || m.includes('getaddrinfo')
    ) {
      return appError(t('无网络连接，检查网络后重试。'));
    }
    return appError(t('AI 整理失败：%@', failure.message || ''));
  }

  // HTTP-level
  if (failure.kind === 'http') {
    const code = failure.status;
    const body = String(failure.body || '');
    const b = body.toLowerCase();
    const mentionsQuota =
      b.includes('insufficient') || b.includes('balance') ||
      b.includes('resource_exhausted') || b.includes('quota') ||
      b.includes('exceeded your current quota') || b.includes('credit');

    // Balance / quota exhausted
    if (code === 402 || mentionsQuota) {
      if (provider?.billingURL) {
        return appError(t('%@ 余额 / 额度不足，无法整理。', name), {
          actionTitle: t('去 %@ 充值 →', name),
          actionURL: provider.billingURL,
        });
      }
      return appError(t('%@ 余额 / 额度不足，无法整理。', name));
    }

    // Invalid / expired key
    if (
      code === 401 || code === 403 ||
      (b.includes('invalid') && b.includes('key')) ||
      b.includes('api_key_invalid') || b.includes('authentication')
    ) {
      return appError(t('%@ 的 API key 无效或已失效。', name), {
        actionTitle: t('去设置重新配置'),
        actionOpensSettings: true,
      });
    }

    // Rate limit (429 without quota markers)
    if (code === 429) {
      return appError(t('请求太频繁，稍等几秒再试。'));
    }

    // Fallback: short raw body
    const snippet = body.trim().slice(0, 160);
    return appError(t('AI 整理失败（%lld）：%@', code, snippet));
  }

  return appError(t('AI 整理失败：%@', failure.message || t('未知错误')));
}

export function classifySoniox(code, message) {
  const raw = String(message || '').toLowerCase();

  if (
    raw.includes('unauthor') || raw.includes('invalid') || raw.includes('api key') ||
    raw.includes('authentication') || code === 401
  ) {
    return appError(t('Soniox 的 API key 无效或已失效。'), {
      actionTitle: t('去设置重新配置'),
      actionOpensSettings: true,
    });
  }

  if (
    raw.includes('quota') || raw.includes('balance') || raw.includes('limit') ||
    raw.includes('exceeded') || raw.includes('insufficient')
  ) {
    return appError(t('Soniox 余额 / 额度不足，无法转录。'), {
      actionTitle: t('去 Soniox 充值 →'),
      actionURL: 'https://console.soniox.com/',
    });
  }

  // Generic connection failure
  if (message) {
    return appError(t('Soniox 连接出错：%@', String(message).trim().slice(0, 160)));
  }
  return appError(t('Soniox 连接断开，请重试。'));
}
