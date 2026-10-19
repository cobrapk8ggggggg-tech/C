const axios = require('axios');
const DEFAULT_WORKER_URL = 'https://deepseek-pow.contact-3mh.workers.dev';
function workerBase(url = DEFAULT_WORKER_URL) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('DeepSeek Worker URL must use HTTPS');
    return url.replace(/\/+$/, '').replace(/\/api\/chat$/, '');
}
async function askDeepSeekWorker(prompt, options = {}) {
    if (!options.token) throw new Error('DeepSeek Worker requires your DeepSeek account token');
    const context = options.context || {};
    const body = { token: options.token, prompt, thinking_enabled: Boolean(options.thinkingEnabled),
        search_enabled: Boolean(options.searchEnabled), model: options.model || 'deepseek-chat',
        temperature: options.temperature ?? 0.7, max_tokens: options.maxTokens ?? 16384,
        presence_penalty: options.presencePenalty ?? 0, frequency_penalty: options.frequencyPenalty ?? 0,
        ...(context.sessionId ? { session_id: context.sessionId } : {}),
        ...(context.parentMessageId != null ? { parent_message_id: context.parentMessageId } : {}) };
    const { data } = await axios.post(workerBase(options.baseUrl || undefined) + '/api/chat', body, { timeout: options.timeout || 300000 });
    if (data.error || data.success === false) throw new Error('DeepSeek Worker rejected the request');
    if (typeof data.response !== 'string' || !data.response.trim()) throw new Error('DeepSeek Worker returned an empty answer');
    if (data.finish_reason === 'length') throw new Error('DeepSeek Worker output reached the token limit');
    context.sessionId = data.session_id || context.sessionId;
    context.parentMessageId = data.parent_message_id ?? context.parentMessageId;
    return data.response;
}
module.exports = { askDeepSeekWorker, DEFAULT_WORKER_URL, workerBase };
