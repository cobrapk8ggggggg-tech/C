const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const renderer = require('react-test-renderer');
const babel = require('@babel/core');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function renderPanel(initial = {}, responder = async () => ({})) {
    const requests = [], changes = [], toasts = [], models = [];
    const filename = path.resolve(__dirname, '../src/components/AccountProviderControls.js');
    const compiled = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
        filename, babelrc: false, configFile: false,
        presets: [require.resolve('@babel/preset-react')], plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')]
    }).code;
    const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
    mod.require = name => {
        if (name === 'react-native') return { View: 'View', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', Switch: 'Switch', ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'web' } };
        if (name === 'expo-document-picker') return { getDocumentAsync: async () => ({ canceled: true }) };
        if (name === '../services/api') return { __esModule: true, default: { post: async (url, body) => { requests.push({ url, body }); return { data: await responder(url, body) }; } } };
        return require(name);
    };
    mod._compile(compiled, filename); const Panel = mod.exports.default;
    let current;
    function Harness() {
        const [provider, setProvider] = React.useState({ providerId: 'chatgpt_1', apiKeys: ['test'], taskConversations: {}, ...initial });
        current = provider;
        return React.createElement(Panel, { provider, onChange: (key, value) => { changes.push([key, value]); setProvider(p => ({ ...p, [key]: value })); }, onModels: value => models.push(value), showToast: (...args) => toasts.push(args) });
    }
    let tree;
    await renderer.act(async () => { tree = renderer.create(React.createElement(Harness)); });
    const buttons = () => tree.root.findAllByType('TouchableOpacity');
    const click = async label => {
        const found = buttons().find(b => b.findAllByType('Text').some(t => t.props.children === label));
        assert.ok(found, 'Button exists: ' + label);
        await renderer.act(async () => { await found.props.onPress(); });
    };
    const input = async (label, value) => {
        const found = tree.root.findAllByType('TextInput').find(i => i.props.accessibilityLabel === label);
        assert.ok(found, 'Input exists: ' + label);
        await renderer.act(async () => found.props.onChangeText(value));
    };
    const close = async () => { await renderer.act(async () => tree.unmount()); };
    return { tree, requests, changes, toasts, models, click, input, close, current: () => current };
}
test('UI stores separate translation, glossary and review conversations', async () => {
    const panel = await renderPanel();
    await panel.input('معرّف المحادثة لهذه المهمة', 'translation-chat');
    await panel.click('المصطلحات'); await panel.input('معرّف المحادثة لهذه المهمة', 'glossary-chat');
    await panel.click('المراجعة'); await panel.input('معرّف المحادثة لهذه المهمة', 'review-chat');
    assert.equal(panel.current().taskConversations.translation.conversationId, 'translation-chat');
    assert.equal(panel.current().taskConversations.glossary.conversationId, 'glossary-chat');
    assert.equal(panel.current().taskConversations.review.conversationId, 'review-chat'); await panel.close();
});
test('UI browses projects, selects their chat, and preserves the project ID', async () => {
    const panel = await renderPanel({}, async url => url.endsWith('/projects') ? { items: [{ id: 'p', name: 'Novel', chats: [{ id: 'c', title: 'Terminology' }] }] } : { projectId: 'p' });
    await panel.click('جلب المشاريع'); await panel.click('مشروع: Novel'); await panel.click('Terminology');
    const task = panel.current().taskConversations.translation;
    assert.equal(task.projectId, 'p'); assert.equal(task.conversationId, 'c'); assert.equal(task.mode, 'reuse');
    assert.ok(panel.requests.some(r => r.url.endsWith('/conversation'))); await panel.close();
});
test('UI creates a conversation in selected project and captures returned IDs', async () => {
    const panel = await renderPanel({ taskConversations: { translation: { projectId: 'p' } } }, async () => ({ reply: 'تم الإنشاء.', context: { conversationId: 'new-c', parentMessageId: 'n' } }));
    await panel.input('رسالة لتجربة المحادثة أو إنشائها', 'Create novel translation chat');
    await panel.click('إنشاء محادثة في المشروع وإرسال الرسالة');
    assert.equal(panel.requests[0].body.createNew, true); assert.equal(panel.requests[0].body.provider.taskConversations.translation.projectId, 'p');
    assert.equal(panel.current().taskConversations.translation.conversationId, 'new-c'); await panel.close();
});
test('UI fetches account models through account endpoint', async () => {
    const panel = await renderPanel({}, async () => ({ models: [{ modelId: 'gpt-test', modelName: 'Test' }] }));
    await panel.click('جلب النماذج'); assert.equal(panel.models[0][0].modelId, 'gpt-test'); await panel.close();
});
test('Gemini UI offers account index and conversation IDs and explains unsupported thinking', async () => {
    const panel = await renderPanel({ providerId: 'gemini_web_1' });
    await panel.input('رقم حساب Google (/u/0 أو /u/1)', '0');
    await panel.input('Response ID', 'r'); await panel.input('Choice ID', 'choice');
    assert.equal(panel.current().geminiAccountIndex, 0);
    assert.equal(panel.current().taskConversations.translation.responseId, 'r');
    assert.ok(panel.tree.root.findAllByType('Text').some(t => typeof t.props.children === 'string' && t.props.children.includes('لا يثبت التحكم بالتفكير')));
    await panel.close();
});
test('DeepSeek Worker UI stores zero temperature and max output tokens', async () => {
    const panel = await renderPanel({ providerId: 'deepseek_worker_1' });
    await panel.input('Temperature', '0'); await panel.input('Max tokens', '30000');
    assert.equal(panel.current().temperature, 0); assert.equal(panel.current().maxTokens, 30000); await panel.close();
});
test('UI shows provider failures without overwriting selected conversation', async () => {
    const panel = await renderPanel({ taskConversations: { translation: { conversationId: 'keep-c' } } }, async () => { throw { response: { data: { message: 'Provider HTTP 401' } } }; });
    await panel.click('جلب المشاريع'); assert.equal(panel.toasts.at(-1)[0], 'Provider HTTP 401');
    assert.equal(panel.current().taskConversations.translation.conversationId, 'keep-c'); await panel.close();
});

test('Settings screen load and save preserves all new fields; model fetch updates do not overwrite each other', async () => {
    const fields = ['chatgptAccountId','reasoningEffort','geminiAccountIndex','geminiBuildLabel','geminiModelHeader','allowGuestFallback','temperature','maxTokens','presencePenalty','frequencyPenalty','translationChunkChars','taskConversations'];
    const provider = { providerId: 'chatgpt_1', name: 'ChatGPT', apiKeys: ['test-token'], models: [{ modelId: 'old', modelName: 'Old' }],
        selectedModel: 'old', chatgptAccountId: 'a', reasoningEffort: 'extended', translationChunkChars: 1700,
        taskConversations: { translation: { projectId: 'p', conversationId: 'c', mode: 'reuse' }, glossary: { conversationId: 'g', mode: 'reuse' }, review: { conversationId: 'r', mode: 'reuse' } } };
    let saved;
    const native = Object.fromEntries(['View','Text','TouchableOpacity','ScrollView','TextInput','ActivityIndicator','StatusBar','ImageBackground','Switch','Modal'].map(x => [x, x]));
    native.StyleSheet = { create: x => x, absoluteFill: {} }; native.Alert = { alert: () => {} };
    const filename = path.resolve(__dirname, '../src/screens/TranslatorSettingsScreen.js');
    const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, babelrc: false, configFile: false, presets: [require.resolve('@babel/preset-react')], plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
    const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
    mod.require = name => {
        if (name === 'react-native') return native;
        if (name === '@expo/vector-icons') return { Ionicons: 'Ionicons' };
        if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
        if (name === 'expo-linear-gradient') return { LinearGradient: 'LinearGradient' };
        if (name === '../context/ToastContext') return { useToast: () => ({ showToast: () => {} }) };
        if (name === '../components/AccountProviderControls') return { __esModule: true, default: 'AccountPanel', ACCOUNT_FIELDS: fields };
        if (name === '../services/api') return { __esModule: true, default: { get: async () => ({ data: { translationProviders: [provider] } }), post: async (url, body) => { saved = body; return { data: {} }; } } };
        if (name.endsWith('.png')) return 1;
        return require(name);
    };
    mod._compile(code, filename);
    let tree;
    await renderer.act(async () => { tree = renderer.create(React.createElement(mod.exports.default, { navigation: { goBack: () => {} } })); });
    const open = tree.root.findAllByType('TouchableOpacity').find(x => x.findAllByType('Text').some(t => t.props.children === 'ChatGPT'));
    await renderer.act(async () => open.props.onPress());
    const controls = tree.root.findByType('AccountPanel');
    await renderer.act(async () => controls.props.onModels([{ modelId: 'new', modelName: 'New' }]));
    const save = tree.root.findAllByType('TouchableOpacity').find(x => x.findAllByType('Text').some(t => typeof t.props.children === 'string' && t.props.children.includes('حفظ')));
    assert.ok(save);
    await renderer.act(async () => save.props.onPress());
    const actual = saved.translationProviders[0];
    assert.equal(actual.models[0].modelId, 'new'); assert.equal(actual.selectedModel, 'new');
    assert.equal(actual.taskConversations.translation.projectId, 'p'); assert.equal(actual.taskConversations.glossary.conversationId, 'g');
    assert.equal(actual.taskConversations.review.conversationId, 'r'); assert.equal(actual.reasoningEffort, 'extended');
    assert.equal(actual.chatgptAccountId, 'a'); assert.equal(actual.translationChunkChars, 1700);
    await renderer.act(async () => tree.unmount());
});

test('Project chat selection preserves its project even if conversation inspection omits project metadata', async () => {
    const panel = await renderPanel({}, async url => url.endsWith('/projects') ? { items: [{ id: 'project-p', name: 'Novel', chats: [{ id: 'c', title: 'Chapter chat' }] }] } : {});
    await panel.click('جلب المشاريع'); await panel.click('مشروع: Novel'); await panel.click('Chapter chat');
    assert.equal(panel.current().taskConversations.translation.projectId, 'project-p'); await panel.close();
});
