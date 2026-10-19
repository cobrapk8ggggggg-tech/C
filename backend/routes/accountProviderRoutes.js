const { defaultStore } = require('../services/accountProviders.service');
const { ChatGPTAndroid } = require('../services/chatgptAndroid.service');
const { askGeminiWeb, uploadGeminiAttachment } = require('../services/geminiWeb.service');
const { isChatGPTProvider, withConversationLock, accountScope, selectedConversationKey } = require('../services/accountSettings.service');

function readProvider(req) {
    let provider = req.body?.provider;
    if (typeof provider === 'string') {
        try { provider = JSON.parse(provider); } catch (_) { throw new Error('Invalid provider configuration'); }
    }
    if (!provider || typeof provider !== 'object') throw new Error('Provider is required');
    if (!isChatGPTProvider(provider) && !/^gemini_web(?:_|$)/i.test(provider.providerId || '')) throw new Error('Unsupported account provider');
    if (!Array.isArray(provider.apiKeys) || !provider.apiKeys[0]) throw new Error('Account credentials are required');
    return provider;
}
function safeError(err) {
    // Axios messages/config can contain tokens, cookies and the entire prompt.
    const status = err.response?.status;
    return status ? `Provider HTTP ${status}` : err.isAxiosError ? 'Provider connection failed' :
        /token|cookie|credential|session|account|Invalid|Unsupported|required|conversation|project|empty|completion|stream|upload/i.test(err.message || '')
            ? String(err.message).slice(0, 180) : 'تعذر تنفيذ طلب المزوّد';
}
module.exports = function(app, verifyToken, verifyAdmin, upload, deps = {}) {
    const client = deps.client || (p => new ChatGPTAndroid(p.apiKeys[0], p.chatgptAccountId));
    const wrap = fn => async (req, res) => {
        try { await fn(req, res, readProvider(req)); }
        catch (err) { res.status(err.response?.status === 429 ? 429 : 400).json({ message: safeError(err) }); }
    };
    const prefix = '/api/translator/accounts';
    app.post(prefix + '/models', verifyToken, verifyAdmin, wrap(async (req, res, p) => {
        if (!isChatGPTProvider(p)) return res.json({ models: [{ modelId: 'adaptive', modelName: 'Gemini Adaptive (from supplied client)' }] });
        res.json({ models: (await client(p).models()).map(m => ({ modelId: m.slug, modelName: m.title || m.slug })) });
    }));
    app.post(prefix + '/projects', verifyToken, verifyAdmin, wrap(async (req, res, p) => {
        if (!isChatGPTProvider(p)) throw new Error('Gemini project listing is not supported by the supplied client');
        res.json(await client(p).projects(req.body.cursor));
    }));
    app.post(prefix + '/chats', verifyToken, verifyAdmin, wrap(async (req, res, p) => {
        if (!isChatGPTProvider(p)) throw new Error('Gemini conversation listing is not supported by the supplied client');
        const offset = Math.max(0, Math.trunc(Number(req.body.offset) || 0));
        res.json(await client(p).chats(offset));
    }));
    app.post(prefix + '/conversation', verifyToken, verifyAdmin, wrap(async (req, res, p) => {
        if (!isChatGPTProvider(p) || !req.body.conversationId) throw new Error('ChatGPT conversation ID is required');
        const data = await client(p).conversation(req.body.conversationId);
        res.json({ id: req.body.conversationId, title: data.title, current_node: data.current_node,
            projectId: data.gizmo_id || data.conversation_mode?.gizmo_id || '' });
    }));
    app.post(prefix + '/upload', verifyToken, verifyAdmin, upload.single('file'), wrap(async (req, res, p) => {
        if (!req.file) throw new Error('A file is required');
        const attachment = isChatGPTProvider(p) ? await client(p).upload(req.file) : await uploadGeminiAttachment(p.apiKeys[0], req.file);
        res.json({ attachment });
    }));
    app.post(prefix + '/send', verifyToken, verifyAdmin, wrap(async (req, res, p) => {
        const purpose = req.body.purpose || 'translation';
        const task = p.taskConversations?.[purpose] || {};
        const prompt = String(req.body.prompt || '').trim();
        if (!prompt) throw new Error('A prompt is required');
        const create = req.body.createNew === true;
        const context = create ? {} : isChatGPTProvider(p) ? { conversationId: task.conversationId || undefined }
            : task.conversationId ? { geminiConv: { conversation_id: task.conversationId,
                response_id: task.responseId || '', choice_id: task.choiceId || '' } } : {};
        const attachments = Array.isArray(req.body.attachments) ? req.body.attachments.slice(0, 10) : [];
        const key = accountScope(p, p.apiKeys[0]) + ':' + (task.conversationId || 'new');
        const reply = await withConversationLock(key, () => isChatGPTProvider(p)
            ? client(p).send(prompt, { context, projectId: task.projectId, model: task.model || p.selectedModel || 'auto',
                reasoningEffort: task.reasoningEffort === 'auto' ? p.reasoningEffort : task.reasoningEffort || p.reasoningEffort, attachments })
            : askGeminiWeb(prompt, { token: p.apiKeys[0], context, accountIndex: p.geminiAccountIndex ?? 1,
                buildLabel: p.geminiBuildLabel, modelHeader: p.geminiModelHeader, attachments,
                allowGuestFallback: false, autoContinue: false }));
        // Session CSRF tokens and upstream credentials never leave the server.
        const publicContext = isChatGPTProvider(p) ? { conversationId: context.conversationId, parentMessageId: context.parentMessageId }
            : { conversationId: context.geminiConv?.conversation_id, responseId: context.geminiConv?.response_id,
                choiceId: context.geminiConv?.choice_id };
        if (publicContext.conversationId) {
            await (deps.stateStore || defaultStore).set(selectedConversationKey(p, p.apiKeys[0], publicContext.conversationId, task.projectId || ''), context);
        }
        res.json({ reply, context: publicContext });
    }));
    app.use(prefix, (err, req, res, next) => {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'الحد الأقصى لحجم المرفق 10 MB' });
        if (err.name === 'MulterError') return res.status(400).json({ message: 'Invalid file upload' });
        next(err);
    });
};
module.exports.safeError = safeError;
