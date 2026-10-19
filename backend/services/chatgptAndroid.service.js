// Account protocol ported from the supplied chatgpt_android_interactive.py.
const axios = require('axios');
const crypto = require('node:crypto');
const { readLines } = require('./streamLines.service');
const BASE = 'https://android.chat.openai.com';

class ChatGPTAndroid {
    constructor(token, accountId) {
        if (!token) throw new Error('ChatGPT access token is required');
        if (!accountId) {
            try {
                const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
                accountId = claims['https://api.openai.com/auth'].chatgpt_account_id;
            } catch (_) { throw new Error('Invalid ChatGPT token; provide a session access token and account ID'); }
        }
        if (!accountId) throw new Error('ChatGPT account ID is required');
        this.http = axios.create({ baseURL: BASE, timeout: 60000, headers: {
            Authorization: `Bearer ${token}`, 'ChatGPT-Account-ID': accountId,
            'User-Agent': 'ChatGPT/1.2026.195 (Android 16; 24117RN76G; build 2619512)',
            'oai-package-name': 'com.openai.chatgpt', 'oai-client-type': 'android',
            Accept: 'text/event-stream,application/json', 'Content-Type': 'application/json',
            'oai-device-id': crypto.randomUUID(), 'accept-language': 'en-US,en;q=0.9',
            'chatgpt-residency-region': 'no_constraint', 'x-device-tier': 'mid'
        }});
    }
    async get(path, params) { return (await this.http.get(path, { params })).data; }
    async models() { return (await this.get('/backend-api/models')).models || []; }
    async chats(offset = 0) {
        return this.get('/backend-api/conversations', { offset, limit: 50, order: 'updated', is_archived: false });
    }
    async projects(cursor) {
        const data = await this.get('/backend-api/gizmos/snorlax/sidebar', {
            owned_only: true, conversations_per_gizmo: 50, limit: 50, ...(cursor ? { cursor } : {})
        });
        return { ...data, items: (data.items || []).map(x => {
            const g = x.gizmo?.gizmo || {};
            return { id: g.id, name: g.display?.name || 'بدون اسم', chats: x.conversations?.items || [] };
        }) };
    }
    async conversation(id) { return this.get('/backend-api/conversation/' + encodeURIComponent(id)); }
    async upload(file) {
        if (!file?.buffer || !file.originalname) throw new Error('A file is required');
        const mime = file.mimetype || 'application/octet-stream';
        const { data } = await this.http.post('/backend-api/files', {
            file_name: file.originalname, file_size: file.buffer.length, mime_type: mime, use_case: 'multimodal'
        });
        const url = new URL(data.upload_url);
        if (url.protocol !== 'https:') throw new Error('Invalid upload URL');
        // A separate client prevents forwarding account credentials to blob storage.
        await axios.put(url.href, file.buffer, { headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': mime }, timeout: 180000 });
        await this.http.post('/backend-api/files/' + encodeURIComponent(data.file_id) + '/uploaded', {});
        const attachment = { id: data.file_id, name: file.originalname, mime_type: mime, size: file.buffer.length };
        if (!mime.startsWith('image/')) return { attachment };
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) throw new Error('Unsupported image format');
        let width = 1024, height = 1024;
        if (mime === 'image/png' && file.buffer.length >= 24 && file.buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
            width = file.buffer.readUInt32BE(16); height = file.buffer.readUInt32BE(20);
        }
        return { attachment, part: { content_type: 'image_asset_pointer', asset_pointer: 'file-service://' + data.file_id,
            size_bytes: file.buffer.length, width, height } };
    }
    async send(prompt, options = {}) {
        const context = options.context || {};
        const cid = context.conversationId || options.conversationId;
        let parent = context.parentMessageId || crypto.randomUUID();
        if (cid) {
            const conversation = await this.conversation(cid);
            if (!conversation.current_node) throw new Error('ChatGPT conversation has no current node');
            parent = conversation.current_node;
            const project = conversation.gizmo_id || conversation.conversation_mode?.gizmo_id;
            if (options.projectId && project && project !== options.projectId) throw new Error('Conversation belongs to another project');
        }
        const attachments = options.attachments || [];
        const parts = [...attachments.map(a => a.part).filter(Boolean), prompt];
        const metadata = { ...(attachments.length ? { attachments: attachments.map(a => a.attachment) } : {}),
            ...(options.projectId ? { gizmo_id: options.projectId } : {}) };
        const body = {
            action: 'next', messages: [{ id: crypto.randomUUID(), author: { role: 'user' },
                content: { content_type: parts.length > 1 ? 'multimodal_text' : 'text', parts },
                status: 'finished_successfully', recipient: 'all', metadata }],
            parent_message_id: parent, model: options.model || 'auto', timezone: options.timezone || 'Asia/Baghdad',
            timezone_offset_min: options.timezoneOffsetMin ?? 180, history_and_training_disabled: false,
            force_use_sse: true, stream: true, websocket_request_id: crypto.randomUUID(),
            ...(cid ? { conversation_id: cid } : {}),
            ...(options.projectId ? { conversation_mode: { kind: 'gizmo_interaction', gizmo_id: options.projectId }, conversation_origin: 'tpp' } : {}),
            // Optional account backend field; availability depends on the selected model/account.
            ...(options.reasoningEffort && options.reasoningEffort !== 'auto' ? { thinking_effort: options.reasoningEffort } : {})
        };
        const response = await this.http.post('/backend-api/conversation', body, { responseType: 'stream', timeout: options.timeout || 300000 });
        let text = '', conversationId = cid, messageId, finished = false;
        await readLines(response.data, line => {
            if (!line.startsWith('data:')) return;
            const raw = line.slice(5).trim();
            if (raw === '[DONE]') return;
            let event;
            try { event = JSON.parse(raw); } catch (_) { throw new Error('Malformed ChatGPT stream event'); }
            if (event.error) throw new Error('ChatGPT stream reported an error');
            conversationId = event.conversation_id || conversationId;
            const m = event.message;
            if (m?.author?.role !== 'assistant' || (m.channel && m.channel !== 'final')) return;
            const value = m.content?.parts?.filter(p => typeof p === 'string').join('');
            if (value) { text = value; messageId = m.id; }
            if (m.status === 'finished_successfully' || m.end_turn === true) finished = true;
        });
        if (!text.trim()) throw new Error('ChatGPT returned an empty answer');
        if (!finished) throw new Error('ChatGPT response ended before completion');
        context.conversationId = conversationId;
        context.parentMessageId = messageId;
        return text;
    }
}
module.exports = { ChatGPTAndroid };
