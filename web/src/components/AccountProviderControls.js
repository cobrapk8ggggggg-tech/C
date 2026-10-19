import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, ActivityIndicator, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import api from '../services/api';

export const ACCOUNT_FIELDS = ['chatgptAccountId', 'reasoningEffort', 'geminiAccountIndex', 'geminiBuildLabel',
  'geminiModelHeader', 'allowGuestFallback', 'temperature', 'maxTokens', 'presencePenalty', 'frequencyPenalty',
  'geminiParagraphMode', 'translationChunkChars', 'taskConversations'];
const TASKS = [['translation', 'الترجمة'], ['glossary', 'المصطلحات'], ['review', 'المراجعة'], ['titles', 'العناوين'], ['metadata', 'البيانات']];
const buttonStyle = { padding: 10, backgroundColor: '#263548', borderRadius: 7, marginVertical: 4 };
const labelStyle = { color: '#ddd', textAlign: 'right', marginVertical: 5 };
const inputStyle = { borderWidth: 1, borderColor: '#536176', borderRadius: 6, padding: 9, color: '#fff', marginBottom: 8 };

export default function AccountProviderControls({ provider, onChange, onModels, showToast }) {
  const gpt = /^chatgpt(?:_|$)/i.test(provider.providerId);
  const gemini = /^gemini_web(?:_|$)/i.test(provider.providerId);
  const [purpose, setPurpose] = useState('translation');
  const [projects, setProjects] = useState([]);
  const [chats, setChats] = useState([]);
  const [chatProjectId, setChatProjectId] = useState('');
  const [chatOffset, setChatOffset] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [reply, setReply] = useState('');
  const task = provider.taskConversations?.[purpose] || {};
  const changeTask = patch => onChange('taskConversations', { ...provider.taskConversations, [purpose]: { ...task, ...patch } });
  const run = async fn => { setBusy(true); try { await fn(); } catch (e) { showToast(e.response?.data?.message || 'فشل طلب المزوّد', 'error'); } finally { setBusy(false); } };
  const request = async (action, body = {}) => (await api.post('/api/translator/accounts/' + action, { provider, ...body })).data;
  const field = (label, name, numeric = false, value = provider[name], setter = v => onChange(name, v)) => (
    <View key={name}><Text style={labelStyle}>{label}</Text><TextInput accessibilityLabel={label} style={inputStyle}
      value={String(value ?? '')} onChangeText={v => setter(numeric ? (v === '' ? '' : Number(v)) : v)}
      keyboardType={numeric ? 'numeric' : 'default'} autoCapitalize="none" autoCorrect={false} /></View>
  );
  const button = (label, fn, selected = false) => <TouchableOpacity key={label} accessibilityRole="button" accessibilityState={{ disabled: busy, selected }}
    disabled={busy} style={[buttonStyle, selected && { borderWidth: 1, borderColor: '#5bbbf7' }]} onPress={() => run(fn)}><Text style={labelStyle}>{label}</Text></TouchableOpacity>;
  const send = async createNew => {
    if (!prompt.trim()) { showToast('اكتب رسالة أولاً', 'warning'); return; }
    const data = await request('send', { purpose, prompt, createNew, attachments });
    setReply(data.reply); setAttachments([]);
    if (data.context?.conversationId) changeTask({ ...data.context, mode: 'reuse' });
    showToast('وصل الرد؛ احفظ الإعدادات لتثبيت اختيار المحادثة', 'success');
  };
  const upload = async () => {
    const selected = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (selected.canceled) return;
    const asset = selected.assets[0];
    const data = new FormData(); data.append('provider', JSON.stringify(provider));
    if (Platform.OS === 'web') {
      data.append('file', await (await fetch(asset.uri)).blob(), asset.name);
    } else {
      data.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' });
    }
    const response = await api.post('/api/translator/accounts/upload', data, { headers: { 'Content-Type': 'multipart/form-data' } });
    setAttachments(prev => [...prev, { ...response.data.attachment, displayName: asset.name }]);
  };
  return <View style={{ marginVertical: 12 }}>
    <Text style={labelStyle}>إعدادات الحساب والمحادثات حسب المهمة</Text>
    {busy && <ActivityIndicator accessibilityLabel="جارٍ الاتصال بالمزوّد" />}
    {gemini && <View><View style={{ flexDirection: 'row', alignItems: 'center' }}><Switch accessibilityLabel="تقسيم الفصل وفحص الفقرات" value={provider.geminiParagraphMode !== false} onValueChange={v => onChange('geminiParagraphMode', v)} /><Text style={labelStyle}>تقسيم الفصل وفحص الفقرات (Gemini فقط)</Text></View><Text style={labelStyle}>عند التعطيل يُرسل الفصل كاملًا دون تقسيم أو علامات للفقرات.</Text>{provider.geminiParagraphMode !== false && field('حجم جزء الترجمة بالأحرف (500–6000)', 'translationChunkChars', true, provider.translationChunkChars ?? 2400)}</View>}
    {gpt && <>
      {field('معرّف حساب ChatGPT (اختياري إذا كان ضمن التوكن)', 'chatgptAccountId')}
      {field('مستوى التفكير (auto / light / standard / extended / heavy؛ يعتمد على النموذج)', 'reasoningEffort', false, provider.reasoningEffort || 'auto')}
      <Text style={labelStyle}>التحكم بالتفكير يُرسل إلى خادم الحساب؛ يحتاج تحققًا حيًا من دعمه في النموذج.</Text>
    </>}
    {gemini && <>
      {field('رقم حساب Google (/u/0 أو /u/1)', 'geminiAccountIndex', true, provider.geminiAccountIndex ?? 1)}
      {field('Build label (فارغ = قيمة الملف المرفق)', 'geminiBuildLabel')}
      {field('ترويسة النموذج JSPB (فارغة = adaptive من الملف)', 'geminiModelHeader')}
      <Text style={labelStyle}>الملف المرفق لا يثبت التحكم بالتفكير أو جلب قائمة المحادثات في Gemini. اختيار المحادثة بمعرّفات الخادم أدناه.</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}><Switch value={provider.allowGuestFallback === true} onValueChange={v => onChange('allowGuestFallback', v)} accessibilityLabel="السماح بوضع الضيف" /><Text style={labelStyle}>السماح بوضع الضيف عند فشل الحساب</Text></View>
    </>}
    {!gemini && !gpt && <>
      {field('Temperature', 'temperature', true, provider.temperature ?? 0.7)}
      {field('Max tokens', 'maxTokens', true, provider.maxTokens ?? 16384)}
      {field('Presence penalty', 'presencePenalty', true, provider.presencePenalty ?? 0)}
      {field('Frequency penalty', 'frequencyPenalty', true, provider.frequencyPenalty ?? 0)}
    </>}
    {TASKS.map(([id, name]) => button(name, async () => { setPurpose(id); }, purpose === id))}
    {[['per_job', 'محادثة مستقلة لكل مهمة تشغيل'], ['new', 'محادثة جديدة لكل طلب'], ['reuse', 'استخدام المحادثة المختارة']].map(([id, name]) => button(name, async () => changeTask({ mode: id }), (task.mode || 'per_job') === id))}
    {gpt && field('معرّف المشروع لهذه المهمة (فارغ = خارج المشاريع)', 'projectId', false, task.projectId, v => changeTask({ projectId: v, conversationId: '', mode: 'per_job' }))}
    {field('معرّف المحادثة لهذه المهمة', 'conversationId', false, task.conversationId, v => changeTask({ conversationId: v }))}
    {gemini && <>
      {field('Response ID', 'responseId', false, task.responseId, v => changeTask({ responseId: v }))}
      {field('Choice ID', 'choiceId', false, task.choiceId, v => changeTask({ choiceId: v }))}
    </>}
    {!gemini && !gpt && field('Parent message ID للمحادثة الموجودة', 'parentMessageId', false, task.parentMessageId, v => changeTask({ parentMessageId: v }))}
    {!gemini && field('نموذج هذه المهمة (فارغ = نموذج المزوّد)', 'model', false, task.model, v => changeTask({ model: v }))}
    {gpt && field('تفكير هذه المهمة (auto = إعداد المزوّد)', 'reasoningEffort', false, task.reasoningEffort || 'auto', v => changeTask({ reasoningEffort: v }))}
    {(gpt || gemini) && button('جلب النماذج', async () => onModels((await request('models')).models))}
    {gpt && <>
      {button('جلب المشاريع', async () => { const d = await request('projects'); setProjects(d.items || []); setCursor(d.cursor || d.next_cursor); })}
      {cursor && button('مزيد من المشاريع', async () => { const d = await request('projects', { cursor }); setProjects(prev => [...prev, ...(d.items || [])]); setCursor(d.cursor || d.next_cursor); })}
      {projects.map(p => <View key={p.id}>{button('مشروع: ' + p.name, async () => { changeTask({ projectId: p.id, conversationId: '', mode: 'per_job' }); setChats(p.chats || []); setChatProjectId(p.id); }, task.projectId === p.id)}</View>)}
      {button('جلب المحادثات العامة', async () => { const d = await request('chats'); setChats(d.items || []); setChatProjectId(''); setChatOffset(50); })}
      {button('مزيد من المحادثات العامة', async () => { const d = await request('chats', { offset: chatOffset }); setChats(prev => [...prev, ...(d.items || [])]); setChatOffset(prev => prev + 50); })}
      {chats.map(c => <View key={c.id}>{button(c.title || c.id, async () => {
        const d = await request('conversation', { conversationId: c.id });
        changeTask({ conversationId: c.id, projectId: d.projectId || chatProjectId, mode: 'reuse' });
      }, task.conversationId === c.id)}</View>)}
    </>}
    {(gpt || gemini) && <>
      {button('إرفاق صورة أو ملف', upload)}
      {attachments.map((a, i) => <Text key={i} style={labelStyle}>{a.displayName}</Text>)}
      {!!attachments.length && button('مسح المرفقات المجهزة', async () => setAttachments([]))}
      {field('رسالة لتجربة المحادثة أو إنشائها', 'prompt', false, prompt, setPrompt)}
      {button('إرسال إلى المحادثة المختارة', () => send(false))}
      {button(gpt && task.projectId ? 'إنشاء محادثة في المشروع وإرسال الرسالة' : 'إنشاء محادثة جديدة وإرسال الرسالة', () => send(true))}
      {!!reply && <Text selectable style={labelStyle}>{reply}</Text>}
    </>}
  </View>;
}
